use serde_json::Value;

use crate::constants;

// Request validation: the observable `AnthropicMessageRequestSchema` rules,
// probed black-box through `apps/api`. Returns the first failure in schema
// order, the same string `MessagesController` puts in the envelope.
//
// Message content, system, and tool_result content are unions on the Node
// side, so every type failure inside them collapses to `Invalid input`;
// top-level scalar fields keep their specific `Expected ..., received ...`
// messages (both shapes probed).

fn received(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn expected_type(value: &Value, expected: &str) -> String {
    constants::gateway::anthropic::expected(expected, received(value))
}

fn check_string(value: &Value) -> Result<(), String> {
    if value.is_string() {
        Ok(())
    } else {
        Err(expected_type(value, "string"))
    }
}

fn check_boolean(value: &Value) -> Result<(), String> {
    if value.is_boolean() {
        Ok(())
    } else {
        Err(expected_type(value, "boolean"))
    }
}

fn check_number(value: &Value) -> Result<(), String> {
    if value.is_number() {
        Ok(())
    } else {
        Err(expected_type(value, "number"))
    }
}

fn check_integer(value: &Value) -> Result<(), String> {
    check_number(value)?;
    if value.as_f64().is_some_and(|number| number.fract() == 0.0) {
        Ok(())
    } else {
        Err(constants::gateway::anthropic::expected("integer", "float"))
    }
}

fn check_object(value: &Value) -> Result<(), String> {
    if value.is_object() {
        Ok(())
    } else {
        Err(expected_type(value, "object"))
    }
}

fn check_array(value: &Value) -> Result<(), String> {
    if value.is_array() {
        Ok(())
    } else {
        Err(expected_type(value, "array"))
    }
}

fn check_enum(value: &Value, allowed: &str, variants: &[&str]) -> Result<(), String> {
    match value.as_str() {
        Some(candidate) if variants.contains(&candidate) => Ok(()),
        // A wrong string carries the `Invalid enum value.` prefix; a
        // non-string is a plain type error (probed for `role`).
        Some(candidate) => Err(constants::gateway::anthropic::enum_value(
            allowed,
            &format!("'{candidate}'"),
        )),
        None => Err(constants::gateway::anthropic::expected(
            allowed,
            received(value),
        )),
    }
}

fn check_max_tokens(value: &Value) -> Result<(), String> {
    check_integer(value)?;
    let number = value.as_f64().expect("checked number");
    if number < 1.0 {
        return Err(constants::gateway::anthropic::NUMBER_GREATER_THAN_ZERO.to_owned());
    }
    if number > 1_000_000.0 {
        return Err(constants::gateway::schema::MAX_TOKENS_ABOVE_CAP.to_owned());
    }
    Ok(())
}

fn check_unit_interval(value: &Value) -> Result<(), String> {
    check_number(value)?;
    let number = value.as_f64().expect("checked number");
    if number < 0.0 {
        return Err(constants::gateway::anthropic::NUMBER_AT_LEAST_ZERO.to_owned());
    }
    if number > 1.0 {
        return Err(constants::gateway::anthropic::NUMBER_AT_MOST_ONE.to_owned());
    }
    Ok(())
}

fn check_positive_integer(value: &Value) -> Result<(), String> {
    check_integer(value)?;
    if value.as_f64().expect("checked number") < 1.0 {
        return Err(constants::gateway::anthropic::NUMBER_GREATER_THAN_ZERO.to_owned());
    }
    Ok(())
}

fn check_optional(
    object: &serde_json::Map<String, Value>,
    key: &str,
    check: impl Fn(&Value) -> Result<(), String>,
) -> Result<(), String> {
    match object.get(key) {
        Some(value) => check(value),
        None => Ok(()),
    }
}

fn validate_image_source(source: &Value) -> Result<(), String> {
    check_object(source)?;
    let source = source.as_object().expect("checked object");
    match source.get("type").and_then(Value::as_str) {
        Some("base64") => {}
        _ => return Err(constants::gateway::anthropic::INVALID_INPUT.to_owned()),
    }
    check_string(source.get("media_type").unwrap_or(&Value::Null))?;
    check_string(source.get("data").unwrap_or(&Value::Null))
}

fn validate_content_blocks(blocks: &[Value]) -> Result<(), String> {
    let invalid = || constants::gateway::anthropic::INVALID_INPUT.to_owned();
    for block in blocks {
        content_block_fields(block).map_err(|_| invalid())?;
    }
    Ok(())
}

/// Field checks for one content block. Callers map every error to the union's
/// `Invalid input`; only the shape (object + known `type`) is checked here.
fn content_block_fields(block: &Value) -> Result<(), String> {
    let invalid = || constants::gateway::anthropic::INVALID_INPUT.to_owned();
    let Some(object) = block.as_object() else {
        return Err(invalid());
    };
    let Some(kind) = object.get("type").and_then(Value::as_str) else {
        return Err(invalid());
    };
    match kind {
        "text" => {
            if let Some(text) = object.get("text") {
                check_string(text)?;
            }
        }
        "image" => {
            if let Some(source) = object.get("source") {
                validate_image_source(source)?;
            }
        }
        "tool_use" => {
            check_optional(object, "id", check_string)?;
            check_optional(object, "name", check_string)?;
            check_optional(object, "input", check_object)?;
        }
        "tool_result" => {
            check_optional(object, "tool_use_id", check_string)?;
            if let Some(content) = object.get("content") {
                if content.is_string() {
                    // A string result needs no further checks.
                } else {
                    check_array(content)?;
                    for item in content.as_array().expect("checked array") {
                        let Some(item) = item.as_object() else {
                            return Err(invalid());
                        };
                        if let Some(text) = item.get("text") {
                            check_string(text)?;
                        }
                    }
                }
            }
            check_optional(object, "is_error", check_boolean)?;
        }
        "thinking" => {
            check_optional(object, "thinking", check_string)?;
            check_optional(object, "signature", check_string)?;
        }
        "redacted_thinking" => {
            check_optional(object, "data", check_string)?;
        }
        _ => return Err(invalid()),
    }
    Ok(())
}

/// `system` is a union (string | text blocks) on the Node side, so every
/// failure here — non-string non-array, bad entry, bad field — is `Invalid input`.
fn validate_system(system: &Value) -> Result<(), String> {
    let invalid = || constants::gateway::anthropic::INVALID_INPUT.to_owned();
    if system.is_string() {
        return Ok(());
    }
    let Some(entries) = system.as_array() else {
        return Err(invalid());
    };
    for entry in entries {
        let Some(object) = entry.as_object() else {
            return Err(invalid());
        };
        if object.get("type").and_then(Value::as_str) != Some("text") {
            return Err(invalid());
        }
        if let Some(text) = object.get("text")
            && !text.is_string()
        {
            return Err(invalid());
        }
    }
    Ok(())
}

fn validate_tool_choice(tool_choice: &Value) -> Result<(), String> {
    check_object(tool_choice)?;
    let object = tool_choice.as_object().expect("checked object");
    let kind = object
        .get("type")
        .ok_or_else(|| constants::gateway::anthropic::REQUIRED.to_owned())?;
    check_enum(
        kind,
        constants::gateway::anthropic::TOOL_CHOICE_ENUM,
        &["auto", "any", "tool"],
    )?;
    if kind.as_str() == Some("tool")
        && let Some(name) = object.get("name")
    {
        check_string(name)?;
    }
    Ok(())
}

fn validate_thinking(thinking: &Value) -> Result<(), String> {
    check_object(thinking)?;
    let object = thinking.as_object().expect("checked object");
    let kind = object
        .get("type")
        .ok_or_else(|| constants::gateway::anthropic::REQUIRED.to_owned())?;
    check_enum(
        kind,
        constants::gateway::anthropic::THINKING_ENUM,
        &["enabled", "disabled", "adaptive"],
    )?;
    check_optional(object, "budget_tokens", check_integer)
}

fn validate_tools(tools: &Value) -> Result<(), String> {
    check_array(tools)?;
    let tools = tools.as_array().expect("checked array");
    if tools.len() > 128 {
        return Err(constants::gateway::anthropic::TOOLS_MAX_128.to_owned());
    }
    for tool in tools {
        check_object(tool)?;
        let object = tool.as_object().expect("checked object");
        match object.get("name") {
            None => return Err(constants::gateway::anthropic::REQUIRED.to_owned()),
            Some(name) => check_string(name)?,
        }
        check_optional(object, "description", check_string)?;
        match object.get("input_schema") {
            None => return Err(constants::gateway::anthropic::REQUIRED.to_owned()),
            Some(schema) => check_object(schema)?,
        }
    }
    Ok(())
}

/// Validates a decoded `/v1/messages` body before it is deserialized. The
/// caller has already separated `null`/scalar bodies (their own message) from
/// objects and arrays; arrays fail here with `Expected object, received array`.
pub fn validate_anthropic_request(body: &Value) -> Result<(), String> {
    let invalid = || constants::gateway::anthropic::INVALID_INPUT.to_owned();
    let Some(object) = body.as_object() else {
        return Err(expected_type(body, "object"));
    };

    let Some(model) = object.get("model") else {
        return Err(constants::gateway::anthropic::MODEL_FIELD.to_owned());
    };
    if !model.is_string() {
        return Err(expected_type(model, "string"));
    }
    if model.as_str().expect("checked string").is_empty() {
        return Err(constants::gateway::anthropic::MODEL_FIELD.to_owned());
    }

    let messages = object
        .get("messages")
        .ok_or_else(|| constants::gateway::anthropic::MESSAGES_FIELD.to_owned())?;
    check_array(messages)?;
    let messages = messages.as_array().expect("checked array");
    if messages.is_empty() {
        return Err(constants::gateway::schema::MESSAGES_NOT_EMPTY.to_owned());
    }
    if messages.len() > 1000 {
        return Err(constants::gateway::schema::MESSAGES_MAX_1000.to_owned());
    }
    for message in messages {
        let Some(message) = message.as_object() else {
            return Err(expected_type(message, "object"));
        };
        match message.get("role") {
            None => return Err(constants::gateway::anthropic::REQUIRED.to_owned()),
            Some(role) => check_enum(
                role,
                constants::gateway::anthropic::ROLE_ENUM,
                &["user", "assistant", "system"],
            )?,
        }
        match message.get("content") {
            None => return Err(invalid()),
            Some(Value::String(_)) => {}
            Some(Value::Array(blocks)) => validate_content_blocks(blocks)?,
            Some(_) => return Err(invalid()),
        }
    }

    check_optional(object, "max_tokens", check_max_tokens)?;
    check_optional(object, "temperature", check_unit_interval)?;
    check_optional(object, "top_p", check_unit_interval)?;
    check_optional(object, "top_k", check_positive_integer)?;
    if let Some(stop) = object.get("stop_sequences") {
        check_array(stop)?;
        for sequence in stop.as_array().expect("checked array") {
            check_string(sequence)?;
        }
    }
    check_optional(object, "stream", check_boolean)?;
    check_optional(object, "tools", validate_tools)?;
    check_optional(object, "tool_choice", validate_tool_choice)?;
    check_optional(object, "thinking", validate_thinking)?;
    check_optional(object, "system", validate_system)?;
    check_optional(object, "metadata", check_object)
}
