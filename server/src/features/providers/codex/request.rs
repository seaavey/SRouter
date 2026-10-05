//! Codex request encoding: the Chat Completions transcript is rewritten into the
//! OpenAI Responses API shape (`input` items, flat function tools, `text.format`).

use serde_json::Value;

use crate::constants;
use crate::error::APIError;
use crate::protocol::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ResponseFormat, ToolChoice,
    ToolChoiceMode,
};

/// Builds the Responses API body for one turn: the message transcript becomes
/// `input` items, chat tools become flat function tools, and the stream flags
/// are the adapter's own (`stream: true`, `store: false`, the shape the official
/// client sends).
pub(super) fn upstream_body(
    model_key: &str,
    request: &ChatCompletionRequest,
) -> Result<Value, APIError> {
    let mut body = serde_json::json!({
        "model": model_key,
        "input": input_items(&request.messages),
        "stream": true,
        "store": false,
    });

    if let Some(tools) = &request.tools
        && !tools.is_empty()
    {
        body["tools"] = Value::Array(
            tools
                .iter()
                .map(|tool| {
                    serde_json::json!({
                        "type": "function",
                        "name": tool.function.name,
                        "description": tool.function.description,
                        "parameters": tool.function.parameters,
                    })
                })
                .collect(),
        );
    }

    if let Some(tool_choice) = &request.tool_choice {
        body["tool_choice"] = match tool_choice {
            ToolChoice::Mode(ToolChoiceMode::None) => Value::String("none".to_owned()),
            ToolChoice::Mode(ToolChoiceMode::Auto) => Value::String("auto".to_owned()),
            ToolChoice::Mode(ToolChoiceMode::Required) => Value::String("required".to_owned()),
            ToolChoice::Named(named) => serde_json::json!({
                "type": "function",
                "name": named.function.name,
            }),
        };
    }

    // `none` disables reasoning on the chat schema; the Responses API has no
    // such value, so the field is dropped and upstream runs its default.
    let effort = request
        .reasoning
        .as_ref()
        .and_then(|options| options.effort.as_deref())
        .or(request.reasoning_effort.as_deref())
        .filter(|effort| !effort.eq_ignore_ascii_case("none"));
    if let Some(effort) = effort {
        body["reasoning"] = serde_json::json!({ "effort": effort });
    }

    if let Some(max_tokens) = request.max_tokens {
        body["max_output_tokens"] = Value::from(max_tokens);
    }
    if let Some(temperature) = request.temperature {
        body["temperature"] = Value::from(temperature);
    }
    if let Some(top_p) = request.top_p {
        body["top_p"] = Value::from(top_p);
    }

    if let Some(format) = request.response_format.as_ref().and_then(text_format) {
        body["text"] = serde_json::json!({ "format": format });
    }

    serde_json::to_value(&body)
        .map_err(|error| APIError::new(500, constants::providers::could_not_build_request(&error)))
}

/// Maps the chat `response_format` onto the Responses `text.format` object.
/// An unknown shape is dropped rather than sent as a guess.
fn text_format(format: &ResponseFormat) -> Option<Value> {
    match format.kind.as_str() {
        "json_object" => Some(serde_json::json!({ "type": "json_object" })),
        "json_schema" => {
            // Chat requests nest the schema under `json_schema`; the Responses
            // API wants the parts flattened into `text.format`.
            let nested = format.json_schema.as_ref().and_then(Value::as_object);
            let name = format
                .name
                .clone()
                .or_else(|| {
                    nested
                        .and_then(|object| object.get("name"))
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| "response".to_owned());
            let schema = nested
                .and_then(|object| object.get("schema"))
                .cloned()
                .or_else(|| format.json_schema.clone())?;
            let strict = format.strict.or_else(|| {
                nested
                    .and_then(|object| object.get("strict"))
                    .and_then(Value::as_bool)
            });

            let mut mapped = serde_json::json!({
                "type": "json_schema",
                "name": name,
                "schema": schema,
            });
            if let Some(strict) = strict {
                mapped["strict"] = Value::Bool(strict);
            }
            Some(mapped)
        }
        _ => None,
    }
}

/// Turns the chat transcript into Responses `input` items: messages, tool
/// results as `function_call_output`, and assistant tool calls as
/// `function_call` items.
fn input_items(messages: &[ChatMessage]) -> Vec<Value> {
    let mut items = Vec::with_capacity(messages.len());

    for message in messages {
        let role = match message.role {
            ChatRole::System | ChatRole::Developer => "developer",
            ChatRole::User => "user",
            ChatRole::Assistant => "assistant",
            ChatRole::Tool | ChatRole::Function => {
                items.push(function_call_output(message));
                continue;
            }
        };

        let text_part_type = if message.role == ChatRole::Assistant {
            "output_text"
        } else {
            "input_text"
        };
        let content = content_parts(&message.content, text_part_type);
        if !content.is_empty() {
            items.push(serde_json::json!({
                "type": "message",
                "role": role,
                "content": content,
            }));
        }

        if let Some(tool_calls) = &message.tool_calls {
            for call in tool_calls {
                items.push(serde_json::json!({
                    "type": "function_call",
                    "call_id": call.id,
                    "name": call.function.name,
                    "arguments": call.function.arguments,
                }));
            }
        }
    }

    items
}

fn function_call_output(message: &ChatMessage) -> Value {
    let call_id = message
        .tool_call_id
        .clone()
        .or_else(|| message.name.clone())
        .unwrap_or_default();
    let output = match &message.content {
        ChatContent::Text(text) => text.clone(),
        ChatContent::Parts(parts) => parts
            .iter()
            .filter_map(|part| part.text.as_ref())
            .cloned()
            .collect::<Vec<_>>()
            .join("\n"),
        ChatContent::Null => String::new(),
    };

    serde_json::json!({
        "type": "function_call_output",
        "call_id": call_id,
        "output": output,
    })
}

fn content_parts(content: &ChatContent, text_part_type: &str) -> Vec<Value> {
    let mut parts = Vec::new();
    match content {
        ChatContent::Text(text) => {
            if !text.is_empty() {
                parts.push(serde_json::json!({
                    "type": text_part_type,
                    "text": text,
                }));
            }
        }
        ChatContent::Parts(entries) => {
            for entry in entries {
                if let Some(text) = &entry.text
                    && !text.is_empty()
                {
                    parts.push(serde_json::json!({
                        "type": text_part_type,
                        "text": text,
                    }));
                } else if let Some(image) = &entry.image_url {
                    let mut part = serde_json::json!({
                        "type": "input_image",
                        "image_url": image.url,
                    });
                    if let Some(detail) = image.detail {
                        part["detail"] = serde_json::json!(detail);
                    }
                    parts.push(part);
                }
            }
        }
        ChatContent::Null => {}
    }
    parts
}

pub(super) fn strip_codex_prefix(model: &str) -> &str {
    model
        .strip_prefix("openai_codex/")
        .or_else(|| model.strip_prefix("codex/"))
        .unwrap_or(model)
}
