use serde_json::json;

use super::request::{build_body, requested_key};
use super::translate::{Aggregator, EnvelopeTranslator, data_payload};
use crate::features::providers::qoder::catalog::{ModelConfig, QoderCatalog};
use crate::infrastructure::database::providers::QoderCredentials;
use crate::protocol::model::ChatCompletionRequest;

fn credentials() -> QoderCredentials {
    QoderCredentials {
        id: "qoder_account".to_owned(),
        access_token: "device-token".to_owned(),
        refresh_token: None,
        token_expires_at: None,
        user_id: "user-1".to_owned(),
        name: "Tester".to_owned(),
        email: "tester@example.com".to_owned(),
    }
}

fn config(key: &str) -> ModelConfig {
    ModelConfig {
        key: key.to_owned(),
        is_reasoning: false,
        max_output_tokens: 32_768,
        source: "system".to_owned(),
    }
}

fn request() -> ChatCompletionRequest {
    serde_json::from_value(json!({
            "model": "qd/auto",
            "messages": [
                {"role": "system", "content": "be brief"},
                {"role": "developer", "content": "stay on topic"},
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
                {"role": "assistant", "content": null, "tool_calls": [
                    {"id": "call-1", "type": "function", "function": {"name": "search", "arguments": "{}"}}
                ]},
                {"role": "tool", "tool_call_id": "call-1", "content": "result"}
            ],
            "max_tokens": 100_000
        }))
        .expect("request parses")
}

#[test]
fn the_body_lifts_the_system_prompt_and_keeps_the_conversation() {
    let body = build_body("auto", &config("auto"), &credentials(), &request());

    assert_eq!(body["system"], "be brief\n\nstay on topic");
    assert_eq!(body["messages"].as_array().expect("messages").len(), 4);
    assert_eq!(body["messages"][0]["role"], "user");
    assert_eq!(body["messages"][3]["role"], "tool");
    assert_eq!(body["messages"][3]["tool_call_id"], "call-1");
    assert_eq!(body["model_config"]["key"], "auto");
    assert_eq!(body["chat_context"]["text"], "hi");
    assert_eq!(body["business"]["name"], "hi");
}

#[test]
fn the_requested_budget_is_clamped_to_the_model_output_cap() {
    let body = build_body("auto", &config("auto"), &credentials(), &request());

    assert_eq!(body["parameters"]["max_tokens"], 32_768);
    assert_eq!(
        body["model_config"]["max_output_tokens"], 32_768,
        "the cap is reported alongside the budget"
    );
}

#[test]
fn session_and_record_ids_are_stable_for_the_same_conversation() {
    let request = request();
    let first = build_body("auto", &config("auto"), &credentials(), &request);
    let second = build_body("auto", &config("auto"), &credentials(), &request);

    assert_eq!(first["session_id"], second["session_id"]);
    assert_eq!(first["chat_record_id"], second["chat_record_id"]);
    assert_eq!(first["session_id"].as_str().expect("hash").len(), 16);
    assert_ne!(
        first["request_id"], second["request_id"],
        "each attempt needs its own request id"
    );
}

#[test]
fn the_body_carries_the_catalog_reasoning_flag() {
    let mut config = config("auto");
    config.is_reasoning = true;

    let body = build_body("auto", &config, &credentials(), &request());

    assert_eq!(body["model_config"]["is_reasoning"], true);
    assert_eq!(
        body["chat_context"]["extra"]["modelConfig"]["is_reasoning"],
        true
    );
}

#[test]
fn the_live_catalog_answers_a_friendly_id_before_the_static_table() {
    let catalog = QoderCatalog::parse_chat_list(&json!({
        "chat": [
            {"key": "qfmodel", "enable": true, "display_name": "Qwen3.8-Flash"},
            {"key": "dfmodel", "enable": true, "display_name": "DeepSeek-Flash"}
        ]
    }))
    .expect("catalog parses");

    assert_eq!(requested_key(&catalog, "qwen3.8-flash"), "qfmodel");
    assert_eq!(requested_key(&catalog, "qfmodel"), "qfmodel");
    assert_eq!(
        requested_key(&catalog, "deepseek-flash"),
        "dfmodel",
        "the name upstream gave wins over the static row for the same key"
    );
    assert_eq!(
        requested_key(&catalog, "kimi-k2.7"),
        "kmodel",
        "a static alias the catalog never advertised still resolves"
    );
    assert_eq!(requested_key(&catalog, "brand-new-key"), "brand-new-key");
}

#[test]
fn the_static_table_resolves_until_the_catalog_lands() {
    let empty = QoderCatalog::empty();

    assert_eq!(requested_key(&empty, "qwen3.7-max"), "qmodel_latest");
    assert_eq!(requested_key(&empty, "qmodel_latest"), "qmodel_latest");
    assert_eq!(requested_key(&empty, " GLM-5.2 "), "gm51model");
    assert_eq!(requested_key(&empty, "unknown"), "unknown");
}

#[test]
fn only_data_lines_carry_a_payload() {
    assert_eq!(data_payload("data: {}"), Some("{}"));
    assert_eq!(data_payload("data:[DONE]"), None);
    assert_eq!(data_payload("event: finish"), None);
    assert_eq!(data_payload("data: "), None);
}

/// One upstream frame: an envelope holding a stringified chunk.
fn envelope(body: &str, status: i64) -> String {
    let encoded = serde_json::to_string(body).expect("body encodes");

    format!("data: {{\"headers\":{{}},\"body\":{encoded},\"statusCodeValue\":{status}}}")
}

#[test]
fn the_translator_fills_the_fields_a_client_reads() {
    let mut translator = EnvelopeTranslator::new("auto");
    let payload = envelope(
        r#"{"choices":[{"index":0,"delta":{"content":"hel"},"finish_reason":null}]}"#,
        200,
    );
    let frames = translator.push(format!("{payload}\n").as_bytes());

    assert_eq!(frames.len(), 1);
    let frame = frames[0].as_ref().expect("frame");
    let text = String::from_utf8(frame.to_vec()).expect("utf8");
    let json: serde_json::Value =
        serde_json::from_str(text.trim_start_matches("data: ")).expect("chunk parses");

    assert_eq!(json["object"], "chat.completion.chunk");
    assert_eq!(json["model"], "auto");
    assert!(json["id"].as_str().expect("id").starts_with("chatcmpl-"));
    assert_eq!(json["choices"][0]["index"], 0);
    assert_eq!(json["choices"][0]["delta"]["content"], "hel");
}

#[test]
fn frames_split_across_reads_are_reassembled() {
    let mut translator = EnvelopeTranslator::new("auto");
    let payload = envelope(
        r#"{"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}"#,
        200,
    );
    let cut = payload.len() / 2;

    assert!(
        translator.push(&payload.as_bytes()[..cut]).is_empty(),
        "a partial line emits nothing"
    );
    let frames = translator.push(format!("{}\n", &payload[cut..]).as_bytes());
    assert_eq!(frames.len(), 1);

    let finished = translator.finish();
    assert_eq!(
        String::from_utf8(
            finished
                .last()
                .expect("terminator")
                .as_ref()
                .expect("bytes")
                .to_vec(),
        )
        .expect("utf8"),
        "data: [DONE]\n\n"
    );
}

#[test]
fn a_failed_envelope_becomes_an_error_event() {
    let mut translator = EnvelopeTranslator::new("auto");
    let payload = envelope("upstream exploded", 503);
    let frames = translator.push(format!("{payload}\n").as_bytes());

    assert_eq!(frames.len(), 1);
    let error = frames[0].as_ref().expect_err("error envelope fails");
    assert_eq!(error.status(), 500);
    assert!(error.message().contains("503"));
}

#[test]
fn the_aggregator_reassembles_fragmented_tool_calls() {
    let request = serde_json::from_value::<ChatCompletionRequest>(json!({
        "model": "auto",
        "messages": [{"role": "user", "content": "search for it"}]
    }))
    .expect("request parses");
    let mut aggregator = Aggregator::new("auto");

    for fragment in [
        r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"search","arguments":""}}]},"finish_reason":null}]}"#,
        r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"q\""}}]},"finish_reason":null}]}"#,
        r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\"rust\"}"}}]},"finish_reason":"tool_calls"}]}"#,
    ] {
        let payload = envelope(fragment, 200);

        aggregator
            .accept(payload.trim_start_matches("data: "))
            .expect("chunk accepts");
    }

    let response = aggregator.finish(&request).expect("response builds");
    let call = &response["choices"][0]["message"]["tool_calls"][0];

    assert_eq!(response["object"], "chat.completion");
    assert_eq!(response["choices"][0]["finish_reason"], "tool_calls");
    assert_eq!(call["id"], "call-1");
    assert_eq!(call["function"]["name"], "search");
    assert_eq!(call["function"]["arguments"], r#"{"q":"rust"}"#);
    assert!(
        response["usage"]["total_tokens"]
            .as_i64()
            .expect("usage estimated")
            > 0
    );
}
