use serde_json::Value;
use std::borrow::Cow;

const MARKER: char = '\u{e000}';
pub const ENCODING: &str = "clipshelf-utf16-v1";
fn escaped_unit(text: &str) -> Option<(u16, usize)> {
    if !text.starts_with(MARKER) {
        return None;
    }
    let rest = &text[MARKER.len_utf8()..];
    if rest.starts_with('e') {
        return Some((MARKER as u16, MARKER.len_utf8() + 1));
    }
    if rest.starts_with('s') {
        let digits = rest.get(1..5)?;
        if digits.bytes().all(|c| c.is_ascii_hexdigit()) {
            let unit = u16::from_str_radix(digits, 16).ok()?;
            if (0xd800..=0xdfff).contains(&unit) {
                return Some((unit, MARKER.len_utf8() + 5));
            }
        }
    }
    None
}
pub fn encode_units(units: &[u16]) -> String {
    let mut result = String::new();
    let mut index = 0;
    while index < units.len() {
        let unit = units[index];
        if (0xd800..=0xdbff).contains(&unit)
            && units
                .get(index + 1)
                .is_some_and(|u| (0xdc00..=0xdfff).contains(u))
        {
            let low = units[index + 1];
            let point = 0x10000 + ((u32::from(unit) - 0xd800) << 10) + (u32::from(low) - 0xdc00);
            result.push(char::from_u32(point).unwrap());
            index += 2;
            continue;
        }
        if (0xd800..=0xdfff).contains(&unit) {
            result.push(MARKER);
            result.push_str(&format!("s{unit:04x}"));
        } else {
            let ch = char::from_u32(u32::from(unit)).unwrap();
            result.push(ch);
            if ch == MARKER {
                result.push('e');
            }
        }
        index += 1;
    }
    result
}
pub fn encode(text: &str) -> String {
    encode_units(&text.encode_utf16().collect::<Vec<_>>())
}
pub fn units(text: &str) -> Vec<u16> {
    let mut result = Vec::new();
    let mut index = 0;
    while index < text.len() {
        if let Some((unit, size)) = escaped_unit(&text[index..]) {
            result.push(unit);
            index += size;
        } else {
            let ch = text[index..].chars().next().unwrap();
            let mut buf = [0u16; 2];
            result.extend_from_slice(ch.encode_utf16(&mut buf));
            index += ch.len_utf8();
        }
    }
    result
}
pub fn lossy(text: &str) -> String {
    String::from_utf16_lossy(&units(text))
}
pub fn len(text: &str) -> usize {
    if !text.contains(MARKER) {
        return text.encode_utf16().count();
    }
    units(text).len()
}
pub fn bytes(text: &str) -> usize {
    if !text.contains(MARKER) {
        return text.len();
    }
    let mut result = 0;
    let mut index = 0;
    while index < text.len() {
        if let Some((_, size)) = escaped_unit(&text[index..]) {
            result += 3;
            index += size;
        } else {
            let ch = text[index..].chars().next().unwrap();
            result += ch.len_utf8();
            index += ch.len_utf8();
        }
    }
    result
}
pub fn prefix(text: &str, max: usize) -> Cow<'_, str> {
    let mut length = 0;
    let mut index = 0;
    while index < text.len() {
        if length == max {
            return Cow::Borrowed(&text[..index]);
        }
        if let Some((_, size)) = escaped_unit(&text[index..]) {
            length += 1;
            index += size;
            continue;
        }
        let ch = text[index..].chars().next().unwrap();
        if length + ch.len_utf16() > max {
            let mut output = text[..index].to_owned();
            let mut buf = [0u16; 2];
            ch.encode_utf16(&mut buf);
            output.push_str(&encode_units(&buf[..1]));
            return Cow::Owned(output);
        }
        length += ch.len_utf16();
        index += ch.len_utf8();
    }
    Cow::Borrowed(text)
}
pub fn encode_value(value: &mut Value) {
    match value {
        Value::String(text) => *text = encode(text),
        Value::Array(items) => items.iter_mut().for_each(encode_value),
        Value::Object(items) => items.values_mut().for_each(encode_value),
        _ => {}
    }
}
fn lower_bytes(text: &str) -> Vec<u8> {
    if !text.contains(MARKER) {
        return text
            .to_lowercase()
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
    }
    let mut result = Vec::new();
    let mut segment = String::new();
    for unit in char::decode_utf16(units(text)) {
        match unit {
            Ok(ch) => segment.push(ch),
            Err(error) => {
                result.extend(segment.to_lowercase().encode_utf16());
                segment.clear();
                result.push(error.unpaired_surrogate());
            }
        }
    }
    result.extend(segment.to_lowercase().encode_utf16());
    result.into_iter().flat_map(u16::to_le_bytes).collect()
}
pub struct Search {
    patterns: Vec<regex::bytes::Regex>,
}
impl Search {
    pub fn new(query: &str) -> Result<Self, String> {
        let mut patterns = Vec::new();
        for word in crate::content::words(query) {
            let literal = lower_bytes(word)
                .iter()
                .map(|byte| format!(r"\x{byte:02x}"))
                .collect::<String>();
            patterns.push(
                regex::bytes::Regex::new(&format!("(?-u:{literal})"))
                    .map_err(|_| "搜索内容过长")?,
            );
        }
        Ok(Self { patterns })
    }
    pub fn matches(&self, text: &str) -> bool {
        let bytes = lower_bytes(text);
        self.patterns.iter().all(|pattern| {
            let mut offset = 0;
            while let Some(found) = pattern.find_at(&bytes, offset) {
                if found.start() % 2 == 0 {
                    return true;
                }
                offset = found.start() + 1;
            }
            false
        })
    }
}
pub fn legacy_json(bytes: &[u8]) -> Result<Value, serde_json::Error> {
    // serde_json 的 String 无法容纳孤立代理项；只在 JSON 字符串内部做可逆编码。
    fn unicode(bytes: &[u8]) -> Option<u16> {
        if !bytes.starts_with(b"\\u") {
            return None;
        }
        let digits = std::str::from_utf8(bytes.get(2..6)?).ok()?;
        u16::from_str_radix(digits, 16).ok()
    }
    let mut output = Vec::with_capacity(bytes.len());
    let mut inside = false;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'"' {
            inside = !inside;
            output.push(b'"');
            index += 1;
            continue;
        }
        if inside && bytes[index] == b'\\' {
            if let Some(unit) = unicode(&bytes[index..]) {
                if (0xd800..=0xdbff).contains(&unit)
                    && unicode(bytes.get(index + 6..).unwrap_or_default())
                        .is_some_and(|low| (0xdc00..=0xdfff).contains(&low))
                {
                    output.extend_from_slice(&bytes[index..index + 12]);
                    index += 12;
                    continue;
                }
                if (0xd800..=0xdfff).contains(&unit) || unit == MARKER as u16 {
                    output.extend_from_slice(encode_units(&[unit]).as_bytes());
                    index += 6;
                    continue;
                }
                output.extend_from_slice(&bytes[index..index + 6]);
                index += 6;
                continue;
            }
            output.push(bytes[index]);
            index += 1;
            if index < bytes.len() {
                output.push(bytes[index]);
                index += 1;
            }
            continue;
        }
        if inside && bytes[index..].starts_with(&[0xee, 0x80, 0x80]) {
            output.extend_from_slice(encode_units(&[MARKER as u16]).as_bytes());
            index += MARKER.len_utf8();
            continue;
        }
        output.push(bytes[index]);
        index += 1;
    }
    serde_json::from_slice(&output)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_unpaired_surrogates_and_literal_marker_without_collision() {
        let original = [0xd800, 65, 0xdc00, 0xe000, 115, 0xd83d, 0xde00];
        let encoded = encode_units(&original);
        assert_eq!(units(&encoded), original);
        assert_eq!(len(&encoded), original.len());
        assert_eq!(bytes(&encode_units(&[0xd800])), 3);
        assert_eq!(units(&prefix("😀", 1)), vec![0xd83d]);
        assert_eq!(prefix("😀", 2), "😀");
    }
    #[test]
    fn legacy_json_does_not_confuse_literal_backslash_or_marker_with_surrogates() {
        let value =
            legacy_json(br#"{"text":"a\ud800b","literal":"\\ud800","marker":"\ue000sd800"}"#)
                .unwrap();
        assert_eq!(units(value["text"].as_str().unwrap()), vec![97, 0xd800, 98]);
        assert_eq!(value["literal"], r"\ud800");
        assert_eq!(lossy(value["marker"].as_str().unwrap()), "\u{e000}sd800");
    }
    #[test]
    fn search_matches_logical_utf16_units_instead_of_private_transport_encoding() {
        assert!(!Search::new("e").unwrap().matches(&encode("\u{e000}")));
        assert!(!Search::new("sd800")
            .unwrap()
            .matches(&encode_units(&[0xd800])));
        assert!(Search::new(&encode_units(&[0xd83d])).unwrap().matches("😀"));
        assert!(Search::new("中文\u{feff}WINDOWS")
            .unwrap()
            .matches("Windows 中文"));
    }
}
