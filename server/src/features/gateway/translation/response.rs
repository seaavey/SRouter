use serde_json::Value;

// ============================================================================
// Translation: OpenAI Response -> Anthropic Response
// ============================================================================

pub fn openai_to_anthropic_response(
    res: &Value,
    original_model: &str,
    allow_thinking: bool,
) -> Value {
    let choice = res.get("choices").and_then(|c| c.get(0));
    let mut content_blocks: Vec<Value> = Vec::new();

    if let Some(msg) = choice.and_then(|c| c.get("message")) {
        let reasoning = msg
            .get("reasoning_content")
            .or_else(|| msg.get("reasoning"))
            .or_else(|| msg.get("thought"))
            .and_then(|v| v.as_str());

        if let Some(r) = reasoning
            && allow_thinking
            && !r.is_empty()
        {
            content_blocks.push(serde_json::json!({
                "type": "thinking",
                "thinking": r
            }));
        }

        if let Some(content) = msg.get("content") {
            if let Some(text) = content.as_str() {
                // Node keeps an empty string as an empty text block and only
                // omits the block for `null` content (probed both ways).
                content_blocks.push(serde_json::json!({
                    "type": "text",
                    "text": text
                }));
            } else if let Some(arr) = content.as_array() {
                // An array of parts collapses into ONE text block joined by
                // newlines; parts with no text produce no block at all
                // (probed: [p1,p2] -> "p1\np2", all-image -> []).
                let texts: Vec<&str> = arr
                    .iter()
                    .filter(|item| item.get("type").and_then(|t| t.as_str()) == Some("text"))
                    .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                    .collect();
                if !texts.is_empty() {
                    content_blocks.push(serde_json::json!({
                        "type": "text",
                        "text": texts.join("\n")
                    }));
                }
            }
        }

        if let Some(tool_calls) = msg.get("tool_calls").and_then(|tc| tc.as_array()) {
            for tc in tool_calls {
                let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let name = tc
                    .get("function")
                    .and_then(|f| f.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let args_str = tc
                    .get("function")
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}");
                let input: Value = serde_json::from_str(args_str)
                    .unwrap_or_else(|_| serde_json::json!({ "raw": args_str }));

                // A tool call without an id omits the key entirely (probed);
                // a missing name degrades to "" instead of Node's `500`.
                let mut block = serde_json::json!({
                    "type": "tool_use",
                    "name": name,
                    "input": input
                });
                if !id.is_empty() {
                    block["id"] = serde_json::Value::String(id.to_owned());
                }
                content_blocks.push(block);
            }
        }
    }

    let finish_reason = choice
        .and_then(|c| c.get("finish_reason"))
        .and_then(|v| v.as_str());
    let stop_reason = match finish_reason {
        Some("tool_calls") | Some("function_call") => "tool_use",
        Some("length") => "max_tokens",
        // `stop_sequence` maps to `end_turn` too: Node only knows the two
        // special values above (probed).
        _ => "end_turn",
    };

    let msg_id = res
        .get("id")
        .and_then(|v| v.as_str())
        .map(|id| {
            if let Some(rest) = id.strip_prefix("chatcmpl-") {
                format!("msg_{rest}")
            } else {
                format!("msg_{id}")
            }
        })
        // Node falls back to `msg_<uuid>` with dashes for a response that
        // carries no id at all (probed).
        .unwrap_or_else(|| format!("msg_{}", uuid::Uuid::new_v4()));

    let usage = res.get("usage");
    let input_tokens = usage
        .and_then(|u| u.get("prompt_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let output_tokens = usage
        .and_then(|u| u.get("completion_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    // Node reports exactly two usage keys; the cache fields are dropped even
    // when the upstream sent them (probed with both OpenAI and Anthropic
    // shapes).
    serde_json::json!({
        "id": msg_id,
        "type": "message",
        "role": "assistant",
        "model": original_model,
        "content": content_blocks,
        "stop_reason": stop_reason,
        "stop_sequence": serde_json::Value::Null,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens
        }
    })
}
