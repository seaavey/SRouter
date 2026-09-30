//! Built-in Web Search client supporting multiple search providers:
//! 1. Tavily API (`TAVILY_API_KEY`)
//! 2. Brave Search API (`BRAVE_API_KEY`)
//! 3. Serper.dev API (`SERPER_API_KEY`)
//! 4. Zero-config Wikipedia search fallback
//!
//! Provides mock overrides for deterministic unit and integration testing.

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// An individual search result entry.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebSearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// The aggregated web search response.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebSearchResponse {
    pub query: String,
    pub results: Vec<WebSearchResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Configuration keys for external search provider APIs.
#[derive(Clone, Debug, Default)]
pub struct WebSearchConfig {
    pub brave_api_key: Option<String>,
    pub tavily_api_key: Option<String>,
    pub serper_api_key: Option<String>,
    pub searxng_url: Option<String>,
}

impl WebSearchConfig {
    pub fn from_env() -> Self {
        Self {
            brave_api_key: std::env::var("BRAVE_API_KEY")
                .ok()
                .filter(|s| !s.trim().is_empty()),
            tavily_api_key: std::env::var("TAVILY_API_KEY")
                .ok()
                .filter(|s| !s.trim().is_empty()),
            serper_api_key: std::env::var("SERPER_API_KEY")
                .ok()
                .filter(|s| !s.trim().is_empty()),
            searxng_url: std::env::var("SEARXNG_URL")
                .ok()
                .filter(|s| !s.trim().is_empty()),
        }
    }
}

/// Type definition for test mock search handlers.
pub type MockSearchFn =
    Arc<dyn Fn(&str, usize) -> Option<WebSearchResponse> + Send + Sync + 'static>;

/// Built-in search service managing HTTP client and search execution.
#[derive(Clone)]
pub struct SearchService {
    config: WebSearchConfig,
    client: reqwest::Client,
    mock: Option<MockSearchFn>,
}

impl Default for SearchService {
    fn default() -> Self {
        Self::new()
    }
}

impl SearchService {
    /// Builds the search service reading API keys from environment.
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();

        Self {
            config: WebSearchConfig::from_env(),
            client,
            mock: None,
        }
    }

    /// Creates a search service with explicit API credentials.
    pub fn with_config(config: WebSearchConfig) -> Self {
        let mut service = Self::new();
        service.config = config;
        service
    }

    /// Creates a mock search service for testing without network requests.
    pub fn with_mock<F>(mock_fn: F) -> Self
    where
        F: Fn(&str, usize) -> Option<WebSearchResponse> + Send + Sync + 'static,
    {
        Self {
            config: WebSearchConfig::default(),
            client: reqwest::Client::new(),
            mock: Some(Arc::new(mock_fn)),
        }
    }

    /// Executes web search across available providers with fallback.
    pub async fn search(&self, query: &str, limit: usize) -> WebSearchResponse {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return WebSearchResponse {
                query: String::new(),
                results: Vec::new(),
                source: None,
            };
        }

        // Test mock override takes precedence
        if let Some(mock) = &self.mock
            && let Some(resp) = mock(trimmed, limit)
        {
            return resp;
        }

        // 1. Tavily API
        if let Some(key) = &self.config.tavily_api_key
            && let Ok(resp) = self.search_tavily(key, trimmed, limit).await
            && !resp.results.is_empty()
        {
            return resp;
        }

        // 2. Brave Search API
        if let Some(key) = &self.config.brave_api_key
            && let Ok(resp) = self.search_brave(key, trimmed, limit).await
            && !resp.results.is_empty()
        {
            return resp;
        }

        // 3. Serper API
        if let Some(key) = &self.config.serper_api_key
            && let Ok(resp) = self.search_serper(key, trimmed, limit).await
            && !resp.results.is_empty()
        {
            return resp;
        }

        // 4. SearXNG if configured
        if let Some(searxng_url) = &self.config.searxng_url
            && let Ok(resp) = self.search_searxng(searxng_url, trimmed, limit).await
            && !resp.results.is_empty()
        {
            return resp;
        }

        // 5. Zero-config Bing Web Search scraper
        if let Ok(resp) = self.search_bing(trimmed, limit).await
            && !resp.results.is_empty()
        {
            return resp;
        }

        // 6. Zero-config Wikipedia search API fallback
        if let Ok(resp) = self.search_wikipedia(trimmed, limit).await
            && !resp.results.is_empty()
        {
            return resp;
        }

        WebSearchResponse {
            query: trimmed.to_owned(),
            results: Vec::new(),
            source: None,
        }
    }

    async fn search_tavily(
        &self,
        api_key: &str,
        query: &str,
        limit: usize,
    ) -> Result<WebSearchResponse, reqwest::Error> {
        let payload = serde_json::json!({
            "query": query,
            "max_results": limit
        });

        let res = self
            .client
            .post("https://api.tavily.com/search")
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&payload)
            .send()
            .await?;

        if !res.status().is_success() {
            return Ok(empty_response(query));
        }

        let data = res.json::<Value>().await?;
        let results = data["results"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .take(limit)
                    .map(|item| WebSearchResult {
                        title: item["title"].as_str().unwrap_or("").to_owned(),
                        url: item["url"].as_str().unwrap_or("").to_owned(),
                        snippet: item["content"].as_str().unwrap_or("").to_owned(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(WebSearchResponse {
            query: query.to_owned(),
            results,
            source: Some("tavily".to_owned()),
        })
    }

    async fn search_brave(
        &self,
        api_key: &str,
        query: &str,
        limit: usize,
    ) -> Result<WebSearchResponse, reqwest::Error> {
        let url = format!(
            "https://api.search.brave.com/res/v1/web/search?q={}&count={}",
            urlencoding::encode(query),
            limit
        );

        let res = self
            .client
            .get(&url)
            .header("Accept", "application/json")
            .header("X-Subscription-Token", api_key)
            .send()
            .await?;

        if !res.status().is_success() {
            return Ok(empty_response(query));
        }

        let data = res.json::<Value>().await?;
        let results = data["web"]["results"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .take(limit)
                    .map(|item| WebSearchResult {
                        title: item["title"].as_str().unwrap_or("").to_owned(),
                        url: item["url"].as_str().unwrap_or("").to_owned(),
                        snippet: item["description"].as_str().unwrap_or("").to_owned(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(WebSearchResponse {
            query: query.to_owned(),
            results,
            source: Some("brave".to_owned()),
        })
    }

    async fn search_serper(
        &self,
        api_key: &str,
        query: &str,
        limit: usize,
    ) -> Result<WebSearchResponse, reqwest::Error> {
        let payload = serde_json::json!({
            "q": query,
            "num": limit
        });

        let res = self
            .client
            .post("https://google.serper.dev/search")
            .header("Content-Type", "application/json")
            .header("X-API-KEY", api_key)
            .json(&payload)
            .send()
            .await?;

        if !res.status().is_success() {
            return Ok(empty_response(query));
        }

        let data = res.json::<Value>().await?;
        let results = data["organic"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .take(limit)
                    .map(|item| WebSearchResult {
                        title: item["title"].as_str().unwrap_or("").to_owned(),
                        url: item["link"].as_str().unwrap_or("").to_owned(),
                        snippet: item["snippet"].as_str().unwrap_or("").to_owned(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(WebSearchResponse {
            query: query.to_owned(),
            results,
            source: Some("serper".to_owned()),
        })
    }

    async fn search_wikipedia(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<WebSearchResponse, reqwest::Error> {
        let url = format!(
            "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={}&format=json",
            urlencoding::encode(query)
        );

        let res = self
            .client
            .get(&url)
            .header("User-Agent", "SRouter/1.0")
            .send()
            .await?;

        if !res.status().is_success() {
            return Ok(empty_response(query));
        }

        let data = res.json::<Value>().await?;
        let results = data["query"]["search"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .take(limit)
                    .map(|item| {
                        let title = item["title"].as_str().unwrap_or("").to_owned();
                        let snippet_raw = item["snippet"].as_str().unwrap_or("");
                        let snippet = strip_html_tags(snippet_raw);
                        let article_url = format!(
                            "https://en.wikipedia.org/wiki/{}",
                            urlencoding::encode(&title.replace(' ', "_"))
                        );
                        WebSearchResult {
                            title,
                            url: article_url,
                            snippet,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(WebSearchResponse {
            query: query.to_owned(),
            results,
            source: Some("wikipedia".to_owned()),
        })
    }

    async fn search_searxng(
        &self,
        searxng_url: &str,
        query: &str,
        limit: usize,
    ) -> Result<WebSearchResponse, reqwest::Error> {
        let base = searxng_url.trim_end_matches('/');
        let url = format!("{base}/search?q={}&format=json", urlencoding::encode(query));

        let res = self
            .client
            .get(&url)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .send()
            .await?;

        if !res.status().is_success() {
            return Ok(empty_response(query));
        }

        let data = res.json::<Value>().await?;
        let results = data["results"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .take(limit)
                    .map(|item| WebSearchResult {
                        title: item["title"].as_str().unwrap_or("").to_owned(),
                        url: item["url"].as_str().unwrap_or("").to_owned(),
                        snippet: item["content"].as_str().unwrap_or("").to_owned(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(WebSearchResponse {
            query: query.to_owned(),
            results,
            source: Some("searxng".to_owned()),
        })
    }

    async fn search_bing(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<WebSearchResponse, reqwest::Error> {
        let url = format!(
            "https://www.bing.com/search?q={}",
            urlencoding::encode(query)
        );

        let res = self
            .client
            .get(&url)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await?;

        if !res.status().is_success() {
            return Ok(empty_response(query));
        }

        let html = res.text().await?;
        let results = parse_bing_html(&html, limit);

        Ok(WebSearchResponse {
            query: query.to_owned(),
            results,
            source: Some("bing".to_owned()),
        })
    }
}

/// Parses Bing HTML search results extracting link, title, and snippet.
pub fn parse_bing_html(html: &str, limit: usize) -> Vec<WebSearchResult> {
    let mut results = Vec::new();
    let mut search_idx = 0;
    while let Some(start_li) = html[search_idx..].find("<li class=\"b_algo\"") {
        if results.len() >= limit {
            break;
        }
        let li_start = search_idx + start_li;
        let Some(end_li_rel) = html[li_start..].find("</li>") else {
            break;
        };
        let li_end = li_start + end_li_rel;
        let li_content = &html[li_start..li_end];
        search_idx = li_end + 5;

        if let Some(h2_start) = li_content.find("<h2") {
            let h2_content = &li_content[h2_start..];
            if let Some(a_start) = h2_content.find("<a ") {
                let a_content = &h2_content[a_start..];
                if let Some(href_start) = a_content.find("href=\"") {
                    let href_val_start = href_start + 6;
                    if let Some(href_end) = a_content[href_val_start..].find('"') {
                        let mut raw_url = a_content[href_val_start..href_val_start + href_end]
                            .replace("&amp;", "&");

                        let title = if let Some(tag_close) = a_content.find('>') {
                            if let Some(a_close) = a_content[tag_close..].find("</a>") {
                                strip_html_tags(&a_content[tag_close + 1..tag_close + a_close])
                            } else {
                                String::new()
                            }
                        } else {
                            String::new()
                        };

                        let snippet = if let Some(p_start) = li_content.find("<p") {
                            let p_content = &li_content[p_start..];
                            if let Some(tag_close) = p_content.find('>') {
                                if let Some(p_close) = p_content[tag_close..].find("</p>") {
                                    strip_html_tags(&p_content[tag_close + 1..tag_close + p_close])
                                } else {
                                    String::new()
                                }
                            } else {
                                String::new()
                            }
                        } else {
                            String::new()
                        };

                        // Decode Bing tracking base64 parameter u=a1... if present
                        if let Some(u_idx) = raw_url.find("u=a1") {
                            let u_part = &raw_url[u_idx + 4..];
                            let param_end = u_part.find('&').unwrap_or(u_part.len());
                            let b64 = &u_part[..param_end];
                            use base64::Engine;
                            if let Ok(decoded) =
                                base64::engine::general_purpose::STANDARD.decode(b64)
                                && let Ok(decoded_str) = String::from_utf8(decoded)
                                && decoded_str.starts_with("http")
                            {
                                raw_url = decoded_str;
                            }
                        }

                        if !title.is_empty() && !raw_url.is_empty() {
                            results.push(WebSearchResult {
                                title,
                                url: raw_url,
                                snippet,
                            });
                        }
                    }
                }
            }
        }
    }
    results
}

fn empty_response(query: &str) -> WebSearchResponse {
    WebSearchResponse {
        query: query.to_owned(),
        results: Vec::new(),
        source: None,
    }
}

/// Strips HTML tags and unescapes common HTML entities.
pub fn strip_html_tags(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_tag = false;
    for c in input.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            output.push(c);
        }
    }
    output
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .trim()
        .to_string()
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut encoded = String::with_capacity(s.len() * 3);
        for byte in s.bytes() {
            match byte {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    encoded.push(byte as char);
                }
                b' ' => encoded.push_str("%20"),
                other => {
                    encoded.push_str(&format!("%{other:02X}"));
                }
            }
        }
        encoded
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_html_tags_and_entities() {
        let raw = r#"In <span class="searchmatch">Rust</span>, memory &amp; safety are paramount."#;
        assert_eq!(
            strip_html_tags(raw),
            "In Rust, memory & safety are paramount."
        );
    }

    #[tokio::test]
    async fn empty_query_returns_empty_results() {
        let service = SearchService::new();
        let res = service.search("   ", 5).await;
        assert!(res.results.is_empty());
        assert_eq!(res.query, "");
    }

    #[tokio::test]
    async fn mock_service_returns_configured_results() {
        let service = SearchService::with_mock(|query, _limit| {
            Some(WebSearchResponse {
                query: query.to_owned(),
                results: vec![WebSearchResult {
                    title: "Test Title".to_owned(),
                    url: "https://example.com".to_owned(),
                    snippet: "Test Snippet".to_owned(),
                }],
                source: Some("test_mock".to_owned()),
            })
        });

        let res = service.search("rust programming", 5).await;
        assert_eq!(res.query, "rust programming");
        assert_eq!(res.source.as_deref(), Some("test_mock"));
        assert_eq!(res.results.len(), 1);
        assert_eq!(res.results[0].title, "Test Title");
    }

    #[test]
    fn parse_bing_html_extracts_links_and_snippets() {
        let sample_html = r#"
            <ol id="b_results">
                <li class="b_algo">
                    <h2><a href="https://example.com/rust&amp;lang">Rust <strong>Programming</strong></a></h2>
                    <div class="b_caption">
                        <p>A language empowering everyone to build <b>reliable</b> software.</p>
                    </div>
                </li>
            </ol>
        "#;
        let results = parse_bing_html(sample_html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Rust Programming");
        assert_eq!(results[0].url, "https://example.com/rust&lang");
        assert_eq!(
            results[0].snippet,
            "A language empowering everyone to build reliable software."
        );
    }
}
