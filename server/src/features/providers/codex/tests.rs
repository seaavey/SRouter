use axum::body::Bytes;
use futures_util::StreamExt;
use serde_json::{Value, json};

use crate::features::providers::adapter::ProviderStream;
use crate::features::providers::codex::types::CodexEndpoints;
use crate::infrastructure::database::providers::CodexCredentials;
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::model::ChatCompletionRequest;

use super::auth::token_refresh_is_due;
use super::executor::CodexExecutor;
use super::request::upstream_body;
use super::translate::{DecodedFrame, EventDecoder, ResponsesEvent, Translator, translate_stream};

fn parse(value: Value) -> ChatCompletionRequest {
    serde_json::from_value(value).expect("request parses")
}

fn simple_request() -> ChatCompletionRequest {
    parse(json!({
        "model": "openai_codex/gpt-6.1-sol",
        "messages": [
            {"role": "system", "content": "be terse"},
            {"role": "user", "content": "hello"}
        ]
    }))
}

fn sse(events: &[Value]) -> String {
    let mut body = String::new();
    for event in events {
        body.push_str("event: ");
        body.push_str(event["type"].as_str().unwrap_or("message"));
        body.push_str("\ndata: ");
        body.push_str(&event.to_string());
        body.push_str("\n\n");
    }
    body
}

fn text_events() -> Vec<Value> {
    vec![
        json!({"type": "response.created", "response": {"id": "resp_1"}}),
        json!({"type": "response.output_text.delta", "delta": "Hello"}),
        json!({"type": "response.output_text.delta", "delta": " world"}),
        json!({
            "type": "response.completed",
            "response": {
                "usage": {
                    "input_tokens": 5,
                    "output_tokens": 7,
                    "input_tokens_details": {"cached_tokens": 2}
                }
            }
        }),
    ]
}

async fn collect(stream: ProviderStream) -> String {
    let frames: Vec<Bytes> = stream.collect().await;
    frames
        .iter()
        .map(|frame| String::from_utf8_lossy(frame))
        .collect()
}

#[test]
fn executor_contract_uses_live_catalog_and_needs_a_connection() {
    let executor = CodexExecutor::new(
        CodexEndpoints::default(),
        None,
        UpstreamClient::new().expect("client"),
    );

    assert_eq!(executor.id(), "openai_codex");
    assert_eq!(executor.keys(), &["openai_codex", "codex"]);
    assert_eq!(executor.alias(), "openai_codex");
    assert!(
        executor.models().is_empty(),
        "the catalog is empty until a live fetch confirms models"
    );
    assert_eq!(
        executor.model_id_variants("openai_codex/GPT-6-Luna"),
        vec!["gpt-6-luna", "gpt-6.luna"]
    );
}

#[test]
fn upstream_body_carries_the_responses_shape() {
    let mut request = simple_request();
    request.max_tokens = Some(256);
    request.reasoning_effort = Some("high".to_owned());

    let body = upstream_body("gpt-6.1-sol", &request).expect("body");

    assert_eq!(body["model"], "gpt-6.1-sol");
    assert_eq!(body["stream"], true);
    assert_eq!(body["store"], false);
    assert_eq!(body["max_output_tokens"], 256);
    assert_eq!(body["reasoning"]["effort"], "high");
    assert!(body.get("tools").is_none());
    assert!(body.get("text").is_none());

    let input = body["input"].as_array().expect("input array");
    assert_eq!(input.len(), 2);
    assert_eq!(input[0]["type"], "message");
    assert_eq!(input[0]["role"], "developer");
    assert_eq!(input[0]["content"][0]["type"], "input_text");
    assert_eq!(input[0]["content"][0]["text"], "be terse");
    assert_eq!(input[1]["role"], "user");
}

#[test]
fn tools_and_tool_results_use_the_responses_item_shapes() {
    let request = parse(json!({
        "model": "openai_codex/gpt-6.1-sol",
        "messages": [
            {"role": "user", "content": "weather?"},
            {"role": "assistant", "content": null, "tool_calls": [
                {"id": "call_1", "type": "function",
                 "function": {"name": "lookup", "arguments": "{\"q\":\"bmw\"}"}}
            ]},
            {"role": "tool", "tool_call_id": "call_1", "content": "sunny"}
        ],
        "tools": [
            {"type": "function", "function": {"name": "lookup",
             "parameters": {"type": "object"}}}
        ],
        "tool_choice": "auto"
    }));

    let body = upstream_body("gpt-6.1-sol", &request).expect("body");

    assert_eq!(body["tool_choice"], "auto");
    assert_eq!(body["tools"][0]["type"], "function");
    assert_eq!(body["tools"][0]["name"], "lookup");
    assert_eq!(body["tools"][0]["parameters"]["type"], "object");
    assert!(
        body["tools"][0].get("function").is_none(),
        "Responses tools are flat, not nested under `function`"
    );

    let input = body["input"].as_array().expect("input array");
    assert_eq!(input[1]["type"], "function_call");
    assert_eq!(input[1]["call_id"], "call_1");
    assert_eq!(input[1]["name"], "lookup");
    assert_eq!(input[2]["type"], "function_call_output");
    assert_eq!(input[2]["call_id"], "call_1");
    assert_eq!(input[2]["output"], "sunny");
}

#[test]
fn assistant_history_is_output_text_and_images_become_input_images() {
    let request = parse(json!({
        "model": "openai_codex/gpt-6.1-sol",
        "messages": [
            {"role": "user", "content": [
                {"type": "text", "text": "what is this"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}}
            ]},
            {"role": "assistant", "content": "it is a cat"}
        ]
    }));

    let body = upstream_body("gpt-6.1-sol", &request).expect("body");
    let input = body["input"].as_array().expect("input array");

    assert_eq!(input[0]["content"][0]["type"], "input_text");
    assert_eq!(input[0]["content"][1]["type"], "input_image");
    assert_eq!(
        input[0]["content"][1]["image_url"],
        "data:image/png;base64,AAA"
    );
    assert_eq!(input[1]["role"], "assistant");
    assert_eq!(input[1]["content"][0]["type"], "output_text");
}

#[test]
fn reasoning_none_is_still_sent_but_asks_for_no_trace() {
    let request = parse(json!({
        "model": "openai_codex/gpt-6.1-sol",
        "messages": [{"role": "user", "content": "hi"}],
        "reasoning": {"effort": "none"},
        "response_format": {"type": "text"}
    }));

    let body = upstream_body("gpt-6.1-sol", &request).expect("body");

    assert_eq!(
        body["reasoning"]["effort"], "none",
        "the level is always sent, `none` included"
    );
    assert_eq!(body["reasoning"]["summary"], "auto");
    assert!(
        body.get("include").is_none(),
        "a turn with reasoning off asks for no encrypted trace"
    );
    assert!(body.get("text").is_none());
}

#[test]
fn a_request_without_an_effort_runs_at_the_default_level() {
    let request = simple_request();

    let body = upstream_body("gpt-6.1-sol", &request).expect("body");

    assert_eq!(body["reasoning"]["effort"], "low");
    assert_eq!(body["reasoning"]["summary"], "auto");
    assert_eq!(body["include"][0], "reasoning.encrypted_content");
}

#[test]
fn an_unknown_effort_falls_back_instead_of_reaching_upstream() {
    let mut request = simple_request();
    request.reasoning_effort = Some("sok-ajaib".to_owned());

    let body = upstream_body("gpt-6.1-sol", &request).expect("body");

    assert_eq!(body["reasoning"]["effort"], "low");
}

#[test]
fn an_unknown_explicit_effort_lets_the_model_suffix_through() {
    let mut request = simple_request();
    request.reasoning_effort = Some("sok-ajaib".to_owned());

    let body = upstream_body("gpt-5.3-codex-high", &request).expect("body");

    assert_eq!(
        body["reasoning"]["effort"], "high",
        "an unusable explicit value must not shadow a real model level"
    );
}

#[test]
fn an_empty_explicit_effort_lets_the_model_suffix_through() {
    let mut request = simple_request();
    request.reasoning_effort = Some(String::new());

    let body = upstream_body("gpt-5.3-codex-high", &request).expect("body");

    assert_eq!(body["reasoning"]["effort"], "high");
}

#[test]
fn a_reasoning_effort_outranks_the_nested_reasoning_effort() {
    let mut request = simple_request();
    request.reasoning_effort = Some("high".to_owned());
    request.reasoning =
        Some(serde_json::from_value(json!({"effort": "minimal"})).expect("reasoning options"));

    let body = upstream_body("gpt-6.1-sol", &request).expect("body");

    assert_eq!(
        body["reasoning"]["effort"], "high",
        "the flat field is the one the official clients send"
    );
}

#[test]
fn a_level_is_normalized_before_it_reaches_upstream() {
    let mut request = simple_request();
    request.reasoning_effort = Some("HIGH".to_owned());

    let body = upstream_body("gpt-6.1-sol", &request).expect("body");

    assert_eq!(body["reasoning"]["effort"], "high");
}

#[test]
fn a_model_suffix_names_the_effort_and_leaves_the_model() {
    let request = simple_request();

    let body = upstream_body("gpt-5.3-codex-high", &request).expect("body");

    assert_eq!(body["model"], "gpt-5.3-codex");
    assert_eq!(body["reasoning"]["effort"], "high");
}

#[test]
fn an_explicit_effort_outranks_the_model_suffix() {
    let mut request = simple_request();
    request.reasoning_effort = Some("medium".to_owned());

    let body = upstream_body("gpt-5.3-codex-high", &request).expect("body");

    assert_eq!(body["model"], "gpt-5.3-codex");
    assert_eq!(body["reasoning"]["effort"], "medium");
}

#[test]
fn a_model_suffix_that_is_not_a_level_stays_in_the_id() {
    let request = simple_request();

    let body = upstream_body("gpt-6-luna", &request).expect("body");

    assert_eq!(body["model"], "gpt-6-luna");
    assert_eq!(body["reasoning"]["effort"], "low");
}

#[test]
fn json_schema_response_format_is_flattened_into_text_format() {
    let request = parse(json!({
        "model": "openai_codex/gpt-6.1-sol",
        "messages": [{"role": "user", "content": "hi"}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "person", "schema": {"type": "object"}, "strict": true}
        }
    }));

    let body = upstream_body("gpt-6.1-sol", &request).expect("body");

    assert_eq!(body["text"]["format"]["type"], "json_schema");
    assert_eq!(body["text"]["format"]["name"], "person");
    assert_eq!(body["text"]["format"]["schema"]["type"], "object");
    assert_eq!(body["text"]["format"]["strict"], true);
}

#[test]
fn decoder_reassembles_events_split_across_reads() {
    let payload = sse(&text_events());
    let mut decoder = EventDecoder::default();
    let mut frames = Vec::new();
    for chunk in payload.as_bytes().chunks(7) {
        frames.extend(decoder.push(chunk));
    }
    frames.extend(decoder.finish());

    assert_eq!(frames.len(), text_events().len());
    match &frames[1] {
        DecodedFrame::Event(ResponsesEvent::OutputTextDelta { delta }) => {
            assert_eq!(delta, "Hello")
        }
        other => panic!("expected data frame, got {other:?}"),
    }
}

#[test]
fn failed_responses_and_error_events_become_stream_errors() {
    let failed = sse(&[json!({
        "type": "response.failed",
        "response": {"error": {"message": "quota blown"}}
    })]);
    let mut decoder = EventDecoder::default();
    let frames = decoder.push(failed.as_bytes());
    match &frames[0] {
        DecodedFrame::Error(error) => assert_eq!(error.message(), "quota blown"),
        other => panic!("expected error frame, got {other:?}"),
    }

    let errored = sse(&[json!({"type": "error", "message": "bad request"})]);
    let mut decoder = EventDecoder::default();
    let frames = decoder.push(errored.as_bytes());
    match &frames[0] {
        DecodedFrame::Error(error) => assert_eq!(error.message(), "bad request"),
        other => panic!("expected error frame, got {other:?}"),
    }
}

#[tokio::test]
async fn streaming_path_emits_chat_chunks_and_one_terminator() {
    let stream = futures_util::stream::iter([Ok::<Bytes, reqwest::Error>(Bytes::from(sse(
        &text_events(),
    )))]);
    let body = collect(translate_stream(stream, "gpt-6.1-sol")).await;

    assert!(body.contains("\"content\":\"Hello\""), "{body}");
    assert!(body.contains("\"content\":\" world\""), "{body}");
    assert!(body.contains("\"finish_reason\":\"stop\""), "{body}");
    assert!(body.contains("\"prompt_tokens\":5"), "{body}");
    assert!(body.contains("\"completion_tokens\":7"), "{body}");
    assert!(body.contains("\"cached_tokens\":2"), "{body}");
    assert!(body.contains("\"model\":\"gpt-6.1-sol\""), "{body}");
    assert_eq!(body.matches("data: [DONE]").count(), 1, "{body}");
}

#[tokio::test]
async fn streaming_path_translates_function_calls_into_tool_call_deltas() {
    let events = vec![
        json!({"type": "response.output_item.added", "output_index": 1,
                   "item": {"type": "function_call", "call_id": "call_9",
                            "id": "fc_1", "name": "lookup", "arguments": ""}}),
        json!({"type": "response.function_call_arguments.delta", "output_index": 1,
                   "delta": "{\"q\":"}),
        json!({"type": "response.function_call_arguments.delta", "output_index": 1,
                   "delta": "\"bmw\"}"}),
        json!({"type": "response.completed", "response": {}}),
    ];
    let stream =
        futures_util::stream::iter([Ok::<Bytes, reqwest::Error>(Bytes::from(sse(&events)))]);
    let body = collect(translate_stream(stream, "gpt-6.1-sol")).await;

    assert!(body.contains("\"name\":\"lookup\""), "{body}");
    assert!(body.contains("\"arguments\":\"{\\\"q\\\":\""), "{body}");
    assert!(body.contains("\"finish_reason\":\"tool_calls\""), "{body}");
    assert_eq!(body.matches("data: [DONE]").count(), 1, "{body}");
}

#[tokio::test]
async fn a_failed_response_ends_the_stream_with_an_error_event() {
    let stream =
        futures_util::stream::iter([Ok::<Bytes, reqwest::Error>(Bytes::from(sse(&[json!({
            "type": "response.failed",
            "response": {"error": {"message": "quota blown"}}
        })])))]);
    let body = collect(translate_stream(stream, "gpt-6.1-sol")).await;

    assert!(body.contains("quota blown"), "{body}");
    assert!(!body.contains("[DONE]"), "{body}");
}

#[test]
fn buffered_translator_folds_text_tools_and_usage() {
    let mut translator = Translator::new("gpt-6.1-sol");
    translator.emit = false;
    let request = simple_request();

    let events = vec![
        json!({"type": "response.output_item.added", "output_index": 2,
                   "item": {"type": "function_call", "call_id": "call_1",
                            "id": "fc_1", "name": "lookup", "arguments": ""}}),
        json!({"type": "response.function_call_arguments.delta", "output_index": 2,
                   "delta": "{\"q\":\"bmw\"}"}),
        json!({"type": "response.output_text.delta", "delta": "checking"}),
        json!({
            "type": "response.completed",
            "response": {"usage": {"input_tokens": 5, "output_tokens": 7}}
        }),
    ];
    for event in events {
        translator
            .accept(DecodedFrame::Event(
                serde_json::from_value(event).expect("event parses"),
            ))
            .expect("event accepted");
    }

    let completion = translator.finish_buffered(&request).expect("completion");
    assert_eq!(completion["object"], "chat.completion");
    assert_eq!(completion["model"], "gpt-6.1-sol");
    assert_eq!(completion["choices"][0]["message"]["content"], "checking");
    assert_eq!(completion["choices"][0]["finish_reason"], "tool_calls");
    assert_eq!(
        completion["choices"][0]["message"]["tool_calls"][0]["id"],
        "call_1"
    );
    assert_eq!(
        completion["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
        "{\"q\":\"bmw\"}"
    );
    assert_eq!(completion["usage"]["prompt_tokens"], 5);
    assert_eq!(completion["usage"]["completion_tokens"], 7);
    assert_eq!(completion["usage"]["total_tokens"], 12);
}

#[test]
fn an_incomplete_response_cut_by_the_token_budget_reports_length() {
    let mut translator = Translator::new("gpt-6.1-sol");
    translator.emit = false;
    translator
        .accept(DecodedFrame::Event(
            serde_json::from_value(json!({
                "type": "response.incomplete",
                "response": {
                    "incomplete_details": {"reason": "max_output_tokens"},
                    "usage": {"input_tokens": 3, "output_tokens": 4}
                }
            }))
            .expect("event parses"),
        ))
        .expect("event accepted");

    let completion = translator
        .finish_buffered(&simple_request())
        .expect("completion");
    assert_eq!(completion["choices"][0]["finish_reason"], "length");
}

#[test]
fn token_refresh_window_follows_the_node_lead_time() {
    let credentials = CodexCredentials {
        id: "codex-account".to_owned(),
        access_token: "access".to_owned(),
        refresh_token: Some("refresh".to_owned()),
        account_id: Some("acct".to_owned()),
        token_expires_at: Some(1_000_000),
        last_refreshed_at: None,
    };

    assert!(!token_refresh_is_due(
        &credentials,
        1_000_000 - 6 * 60 * 1000
    ));
    assert!(token_refresh_is_due(
        &credentials,
        1_000_000 - 4 * 60 * 1000
    ));

    let unknown = CodexCredentials {
        token_expires_at: None,
        ..credentials.clone()
    };
    let never_refreshed = CodexCredentials {
        last_refreshed_at: None,
        ..unknown.clone()
    };
    // No expiry and no refresh yet: refresh at once (the Node rule).
    assert!(token_refresh_is_due(&never_refreshed, 60 * 60 * 1000));
    // No expiry but refreshed an hour ago: only stale tokens are refreshed.
    let refreshed_now = CodexCredentials {
        last_refreshed_at: Some(60 * 60 * 1000),
        ..unknown.clone()
    };
    assert!(!token_refresh_is_due(&refreshed_now, 60 * 60 * 1000));
    let refreshed_long_ago = CodexCredentials {
        last_refreshed_at: Some(0),
        ..unknown.clone()
    };
    assert!(token_refresh_is_due(
        &refreshed_long_ago,
        13 * 60 * 60 * 1000
    ));
}
