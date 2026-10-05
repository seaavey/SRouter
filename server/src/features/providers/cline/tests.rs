use serde_json::{Value, json};

use crate::features::providers::cline::catalog::read_catalog;
use crate::features::providers::cline::types::ClineEndpoints;
use crate::infrastructure::database::providers::ClineCredentials;
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::model::ChatCompletionRequest;

use super::auth::{
    TOKEN_REFRESH_FALLBACK_MS, TOKEN_REFRESH_LEAD_MS, bearer_token, parse_rfc3339_ms,
    token_refresh_is_due,
};
use super::executor::ClineExecutor;
use super::request::{model_requires_reasoning, strip_cline_prefix, strip_reasoning_disables};
use super::translate::{Aggregator, DecodedFrame, EventDecoder};

fn request() -> ChatCompletionRequest {
    serde_json::from_value(json!({
        "model": "cline/openai/gpt-5",
        "messages": [{"role": "user", "content": "hello"}]
    }))
    .expect("request parses")
}

fn credentials(expires_at: Option<i64>, refreshed_at: Option<i64>) -> ClineCredentials {
    ClineCredentials {
        id: "cline-account".to_owned(),
        access_token: "workos:access".to_owned(),
        refresh_token: Some("workos:refresh".to_owned()),
        token_expires_at: expires_at,
        last_refreshed_at: refreshed_at,
    }
}

#[test]
fn executor_contract_uses_static_metadata_and_public_catalog() {
    let executor = ClineExecutor::new(
        ClineEndpoints::default(),
        None,
        UpstreamClient::new().expect("client"),
    );

    assert_eq!(executor.id(), "cline");
    assert_eq!(executor.keys(), &["cline"]);
    assert_eq!(executor.alias(), "cline");
    assert!(executor.models().is_empty());
    assert!(read_catalog(&executor.catalog).is_empty());
    assert_eq!(
        executor.model_id_variants("cline/OpenAI/GPT-5"),
        vec!["openai/gpt-5"]
    );
}

#[test]
fn request_body_uses_the_bare_model_and_always_streams() {
    let mut body = serde_json::to_value(request()).expect("request serializes");
    let model = strip_cline_prefix("cline/openai/gpt-5");
    body["model"] = Value::String(model.to_owned());
    body["stream"] = Value::Bool(true);

    assert_eq!(body["model"], "openai/gpt-5");
    assert_eq!(body["stream"], true);
}

#[test]
fn mandatory_reasoning_models_are_matched_on_the_upstream_key() {
    assert!(model_requires_reasoning(
        "cline-free/muse-spark-1.3-contributor"
    ));
    assert!(model_requires_reasoning(
        "cline/cline-free/Muse-Spark-1.3-Contributor"
    ));
    assert!(!model_requires_reasoning("cline-free/deepseek-v4.1-flash"));
    assert!(!model_requires_reasoning("anthropic/claude-sonnet-5.5"));
}

#[test]
fn disabling_effort_is_dropped_only_where_reasoning_is_mandatory() {
    let mut body = json!({
        "model": "cline-free/muse-spark-1.3-contributor",
        "reasoning_effort": "none",
        "reasoning": {"effort": "none", "summary": "auto"},
        "temperature": 0.2
    });
    strip_reasoning_disables(&mut body);

    assert!(
        body.get("reasoning_effort").is_none(),
        "the disable must not reach an endpoint that mandates reasoning: {body}"
    );
    assert_eq!(body["reasoning"], json!({"summary": "auto"}));
    assert_eq!(body["temperature"], 0.2);

    let mut kept = json!({"reasoning_effort": "low", "reasoning": {"effort": "medium"}});
    strip_reasoning_disables(&mut kept);
    assert_eq!(
        kept,
        json!({"reasoning_effort": "low", "reasoning": {"effort": "medium"}}),
        "a real effort level is the caller's choice and stays untouched"
    );
}

#[test]
fn workos_prefix_is_added_exactly_once() {
    assert_eq!(bearer_token("token"), "Bearer workos:token");
    assert_eq!(bearer_token("workos:token"), "Bearer workos:token");
}

#[test]
fn refresh_due_uses_expiry_lead_and_twelve_hour_fallback() {
    let now = 1_000_000_000;
    assert!(token_refresh_is_due(
        &credentials(Some(now + TOKEN_REFRESH_LEAD_MS), Some(now)),
        now
    ));
    assert!(!token_refresh_is_due(
        &credentials(Some(now + TOKEN_REFRESH_LEAD_MS + 1), Some(now)),
        now
    ));
    assert!(token_refresh_is_due(&credentials(None, None), now));
    assert!(token_refresh_is_due(
        &credentials(None, Some(now - TOKEN_REFRESH_FALLBACK_MS)),
        now
    ));
}

#[test]
fn rfc3339_expiry_is_converted_to_epoch_milliseconds() {
    assert_eq!(
        parse_rfc3339_ms("2023-11-14T22:13:20.123Z"),
        Some(1_700_000_000_123)
    );
    assert_eq!(
        parse_rfc3339_ms("2023-11-14T22:13:20Z"),
        Some(1_700_000_000_000)
    );
}

#[test]
fn a_non_utc_expiry_degrades_to_an_unknown_expiry() {
    assert_eq!(
        parse_rfc3339_ms("2023-11-14T23:13:20+01:00"),
        None,
        "only the UTC shape upstream ships is parsed; anything else leaves the expiry unknown"
    );
    assert_eq!(parse_rfc3339_ms("not a date"), None);
}

#[test]
fn fragmented_events_and_done_are_emitted_once() {
    let mut decoder = EventDecoder::default();
    assert!(decoder.push(b"data: {\"choices\":[{").is_empty());
    let frames = decoder.push(b"\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n");

    assert_eq!(frames.len(), 2);
    assert!(matches!(frames[0], DecodedFrame::Data(_)));
    assert!(matches!(frames[1], DecodedFrame::Done));
    assert!(decoder.finish().is_empty());
}

#[test]
fn both_stream_error_shapes_become_errors() {
    let mut decoder = EventDecoder::default();
    let root = decoder.push(b"data: {\"error\":\"root failure\"}\n\n");
    assert!(matches!(&root[0], DecodedFrame::Error(error) if error.message() == "root failure"));

    let mut decoder = EventDecoder::default();
    let choice = decoder.push(
            b"data: {\"choices\":[{\"finish_reason\":\"error\",\"error\":{\"message\":\"choice failure\"}}]}\n\n",
        );
    assert!(
        matches!(&choice[0], DecodedFrame::Error(error) if error.message() == "choice failure")
    );
}

#[test]
fn aggregator_reassembles_content_reasoning_tools_and_cost() {
    let mut aggregator = Aggregator::new("openai/gpt-5");
    for value in [
        json!({"choices":[{"delta":{"content":"hel","reasoning":"why "},"finish_reason":null}]}),
        json!({"choices":[{"delta":{"content":"lo","reasoning":"not","tool_calls":[{"index":0,"id":"call-1","function":{"name":"search","arguments":"{\"q\""}}]},"finish_reason":null}]}),
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\"rust\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5,"cost":0.01}}),
    ] {
        aggregator
            .accept(DecodedFrame::Data(value))
            .expect("chunk accepts");
    }

    let response = aggregator.finish(&request()).expect("response builds");
    assert_eq!(response["choices"][0]["message"]["content"], "hello");
    assert_eq!(response["choices"][0]["message"]["reasoning"], "why not");
    assert_eq!(
        response["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
        r#"{"q":"rust"}"#
    );
    assert_eq!(response["usage"]["cost"], 0.01);
}

#[test]
fn success_envelopes_unwrap_and_failure_envelopes_error() {
    let mut decoder = EventDecoder::default();
    let frames = decoder.push(
        b"data: {\"success\":true,\"data\":{\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}}\n\n",
    );
    assert!(
        matches!(&frames[0], DecodedFrame::Data(value) if value["choices"][0]["delta"]["content"] == "ok")
    );

    let mut decoder = EventDecoder::default();
    let frames = decoder.push(b"data: {\"success\":false,\"error\":\"denied\"}\n\n");
    assert!(matches!(&frames[0], DecodedFrame::Error(error) if error.message() == "denied"));
}
