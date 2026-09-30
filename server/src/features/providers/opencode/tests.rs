//! Tests for the OpenCode Zen provider types and executor.

use crate::features::providers::opencode::executor::{
    adapter, adapter_with_base_url, generate_opencode_session_id,
};
use crate::features::providers::opencode::types::{
    OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_KEYS, OPENCODE_ZEN_MODELS, OPENCODE_ZEN_PROVIDER,
};

#[test]
fn opencode_zen_metadata_matches_the_node_api_provider() {
    assert_eq!(OPENCODE_ZEN_PROVIDER.id, "opencode_zen");
    assert_eq!(OPENCODE_ZEN_PROVIDER.name, "OpenCode Zen");
    assert_eq!(OPENCODE_ZEN_PROVIDER.category, "free_tier");
    assert_eq!(OPENCODE_ZEN_PROVIDER.protocol, "openai");
    assert_eq!(OPENCODE_ZEN_PROVIDER.alias, "zen");
    assert_eq!(OPENCODE_ZEN_PROVIDER.base_url, OPENCODE_ZEN_BASE_URL);
    assert_eq!(OPENCODE_ZEN_PROVIDER.web_url, "https://opencode.ai/zen");
    const { assert!(!OPENCODE_ZEN_PROVIDER.requires_api_key) };
    const { assert!(!OPENCODE_ZEN_PROVIDER.requires_oauth) };
    const { assert!(OPENCODE_ZEN_PROVIDER.supports_custom_url) };
    assert_eq!(
        OPENCODE_ZEN_PROVIDER.status_message,
        "Free Tier Ready (Unlimited)"
    );
}

#[test]
fn opencode_zen_exposes_verified_free_models() {
    let ids: Vec<&str> = OPENCODE_ZEN_MODELS.iter().map(|m| m.id).collect();
    assert!(ids.contains(&"space-bunny-free"));
    assert!(ids.contains(&"nemotron-3.5-lightning-free"));
    assert!(ids.contains(&"nemotron-3-ultra-free"));
    assert!(ids.contains(&"mimo-v2.5-free"));
    assert!(ids.contains(&"mimo-v2.6-flash-free"));
    assert!(ids.contains(&"big-pickle"));
    assert!(ids.contains(&"longcat-2.5-preview-free"));
}

#[test]
fn opencode_zen_registry_keys_cover_the_base_id_and_aliases() {
    assert_eq!(
        OPENCODE_ZEN_KEYS,
        ["opencode_zen", "opencode", "zen"].as_slice()
    );
}

#[test]
fn opencode_zen_adapter_builds_with_default_and_custom_base_url() {
    let default_adapter = adapter().expect("default opencode adapter must build");
    assert_eq!(default_adapter.id(), "opencode_zen");
    assert_eq!(default_adapter.keys(), OPENCODE_ZEN_KEYS);
    assert_eq!(default_adapter.models(), OPENCODE_ZEN_MODELS);

    let custom_adapter = adapter_with_base_url("https://custom.opencode.local/v1")
        .expect("custom opencode adapter must build");
    assert_eq!(custom_adapter.id(), "opencode_zen");
    assert_eq!(custom_adapter.keys(), OPENCODE_ZEN_KEYS);
    assert_eq!(custom_adapter.models(), OPENCODE_ZEN_MODELS);
}

#[test]
fn opencode_session_id_generator_matches_format() {
    let session_id = generate_opencode_session_id();
    assert!(
        session_id.starts_with("ses_"),
        "session id must start with ses_"
    );
    assert_eq!(
        session_id.len(),
        30,
        "session id must be exactly 30 characters (4 prefix + 12 hex + 14 base62)"
    );

    // Verify hex portion (12 chars):
    let hex_part = &session_id[4..16];
    assert!(
        hex_part.chars().all(|c| c.is_ascii_hexdigit()),
        "hex portion must contain valid hex chars"
    );

    // Invert the 6 bytes back to verify the embedded timestamp:
    let bytes = hex::decode(hex_part).expect("valid hex bytes");
    let mut a: u64 = 0;
    for &b in &bytes {
        a = (a << 8) | (b as u64);
    }
    let n = (!a) & 0xffff_ffff_ffff;
    let ts_lower36 = n >> 12;
    let now_ms = crate::clock::now_ms() as u64;
    let expected_lower36 = now_ms & ((1 << 36) - 1);

    // Check lower 36 bits of timestamp is within 5 seconds of now:
    let diff = (ts_lower36 as i64 - expected_lower36 as i64).abs();
    assert!(
        diff <= 5000,
        "embedded timestamp lower 36 bits {ts_lower36} must be close to current time {expected_lower36}, diff: {diff}"
    );

    // Verify base62 suffix portion (14 chars):
    let b62_part = &session_id[16..];
    assert!(
        b62_part.chars().all(|c| c.is_ascii_alphanumeric()),
        "suffix must be base62 alphanumeric"
    );
}
