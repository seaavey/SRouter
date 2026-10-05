//! OpenAI-compatible image generation contract shared by the gateway handler
//! and the provider adapters that forward the request.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// OpenAI-compatible image generation request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenerationRequest {
    pub prompt: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub n: Option<u32>,
    #[serde(default)]
    pub quality: Option<String>,
    #[serde(default)]
    pub response_format: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub image: Option<Value>,
    #[serde(default)]
    pub images: Option<Value>,
}
