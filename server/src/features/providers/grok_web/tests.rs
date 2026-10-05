use serde_json::Value;

use crate::protocol::model::{ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ToolCall};

use super::request::{flatten_messages, resolve_model, tool_instruction, tools_active};
use super::translate::{encode_frame, extract_first_object, parse_tool_calls};
use super::transport::{ASSISTANT_CHANNEL, WsFrame, classify_value};

fn message(role: ChatRole, content: ChatContent) -> ChatMessage {
    ChatMessage {
        role,
        content,
        name: None,
        tool_calls: None,
        tool_call_id: None,
        cache_control: None,
    }
}

#[test]
fn single_user_message_is_sent_bare() {
    let prompt = flatten_messages(&[message(
        ChatRole::User,
        ChatContent::Text("Hello".to_owned()),
    )])
    .expect("prompt");
    assert_eq!(prompt, "Hello");
}

#[test]
fn system_and_history_turns_are_role_prefixed_except_the_last_user() {
    let prompt = flatten_messages(&[
        message(ChatRole::System, ChatContent::Text("Be brief".to_owned())),
        message(ChatRole::User, ChatContent::Text("First".to_owned())),
        message(ChatRole::Assistant, ChatContent::Text("Sure".to_owned())),
        message(ChatRole::User, ChatContent::Text("Second".to_owned())),
    ])
    .expect("prompt");
    assert_eq!(
        prompt,
        "system: Be brief\n\nuser: First\n\nassistant: Sure\n\nSecond"
    );
}

#[test]
fn developer_role_flattens_as_system() {
    let prompt = flatten_messages(&[
        message(ChatRole::Developer, ChatContent::Text("Rules".to_owned())),
        message(ChatRole::User, ChatContent::Text("Hi".to_owned())),
    ])
    .expect("prompt");
    assert_eq!(prompt, "system: Rules\n\nHi");
}

#[test]
fn empty_and_null_turns_are_dropped() {
    let prompt = flatten_messages(&[
        message(ChatRole::User, ChatContent::Text("   ".to_owned())),
        message(ChatRole::Assistant, ChatContent::Null),
        message(ChatRole::User, ChatContent::Text("Real".to_owned())),
    ])
    .expect("prompt");
    assert_eq!(prompt, "Real");
}

#[test]
fn only_empty_content_is_a_400() {
    let error = flatten_messages(&[message(ChatRole::User, ChatContent::Text("".to_owned()))])
        .expect_err("empty prompt is rejected");
    assert_eq!(error.status(), 400);
}

#[test]
fn image_parts_are_rejected_not_silently_dropped() {
    use crate::protocol::model::{ContentPart, ContentPartType, ImageUrl};

    let error = flatten_messages(&[message(
        ChatRole::User,
        ChatContent::Parts(vec![
            ContentPart {
                kind: ContentPartType::Text,
                text: Some("look".to_owned()),
                image_url: None,
                cache_control: None,
            },
            ContentPart {
                kind: ContentPartType::ImageUrl,
                text: None,
                image_url: Some(ImageUrl {
                    url: "data:image/png;base64,AAAA".to_owned(),
                    detail: None,
                }),
                cache_control: None,
            },
        ]),
    )])
    .expect_err("images are unsupported");
    assert_eq!(error.status(), 400);
}

#[test]
fn unknown_models_are_404_and_advertised_ids_resolve() {
    assert_eq!(resolve_model("fast").expect("fast"), "fast");
    assert_eq!(resolve_model("HEAVY").expect("heavy"), "heavy");
    let error = resolve_model("grok-9").expect_err("unknown");
    assert_eq!(error.status(), 404);
}

#[test]
fn response_chunks_translate_by_channel() {
    let chunk = |channel: &str, text: &str| {
        serde_json::json!({
            "event": {
                "type": "response.chunk",
                "chunk": { "text": { "text": text, "channel": channel } }
            }
        })
    };
    assert!(matches!(
        classify_value(&chunk(ASSISTANT_CHANNEL, "zeta")),
        WsFrame::Text(text) if text == "zeta"
    ));
    assert!(matches!(
        classify_value(&chunk("CHANNEL_SOMETHING_ELSE", "think")),
        WsFrame::Reasoning(text) if text == "think"
    ));
    // Metadata-only and follow-up chunks carry no text and are ignored.
    assert!(matches!(
        classify_value(&serde_json::json!({
            "event": { "type": "response.chunk", "chunk": { "metadata": {} } }
        })),
        WsFrame::Ignored
    ));
}

#[test]
fn done_frames_carry_status_and_reason() {
    let done = |status: &str, reason: Option<&str>| {
        let mut response = serde_json::json!({ "status": status });
        if let Some(reason) = reason {
            response["status_details"] = serde_json::json!({ "reason": reason });
        }
        serde_json::json!({ "event": { "type": "response.done", "response": response } })
    };
    assert!(matches!(
        classify_value(&done("completed", None)),
        WsFrame::Completed
    ));
    assert!(matches!(
        classify_value(&done("incomplete", Some("stream_error"))),
        WsFrame::Failed(reason) if reason == "stream_error"
    ));
}

#[test]
fn error_shapes_surface_a_message() {
    let top_level = serde_json::json!({ "error": { "message": "boom" } });
    assert!(matches!(
        classify_value(&top_level),
        WsFrame::Errored(message) if message == "boom"
    ));
    let error_event = serde_json::json!({
        "event": { "type": "response.error", "message": "nope" }
    });
    assert!(matches!(
        classify_value(&error_event),
        WsFrame::Errored(message) if message == "nope"
    ));
}

#[test]
fn framing_matches_the_openai_chunk_shape() {
    let frame = encode_frame(
        "chatcmpl-abc",
        1_700_000_000,
        "fast",
        serde_json::json!({ "content": "hi" }),
        None,
        None,
    );
    let text = String::from_utf8(frame.to_vec()).expect("utf8");
    assert!(text.starts_with("data: {"));
    assert!(text.ends_with("\n\n"));
    let value: Value =
        serde_json::from_str(text.trim_start_matches("data: ").trim_end()).expect("frame parses");
    assert_eq!(value["object"], "chat.completion.chunk");
    assert_eq!(value["model"], "fast");
    assert_eq!(value["choices"][0]["delta"]["content"], "hi");
}

fn request_with_tools(value: Value) -> ChatCompletionRequest {
    serde_json::from_value(value).expect("request parses")
}

#[test]
fn parse_tool_calls_accepts_bare_fenced_and_embedded_envelopes() {
    let bare = r#"{"tool_calls":[{"name":"get_weather","arguments":{"city":"Jakarta"}}]}"#;

    let parsed = parse_tool_calls(bare).expect("bare parses");
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].name, "get_weather");
    assert_eq!(parsed[0].arguments, r#"{"city":"Jakarta"}"#);

    let fenced = format!("```json\n{bare}\n```");
    assert_eq!(parse_tool_calls(&fenced).expect("fenced parses").len(), 1);

    let embedded = format!("Sure.\n{bare}\nDone.");
    assert_eq!(
        parse_tool_calls(&embedded).expect("embedded parses")[0].name,
        "get_weather"
    );

    let string_arguments = r#"{"tool_calls":[{"name":"lookup","arguments":"{\"q\":\"x\"}"}]}"#;
    assert_eq!(
        parse_tool_calls(string_arguments).expect("string args")[0].arguments,
        r#"{"q":"x"}"#
    );
}

#[test]
fn parse_tool_calls_rejects_prose_malformed_and_empty_lists() {
    assert!(parse_tool_calls("The weather is fine.").is_none());
    assert!(parse_tool_calls(r#"{"tool_calls":[]}"#).is_none());
    assert!(parse_tool_calls(r#"{"tool_calls":[{"arguments":{}}]}"#).is_none());
    assert!(parse_tool_calls(r#"{"tool_calls":[{"name":"   "}]}"#).is_none());
    assert!(parse_tool_calls("{not json}").is_none());
}

#[test]
fn extract_first_object_ignores_braces_inside_strings() {
    assert_eq!(
        extract_first_object(r#"prefix {"a":"}"} suffix"#),
        Some(r#"{"a":"}"}"#)
    );
    assert!(extract_first_object("no object here").is_none());
}

#[test]
fn tool_instruction_lists_the_tools_and_honours_tool_choice() {
    let auto = request_with_tools(serde_json::json!({
        "model": "grok-web/fast",
        "messages": [{ "role": "user", "content": "hi" }],
        "tools": [{ "type": "function", "function": {
            "name": "get_weather", "description": "Weather", "parameters": { "type": "object" }
        }}],
        "tool_choice": "auto"
    }));
    let section = tool_instruction(&auto).expect("section");
    assert!(section.contains("get_weather"));
    assert!(section.contains("Call a function when it is needed"));
    assert!(section.contains("tool_calls"));

    let required = request_with_tools(serde_json::json!({
        "model": "grok-web/fast",
        "messages": [{ "role": "user", "content": "hi" }],
        "tools": [{ "type": "function", "function": { "name": "get_weather" } }],
        "tool_choice": "required"
    }));
    assert!(
        tool_instruction(&required)
            .expect("section")
            .contains("MUST call at least one")
    );

    let named = request_with_tools(serde_json::json!({
        "model": "grok-web/fast",
        "messages": [{ "role": "user", "content": "hi" }],
        "tools": [{ "type": "function", "function": { "name": "get_weather" } }],
        "tool_choice": { "type": "function", "function": { "name": "get_weather" } }
    }));
    assert!(
        tool_instruction(&named)
            .expect("section")
            .contains("`get_weather`")
    );

    let none = request_with_tools(serde_json::json!({
        "model": "grok-web/fast",
        "messages": [{ "role": "user", "content": "hi" }],
        "tools": [{ "type": "function", "function": { "name": "get_weather" } }],
        "tool_choice": "none"
    }));
    assert!(tool_instruction(&none).is_none());
    assert!(!tools_active(&none));

    let without_tools = request_with_tools(serde_json::json!({
        "model": "grok-web/fast",
        "messages": [{ "role": "user", "content": "hi" }]
    }));
    assert!(!tools_active(&without_tools));
    assert!(tool_instruction(&without_tools).is_none());
}

#[test]
fn assistant_tool_calls_and_results_flatten_back_into_the_prompt() {
    use crate::protocol::model::{ToolCallFunction, ToolCallKind};

    let messages = vec![
        message(
            ChatRole::User,
            ChatContent::Text("Weather in Jakarta?".to_owned()),
        ),
        ChatMessage {
            role: ChatRole::Assistant,
            content: ChatContent::Null,
            name: None,
            tool_calls: Some(vec![ToolCall {
                id: "call-1".to_owned(),
                kind: ToolCallKind::Function,
                function: ToolCallFunction {
                    name: "get_weather".to_owned(),
                    arguments: r#"{"city":"Jakarta"}"#.to_owned(),
                },
            }]),
            tool_call_id: None,
            cache_control: None,
        },
        ChatMessage {
            role: ChatRole::Tool,
            content: ChatContent::Text(r#"{"temp_c":32}"#.to_owned()),
            name: None,
            tool_calls: None,
            tool_call_id: Some("call-1".to_owned()),
            cache_control: None,
        },
        message(ChatRole::User, ChatContent::Text("And Bandung?".to_owned())),
    ];

    let prompt = flatten_messages(&messages).expect("prompt");
    assert!(prompt.contains("assistant: {"));
    assert!(prompt.contains("\"tool_calls\""));
    assert!(prompt.contains("get_weather"));
    assert!(prompt.contains(r#"{"city":"Jakarta"}"#));
    assert!(prompt.contains(r#"tool result (get_weather): {"temp_c":32}"#));
    assert!(prompt.ends_with("And Bandung?"));
}
