use regex::Regex;
use std::sync::LazyLock;

// JS 的 trim/\s 包含 BOM、不包含 U+0085；Rust 默认空白集合不同。
const JS_SPACE: &str = "\t\n\u{000b}\u{000c}\r \u{00a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}";

pub(crate) fn trim(text: &str) -> &str {
    text.trim_matches(|ch| JS_SPACE.contains(ch))
}
pub(crate) fn words(text: &str) -> impl Iterator<Item = &str> {
    text.split(|ch| JS_SPACE.contains(ch))
        .filter(|word| !word.is_empty())
}

pub(crate) use crate::utf16::prefix;

pub fn classify(text: &str) -> &'static str {
    static CODE: LazyLock<Regex> = LazyLock::new(|| {
        let whitespace = regex::escape(JS_SPACE);
        Regex::new(&format!(r"(?:^|\n)[{whitespace}]*(?:const |let |function |import |export |class |def |SELECT |public |<(?-u:\w)+[^>]*>)|[{{}};][{whitespace}]*\n[^\r\n\u2028\u2029]*[{{}};=]"))
            .expect("固定分类表达式无效")
    });
    let value = trim(text);
    let http = value
        .get(..7)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("http://"));
    let https = value
        .get(..8)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"));
    if (http || https)
        && !value.chars().any(|ch| JS_SPACE.contains(ch))
        && url::Url::parse(value).is_ok()
    {
        return "link";
    }
    if value.starts_with('#')
        && [4, 7, 9].contains(&value.len())
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    {
        return "color";
    }
    if CODE.is_match(value) {
        "code"
    } else {
        "text"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript_whitespace_and_ascii_markup_rules_are_preserved() {
        assert_eq!(classify("<中文>"), "text");
        assert_eq!(classify("\u{feff}const value = 1;"), "code");
        assert_eq!(classify("\u{0085}const value = 1;"), "text");
        assert_eq!(trim("\u{feff} \n"), "");
        assert_eq!(trim("\u{0085}"), "\u{0085}");
        assert_eq!(prefix("中😀文", 3), "中😀");
        assert_eq!(
            crate::utf16::units(&prefix("中😀文", 2)),
            vec![0x4e2d, 0xd83d]
        );
    }
}
