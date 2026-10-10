//! Always-on token saver: strips provably noisy bytes from tool output before
//! it reaches a provider, and appends one terse-output directive to the system
//! prompt. The pipeline is pure; callers invoke [`apply_to_request`] once per
//! top-level request.

use crate::protocol::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ContentPart, ContentPartType,
};

const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;

/// Appended to the first system message (or prepended when none exists).
pub const TERSE_DIRECTIVE: &str = "Terse mode: answer directly, skip pleasantries and restating the request, and prefer short sentences and code over explanation.";

/// Prefixes of diff metadata lines that carry no content.
const DIFF_METADATA_PREFIXES: [&str; 7] = [
    "index ",
    "old mode ",
    "new mode ",
    "new file mode ",
    "deleted file mode ",
    "similarity index ",
    "dissimilarity index ",
];

/// Compresses eligible messages in place, then applies the terse directive.
///
/// A request whose every message is empty or whitespace is left untouched, so
/// providers that reject an empty prompt still see an empty prompt and reject it.
pub fn apply_to_request(request: &mut ChatCompletionRequest) {
    if !has_meaningful_content(request) {
        return;
    }

    for message in &mut request.messages {
        if !is_eligible_role(message.role) {
            continue;
        }
        let ChatContent::Text(text) = &message.content else {
            continue;
        };
        let transformed = transform_text(text);
        if transformed != *text {
            message.content = ChatContent::Text(transformed);
        }
    }

    apply_directive(request);
}

/// Appends [`TERSE_DIRECTIVE`] to the first system message, or prepends a
/// system message when none exists.
pub fn apply_directive(request: &mut ChatCompletionRequest) {
    let first_system = request
        .messages
        .iter()
        .position(|message| message.role == ChatRole::System);
    if let Some(index) = first_system {
        match &mut request.messages[index].content {
            ChatContent::Text(text) => {
                if !text.is_empty() {
                    text.push_str("\n\n");
                }
                text.push_str(TERSE_DIRECTIVE);
                return;
            }
            ChatContent::Parts(parts) => {
                parts.push(ContentPart {
                    kind: ContentPartType::Text,
                    text: Some(TERSE_DIRECTIVE.to_owned()),
                    image_url: None,
                    cache_control: None,
                });
                return;
            }
            ChatContent::Null => {}
        }
    }

    request.messages.insert(0, system_message(TERSE_DIRECTIVE));
}

/// Whether any message carries non-whitespace text.
fn has_meaningful_content(request: &ChatCompletionRequest) -> bool {
    request
        .messages
        .iter()
        .any(|message| match &message.content {
            ChatContent::Text(text) => !text.trim().is_empty(),
            ChatContent::Parts(parts) => parts.iter().any(|part| {
                part.text
                    .as_deref()
                    .is_some_and(|text| !text.trim().is_empty())
            }),
            ChatContent::Null => false,
        })
}

fn is_eligible_role(role: ChatRole) -> bool {
    matches!(role, ChatRole::User | ChatRole::Tool | ChatRole::Function)
}

fn system_message(content: &str) -> ChatMessage {
    ChatMessage {
        role: ChatRole::System,
        content: ChatContent::Text(content.to_owned()),
        name: None,
        tool_calls: None,
        tool_call_id: None,
        cache_control: None,
    }
}

/// Runs the four transforms in order and returns the result.
fn transform_text(text: &str) -> String {
    let stripped = strip_ansi(text);
    let normalized = normalize_whitespace(&stripped);
    let is_diff = normalized
        .lines()
        .any(|line| line.starts_with("diff --git "));

    if is_diff {
        strip_diff_metadata(&normalized)
    } else {
        collapse_repeated_lines(&normalized)
    }
}

/// Removes CSI, OSC, and two-byte escape sequences.
fn strip_ansi(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] != ESC {
            let character = text[index..].chars().next().expect("char boundary");
            out.push(character);
            index += character.len_utf8();
            continue;
        }

        match bytes.get(index + 1) {
            Some(b'[') => index = skip_csi(bytes, index + 2),
            Some(b']') => index = skip_osc(bytes, index + 2),
            Some(&next) if next < 0x80 => index += 2,
            // A lone ESC, or one before a non-ASCII byte: drop only the ESC.
            _ => index += 1,
        }
    }

    out
}

fn skip_csi(bytes: &[u8], mut index: usize) -> usize {
    while index < bytes.len() {
        let byte = bytes[index];
        index += 1;
        if (0x40..=0x7e).contains(&byte) {
            break;
        }
    }
    index
}

fn skip_osc(bytes: &[u8], mut index: usize) -> usize {
    while index < bytes.len() {
        if bytes[index] == BEL {
            return index + 1;
        }
        if bytes[index] == ESC && bytes.get(index + 1) == Some(&b'\\') {
            return index + 2;
        }
        index += 1;
    }
    index
}

/// Trims trailing spaces per line, collapses runs of three or more newlines
/// into one blank line, and trims the ends of the text. Indentation stays.
fn normalize_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank_run = 0usize;

    for (index, raw) in text.split('\n').enumerate() {
        let line = raw.trim_end();
        if line.is_empty() {
            blank_run += 1;
        } else {
            blank_run = 0;
        }

        if index > 0 {
            if blank_run >= 2 {
                continue;
            }
            out.push('\n');
        }
        out.push_str(line);
    }

    out.trim().to_string()
}

/// Drops diff metadata lines. Only called when the text is already known to be
/// a diff, so a stray metadata-looking line outside a diff is never removed.
fn strip_diff_metadata(text: &str) -> String {
    text.split('\n')
        .filter(|line| {
            !DIFF_METADATA_PREFIXES
                .iter()
                .any(|prefix| line.starts_with(prefix))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Collapses consecutive identical lines into `line (xN)`. Lines shorter than
/// eight characters keep every repeat.
fn collapse_repeated_lines(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut index = 0;

    while index < lines.len() {
        let line = lines[index];
        let mut repeat = 1;
        while index + repeat < lines.len() && lines[index + repeat] == line {
            repeat += 1;
        }

        if repeat >= 2 && line.len() >= 8 {
            out.push(format!("{line} (x{repeat})"));
        } else {
            for _ in 0..repeat {
                out.push(line.to_owned());
            }
        }
        index += repeat;
    }

    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(messages: serde_json::Value) -> ChatCompletionRequest {
        serde_json::from_value(serde_json::json!({ "model": "test/model", "messages": messages }))
            .expect("valid chat completion request")
    }

    fn text_of(message: &ChatMessage) -> &str {
        match &message.content {
            ChatContent::Text(text) => text,
            other => panic!("expected text content, found {other:?}"),
        }
    }

    #[test]
    fn strip_ansi_removes_csi_osc_and_two_byte_escapes() {
        let cases = [
            ("\u{1b}[31mred\u{1b}[0m", "red"),
            (
                "\u{1b}]8;;https://example.com\u{7}link\u{1b}]8;;\u{7}",
                "link",
            ),
            ("\u{1b}]0;title\u{1b}\\after", "after"),
            ("plain \u{1b}Mtext", "plain text"),
            ("no escape bytes here", "no escape bytes here"),
        ];

        for (input, expected) in cases {
            assert_eq!(strip_ansi(input), expected, "input: {input:?}");
        }
    }

    #[test]
    fn normalize_whitespace_trims_trailing_spaces_and_collapses_blank_runs() {
        assert_eq!(normalize_whitespace("a   \n\n\n\nb\t\n"), "a\n\nb");
        assert_eq!(normalize_whitespace("  keep\n  indent\n"), "keep\n  indent");
        assert_eq!(normalize_whitespace("single line   "), "single line");
    }

    #[test]
    fn diff_metadata_is_dropped_only_inside_a_diff() {
        let diff =
            "diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new";
        let output = transform_text(diff);
        assert!(output.contains("diff --git a/x b/x"));
        assert!(!output.contains("index 1..2"));
        assert!(output.contains("@@ -1 +1 @@"));
        assert!(output.contains("-old"));
        assert!(output.contains("+new"));

        let not_a_diff = "index 1\nold mode 100644\nfinal line";
        assert_eq!(transform_text(not_a_diff), not_a_diff);
    }

    #[test]
    fn repeated_lines_collapse_only_when_long_enough_and_not_a_diff() {
        let long = "same repeated line\nsame repeated line\nsame repeated line";
        assert_eq!(transform_text(long), "same repeated line (x3)");

        let short = "aa\naa\naa";
        assert_eq!(transform_text(short), short);

        let nested_in_diff = "diff --git a/x b/x\n+same repeated line\n+same repeated line";
        assert_eq!(transform_text(nested_in_diff), nested_in_diff);
    }

    #[test]
    fn an_all_empty_request_is_left_untouched() {
        let mut request = request(serde_json::json!([
            { "role": "user", "content": "" }
        ]));

        apply_to_request(&mut request);

        assert_eq!(request.messages.len(), 1);
        assert_eq!(text_of(&request.messages[0]), "");
    }

    #[test]
    fn clean_input_is_returned_untouched() {
        let clean = "hello world\nsecond line";
        assert_eq!(transform_text(clean), clean);
    }

    #[test]
    fn apply_to_request_compresses_eligible_roles_and_appends_the_directive() {
        let mut request = request(serde_json::json!([
            { "role": "system", "content": "policy" },
            { "role": "assistant", "content": "\u{1b}[31mprior\u{1b}[0m" },
            { "role": "user", "content": "\u{1b}[31mhello\u{1b}[0m" },
            { "role": "tool", "content": "\u{1b}[32mtool\u{1b}[0m" },
            { "role": "function", "content": "\u{1b}[33mfn\u{1b}[0m" }
        ]));

        apply_to_request(&mut request);

        assert_eq!(
            text_of(&request.messages[0]),
            format!("policy\n\n{TERSE_DIRECTIVE}")
        );
        assert_eq!(text_of(&request.messages[1]), "\u{1b}[31mprior\u{1b}[0m");
        assert_eq!(text_of(&request.messages[2]), "hello");
        assert_eq!(text_of(&request.messages[3]), "tool");
        assert_eq!(text_of(&request.messages[4]), "fn");
    }

    #[test]
    fn apply_to_request_prepends_a_system_message_when_none_exists() {
        let mut request = request(serde_json::json!([
            { "role": "user", "content": "hi" }
        ]));

        apply_to_request(&mut request);

        assert_eq!(request.messages.len(), 2);
        assert_eq!(request.messages[0].role, ChatRole::System);
        assert_eq!(text_of(&request.messages[0]), TERSE_DIRECTIVE);
        assert_eq!(text_of(&request.messages[1]), "hi");
    }

    #[test]
    fn a_parts_system_message_receives_the_directive_as_a_text_part() {
        let mut request = request(serde_json::json!([
            { "role": "system", "content": [{ "type": "text", "text": "policy" }] },
            { "role": "user", "content": "hi" }
        ]));

        apply_to_request(&mut request);

        assert_eq!(request.messages.len(), 2);
        let ChatContent::Parts(parts) = &request.messages[0].content else {
            panic!("expected parts content");
        };
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1].text.as_deref(), Some(TERSE_DIRECTIVE));
        assert_eq!(text_of(&request.messages[1]), "hi");
    }

    #[test]
    fn parts_and_null_content_are_left_alone() {
        let mut request = request(serde_json::json!([
            { "role": "user", "content": [{ "type": "text", "text": "\u{1b}[31mkeep\u{1b}[0m" }] },
            { "role": "assistant", "content": null }
        ]));
        let parts_before = request.messages[0].content.clone();

        apply_to_request(&mut request);

        assert_eq!(request.messages[0].role, ChatRole::System);
        assert_eq!(request.messages[1].content, parts_before);
        assert_eq!(request.messages[2].content, ChatContent::Null);
    }
}
