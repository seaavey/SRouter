//! Prompt construction for the text-only WebSocket transport: OpenAI message
//! flattening, the emulated tool contract, and model resolution.

use serde_json::{Value, json};

use super::types::GROK_WEB_MODELS;
use crate::constants;
use crate::error::APIError;
use crate::protocol::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ContentPartType, ToolCall,
    ToolChoice, ToolChoiceMode,
};

/// Whether the request carries at least one function tool that may be used.
/// `tool_choice: "none"` turns the whole mechanism off.
pub(super) fn tools_active(request: &ChatCompletionRequest) -> bool {
    !matches!(
        request.tool_choice,
        Some(ToolChoice::Mode(ToolChoiceMode::None))
    ) && request
        .tools
        .as_ref()
        .is_some_and(|tools| !tools.is_empty())
}

/// The system section that teaches the model the emulated tool contract, or
/// `None` when the request carries no usable tools.
///
/// The grok.com WebSocket carries text only — its native tools are
/// connector/MCP toolsets the account has registered, with no request field for
/// arbitrary functions — so tools are declared in the prompt and the model's
/// JSON reply is parsed back into OpenAI `tool_calls`.
pub(super) fn tool_instruction(request: &ChatCompletionRequest) -> Option<String> {
    if !tools_active(request) {
        return None;
    }
    let tools = request.tools.as_ref()?;

    let mut section = String::from(
        "You can call functions to fetch data you do not already know. Available functions:",
    );
    for tool in tools {
        let function = &tool.function;
        section.push_str("\n- ");
        section.push_str(&function.name);
        if let Some(description) = function
            .description
            .as_deref()
            .filter(|text| !text.trim().is_empty())
        {
            section.push_str(": ");
            section.push_str(description.trim());
        }
        if let Some(parameters) = &function.parameters {
            section.push_str("\n  parameters (JSON Schema): ");
            section.push_str(&serde_json::to_string(parameters).unwrap_or_default());
        }
    }

    section.push_str("\n\n");
    section.push_str(&tool_directive(request));
    section.push_str(
        "\nWhen you call functions, reply with ONLY a JSON object (no prose, no markdown) in exactly this shape: \
         {\"tool_calls\":[{\"name\":\"<function name>\",\"arguments\":{<arguments>}}]}. \
         The caller runs each function and sends the results back; never invent a result.",
    );
    Some(section)
}

/// The `tool_choice`-dependent instruction sentence.
fn tool_directive(request: &ChatCompletionRequest) -> String {
    match &request.tool_choice {
        Some(ToolChoice::Mode(ToolChoiceMode::Required)) => {
            "You MUST call at least one function now.".to_owned()
        }
        Some(ToolChoice::Named(named)) => {
            format!("You MUST call the function `{}` now.", named.function.name)
        }
        _ => "Call a function when it is needed; otherwise answer normally.".to_owned(),
    }
}

/// The full prompt: the flattened conversation, prefixed with the tool contract
/// when the request carries tools.
pub(super) fn build_prompt(request: &ChatCompletionRequest) -> Result<String, APIError> {
    let base = flatten_messages(&request.messages)?;
    Ok(match tool_instruction(request) {
        Some(section) => format!("{section}\n\n{base}"),
        None => base,
    })
}

/// Collapses the OpenAI message list into the single text prompt the WebSocket
/// protocol accepts: every turn except the last user message is prefixed with
/// its role, mirroring the reference `parseOpenAIMessages`. Empty turns are
/// dropped; a prompt that ends up empty is a `400`.
pub(super) fn flatten_messages(messages: &[ChatMessage]) -> Result<String, APIError> {
    // A `role: "tool"` turn answers a call by id; the id→name map lets the
    // flattened turn carry the function name the model recognises.
    let names: std::collections::HashMap<&str, &str> = messages
        .iter()
        .filter_map(|message| message.tool_calls.as_deref())
        .flatten()
        .map(|call| (call.id.as_str(), call.function.name.as_str()))
        .collect();

    let mut turns: Vec<(&str, String)> = Vec::new();

    for message in messages {
        let role = match message.role {
            ChatRole::System | ChatRole::Developer => "system",
            ChatRole::User => "user",
            ChatRole::Assistant => "assistant",
            ChatRole::Tool => "tool",
            ChatRole::Function => "function",
        };

        let mut text = content_text(&message.content)?;

        if role == "assistant" {
            if let Some(calls) = message
                .tool_calls
                .as_deref()
                .filter(|calls| !calls.is_empty())
            {
                let envelope = render_calls_envelope(calls);
                text = if text.trim().is_empty() {
                    envelope
                } else {
                    format!("{text}\n{envelope}")
                };
            }
        } else if role == "tool" && !text.trim().is_empty() {
            let label = message
                .tool_call_id
                .as_deref()
                .and_then(|id| names.get(id).copied())
                .unwrap_or("result");
            text = format!("tool result ({label}): {text}");
        }

        if !text.trim().is_empty() {
            turns.push((role, text));
        }
    }

    let last_user = turns
        .iter()
        .rposition(|(role, _)| *role == "user")
        .unwrap_or(usize::MAX);

    let rendered: Vec<String> = turns
        .iter()
        .enumerate()
        .map(|(index, (role, text))| {
            if index == last_user {
                text.clone()
            } else {
                format!("{role}: {text}")
            }
        })
        .collect();
    let prompt = rendered.join("\n\n");

    if prompt.trim().is_empty() {
        return Err(APIError::new(
            400,
            constants::providers::grok_web::EMPTY_QUERY,
        ));
    }
    Ok(prompt)
}

/// Extracts a message's text, rejecting image parts (the transport is
/// text-only; dropping one silently would let the model answer a prompt it
/// never saw).
fn content_text(content: &ChatContent) -> Result<String, APIError> {
    match content {
        ChatContent::Text(text) => Ok(text.clone()),
        ChatContent::Parts(parts) => {
            let mut text = String::new();
            for part in parts {
                if part.kind == ContentPartType::ImageUrl {
                    return Err(APIError::new(
                        400,
                        constants::providers::grok_web::UNSUPPORTED_CONTENT,
                    ));
                }
                if let Some(part_text) = &part.text {
                    if !text.is_empty() {
                        text.push(' ');
                    }
                    text.push_str(part_text);
                }
            }
            Ok(text)
        }
        ChatContent::Null => Ok(String::new()),
    }
}

/// Renders prior assistant tool calls back into the emulated envelope so a
/// follow-up turn shows the model the call it made before the results arrived.
fn render_calls_envelope(calls: &[ToolCall]) -> String {
    let rendered: Vec<Value> = calls
        .iter()
        .map(|call| {
            let arguments = serde_json::from_str::<Value>(&call.function.arguments)
                .unwrap_or_else(|_| Value::String(call.function.arguments.clone()));
            json!({ "name": call.function.name, "arguments": arguments })
        })
        .collect();
    json!({ "tool_calls": rendered }).to_string()
}

/// Validates a requested model against the advertised list. The registry's
/// prefix path resolves any `<provider>/<model>` without checking, and the
/// upstream accepts any `session.model` before failing at `response.done`, so
/// the client-side check is what turns a typo into a clean `404`.
pub(super) fn resolve_model(model: &str) -> Result<String, APIError> {
    GROK_WEB_MODELS
        .iter()
        .find(|candidate| model.eq_ignore_ascii_case(candidate.id))
        .map(|candidate| candidate.id.to_owned())
        .ok_or_else(|| APIError::new(404, constants::gateway::model_not_registered(model)))
}
