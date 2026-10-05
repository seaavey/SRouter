//! Antigravity provider: the Google OAuth session, the static CloudCode IDE
//! model catalog, and the Gemini-native executor that later tasks build on.

pub mod translate;
pub mod types;

pub use types::{ANTIGRAVITY_MODEL_IDS, ANTIGRAVITY_PROVIDER, AntigravityEndpoints};
