//! COSY request signing and body encoding for the Qoder gateway.
//!
//! The gateway authenticates every call with a signature over the payload, the
//! wrapped AES key, the timestamp, the body, and the request path. The body
//! itself is obfuscated with a public alphabet transform before it is sent, so
//! encoding and signing always happen together.

use std::collections::BTreeMap;

use aes::Aes128;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use cbc::cipher::{BlockModeEncrypt, KeyIvInit, block_padding::Pkcs7};
use md5::{Digest, Md5};
use rsa::RsaPublicKey;
use rsa::pkcs1v15::Pkcs1v15Encrypt;
use rsa::pkcs8::DecodePublicKey;

use crate::constants;
use crate::error::APIError;
use crate::features::providers::qoder::types::{
    QODER_CLIENT_TYPE, QODER_DATA_POLICY, QODER_IDE_VERSION, QODER_LOGIN_VERSION, QODER_MACHINE_OS,
    QODER_MACHINE_TYPE, QODER_RSA_PUBLIC_KEY,
};

/// Standard base64 alphabet, the one `Buffer.toString("base64")` produces.
const STANDARD_ALPHABET: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/// Gateway alphabet: the same 64 symbols in a scrambled order plus two extras.
const CUSTOM_ALPHABET: &str = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
/// Padding is rewritten so the encoded body survives a URL and a header scan.
const ENCODED_PADDING: char = '$';

/// The account material every signed request carries.
#[derive(Clone, Debug)]
pub struct CosyIdentity<'a> {
    pub uid: &'a str,
    pub auth_token: &'a str,
    pub name: &'a str,
    pub email: &'a str,
    pub machine_id: &'a str,
}

/// Encodes a request body the way the Qoder CLI does: standard base64, then a
/// right rotation of `floor(len / 3)` characters, then one symbol per character
/// through the gateway alphabet.
pub fn encode_body(plain: &[u8]) -> String {
    let encoded = STANDARD.encode(plain);
    let rotated = rotate(&encoded);
    let mut out = String::with_capacity(rotated.len());

    for character in rotated.chars() {
        if character == '=' {
            out.push(ENCODED_PADDING);
            continue;
        }

        match STANDARD_ALPHABET.find(character) {
            Some(index) => out.push(
                CUSTOM_ALPHABET
                    .chars()
                    .nth(index)
                    .expect("custom alphabet covers the standard one"),
            ),
            None => out.push(character),
        }
    }

    out
}

/// Reverses [`encode_body`]. Only tests and diagnostics need it; no upstream
/// call ever decodes a body.
pub fn decode_body(encoded: &str) -> Result<Vec<u8>, String> {
    let mut standard = String::with_capacity(encoded.len());

    for character in encoded.chars() {
        if character == ENCODED_PADDING {
            standard.push('=');
            continue;
        }

        match CUSTOM_ALPHABET.find(character) {
            Some(index) => standard.push(
                STANDARD_ALPHABET
                    .chars()
                    .nth(index)
                    .expect("standard alphabet covers the custom one"),
            ),
            None => standard.push(character),
        }
    }

    let decoded = STANDARD
        .decode(rotate(&standard))
        .map_err(|error| error.to_string())?;

    Ok(decoded)
}

/// Builds the complete COSY header set for one request. `body` is the encoded
/// request body, or an empty string for a GET.
pub fn sign(
    body: &str,
    url: &str,
    identity: &CosyIdentity<'_>,
    timestamp: u64,
    request_id: &str,
) -> Result<BTreeMap<&'static str, String>, APIError> {
    if identity.uid.trim().is_empty() {
        return Err(APIError::new(500, constants::providers::qoder::MISSING_UID));
    }
    if identity.auth_token.trim().is_empty() {
        return Err(APIError::new(
            500,
            constants::providers::qoder::MISSING_TOKEN,
        ));
    }

    let aes_key = fresh_aes_key();
    let info = encrypt_identity(identity, &aes_key)?;
    let cosy_key = wrap_key(&aes_key)?;

    let payload_json = serde_json::json!({
        "version": "v1",
        "requestId": request_id,
        "info": info,
        "cosyVersion": QODER_IDE_VERSION,
        "ideVersion": "",
    });
    let payload = STANDARD.encode(payload_json.to_string().as_bytes());

    let path = sig_path(url);
    let signature_input = format!("{payload}\n{cosy_key}\n{timestamp}\n{body}\n{path}");
    let signature = md5_hex(signature_input.as_bytes());

    let mut headers = BTreeMap::new();
    headers.insert(
        "Authorization",
        format!("Bearer COSY.{payload}.{signature}"),
    );
    headers.insert("Cosy-Key", cosy_key);
    headers.insert("Cosy-User", identity.uid.to_owned());
    headers.insert("Cosy-Date", timestamp.to_string());
    headers.insert("Cosy-Version", QODER_IDE_VERSION.to_owned());
    headers.insert("Cosy-Machineid", identity.machine_id.to_owned());
    headers.insert("Cosy-Machinetoken", identity.machine_id.to_owned());
    headers.insert("Cosy-Machinetype", QODER_MACHINE_TYPE.to_owned());
    headers.insert("Cosy-Machineos", QODER_MACHINE_OS.to_owned());
    headers.insert("Cosy-Clienttype", QODER_CLIENT_TYPE.to_owned());
    headers.insert("Cosy-Clientip", "127.0.0.1".to_owned());
    headers.insert("Cosy-Bodyhash", md5_hex(body.as_bytes()));
    headers.insert("Cosy-Bodylength", body.len().to_string());
    headers.insert("Cosy-Sigpath", path.to_owned());
    headers.insert("Cosy-Data-Policy", QODER_DATA_POLICY.to_owned());
    headers.insert("Cosy-Organization-Id", String::new());
    headers.insert("Cosy-Organization-Tags", String::new());
    headers.insert("Login-Version", QODER_LOGIN_VERSION.to_owned());
    headers.insert("X-Request-Id", request_id.to_owned());

    Ok(headers)
}

/// The path the signature covers: the URL path with a leading `/algo` removed.
pub fn sig_path(url: &str) -> String {
    let rest = match url.find("://") {
        Some(index) => &url[index + 3..],
        None => url,
    };
    let path = match rest.find(['/', '?']) {
        Some(index) => &rest[index..],
        None => "",
    };
    let path = path.split('?').next().unwrap_or("");

    match path.strip_prefix("/algo") {
        Some(stripped) if stripped.starts_with('/') => stripped.to_owned(),
        _ => path.to_owned(),
    }
}

/// Hex digest of a byte slice, lower case, which is how both the signature and
/// the body hash are printed.
pub fn md5_hex(bytes: &[u8]) -> String {
    let mut hasher = Md5::new();
    hasher.update(bytes);

    hex::encode(hasher.finalize())
}

/// A fresh 16-byte key per request, as 16 hex characters of a UUID.
fn fresh_aes_key() -> [u8; 16] {
    let simple = uuid::Uuid::new_v4().simple().to_string();
    let mut key = [0u8; 16];
    key.copy_from_slice(&simple.as_bytes()[..16]);

    key
}

/// Encrypts the identity block with AES-128-CBC. The gateway uses the key as
/// the IV as well, which is unusual but is what the upstream expects.
fn encrypt_identity(identity: &CosyIdentity<'_>, key: &[u8; 16]) -> Result<String, APIError> {
    let payload = serde_json::json!({
        "uid": identity.uid,
        "security_oauth_token": identity.auth_token,
        "name": identity.name,
        "aid": "",
        "email": identity.email,
    });

    let encrypted = cbc::Encryptor::<Aes128>::new(key.into(), key.into())
        .encrypt_padded_vec::<Pkcs7>(payload.to_string().as_bytes());

    Ok(STANDARD.encode(encrypted))
}

/// Wraps the AES key with the gateway's RSA public key.
fn wrap_key(key: &[u8; 16]) -> Result<String, APIError> {
    let public_key = RsaPublicKey::from_public_key_pem(QODER_RSA_PUBLIC_KEY)
        .map_err(|error| APIError::new(500, constants::providers::qoder::key_unreadable(error)))?;
    let rng = &mut rsa::rand_core::OsRng;
    let wrapped = public_key
        .encrypt(rng, Pkcs1v15Encrypt, key)
        .map_err(|error| {
            APIError::new(
                500,
                constants::providers::qoder::key_wrapping_failed(&error),
            )
        })?;

    Ok(STANDARD.encode(wrapped))
}

/// Right rotation by `floor(len / 3)` characters. The transform is an
/// involution, so applying it again restores the original string, which is what
/// [`decode_body`] relies on.
fn rotate(value: &str) -> String {
    let length = value.len();
    let shift = length / 3;

    if shift == 0 || !value.is_char_boundary(length - shift) || !value.is_char_boundary(shift) {
        return value.to_owned();
    }

    format!(
        "{}{}{}",
        &value[length - shift..],
        &value[shift..length - shift],
        &value[..shift]
    )
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;

    use super::{CosyIdentity, decode_body, encode_body, md5_hex, sig_path, sign};
    use crate::constants;
    use crate::features::providers::qoder::types::QODER_CHAT_PATH;

    fn identity() -> CosyIdentity<'static> {
        CosyIdentity {
            uid: "user-1",
            auth_token: "device-token",
            name: "Tester",
            email: "tester@example.com",
            machine_id: "machine-1",
        }
    }

    #[test]
    fn encoded_bodies_round_trip_for_every_padding_length() {
        for payload in [
            "{}",
            r#"{"a":1}"#,
            r#"{"messages":[{"role":"user","content":"hi"}]}"#,
            r#"{"padding":"0123456789"}"#,
        ] {
            let encoded = encode_body(payload.as_bytes());
            let decoded = decode_body(&encoded).expect("encoded body decodes");

            assert_eq!(decoded, payload.as_bytes(), "round trip for {payload}");
        }
    }

    #[test]
    fn encoding_replaces_padding_and_scrambles_the_symbols() {
        // One byte yields two padding characters in base64.
        let encoded = encode_body(b"a");

        assert!(!encoded.contains('='), "padding is rewritten: {encoded}");
        assert!(
            !encoded.contains('+') && !encoded.contains('/'),
            "standard symbols are gone"
        );
        assert_eq!(
            encoded
                .chars()
                .filter(|character| *character == '$')
                .count(),
            2,
            "both padding characters are rewritten: {encoded}"
        );
    }

    #[test]
    fn the_signature_covers_payload_key_date_body_and_path() {
        let url = format!("https://api3.qoder.sh{QODER_CHAT_PATH}?FetchKeys=llm_model_result");
        let headers =
            sign("ENCODED", &url, &identity(), 1_700_000_000, "request-1").expect("request signs");

        assert_eq!(
            headers.get("Cosy-Sigpath").map(String::as_str),
            Some("/api/v2/service/pro/sse/agent_chat_generation")
        );
        assert_eq!(
            headers.get("Cosy-Bodylength").map(String::as_str),
            Some("7")
        );
        assert_eq!(
            headers.get("Cosy-Bodyhash").map(String::as_str),
            Some(md5_hex(b"ENCODED").as_str())
        );
        assert_eq!(
            headers.get("Cosy-Date").map(String::as_str),
            Some("1700000000")
        );
        assert_eq!(headers.get("Cosy-User").map(String::as_str), Some("user-1"));

        let authorization = headers.get("Authorization").expect("authorization header");
        let payload = authorization
            .strip_prefix("Bearer COSY.")
            .and_then(|rest| rest.rsplit_once('.'))
            .map(|(payload, _)| payload)
            .expect("Bearer COSY.<payload>.<signature>");

        let expected = format!(
            "{payload}\n{}\n1700000000\nENCODED\n/api/v2/service/pro/sse/agent_chat_generation",
            headers["Cosy-Key"]
        );
        let signature = authorization.rsplit('.').next().expect("signature segment");
        assert_eq!(signature, md5_hex(expected.as_bytes()));

        let wrapped = STANDARD
            .decode(&headers["Cosy-Key"])
            .expect("Cosy-Key is base64");
        assert_eq!(wrapped.len(), 128, "a 1024-bit key wraps to 128 bytes");
    }

    #[test]
    fn a_request_without_an_identity_is_refused() {
        let error = sign(
            "",
            "https://api3.qoder.sh/algo/api/v2/model/list",
            &CosyIdentity {
                uid: " ",
                ..identity()
            },
            0,
            "request-1",
        )
        .expect_err("an empty uid must not sign");

        assert_eq!(error.status(), 500);
        assert_eq!(error.message(), constants::providers::qoder::MISSING_UID);
    }

    #[test]
    fn the_signature_path_only_drops_the_algo_prefix() {
        assert_eq!(
            sig_path("https://host/algo/api/v2/model/list?Encode=1"),
            "/api/v2/model/list"
        );
        assert_eq!(sig_path("https://host/other/path"), "/other/path");
        assert_eq!(
            sig_path("http://127.0.0.1:1/algo/api/v2/model/list"),
            "/api/v2/model/list"
        );
    }
}
