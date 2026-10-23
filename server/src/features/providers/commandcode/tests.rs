//! Unit tests for the request rewrite and the event translation.

use serde_json::{Value, json};

use super::request::{strip_alias_prefix, transform_body};
use super::translate::{Event, LineDecoder};
use crate::protocol::model::ChatCompletionRequest;

fn request(value: Value) -> ChatCompletionRequest {
    serde_json::from_value(value).expect("request parses")
}

fn body(value: Value) -> Value {
    let request = request(value);
    transform_body(&request.model, &request).expect("body builds")
}

#[test]
fn the_system_turn_is_lifted_out_and_a_user_string_becomes_a_text_part() {
    let built = body(json!({
        "model": "deepseek/deepseek-v4.1-flash",
        "messages": [
            {"role": "system", "content": "Be brief."},
            {"role": "developer", "content": "Answer in English."},
            {"role": "user", "content": "Hello"}
        ]
    }));

    let params = &built["params"];
    assert_eq!(params["system"], "Be brief.\n\nAnswer in English.");
    assert_eq!(params["messages"].as_array().expect("messages").len(), 1);
    assert_eq!(
        params["messages"][0],
        json!({"role": "user", "content": [{"type": "text", "text": "Hello"}]})
    );
    assert_eq!(params["stream"], true);
    assert_eq!(params["max_tokens"], 4096);
    assert_eq!(built["mode"], "agent");
    assert_eq!(built["permissionMode"], "standard");
}

#[test]
fn the_workspace_snapshot_carries_no_date() {
    let built = body(json!({
        "model": "m",
        "messages": [{"role": "user", "content": "hi"}]
    }));

    assert!(built["config"].get("date").is_none());
    assert_eq!(built["config"]["workingDir"], "/");
    assert_eq!(built["config"]["isGitRepo"], false);
}

#[test]
fn an_image_part_carries_its_mime_type() {
    let built = body(json!({
        "model": "m",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "What is this?"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}
            ]
        }]
    }));

    let parts = built["params"]["messages"][0]["content"]
        .as_array()
        .expect("parts");
    assert_eq!(parts[0]["text"], "What is this?");
    assert_eq!(parts[1]["type"], "image");
    assert_eq!(parts[1]["image"], "data:image/png;base64,AAAA");
    assert_eq!(parts[1]["mimeType"], "image/png");
}

#[test]
fn an_image_without_a_detectable_type_leaves_a_placeholder() {
    let built = body(json!({
        "model": "m",
        "messages": [{
            "role": "user",
            "content": [{"type": "image_url", "image_url": {"url": "https://example.com/cat"}}]
        }]
    }));

    assert_eq!(
        built["params"]["messages"][0]["content"],
        json!([{"type": "text", "text": "[image: attached]"}])
    );
}

#[test]
fn an_assistant_tool_call_keeps_its_id_and_a_result_finds_its_tool_name() {
    let built = body(json!({
        "model": "m",
        "messages": [
            {"role": "user", "content": "read the file"},
            {"role": "assistant", "content": null, "tool_calls": [{
                "id": "call-1",
                "type": "function",
                "function": {"name": "read_file", "arguments": "{\"path\":\"/tmp/a\"}"}
            }]},
            {"role": "tool", "tool_call_id": "call-1", "content": "contents"}
        ]
    }));

    let messages = built["params"]["messages"].as_array().expect("messages");
    assert_eq!(
        messages[1]["content"][0],
        json!({
            "type": "tool-call",
            "toolCallId": "call-1",
            "toolName": "read_file",
            "input": {"path": "/tmp/a"}
        })
    );
    assert_eq!(
        messages[2]["content"][0],
        json!({
            "type": "tool-result",
            "toolCallId": "call-1",
            "toolName": "read_file",
            "output": {"type": "text", "value": "contents"}
        })
    );
}

#[test]
fn no_tools_are_sent_when_the_caller_forbade_them() {
    let tool = json!({
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a file",
            "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}
        }
    });
    let forbidden = body(json!({
        "model": "m",
        "messages": [{"role": "user", "content": "hi"}],
        "tools": [tool.clone()],
        "tool_choice": "none"
    }));
    assert_eq!(forbidden["params"]["tools"], json!([]));

    let allowed = body(json!({
        "model": "m",
        "messages": [{"role": "user", "content": "hi"}],
        "tools": [tool],
        "tool_choice": "auto"
    }));
    assert_eq!(
        allowed["params"]["tools"][0],
        json!({
            "name": "read_file",
            "description": "Read a file",
            "input_schema": {"type": "object", "properties": {"path": {"type": "string"}}}
        })
    );
}

#[test]
fn temperature_is_forwarded_only_when_the_caller_set_one() {
    let warm = body(json!({
        "model": "m",
        "messages": [{"role": "user", "content": "hi"}],
        "temperature": 0.3
    }));
    assert_eq!(warm["params"]["temperature"], 0.3);

    let cold = body(json!({
        "model": "m",
        "messages": [{"role": "user", "content": "hi"}]
    }));
    assert!(cold["params"].get("temperature").is_none());
}

#[test]
fn the_vendor_slash_survives_and_the_alias_prefix_does_not() {
    assert_eq!(
        strip_alias_prefix("commandcode/deepseek/deepseek-v4.1-flash"),
        "deepseek/deepseek-v4.1-flash"
    );
    assert_eq!(
        strip_alias_prefix(" deepseek/deepseek-v4.1-flash "),
        "deepseek/deepseek-v4.1-flash"
    );
}

fn decode(lines: &str) -> Vec<Event> {
    let mut decoder = LineDecoder::default();
    let mut events = decoder.push(lines.as_bytes());
    events.extend(decoder.finish());

    events
}

#[test]
fn the_decoder_reads_the_events_the_relay_sends() {
    let events = decode(concat!(
        "{\"type\":\"start\"}\n",
        "{\"type\":\"text-delta\",\"text\":\"Hel\"}\n",
        "{\"type\":\"reasoning-delta\",\"text\":\"thinking\"}\n",
        "{\"type\":\"tool-call\",\"toolCallId\":\"call-1\",\"toolName\":\"read_file\",\"input\":{\"path\":\"/tmp\"}}\n",
        "{\"type\":\"finish-step\",\"totalUsage\":{\"inputTokens\":10,\"outputTokens\":2}}\n",
        "{\"type\":\"finish\",\"finishReason\":\"tool-calls\",\"totalUsage\":{\"inputTokens\":10,\"outputTokens\":3,\"inputTokenDetails\":{\"cacheReadTokens\":4}}}\n",
    ));

    let kinds: Vec<&'static str> = events
        .iter()
        .map(|event| match event {
            Event::Text(_) => "text",
            Event::Reasoning(_) => "reasoning",
            Event::ToolCall { .. } => "tool",
            Event::Usage(_) => "usage",
            Event::Finish(_) => "finish",
            Event::Failed(_) => "failed",
        })
        .collect();
    assert_eq!(
        kinds,
        vec!["text", "reasoning", "tool", "usage", "usage", "finish"]
    );

    let Event::ToolCall {
        id,
        name,
        arguments,
    } = &events[2]
    else {
        panic!("third event is the tool call");
    };
    assert_eq!(id, "call-1");
    assert_eq!(name, "read_file");
    assert_eq!(arguments, "{\"path\":\"/tmp\"}");

    let Event::Usage(last_usage) = &events[4] else {
        panic!("the finish event carries the final usage");
    };
    assert_eq!(last_usage["prompt_tokens"], 10);
    assert_eq!(last_usage["completion_tokens"], 3);
    assert_eq!(last_usage["total_tokens"], 13);
    assert_eq!(last_usage["prompt_tokens_details"]["cached_tokens"], 4);
}

#[test]
fn a_non_json_line_is_skipped_not_fatal() {
    let events = decode("not json\n\n{\"type\":\"text-delta\",\"text\":\"ok\"}\n");

    assert_eq!(events.len(), 1);
    assert!(matches!(&events[0], Event::Text(text) if text == "ok"));
}

#[test]
fn an_in_stream_error_event_carries_the_status_it_names() {
    let events =
        decode("{\"type\":\"error\",\"statusCode\":402,\"error\":\"Insufficient Balance\"}\n");

    let Event::Failed(error) = &events[0] else {
        panic!("the error event is a failure");
    };
    assert_eq!(error.status(), 402);
    assert!(error.message().contains("Insufficient Balance"));
}

#[test]
fn a_failure_without_a_status_degrades_to_bad_gateway() {
    let events = decode("{\"type\":\"error\",\"error\":{\"message\":\"boom\"}}\n");

    let Event::Failed(error) = &events[0] else {
        panic!("the error event is a failure");
    };
    assert_eq!(error.status(), 502);
    assert!(error.message().contains("boom"));
}
