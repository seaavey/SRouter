pub mod listeners;
pub mod middleware;
pub mod static_files;

/// Percent-decodes a path. A `+` is literal here, and an invalid escape passes
/// through unchanged.
pub(crate) fn percent_decode(value: &str) -> String {
    decode(value, false)
}

/// Percent-decodes a form-encoded query component, where `+` stands for a space.
pub(crate) fn form_decode(value: &str) -> String {
    decode(value, true)
}

fn decode(value: &str, plus_as_space: bool) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                match std::str::from_utf8(&bytes[index + 1..index + 3])
                    .ok()
                    .and_then(|hex| u8::from_str_radix(hex, 16).ok())
                {
                    Some(byte) => {
                        decoded.push(byte);
                        index += 3;
                    }
                    None => {
                        decoded.push(b'%');
                        index += 1;
                    }
                }
            }
            b'+' if plus_as_space => {
                decoded.push(b' ');
                index += 1;
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }

    String::from_utf8_lossy(&decoded).into_owned()
}
