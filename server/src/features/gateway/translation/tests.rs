use serde_json::Value;

use crate::protocol::model::{ChatCompletionRequest, ChatContent, ChatRole};

use super::*;

#[test]
fn maps_anthropic_system_and_messages_to_openai() {
    let req = AnthropicMessageRequest {
        model: "claude-3-7-sonnet-20250219".to_owned(),
        messages: vec![
            AnthropicMessage {
                role: "user".to_owned(),
                content: AnthropicMessageContent::Text("Hello Claude".to_owned()),
            },
            AnthropicMessage {
                role: "assistant".to_owned(),
                content: AnthropicMessageContent::Blocks(vec![AnthropicContentBlock::Text {
                    text: "Hi user".to_owned(),
                    cache_control: None,
                }]),
            },
        ],
        system: Some(AnthropicSystem::Text("You are an assistant".to_owned())),
        max_tokens: Some(1024),
        temperature: Some(0.7),
        top_p: Some(0.9),
        top_k: None,
        stop_sequences: Some(vec!["STOP".to_owned()]),
        stream: false,
        tools: None,
        tool_choice: None,
        thinking: None,
        metadata: None,
    };

    let openai_req = anthropic_to_openai_request(req);
    assert_eq!(openai_req.model, "claude-3-7-sonnet-20250219");
    assert_eq!(openai_req.messages.len(), 3);
    assert_eq!(openai_req.messages[0].role, ChatRole::System);
    assert_eq!(openai_req.messages[1].role, ChatRole::User);
    assert_eq!(openai_req.messages[2].role, ChatRole::Assistant);
    assert_eq!(openai_req.max_tokens, Some(1024));
}

#[test]
fn maps_tool_use_and_tool_result() {
    let req = AnthropicMessageRequest {
        model: "claude-3-7-sonnet-20250219".to_owned(),
        messages: vec![
            AnthropicMessage {
                role: "assistant".to_owned(),
                content: AnthropicMessageContent::Blocks(vec![AnthropicContentBlock::ToolUse {
                    id: "call_abc".to_owned(),
                    name: "bash".to_owned(),
                    input: serde_json::json!({ "command": "ls" }),
                }]),
            },
            AnthropicMessage {
                role: "user".to_owned(),
                content: AnthropicMessageContent::Blocks(vec![
                    AnthropicContentBlock::ToolResult {
                        tool_use_id: "call_abc".to_owned(),
                        content: Some(serde_json::json!("file.txt")),
                        is_error: None,
                        cache_control: None,
                    },
                    AnthropicContentBlock::Text {
                        text: "done".to_owned(),
                        cache_control: None,
                    },
                ]),
            },
        ],
        system: None,
        max_tokens: None,
        temperature: None,
        top_p: None,
        top_k: None,
        stop_sequences: None,
        stream: false,
        tools: Some(vec![AnthropicTool {
            name: "bash".to_owned(),
            description: Some("runs bash".to_owned()),
            input_schema: serde_json::json!({ "type": "object" }),
            cache_control: None,
        }]),
        tool_choice: Some(AnthropicToolChoice::Auto),
        thinking: None,
        metadata: None,
    };

    let openai_req = anthropic_to_openai_request(req);
    assert_eq!(openai_req.messages.len(), 3);
    assert_eq!(openai_req.messages[0].role, ChatRole::Assistant);
    assert!(openai_req.messages[0].tool_calls.is_some());
    assert_eq!(openai_req.messages[1].role, ChatRole::Tool);
    assert_eq!(
        openai_req.messages[1].tool_call_id.as_deref(),
        Some("call_abc")
    );
    assert_eq!(openai_req.messages[2].role, ChatRole::User);
    assert!(openai_req.tools.is_some());
}

#[test]
fn translates_openai_response_to_anthropic() {
    let openai_res = serde_json::json!({
        "id": "chatcmpl-test-123",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "Hello Anthropic!"
                },
                "finish_reason": "stop"
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15
        }
    });

    let ant_res = openai_to_anthropic_response(&openai_res, "claude-3-7-sonnet", false);
    assert_eq!(ant_res["type"], "message");
    assert_eq!(ant_res["id"], "msg_test-123");
    assert_eq!(ant_res["role"], "assistant");
    assert_eq!(ant_res["stop_reason"], "end_turn");
    assert_eq!(ant_res["content"][0]["text"], "Hello Anthropic!");
    assert_eq!(ant_res["usage"]["input_tokens"], 10);
    assert_eq!(ant_res["usage"]["output_tokens"], 5);
}

#[test]
fn stream_translator_emits_expected_events() {
    let mut translator = AnthropicStreamTranslator::new("claude-3-7-sonnet", false);

    let chunk1 = serde_json::json!({
        "choices": [{
            "index": 0,
            "delta": { "content": "Hello " },
            "finish_reason": null
        }]
    });
    let events1 = translator.feed_chunk(&chunk1);
    let sse1 = String::from_utf8(events1.concat()).unwrap();
    assert!(sse1.contains("event: message_start"));
    assert!(sse1.contains("event: content_block_start"));
    assert!(sse1.contains("event: content_block_delta"));
    assert!(sse1.contains("Hello "));

    let chunk2 = serde_json::json!({
        "choices": [{
            "index": 0,
            "delta": { "content": "World!" },
            "finish_reason": "stop"
        }]
    });
    let events2 = translator.feed_chunk(&chunk2);
    let sse2 = String::from_utf8(events2.concat()).unwrap();
    assert!(sse2.contains("event: content_block_delta"));
    assert!(sse2.contains("World!"));

    let finish_events = translator.finish();
    let sse_finish = String::from_utf8(finish_events.concat()).unwrap();
    assert!(sse_finish.contains("event: content_block_stop"));
    assert!(sse_finish.contains("event: message_delta"));
    assert!(sse_finish.contains("event: message_stop"));
    assert!(sse_finish.contains("end_turn"));
}

// ==========================================================================
// Parity tests frozen against the Node black-box probes (`probe3`-`probe15`).
// Each expectation is the exact status/message/body `apps/api` produced.
// ==========================================================================

fn request(body: &Value) -> Result<AnthropicMessageRequest, String> {
    serde_json::from_value(body.clone()).map_err(|e| e.to_string())
}

fn validation_error(body: &Value) -> String {
    validate_anthropic_request(body).expect_err("payload should be rejected")
}

fn base() -> Value {
    serde_json::json!({
        "model": "probe-model-1",
        "max_tokens": 16,
        "messages": [{ "role": "user", "content": "hi" }]
    })
}

/// Merges `patch` into a fresh `base()` body — `json!` has no spread syntax.
fn with(patch: Value) -> Value {
    let mut body = base();
    let target = body.as_object_mut().expect("base is an object");
    for (key, value) in patch.as_object().expect("patch is an object") {
        target.insert(key.clone(), value.clone());
    }
    body
}

fn serialized_keys(req: &ChatCompletionRequest) -> Vec<String> {
    let value = serde_json::to_value(req).expect("serializable request");
    let mut keys: Vec<String> = value
        .as_object()
        .expect("request serializes to an object")
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

// -- Validation: scalar fields keep specific messages (probe3, probe9) -----

#[test]
fn validation_reports_exact_scalar_messages() {
    // probe3: role / messages / max_tokens / stop_sequences shapes.
    assert_eq!(
        validation_error(&with(
            serde_json::json!({"messages": [{ "role": 7, "content": "x" }] })
        )),
        "Expected 'user' | 'assistant' | 'system', received number"
    );
    assert_eq!(
        validation_error(&with(
            serde_json::json!({"messages": [{ "role": "User", "content": "x" }] })
        )),
        "Invalid enum value. Expected 'user' | 'assistant' | 'system', received 'User'"
    );
    assert_eq!(
        validation_error(&with(serde_json::json!({"messages": "x" }))),
        "Expected array, received string"
    );
    assert_eq!(
        validation_error(&with(serde_json::json!({"max_tokens": 1.5 }))),
        "Expected integer, received float"
    );
    assert_eq!(
        validation_error(&with(serde_json::json!({"max_tokens": -5 }))),
        "Number must be greater than 0"
    );
    assert_eq!(
        validation_error(&with(serde_json::json!({"stop_sequences": [7] }))),
        "Expected string, received number"
    );
    // probe3: a non-object message item.
    assert_eq!(
        validation_error(&with(serde_json::json!({"messages": [42] }))),
        "Expected object, received number"
    );
    // probe9: null message item.
    assert_eq!(
        validation_error(&with(serde_json::json!({"messages": [null] }))),
        "Expected object, received null"
    );
    // probe9: metadata accepts objects only.
    assert_eq!(
        validation_error(&with(serde_json::json!({"metadata": null }))),
        "Expected object, received null"
    );
    assert_eq!(
        validation_error(&with(serde_json::json!({"metadata": [] }))),
        "Expected object, received array"
    );
    // probe9: top_k is a positive integer.
    assert_eq!(
        validation_error(&with(serde_json::json!({"top_k": 0 }))),
        "Number must be greater than 0"
    );
    // probe3/probe9: tools array and per-tool fields.
    assert_eq!(
        validation_error(&with(serde_json::json!({"tools": {} }))),
        "Expected array, received object"
    );
    assert_eq!(
        validation_error(&with(
            serde_json::json!({"tools": [{ "name": 7, "input_schema": {} }]
            })
        )),
        "Expected string, received number"
    );
    assert_eq!(
        validation_error(&with(
            serde_json::json!({"tools": [{ "name": "t", "input_schema": 7 }]
            })
        )),
        "Expected object, received number"
    );
    // probe9: the 128-tool cap reports the Zod array message at 129 and 1000.
    let many: Vec<Value> = (0..129)
        .map(|i| serde_json::json!({ "name": format!("t{i}"), "input_schema": {} }))
        .collect();
    assert_eq!(
        validation_error(&with(serde_json::json!({"tools": many }))),
        "Array must contain at most 128 element(s)"
    );
    // probe3/probe9: enum fields.
    assert_eq!(
        validation_error(&with(serde_json::json!({"tool_choice": { "type": "nope" }
        }))),
        "Invalid enum value. Expected 'auto' | 'any' | 'tool', received 'nope'"
    );
    assert_eq!(
        validation_error(&with(serde_json::json!({"thinking": { "type": "nope" }
        }))),
        "Invalid enum value. Expected 'enabled' | 'disabled' | 'adaptive', received 'nope'"
    );
    assert_eq!(
        validation_error(&with(
            serde_json::json!({"thinking": { "type": "enabled", "budget_tokens": "5" }
            })
        )),
        "Expected number, received string"
    );
    assert_eq!(
        validation_error(&with(
            serde_json::json!({"thinking": { "type": "enabled", "budget_tokens": 1.5 }
            })
        )),
        "Expected integer, received float"
    );
}

#[test]
fn validation_reports_the_required_field_messages() {
    assert_eq!(
        validate_anthropic_request(&serde_json::json!({ "messages": [] })).unwrap_err(),
        "Missing required field 'model'"
    );
    assert_eq!(
        validate_anthropic_request(&serde_json::json!({ "model": "m" })).unwrap_err(),
        "Missing required field 'messages'"
    );
    assert_eq!(
        validate_anthropic_request(&serde_json::json!({
            "model": "m",
            "messages": []
        }))
        .unwrap_err(),
        "Parameter 'messages' cannot be empty"
    );
}

// -- Validation: unions collapse to "Invalid input" (probe3, probe9) -------

#[test]
fn union_failures_report_invalid_input() {
    // probe3: message content is a string|blocks union.
    for content in [
        serde_json::Value::Null,
        serde_json::json!(5),
        serde_json::json!({ "a": 1 }),
    ] {
        assert_eq!(
            validation_error(&with(
                serde_json::json!({"messages": [{ "role": "user", "content": content }]
                })
            )),
            "Invalid input"
        );
    }
    assert_eq!(
        validation_error(&with(serde_json::json!({"messages": [{ "role": "user" }]
        }))),
        "Invalid input"
    );
    // probe3: a block that is not an object, or lacks `type`.
    assert_eq!(
        validation_error(&with(
            serde_json::json!({"messages": [{ "role": "user", "content": [7] }]
            })
        )),
        "Invalid input"
    );
    assert_eq!(
        validation_error(&with(
            serde_json::json!({"messages": [{ "role": "user", "content": [{ "text": "x" }] }]
            })
        )),
        "Invalid input"
    );
    // probe9: every field failure inside a block reports the union message.
    let block_cases: Vec<Value> = vec![
        serde_json::json!([{ "type": "text", "text": 5 }]),
        serde_json::json!([
            { "role": "assistant" },
            { "type": "tool_use", "id": 7, "name": "s", "input": {} }
        ]),
        serde_json::json!([
            { "type": "tool_result", "tool_use_id": "t", "content": 5 }
        ]),
        serde_json::json!([
            { "type": "tool_result", "tool_use_id": "t", "content": "x", "is_error": "yes" }
        ]),
        serde_json::json!([{ "type": "image", "source": { "type": "base64", "media_type": 5, "data": "AA" } }]),
    ];
    for (i, content) in block_cases.iter().enumerate() {
        let messages = if i == 1 {
            serde_json::json!([
                { "role": "user", "content": "u" },
                { "role": "assistant", "content": content }
            ])
        } else {
            serde_json::json!([{ "role": "user", "content": content }])
        };
        assert_eq!(
            validation_error(&with(serde_json::json!({"messages": messages }))),
            "Invalid input",
            "block case {i}"
        );
    }
    // probe9: a thinking block with a non-string field.
    assert_eq!(
        validation_error(&with(serde_json::json!({"messages": [
                { "role": "assistant", "content": [{ "type": "thinking", "thinking": 5 }] },
                { "role": "user", "content": "u" }
            ]
        }))),
        "Invalid input"
    );
    // probe3/probe9: `system` is string|blocks; every failure is the union message.
    for system in [
        serde_json::json!(123),
        serde_json::json!(null),
        serde_json::json!([{ "type": "nope" }]),
    ] {
        assert_eq!(
            validation_error(&with(serde_json::json!({"system": system }))),
            "Invalid input"
        );
    }
    // probe9: an empty system array and an empty content array are accepted.
    validate_anthropic_request(&with(serde_json::json!({"system": [] })))
        .expect("empty system array is valid");
    validate_anthropic_request(&with(
        serde_json::json!({"messages": [{ "role": "user", "content": [] }]
        }),
    ))
    .expect("empty content array is valid");
}

#[test]
fn a_body_that_is_not_an_object_is_a_type_error() {
    assert_eq!(
        validate_anthropic_request(&serde_json::json!([1, 2])).unwrap_err(),
        "Expected object, received array"
    );
}

// -- Request mapping (probe4, probe9, probe14) -----------------------------

#[test]
fn system_blocks_join_with_blank_lines_and_drop_cache_markers() {
    let req = request(&serde_json::json!({
        "model": "m",
        "messages": [{ "role": "user", "content": "hi" }],
        "system": [
            { "type": "text", "text": "a", "cache_control": { "type": "ephemeral" } },
            { "type": "text", "text": "b" }
        ]
    }))
    .expect("valid request");

    let openai = anthropic_to_openai_request(req);
    assert_eq!(openai.messages[0].role, ChatRole::System);
    assert_eq!(
        openai.messages[0].content,
        ChatContent::Text("a\n\nb".to_owned())
    );
}

#[test]
fn named_tool_choice_carries_the_function_discriminator() {
    // probe14: the upstream body is {"type":"function","function":{...}}.
    let req = request(&serde_json::json!({
        "model": "m",
        "messages": [{ "role": "user", "content": "hi" }],
        "tool_choice": { "type": "tool", "name": "t" }
    }))
    .expect("valid request");

    let openai = anthropic_to_openai_request(req);
    let value = serde_json::to_value(&openai.tool_choice).expect("serializable");
    assert_eq!(
        value,
        serde_json::json!({
            "type": "function",
            "function": { "name": "t" }
        })
    );
}

#[test]
fn a_named_tool_choice_without_a_name_is_dropped() {
    // probe: Node emits no tool_choice key at all for {type:"tool"}.
    let req = request(&serde_json::json!({
        "model": "m",
        "messages": [{ "role": "user", "content": "hi" }],
        "tool_choice": { "type": "tool" }
    }))
    .expect("valid request");

    let openai = anthropic_to_openai_request(req);
    assert!(openai.tool_choice.is_none());
}

#[test]
fn thinking_variants_map_to_the_split_reasoning_shapes() {
    // probe4/probe9: enabled/adaptive -> reasoning:{effort:"high"} and
    // NO reasoning_effort; disabled -> reasoning_effort:"none" only;
    // budget_tokens is never forwarded and no `thinking` key exists.
    for thinking in ["enabled", "adaptive"] {
        let req = request(&serde_json::json!({
            "model": "m",
            "messages": [{ "role": "user", "content": "hi" }],
            "thinking": { "type": thinking, "budget_tokens": 512 }
        }))
        .expect("valid request");
        let openai = anthropic_to_openai_request(req);
        assert_eq!(
            serde_json::to_value(&openai.reasoning).unwrap(),
            serde_json::json!({ "effort": "high" })
        );
        assert!(openai.reasoning_effort.is_none());
        assert!(openai.thinking.is_none());
    }

    let req = request(&serde_json::json!({
        "model": "m",
        "messages": [{ "role": "user", "content": "hi" }],
        "thinking": { "type": "disabled" }
    }))
    .expect("valid request");
    let openai = anthropic_to_openai_request(req);
    assert_eq!(openai.reasoning_effort.as_deref(), Some("none"));
    assert!(openai.reasoning.is_none());
}

#[test]
fn the_upstream_body_drops_every_openai_only_field() {
    // probe14: top_k, metadata, n, user, penalties, stream_options and
    // response_format never reach the upstream; the key set is exact.
    let req = request(&serde_json::json!({
        "model": "m",
        "messages": [{ "role": "user", "content": "hi" }],
        "max_tokens": 64,
        "temperature": 0.7,
        "top_p": 0.9,
        "top_k": 40,
        "stop_sequences": ["STOP"],
        "metadata": { "user_id": "u-1" },
        "n": 2,
        "user": "alice",
        "presence_penalty": 0.1,
        "frequency_penalty": 0.2,
        "stream_options": { "include_usage": true },
        "response_format": { "type": "json_object" },
        "extra_unknown_field": 123
    }))
    .expect("valid request");

    let openai = anthropic_to_openai_request(req);
    assert_eq!(
        serialized_keys(&openai),
        vec![
            "max_tokens",
            "messages",
            "model",
            "stop",
            "stream",
            "temperature",
            "top_p"
        ]
    );
    let stop = serde_json::to_value(&openai.stop).unwrap();
    assert_eq!(stop, serde_json::json!(["STOP"]));
}

#[test]
fn optional_block_shapes_match_the_upstream_captures() {
    // probe4: assistant tool_use only -> content null; two text blocks ->
    // one "a\nb" string; user two text blocks -> parts array; a tool_result
    // content array joins with "\n".
    let req = request(&serde_json::json!({
        "model": "m",
        "messages": [
            { "role": "assistant", "content": [
                { "type": "tool_use", "id": "tu_1", "name": "search", "input": { "q": "x" } }
            ]},
            { "role": "user", "content": [
                { "type": "tool_result", "tool_use_id": "tu_1",
                  "content": [{ "type": "text", "text": "a" }, { "type": "text", "text": "b" }] }
            ]},
            { "role": "assistant", "content": [
                { "type": "text", "text": "a" }, { "type": "text", "text": "b" }
            ]}
        ]
    }))
    .expect("valid request");

    let openai = anthropic_to_openai_request(req);
    assert_eq!(openai.messages.len(), 3);
    assert_eq!(openai.messages[0].content, ChatContent::Null);
    assert_eq!(
        openai.messages[0].tool_calls.as_ref().map(Vec::len),
        Some(1)
    );
    assert_eq!(openai.messages[1].role, ChatRole::Tool);
    assert_eq!(
        openai.messages[1].content,
        ChatContent::Text("a\nb".to_owned())
    );
    assert_eq!(
        openai.messages[2].content,
        ChatContent::Text("a\nb".to_owned())
    );
}

#[test]
fn empty_text_blocks_produce_no_part_and_drop_the_message() {
    // probe9: [{type:"text"}] alone yields no user message; adding a
    // non-empty block keeps only that text.
    let req = request(&serde_json::json!({
        "model": "m",
        "messages": [{ "role": "user", "content": [{ "type": "text" }] }]
    }))
    .expect("valid request");
    let openai = anthropic_to_openai_request(req);
    assert!(
        !openai.messages.iter().any(|m| m.role == ChatRole::User),
        "a message with no parts must be dropped"
    );

    let req = request(&serde_json::json!({
        "model": "m",
        "messages": [{ "role": "user", "content": [
            { "type": "text" }, { "type": "text", "text": "after" }
        ]}]
    }))
    .expect("valid request");
    let openai = anthropic_to_openai_request(req);
    let user = openai
        .messages
        .iter()
        .find(|m| m.role == ChatRole::User)
        .expect("the non-empty block keeps the message");
    assert_eq!(user.content, ChatContent::Text("after".to_owned()));
}

#[test]
fn an_image_without_a_source_is_dropped() {
    // probe9: {type:"image"} with no source contributes no part.
    let req = request(&serde_json::json!({
        "model": "m",
        "messages": [{ "role": "user", "content": [
            { "type": "image" }, { "type": "text", "text": "after-image" }
        ]}]
    }))
    .expect("valid request");
    let openai = anthropic_to_openai_request(req);
    let user = openai
        .messages
        .iter()
        .find(|m| m.role == ChatRole::User)
        .expect("the text block keeps the message");
    match &user.content {
        ChatContent::Text(text) => assert_eq!(text, "after-image"),
        other => panic!("expected text content, got {other:?}"),
    }
}

#[test]
fn a_tool_use_without_an_id_gets_a_minted_call_id() {
    // probe9: upstream ids always exist; the gateway mints `call_<hex>`.
    let req = request(&serde_json::json!({
        "model": "m",
        "messages": [{ "role": "assistant", "content": [
            { "type": "tool_use", "name": "s", "input": {} }
        ]}]
    }))
    .expect("valid request");
    let openai = anthropic_to_openai_request(req);
    let calls = openai.messages[0]
        .tool_calls
        .as_ref()
        .expect("tool_calls present");
    assert!(calls[0].id.starts_with("call_"), "got {}", calls[0].id);
    assert_eq!(calls[0].id.len(), "call_".len() + 8);
}

// -- Response mapping (probe4, probe13, probe15) --------------------------

fn response_with_finish(finish: Value) -> Value {
    serde_json::json!({
        "id": "chatcmpl-z",
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": "x" },
            "finish_reason": finish
        }],
        "usage": { "prompt_tokens": 1, "completion_tokens": 1 }
    })
}

#[test]
fn finish_reason_maps_exactly_as_node_does() {
    // probe15: every finish_reason value and its stop_reason.
    for (finish, expected) in [
        ("stop_sequence", "end_turn"),
        ("length", "max_tokens"),
        ("stop", "end_turn"),
        ("tool_calls", "tool_use"),
        ("function_call", "tool_use"),
        ("content_filter", "end_turn"),
    ] {
        let res = openai_to_anthropic_response(
            &response_with_finish(serde_json::json!(finish)),
            "m",
            false,
        );
        assert_eq!(res["stop_reason"], expected, "finish_reason {finish}");
    }
    let res = openai_to_anthropic_response(&response_with_finish(Value::Null), "m", false);
    assert_eq!(res["stop_reason"], "end_turn", "finish_reason null");
}

#[test]
fn response_content_arrays_collapse_into_one_text_block() {
    // probe4: [p1,p2] -> one block "p1\np2"; all-image/empty/number -> [].
    let parts = serde_json::json!({
        "id": "chatcmpl-x",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": [
                    { "type": "text", "text": "p1" },
                    { "type": "image", "image_url": { "url": "data:image/png;base64,QQ==" } },
                    { "type": "text", "text": "p2" }
                ]
            },
            "finish_reason": "stop"
        }],
        "usage": {}
    });
    let res = openai_to_anthropic_response(&parts, "m", false);
    assert_eq!(res["content"].as_array().unwrap().len(), 1);
    assert_eq!(res["content"][0]["text"], "p1\np2");

    for content in [
        serde_json::json!([]),
        serde_json::json!([{ "type": "image", "image_url": { "url": "u" } }]),
        serde_json::json!(42),
        Value::Null,
    ] {
        let body = serde_json::json!({
            "id": "chatcmpl-x",
            "choices": [{
                "index": 0,
                "message": { "role": "assistant", "content": content },
                "finish_reason": "stop"
            }],
            "usage": {}
        });
        let res = openai_to_anthropic_response(&body, "m", false);
        assert_eq!(res["content"], serde_json::json!([]), "content {content}");
    }
}

#[test]
fn an_empty_string_content_keeps_an_empty_text_block() {
    // probe4: "" -> [{"type":"text","text":""}] (null would drop the block).
    let body = serde_json::json!({
        "id": "chatcmpl-x",
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": "" },
            "finish_reason": "stop"
        }],
        "usage": {}
    });
    let res = openai_to_anthropic_response(&body, "m", false);
    assert_eq!(
        res["content"],
        serde_json::json!([{ "type": "text", "text": "" }])
    );
}

#[test]
fn usage_reports_only_the_two_input_output_counters() {
    // probe4: cache fields are dropped; missing usage -> 0/0.
    let with_details = serde_json::json!({
        "id": "chatcmpl-x",
        "choices": [{ "index": 0, "message": { "role": "assistant", "content": "x" }, "finish_reason": "stop" }],
        "usage": {
            "prompt_tokens": 11,
            "completion_tokens": 7,
            "prompt_tokens_details": { "cached_tokens": 3 },
            "cache_read_input_tokens": 128,
            "cache_creation_input_tokens": 5
        }
    });
    let res = openai_to_anthropic_response(&with_details, "m", false);
    assert_eq!(
        res["usage"],
        serde_json::json!({ "input_tokens": 11, "output_tokens": 7 })
    );
    assert_eq!(res["usage"].as_object().unwrap().len(), 2);

    let missing = serde_json::json!({
        "id": "chatcmpl-x",
        "choices": [{ "index": 0, "message": { "role": "assistant", "content": "x" }, "finish_reason": "stop" }]
    });
    let res = openai_to_anthropic_response(&missing, "m", false);
    assert_eq!(
        res["usage"],
        serde_json::json!({ "input_tokens": 0, "output_tokens": 0 })
    );
}

#[test]
fn the_message_id_strips_the_chatcmpl_prefix_only() {
    // probe4: "chatcmpl-z" -> "msg_z"; "custom-9" -> "msg_custom-9".
    let custom = serde_json::json!({
        "id": "custom-9",
        "choices": [{ "index": 0, "message": { "role": "assistant", "content": "x" }, "finish_reason": "stop" }],
        "usage": {}
    });
    let res = openai_to_anthropic_response(&custom, "m", false);
    assert_eq!(res["id"], "msg_custom-9");

    let no_id = serde_json::json!({
        "choices": [{ "index": 0, "message": { "role": "assistant", "content": "x" }, "finish_reason": "stop" }],
        "usage": {}
    });
    let res = openai_to_anthropic_response(&no_id, "m", false);
    let id = res["id"].as_str().expect("id present");
    assert!(id.starts_with("msg_"), "got {id}");
    assert_eq!(id.len(), "msg_".len() + 36, "uuid keeps its dashes");
}

#[test]
fn thinking_blocks_follow_the_allow_flag() {
    let body = serde_json::json!({
        "id": "chatcmpl-x",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "x",
                "reasoning_content": "thinking hard"
            },
            "finish_reason": "stop"
        }],
        "usage": {}
    });
    let allowed = openai_to_anthropic_response(&body, "m", true);
    assert_eq!(allowed["content"][0]["type"], "thinking");
    assert_eq!(allowed["content"][0]["thinking"], "thinking hard");

    let suppressed = openai_to_anthropic_response(&body, "m", false);
    assert_eq!(suppressed["content"][0]["type"], "text");
    assert!(suppressed["content"].as_array().unwrap().len() == 1);
}

// -- Stream translator (probe13, probe15) ---------------------------------

fn feed(translator: &mut AnthropicStreamTranslator, chunk: Value) -> String {
    String::from_utf8(translator.feed_chunk(&chunk).concat()).unwrap()
}

fn finish_sse(translator: &mut AnthropicStreamTranslator) -> String {
    String::from_utf8(translator.finish().concat()).unwrap()
}

#[test]
fn an_empty_stream_never_emits_message_start() {
    // probe13: zero chunks -> only message_delta (output_tokens 1) + message_stop.
    let mut translator = AnthropicStreamTranslator::new("m", false);
    let sse = finish_sse(&mut translator);
    assert!(!sse.contains("message_start"));
    assert!(sse.contains("event: message_delta"));
    assert!(sse.contains("\"output_tokens\":1"));
    assert!(sse.contains("event: message_stop"));
    assert!(sse.contains("\"stop_reason\":\"end_turn\""));
}

#[test]
fn usage_on_the_first_chunk_lands_in_message_start() {
    // probe13: prompt_tokens 42 read BEFORE message_start is emitted.
    let mut translator = AnthropicStreamTranslator::new("m", false);
    let sse = feed(
        &mut translator,
        serde_json::json!({
            "choices": [{ "index": 0, "delta": {}, "finish_reason": null }],
            "usage": { "prompt_tokens": 42, "completion_tokens": 7, "total_tokens": 49 }
        }),
    );
    assert!(sse.contains("event: message_start"));
    let start = sse.split("event: message_start").nth(1).unwrap();
    let start = start.split("event:").next().unwrap();
    assert!(start.contains("\"input_tokens\":42"), "{start}");
    assert!(start.contains("\"output_tokens\":1"), "{start}");

    let sse2 = feed(
        &mut translator,
        serde_json::json!({
            "choices": [{ "index": 0, "delta": { "content": "hi" }, "finish_reason": "stop" }]
        }),
    );
    assert!(sse2.contains("\"text\":\"hi\""));

    let sse3 = finish_sse(&mut translator);
    // One delta -> output_tokens 1, never completion_tokens 7.
    assert!(sse3.contains("\"output_tokens\":1"), "{sse3}");
    assert!(!sse3.contains("\"output_tokens\":7"));
}

#[test]
fn output_tokens_counts_deltas_not_completion_tokens() {
    // probe13: two text deltas over a final chunk with completion_tokens 9
    // reports output_tokens 2.
    let mut translator = AnthropicStreamTranslator::new("m", false);
    feed(
        &mut translator,
        serde_json::json!({
            "choices": [{ "index": 0, "delta": { "content": "a" }, "finish_reason": null }]
        }),
    );
    feed(
        &mut translator,
        serde_json::json!({
            "choices": [{ "index": 0, "delta": { "content": "b" }, "finish_reason": "stop" }],
            "usage": { "prompt_tokens": 5, "completion_tokens": 9, "total_tokens": 14 }
        }),
    );
    let sse = finish_sse(&mut translator);
    assert!(sse.contains("\"output_tokens\":2"), "{sse}");
    assert!(sse.contains("\"stop_reason\":\"end_turn\""));
}

#[test]
fn stream_finish_reason_maps_like_the_buffered_path() {
    for (finish, expected) in [
        ("length", "max_tokens"),
        ("tool_calls", "tool_use"),
        ("function_call", "tool_use"),
        ("stop_sequence", "end_turn"),
        ("stop", "end_turn"),
    ] {
        let mut translator = AnthropicStreamTranslator::new("m", false);
        feed(
            &mut translator,
            serde_json::json!({
                "choices": [{ "index": 0, "delta": { "content": "x" }, "finish_reason": finish }]
            }),
        );
        let sse = finish_sse(&mut translator);
        assert!(
            sse.contains(&format!("\"stop_reason\":\"{expected}\"")),
            "finish_reason {finish}: {sse}"
        );
    }
}

#[test]
fn stream_tool_deltas_open_and_close_the_tool_block() {
    // probe: partial JSON deltas flow as input_json_delta on one block.
    let mut translator = AnthropicStreamTranslator::new("m", false);
    let sse1 = feed(
        &mut translator,
        serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_1",
                        "function": { "name": "search", "arguments": "{\"q\":" }
                    }]
                },
                "finish_reason": null
            }]
        }),
    );
    assert!(sse1.contains("event: content_block_start"), "{sse1}");
    assert!(sse1.contains("\"type\":\"tool_use\""), "{sse1}");

    let sse2 = feed(
        &mut translator,
        serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": { "tool_calls": [{ "index": 0, "function": { "arguments": "\"rust\"}" } }] },
                "finish_reason": "tool_calls"
            }]
        }),
    );
    assert!(sse2.contains("input_json_delta"), "{sse2}");

    let sse3 = finish_sse(&mut translator);
    assert!(sse3.contains("event: content_block_stop"), "{sse3}");
    assert!(sse3.contains("\"stop_reason\":\"tool_use\""), "{sse3}");
}

// -- Error envelope type mapping (contract) -------------------------------

#[test]
fn error_types_follow_the_contract_table() {
    // docs/api-v1-contract.md "Error envelopes": the same mapping Node's
    // GetErrorTypeFromStatus uses (probed via probe-401/-429/-500 outputs).
    assert_eq!(anthropic_error_type(400), "invalid_request_error");
    assert_eq!(anthropic_error_type(404), "invalid_request_error");
    assert_eq!(anthropic_error_type(409), "invalid_request_error");
    assert_eq!(anthropic_error_type(422), "invalid_request_error");
    assert_eq!(anthropic_error_type(401), "authentication_error");
    assert_eq!(anthropic_error_type(403), "permission_error");
    assert_eq!(anthropic_error_type(429), "rate_limit_error");
    assert_eq!(anthropic_error_type(500), "api_error");
    assert_eq!(anthropic_error_type(502), "api_error");
}
