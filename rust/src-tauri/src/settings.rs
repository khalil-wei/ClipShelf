use crate::content::trim;
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub open_at_login: bool,
    pub theme: String,
    pub compact: bool,
    pub reduce_motion: bool,
    pub hide_on_blur: bool,
    pub height: u32,
    pub retention_days: u32,
    pub shortcut: String,
    pub separator: String,
    pub capture_images: bool,
    pub always_plain_text: bool,
    pub ignored_apps: Vec<String>,
    pub ignore_confidential: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            open_at_login: false,
            theme: "system".into(),
            compact: false,
            reduce_motion: false,
            hide_on_blur: true,
            height: 390,
            retention_days: 0,
            shortcut: "Ctrl+Shift+V".into(),
            separator: "\n".into(),
            capture_images: true,
            always_plain_text: false,
            ignored_apps: Vec::new(),
            ignore_confidential: true,
        }
    }
}

impl Settings {
    pub fn configure(&mut self, value: &Value) -> Result<(), &'static str> {
        let values = value.as_object().ok_or("设置无效")?;
        // 快捷键等后续字段失败时，前面已通过的字段也不能提前生效。
        let mut next = self.clone();
        if let Some(value) = values.get("theme") {
            let theme = value
                .as_str()
                .filter(|theme| ["system", "light", "dark"].contains(theme))
                .ok_or("主题无效")?;
            next.theme = theme.into();
        }
        for (key, target) in [
            ("compact", &mut next.compact),
            ("reduceMotion", &mut next.reduce_motion),
            ("hideOnBlur", &mut next.hide_on_blur),
            ("captureImages", &mut next.capture_images),
            ("alwaysPlainText", &mut next.always_plain_text),
            ("ignoreConfidential", &mut next.ignore_confidential),
            ("openAtLogin", &mut next.open_at_login),
        ] {
            if let Some(value) = values.get(key) {
                *target = value.as_bool().ok_or("设置无效")?;
            }
        }
        if let Some(value) = values.get("ignoredApps") {
            let error = "请输入应用进程名，每行一个，最多 50 个";
            let apps = value
                .as_array()
                .filter(|apps| apps.len() <= 50)
                .ok_or(error)?;
            let mut cleaned = Vec::new();
            for app in apps {
                let name = app
                    .as_str()
                    .filter(|name| {
                        crate::utf16::len(name) <= 80
                            && !name
                                .chars()
                                .any(|ch| ch == '/' || ch == '\\' || ch <= '\u{001f}')
                    })
                    .ok_or(error)?;
                let name = trim(name);
                if !name.is_empty() && !cleaned.iter().any(|app| app == name) {
                    cleaned.push(name.to_owned());
                }
            }
            next.ignored_apps = cleaned;
        }
        if let Some(value) = values.get("height") {
            let height = value
                .as_f64()
                .filter(|height| height.is_finite())
                .ok_or("高度无效")?;
            next.height = height.round().clamp(290.0, 640.0) as u32;
        }
        if let Some(value) = values.get("retentionDays") {
            let days = value
                .as_f64()
                .filter(|days| [0.0, 7.0, 30.0, 90.0].contains(days))
                .ok_or("保留时间无效")?;
            next.retention_days = days as u32;
        }
        for (key, target, choices, error) in [
            (
                "shortcut",
                &mut next.shortcut,
                &["Ctrl+Shift+V", "Ctrl+Alt+V", "Alt+V"][..],
                "快捷键无效",
            ),
            (
                "separator",
                &mut next.separator,
                &["\n", "\n\n", " ", "\t"][..],
                "分隔符无效",
            ),
        ] {
            if let Some(value) = values.get(key) {
                let text = value
                    .as_str()
                    .filter(|text| choices.contains(text))
                    .ok_or(error)?;
                *target = text.into();
            }
        }
        if values.get("compact") == Some(&Value::Bool(false)) && next.height < 345 {
            next.height = 390;
        }
        *self = next;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn invalid_update_does_not_partially_apply() {
        let mut settings = Settings::default();
        let before = settings.clone();
        assert_eq!(
            settings.configure(&json!({"theme":"dark","shortcut":"bad"})),
            Err("快捷键无效")
        );
        assert_eq!(settings, before);
        assert!(settings.configure(&json!({"captureImages":1})).is_err());
        assert_eq!(settings, before);
    }

    #[test]
    fn settings_keep_legacy_names_defaults_and_compact_height() {
        let mut settings = Settings::default();
        settings
            .configure(
                &json!({"height":302,"compact":true,"ignoredApps":[" Code.exe ","Code.exe",""]}),
            )
            .unwrap();
        assert_eq!(settings.ignored_apps, vec!["Code.exe"]);
        settings.configure(&json!({"compact":false})).unwrap();
        assert_eq!(settings.height, 390);
        let value = serde_json::to_value(&settings).unwrap();
        assert_eq!(value.get("captureImages"), Some(&json!(true)));
        assert_eq!(value.get("retentionDays"), Some(&json!(0)));
        assert_eq!(value.get("separator"), Some(&json!("\n")));
        assert_eq!(value.get("shortcut"), Some(&json!("Ctrl+Shift+V")));
    }

    #[test]
    fn rejects_invalid_boundary_values_and_clamps_height() {
        let mut settings = Settings::default();
        for value in [
            json!(null),
            json!({"theme":"auto"}),
            json!({"ignoredApps":["C:/Code.exe"]}),
            json!({"ignoredApps":["a\u{0000}b"]}),
            json!({"retentionDays":1}),
            json!({"separator":","}),
            json!({"height":"390"}),
        ] {
            assert!(settings.configure(&value).is_err(), "{value}");
        }
        settings.configure(&json!({"height":999})).unwrap();
        assert_eq!(settings.height, 640);
        settings.configure(&json!({"height":1})).unwrap();
        assert_eq!(settings.height, 290);
        settings.configure(&json!({"height":390.5})).unwrap();
        assert_eq!(settings.height, 391);
    }
}
