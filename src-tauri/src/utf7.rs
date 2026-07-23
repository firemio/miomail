//! Modified UTF-7 (RFC 3501 §5.1.3) codec for IMAP mailbox names.
//!
//! IMAP servers store mailbox names in a modified UTF-7 form on the wire:
//! printable ASCII is sent as-is, `&` is escaped as `&-`, and runs of any
//! other characters are converted to UTF-16BE, base64-encoded (padding
//! stripped, `/` written as `,`) and wrapped in `&`…`-`.
//!
//! Examples (verified against a live server):
//!   `仕事`   ⇔ `&TtVOiw-`
//!   `案件A`  ⇔ `&aEhO9g-A`
//!   `&`      ⇔ `&-`

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};

/// Characters that may be sent literally on the wire: printable ASCII
/// (0x20..=0x7E) except `&`.
fn is_direct(c: char) -> bool {
    (' '..='~').contains(&c) && c != '&'
}

/// base64 of the UTF-16BE bytes, modified UTF-7 style (`/` → `,`, no padding).
fn b64_encode(bytes: &[u8]) -> String {
    STANDARD_NO_PAD.encode(bytes).replace('/', ",")
}

/// Inverse of `b64_encode`. Returns None on any malformed input.
fn b64_decode(section: &str) -> Option<Vec<u8>> {
    STANDARD_NO_PAD.decode(section.replace(',', "/")).ok()
}

/// Encode a Unicode string into modified UTF-7.
pub fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut run: Vec<u16> = Vec::new(); // pending UTF-16 units for the current `&…-` section

    fn flush(out: &mut String, run: &mut Vec<u16>) {
        if run.is_empty() {
            return;
        }
        let mut bytes = Vec::with_capacity(run.len() * 2);
        for unit in run.iter() {
            bytes.extend_from_slice(&unit.to_be_bytes());
        }
        out.push('&');
        out.push_str(&b64_encode(&bytes));
        out.push('-');
        run.clear();
    }

    for c in s.chars() {
        if c == '&' {
            flush(&mut out, &mut run);
            out.push_str("&-");
        } else if is_direct(c) {
            flush(&mut out, &mut run);
            out.push(c);
        } else {
            // Chars outside the BMP become surrogate pairs automatically.
            let mut buf = [0u16; 2];
            run.extend_from_slice(c.encode_utf16(&mut buf));
        }
    }
    flush(&mut out, &mut run);
    out
}

/// Strict decode helper: any malformed `&…-` section aborts the whole decode.
fn try_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] != b'&' {
            // Copy literal text up to the next `&`. Safe to slice: `&` is ASCII,
            // so `i` always lands on a char boundary.
            let start = i;
            while i < bytes.len() && bytes[i] != b'&' {
                i += 1;
            }
            out.push_str(&s[start..i]);
            continue;
        }

        // `&-` is the escaped literal ampersand.
        if i + 1 < bytes.len() && bytes[i + 1] == b'-' {
            out.push('&');
            i += 2;
            continue;
        }

        // Otherwise a base64 section runs until the terminating `-`.
        let start = i + 1;
        let mut end = start;
        while end < bytes.len() && bytes[end] != b'-' {
            end += 1;
        }
        if end >= bytes.len() || end == start {
            return None; // missing terminator, or empty `&-` (handled above)
        }

        let raw = b64_decode(&s[start..end])?;
        if raw.len() % 2 != 0 {
            return None; // UTF-16BE needs an even byte count
        }
        let units: Vec<u16> = raw
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        let decoded = String::from_utf16(&units).ok()?;
        out.push_str(&decoded);
        i = end + 1;
    }

    Some(out)
}

/// Decode a modified UTF-7 string. Input that cannot be decoded is returned
/// unchanged (a plain folder name containing `&`, for example).
pub fn decode(s: &str) -> String {
    match try_decode(s) {
        Some(d) => d,
        None => s.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_server_vectors() {
        // 実サーバーで観測された対応
        assert_eq!(encode("仕事"), "&TtVOiw-");
        assert_eq!(decode("&TtVOiw-"), "仕事");
        assert_eq!(encode("案件A"), "&aEhO9g-A");
        assert_eq!(decode("&aEhO9g-A"), "案件A");
        assert_eq!(encode("&"), "&-");
        assert_eq!(decode("&-"), "&");
    }

    #[test]
    fn ascii_only_passes_through() {
        assert_eq!(encode("INBOX"), "INBOX");
        assert_eq!(decode("INBOX"), "INBOX");
        assert_eq!(encode("Sent Items"), "Sent Items");
        assert_eq!(decode("Sent Items"), "Sent Items");
        assert_eq!(encode("[Gmail]/Sent Mail"), "[Gmail]/Sent Mail");
        assert_eq!(decode("[Gmail]/Sent Mail"), "[Gmail]/Sent Mail");
    }

    #[test]
    fn undecodable_input_is_returned_unchanged() {
        // `&` に終端 `-` が続かない
        assert_eq!(decode("R&D"), "R&D");
        assert_eq!(decode("abc&TtV"), "abc&TtV");
        assert_eq!(decode("trailing&"), "trailing&");
        // 不正な base64 文字
        assert_eq!(decode("x&!@#-y"), "x&!@#-y");
        // 長さが不正な base64 (len % 4 == 1)
        assert_eq!(decode("&T-"), "&T-");
        // 奇数バイトで UTF-16BE にならない
        assert_eq!(decode("&AA-"), "&AA-");
    }

    #[test]
    fn round_trip_various() {
        for original in [
            "仕事",
            "案件A",
            "開発プロジェクト",
            "📧メールボックス", // サロゲートペアを含む
            "R&D 2024 予算",
            "INBOX",
            "重要/請求書/2024年6月",
            "a&b&c",
        ] {
            assert_eq!(
                decode(&encode(original)),
                original,
                "round trip failed for {:?}",
                original
            );
        }
    }

    #[test]
    fn decode_is_idempotent_on_plain_text() {
        // デコードしても変わらない入力は安定していること
        assert_eq!(decode("仕事"), "仕事");
        assert_eq!(decode("plain"), "plain");
    }
}
