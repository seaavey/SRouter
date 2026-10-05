use serde_json::Value;

use crate::protocol::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ContentPart, ContentPartType,
    ImageUrl, ReasoningOptions, StopSequence, ToolCall, ToolCallFunction, ToolCallKind, ToolChoice,
    ToolChoiceFunction, ToolChoiceMode, ToolChoiceNamed, ToolDefinition, ToolFunction, ToolKind,
};

use super::types::generate_call_id;
use super::*;

// ============================================================================
// Translation: Anthropic Request -> OpenAI Request
// ============================================================================

pub fn anthropic_to_openai_request(req: AnthropicMessageRequest) -> ChatCompletionRequest {
    let mut messages: Vec<ChatMessage> = Vec::new();

    // Node joins the system blocks and drops their `cache_control`, exactly
    // like every other block marker: none of the executors read them and the
    // OpenAI upstreams have no such concept.
    if let Some(system) = req.system {
        let text = match system {
            AnthropicSystem::Text(text) => text,
            AnthropicSystem::Blocks(blocks) => blocks
                .iter()
                .filter(|b| b.block_type == "text")
                .map(|b| b.text.as_str())
                .collect::<Vec<_>>()
                .join("\n\n"),
        };
        if !text.is_empty() {
            messages.push(ChatMessage {
                role: ChatRole::System,
                content: ChatContent::Text(text),
                name: None,
                tool_calls: None,
                tool_call_id: None,
                cache_control: None,
            });
        }
    }

    for msg in req.messages {
        match msg.content {
            AnthropicMessageContent::Text(text) => {
                // Node passes `system` through for string content, but its
                // block branch folds a system role into `user`; only the
                // string arm keeps the role (probed both ways).
                let role = match msg.role.as_str() {
                    "assistant" => ChatRole::Assistant,
                    "system" => ChatRole::System,
                    _ => ChatRole::User,
                };
                messages.push(ChatMessage {
                    role,
                    content: ChatContent::Text(text),
                    name: None,
                    tool_calls: None,
                    tool_call_id: None,
                    cache_control: None,
                });
            }
            AnthropicMessageContent::Blocks(blocks) => {
                let mut parts: Vec<ContentPart> = Vec::new();
                let mut tool_calls: Vec<ToolCall> = Vec::new();
                let mut tool_results: Vec<(String, String)> = Vec::new();

                for block in blocks {
                    match block {
                        AnthropicContentBlock::Text { text, .. } => {
                            // Empty and absent text blocks produce no part:
                            // a user message whose parts end up empty is
                            // dropped entirely (probed).
                            if !text.is_empty() {
                                parts.push(ContentPart {
                                    kind: ContentPartType::Text,
                                    text: Some(text),
                                    image_url: None,
                                    cache_control: None,
                                });
                            }
                        }
                        AnthropicContentBlock::Image { source, .. } => {
                            if let Some(source) = source {
                                let url =
                                    format!("data:{};base64,{}", source.media_type, source.data);
                                parts.push(ContentPart {
                                    kind: ContentPartType::ImageUrl,
                                    text: None,
                                    image_url: Some(ImageUrl { url, detail: None }),
                                    cache_control: None,
                                });
                            }
                        }
                        AnthropicContentBlock::ToolUse { id, name, input } => {
                            let args = if let Some(s) = input.as_str() {
                                s.to_owned()
                            } else {
                                serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_owned())
                            };
                            tool_calls.push(ToolCall {
                                id: if id.is_empty() {
                                    generate_call_id()
                                } else {
                                    id
                                },
                                kind: ToolCallKind::Function,
                                function: ToolCallFunction {
                                    name,
                                    arguments: args,
                                },
                            });
                        }
                        AnthropicContentBlock::ToolResult {
                            tool_use_id,
                            content,
                            ..
                        } => {
                            let text = match content {
                                None => String::new(),
                                Some(Value::String(s)) => s,
                                Some(Value::Array(arr)) => arr
                                    .iter()
                                    .map(|item| {
                                        if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                                            t.to_owned()
                                        } else {
                                            serde_json::to_string(item).unwrap_or_default()
                                        }
                                    })
                                    .collect::<Vec<_>>()
                                    .join("\n"),
                                Some(other) => serde_json::to_string(&other).unwrap_or_default(),
                            };
                            tool_results.push((tool_use_id, text));
                        }
                        AnthropicContentBlock::Thinking { .. }
                        | AnthropicContentBlock::RedactedThinking { .. } => {}
                    }
                }

                if msg.role == "assistant" {
                    let text = parts
                        .iter()
                        .filter_map(|p| p.text.as_deref())
                        .collect::<Vec<_>>()
                        .join("\n");
                    let content = if text.is_empty() {
                        if !tool_calls.is_empty() {
                            ChatContent::Null
                        } else {
                            ChatContent::Text(String::new())
                        }
                    } else {
                        ChatContent::Text(text)
                    };
                    messages.push(ChatMessage {
                        role: ChatRole::Assistant,
                        content,
                        name: None,
                        tool_calls: if tool_calls.is_empty() {
                            None
                        } else {
                            Some(tool_calls)
                        },
                        tool_call_id: None,
                        cache_control: None,
                    });
                } else {
                    for (tool_call_id, result_content) in tool_results {
                        messages.push(ChatMessage {
                            role: ChatRole::Tool,
                            content: ChatContent::Text(result_content),
                            name: None,
                            tool_calls: None,
                            // A tool_result without an id sends no
                            // `tool_call_id` key at all (probed).
                            tool_call_id: (!tool_call_id.is_empty()).then_some(tool_call_id),
                            cache_control: None,
                        });
                    }

                    if parts.len() == 1 && parts[0].kind == ContentPartType::Text {
                        if let Some(txt) = parts.remove(0).text {
                            messages.push(ChatMessage {
                                role: ChatRole::User,
                                content: ChatContent::Text(txt),
                                name: None,
                                tool_calls: None,
                                tool_call_id: None,
                                cache_control: None,
                            });
                        }
                    } else if !parts.is_empty() {
                        messages.push(ChatMessage {
                            role: ChatRole::User,
                            content: ChatContent::Parts(parts),
                            name: None,
                            tool_calls: None,
                            tool_call_id: None,
                            cache_control: None,
                        });
                    }
                }
            }
        }
    }

    let tools = req.tools.map(|tools_list| {
        tools_list
            .into_iter()
            .map(|t| ToolDefinition {
                kind: ToolKind::Function,
                function: ToolFunction {
                    name: t.name,
                    description: t.description,
                    parameters: Some(t.input_schema),
                },
                cache_control: None,
            })
            .collect()
    });

    // `any` becomes `required`; a named selector without a name is dropped
    // entirely (probed: Node sends no `tool_choice` key at all).
    let tool_choice = req.tool_choice.and_then(|tc| match tc {
        AnthropicToolChoice::Auto => Some(ToolChoice::Mode(ToolChoiceMode::Auto)),
        AnthropicToolChoice::Any => Some(ToolChoice::Mode(ToolChoiceMode::Required)),
        AnthropicToolChoice::Tool { name } => name.filter(|n| !n.is_empty()).map(|name| {
            ToolChoice::Named(ToolChoiceNamed {
                kind: ToolKind::Function,
                function: ToolChoiceFunction { name },
            })
        }),
    });

    // Node's split shapes: `disabled` sends top-level `reasoning_effort:
    // "none"`, `enabled`/`adaptive` send `reasoning: {effort: "high"}`,
    // `budget_tokens` is never forwarded, and no `thinking` key ever leaves
    // the gateway (all probed).
    let (reasoning_effort, reasoning) = match &req.thinking {
        Some(AnthropicThinking::Disabled) => (Some("none".to_owned()), None),
        Some(AnthropicThinking::Enabled { .. }) | Some(AnthropicThinking::Adaptive { .. }) => (
            None,
            Some(ReasoningOptions {
                effort: Some("high".to_owned()),
                summary: None,
            }),
        ),
        None => (None, None),
    };

    ChatCompletionRequest {
        model: req.model,
        messages,
        stream: req.stream,
        stream_options: None,
        temperature: req.temperature,
        top_p: req.top_p,
        n: None,
        stop: req.stop_sequences.map(StopSequence::List),
        max_tokens: req.max_tokens,
        presence_penalty: None,
        frequency_penalty: None,
        user: None,
        tools,
        tool_choice,
        response_format: None,
        reasoning_effort,
        reasoning,
        thinking: None,
        enable_thinking: None,
        thinking_budget: None,
        prompt_cache_key: None,
        prompt_cache_retention: None,
    }
}
