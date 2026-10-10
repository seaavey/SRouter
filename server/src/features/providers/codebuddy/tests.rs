use serde_json::{Value, json};

use crate::error::APIError;
use crate::features::providers::codebuddy::types::Flavor;
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::model::ChatCompletionRequest;

use super::executor::CodeBuddyExecutor;
use super::request::transform_body;
use super::translate::{Aggregator, DecodedFrame, LineDecoder};

fn request(value: Value) -> ChatCompletionRequest {
    serde_json::from_value(value).expect("request parses")
}

fn simple_request() -> ChatCompletionRequest {
    request(json!({
        "model": "codebuddy/gpt-5.6-astra",
        "messages": [{"role": "user", "content": "hello"}]
    }))
}

#[test]
fn executor_contract_uses_flavor_metadata_and_public_catalog() {
    let global = CodeBuddyExecutor::new(
        Flavor::Global,
        Flavor::Global.endpoints(),
        None,
        UpstreamClient::new().expect("client"),
    );
    let china = CodeBuddyExecutor::new(
        Flavor::China,
        Flavor::China.endpoints(),
        None,
        UpstreamClient::new().expect("client"),
    );

    assert_eq!(global.id(), "codebuddy");
    assert_eq!(global.keys(), &["codebuddy"]);
    assert_eq!(global.alias(), "codebuddy");
    assert!(global.models().is_empty());

    assert_eq!(china.id(), "codebuddy-cn");
    assert_eq!(china.keys(), &["codebuddy-cn"]);
    assert_eq!(china.alias(), "codebuddy-cn");
    assert!(china.models().is_empty());
}

#[test]
fn transform_uses_the_bare_model_and_always_streams() {
    let body = transform_body("gpt-5.6-astra", &simple_request()).expect("body builds");

    assert_eq!(body["model"], "gpt-5.6-astra");
    assert_eq!(body["stream"], true);
}

#[test]
fn transform_prepends_the_identity_prompt_and_keeps_caller_system_turns() {
    let body = transform_body(
        "gpt-5.6-astra",
        &request(json!({
            "model": "codebuddy/gpt-5.6-astra",
            "messages": [
                {"role": "system", "content": "Be terse."},
                {"role": "developer", "content": "Prefer JSON."},
                {"role": "user", "content": "hi"}
            ]
        })),
    )
    .expect("body builds");

    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(
        body["messages"][0]["content"],
        "You are CodeBuddy Code.\n\nBe terse.\n\nPrefer JSON."
    );
    assert_eq!(body["messages"].as_array().unwrap().len(), 2);
}

#[test]
fn transform_rewrites_user_strings_to_typed_blocks() {
    let body = transform_body("gpt-5.6-astra", &simple_request()).expect("body builds");

    assert_eq!(body["messages"][1]["role"], "user");
    assert_eq!(
        body["messages"][1]["content"],
        json!([{"type": "text", "text": "hello"}])
    );
}

#[test]
fn transform_drops_a_disabled_effort_and_summarizes_a_real_one() {
    let disabled = transform_body(
        "gpt-5.6-astra",
        &request(json!({
            "model": "codebuddy/gpt-5.6-astra",
            "messages": [{"role": "user", "content": "hi"}],
            "reasoning_effort": "none"
        })),
    )
    .expect("body builds");
    assert!(disabled.get("reasoning_effort").is_none());
    assert!(disabled.get("reasoning_summary").is_none());

    let enabled = transform_body(
        "gpt-5.6-astra",
        &request(json!({
            "model": "codebuddy/gpt-5.6-astra",
            "messages": [{"role": "user", "content": "hi"}],
            "reasoning_effort": "high"
        })),
    )
    .expect("body builds");
    assert_eq!(enabled["reasoning_summary"], "auto");
    assert_eq!(enabled["reasoning_effort"], "high");
}

#[test]
fn transform_mirrors_a_json_object_format_into_the_last_user_turn() {
    let body = transform_body(
        "gpt-5.6-astra",
        &request(json!({
            "model": "codebuddy/gpt-5.6-astra",
            "messages": [{"role": "user", "content": "hi"}],
            "response_format": {"type": "json_object"}
        })),
    )
    .expect("body builds");

    assert!(body.get("response_format").is_none());
    assert_eq!(
        body["messages"][1]["content"][0]["text"],
        "hi\n\nRespond only in valid JSON."
    );
}

#[test]
fn transform_mirrors_a_json_schema_format_into_the_last_user_turn() {
    let body = transform_body(
            "gpt-5.6-astra",
            &request(json!({
                "model": "codebuddy/gpt-5.6-astra",
                "messages": [{"role": "user", "content": "hi"}],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"schema": {"type": "object", "properties": {"ok": {"type": "boolean"}}}}
                }
            })),
        )
        .expect("body builds");

    assert!(body.get("response_format").is_none());
    let text = body["messages"][1]["content"][0]["text"]
        .as_str()
        .expect("text part");
    assert!(text.starts_with("hi\n\nYou must respond with valid JSON matching this schema:\n"));
    assert!(text.contains("\"type\": \"object\""));
}

#[test]
fn a_disabled_effort_is_absent_from_the_serialized_body() {
    // `reasoning_effort` is skipped when None; the drop path only removes a
    // value the caller actually sent.
    let body = transform_body(
        "gpt-5.6-astra",
        &request(json!({
            "model": "codebuddy/gpt-5.6-astra",
            "messages": [{"role": "user", "content": "hi"}],
            "reasoning_effort": "off"
        })),
    )
    .expect("body builds");
    assert!(body.get("reasoning_effort").is_none());
}

#[test]
fn line_decoder_reads_data_frames_and_ndjson_and_done_once() {
    let mut decoder = LineDecoder::default();
    let frames = decoder.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n");
    assert!(
        matches!(&frames[0], DecodedFrame::Data(value) if value["choices"][0]["delta"]["content"] == "a")
    );

    let frames = decoder.push(b"{\"choices\":[{\"delta\":{\"content\":\"b\"}}]}\ndata: [DONE]\n");
    assert!(matches!(&frames[0], DecodedFrame::Data(_)));
    assert!(matches!(&frames[1], DecodedFrame::Done));
    assert!(decoder.finish().is_empty());
}

#[test]
fn line_decoder_reassembles_a_fragmented_line() {
    let mut decoder = LineDecoder::default();
    assert!(decoder.push(b"data: {\"choices\":[{").is_empty());
    let frames = decoder.push(b"\"delta\":{\"content\":\"hi\"}}]}\n\n");
    assert!(
        matches!(&frames[0], DecodedFrame::Data(value) if value["choices"][0]["delta"]["content"] == "hi")
    );
}

#[test]
fn an_error_frame_becomes_an_error() {
    let mut decoder = LineDecoder::default();
    let frames = decoder.push(b"data: {\"error\":{\"message\":\"boom\"}}\n");
    assert!(matches!(&frames[0], DecodedFrame::Error(error) if error.message() == "boom"));
}

#[test]
fn aggregator_reassembles_content_reasoning_tools_finish_and_usage() {
    let mut aggregator = Aggregator::new("gpt-5.6-astra");
    for value in [
        json!({"choices":[{"delta":{"content":"hel","reasoning_content":"why "},"finish_reason":null}]}),
        json!({"choices":[{"delta":{"content":"lo","reasoning_content":"not","tool_calls":[{"index":0,"id":"call-1","function":{"name":"search","arguments":"{\"q\""}}]},"finish_reason":null}]}),
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\"rust\"}"}}]},"finish_reason":"tool_calls"}]}),
        json!({"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}),
    ] {
        aggregator
            .accept(DecodedFrame::Data(value))
            .expect("chunk accepts");
    }

    let response = aggregator.finish();
    assert_eq!(response["object"], "chat.completion");
    assert_eq!(response["model"], "gpt-5.6-astra");
    assert_eq!(response["choices"][0]["message"]["content"], "hello");
    assert_eq!(
        response["choices"][0]["message"]["reasoning_content"],
        "why not"
    );
    assert_eq!(
        response["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
        r#"{"q":"rust"}"#
    );
    assert!(
        response["choices"][0]["message"]["tool_calls"][0]
            .get("index")
            .is_none(),
        "the Node shape omits the tool-call index"
    );
    assert_eq!(response["choices"][0]["finish_reason"], "tool_calls");
    assert_eq!(response["usage"]["total_tokens"], 5);
}

#[test]
fn a_repeated_blank_tool_call_name_does_not_erase_the_one_that_named_it() {
    // The real upstream stream names the call once, then repeats it with an
    // empty `name` on every argument chunk. Those blanks must not overwrite.
    let mut aggregator = Aggregator::new("deepseek-v4.1-flash");
    for value in [
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}),
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"","arguments":"{\"city\""}}]},"finish_reason":null}]}),
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"","arguments":":\"Jakarta\"}"}}]},"finish_reason":"tool_calls"}]}),
    ] {
        aggregator
            .accept(DecodedFrame::Data(value))
            .expect("chunk accepts");
    }

    let response = aggregator.finish();
    let call = &response["choices"][0]["message"]["tool_calls"][0];
    assert_eq!(call["id"], "call-1");
    assert_eq!(call["function"]["name"], "get_weather");
    assert_eq!(call["function"]["arguments"], r#"{"city":"Jakarta"}"#);
}

#[test]
fn aggregator_falls_back_to_reasoning_then_null_content() {
    let mut reasoning_only = Aggregator::new("glm-5.3");
    reasoning_only
        .accept(DecodedFrame::Data(json!({
            "choices": [{"delta": {"reasoning_content": "thinking"}, "finish_reason": null}]
        })))
        .expect("chunk accepts");
    let response = reasoning_only.finish();
    assert_eq!(response["choices"][0]["message"]["content"], "thinking");
    assert_eq!(
        response["choices"][0]["message"]["reasoning_content"],
        "thinking"
    );

    let mut empty = Aggregator::new("glm-5.3");
    empty
        .accept(DecodedFrame::Data(json!({
            "choices": [{"delta": {}, "finish_reason": "stop"}]
        })))
        .expect("chunk accepts");
    let response = empty.finish();
    assert!(response["choices"][0]["message"]["content"].is_null());
    assert!(response.get("usage").is_none());
}

#[test]
fn an_error_frame_aborts_aggregation() {
    let mut aggregator = Aggregator::new("gpt-5.6-astra");
    let error = aggregator
        .accept(DecodedFrame::Error(APIError::new(500, "boom")))
        .expect_err("error frame fails");
    assert_eq!(error.message(), "boom");
}
