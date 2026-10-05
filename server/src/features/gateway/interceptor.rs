//! Tool interception for built-in tools (such as web search).
//! Intercepts search tool calls emitted by models when the client did NOT
//! explicitly define the tool in their request.

use serde_json::Value;

use crate::features::gateway::search::{SearchService, WebSearchResponse};
use crate::protocol::model::ToolDefinition;

/// Tool names recognized as search tools eligible for server-side interception.
pub const INTERCEPTED_SEARCH_TOOLS: &[&str] = &[
    "web_search",
    "web_search_preview",
    "search",
    "google_search",
    "duckduckgo_search",
    "brave_search",
    "bing_search",
];

/// Checks whether the client explicitly provided a tool in their request `tools` array.
pub fn is_tool_provided_by_client(
    client_tools: Option<&[ToolDefinition]>,
    tool_name: &str,
) -> bool {
    let Some(tools) = client_tools else {
        return false;
    };
    let target = tool_name.trim().to_lowercase();
    tools
        .iter()
        .any(|t| t.function.name.trim().to_lowercase() == target)
}

/// Determines whether a tool call should be intercepted server-side.
///
/// Returns true if:
/// 1. The tool name matches a recognized search tool.
/// 2. The client did NOT define this tool in their request `tools` list.
pub fn should_intercept_tool_call(
    tool_name: &str,
    client_tools: Option<&[ToolDefinition]>,
) -> bool {
    let normalized = tool_name.trim().to_lowercase();
    if !INTERCEPTED_SEARCH_TOOLS.contains(&normalized.as_str()) {
        return false;
    }
    !is_tool_provided_by_client(client_tools, tool_name)
}

/// Safely extracts the search query string from tool call arguments JSON or raw text.
pub fn extract_search_query(args_string: &str) -> String {
    let trimmed = args_string.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
        if let Some(s) = parsed.as_str() {
            return s.trim().to_owned();
        }

        if let Some(obj) = parsed.as_object() {
            // Check common query parameter names
            for key in [
                "query",
                "q",
                "search_query",
                "searchTerm",
                "search",
                "keyword",
                "text",
                "prompt",
            ] {
                if let Some(val) = obj.get(key).and_then(|v| v.as_str()) {
                    return val.trim().to_owned();
                }
            }

            // Fallback: take the first string value found in the object
            for (_key, val) in obj {
                if let Some(s) = val.as_str() {
                    return s.trim().to_owned();
                }
            }
        }
    }

    trimmed.to_owned()
}

/// Executes web search for an intercepted tool call and returns the tool call ID and result.
pub async fn execute_intercepted_search(
    search_service: &SearchService,
    tool_call_id: &str,
    arguments: &str,
) -> (String, WebSearchResponse) {
    let id = if tool_call_id.trim().is_empty() {
        format!("call_search_{}", crate::clock::now_ms())
    } else {
        tool_call_id.to_owned()
    };

    let query = extract_search_query(arguments);
    let result = search_service.search(&query, 5).await;

    (id, result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::model::{ToolFunction, ToolKind};

    fn client_tool(name: &str) -> ToolDefinition {
        ToolDefinition {
            kind: ToolKind::Function,
            function: ToolFunction {
                name: name.to_owned(),
                description: None,
                parameters: None,
            },
            cache_control: None,
        }
    }

    #[test]
    fn should_intercept_detects_search_tools_not_in_client_tools() {
        assert!(should_intercept_tool_call("web_search", None));
        assert!(should_intercept_tool_call("google_search", None));
        assert!(should_intercept_tool_call("bing_search", None));
        assert!(should_intercept_tool_call("duckduckgo_search", None));
        assert!(should_intercept_tool_call("brave_search", None));
        assert!(!should_intercept_tool_call("read_file", None));
        assert!(!should_intercept_tool_call("calculator", None));
    }

    #[test]
    fn does_not_intercept_when_client_provides_the_tool() {
        let tools = vec![client_tool("web_search"), client_tool("read_file")];
        assert!(!should_intercept_tool_call("web_search", Some(&tools)));
        assert!(should_intercept_tool_call("google_search", Some(&tools)));
    }

    #[test]
    fn extracts_query_from_various_argument_formats() {
        assert_eq!(
            extract_search_query(r#"{"query": "rust release notes"}"#),
            "rust release notes"
        );
        assert_eq!(
            extract_search_query(r#"{"q": "golang vs rust"}"#),
            "golang vs rust"
        );
        assert_eq!(
            extract_search_query(r#"{"search_query": "deep learning"}"#),
            "deep learning"
        );
        assert_eq!(
            extract_search_query(r#"{"searchTerm": "indonesia news"}"#),
            "indonesia news"
        );
        assert_eq!(
            extract_search_query(r#"{"customKey": "first string value"}"#),
            "first string value"
        );
        assert_eq!(
            extract_search_query(r#""plain string query""#),
            "plain string query"
        );
        assert_eq!(
            extract_search_query("raw fallback query"),
            "raw fallback query"
        );
    }
}
