use crate::content::{classify, prefix, trim};
use crate::settings::Settings;
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashSet, sync::Arc};
use uuid::Uuid;

pub const MAX_BYTES: usize = 1024 * 1024;
const DAY: f64 = 86_400_000.0;
const PALETTE: [&str; 6] = [
    "#f06464", "#eda841", "#69b987", "#629fe7", "#ad83da", "#d88bb7",
];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    pub media_id: String,
    pub width: f64,
    pub height: f64,
    pub bytes: f64,
}

impl ImageMetadata {
    fn valid(&self) -> bool {
        is_media_id(&self.media_id)
            && self.width.is_finite()
            && self.height.is_finite()
            && self.width > 0.0
            && self.height > 0.0
            && self.width * self.height <= 32_000_000.0
            && self.bytes.is_finite()
            && self.bytes > 0.0
            && self.bytes <= (16 * MAX_BYTES) as f64
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Item {
    pub id: String,
    pub text: Arc<str>,
    pub html: Arc<str>,
    pub title: String,
    pub source: String,
    pub kind: String,
    pub starred: bool,
    pub groups: Vec<String>,
    pub created: f64,
    pub updated: f64,
    #[serde(flatten)]
    pub image: Option<ImageMetadata>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub color: String,
    pub order: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipStore {
    pub items: Vec<Item>,
    pub groups: Vec<Group>,
    pub settings: Settings,
    pub paused: bool,
    pub pause_until: f64,
}

fn is_media_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch))
}

fn string(value: Option<&Value>) -> &str {
    value.and_then(Value::as_str).unwrap_or("")
}

fn legacy_number(value: Option<&Value>) -> f64 {
    let number = match value {
        Some(Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        Some(Value::String(text)) => trim(text).parse().unwrap_or(0.0),
        Some(Value::Bool(true)) => 1.0,
        _ => 0.0,
    };
    // 兼容旧版 Number(...) || 0；NaN 不能进入尺寸判断或累计预算。
    if number.is_nan() {
        0.0
    } else {
        number
    }
}

fn timestamp(value: Option<&Value>, now: f64) -> f64 {
    let number = legacy_number(value);
    if number != 0.0 && number.is_finite() {
        number
    } else {
        now
    }
}

impl ClipStore {
    pub fn from_snapshot(value: &Value, now: f64) -> Result<Self, &'static str> {
        let data = value.as_object().ok_or("历史格式无效")?;
        let mut store = Self::default();
        if let Some(groups) = data.get("groups").and_then(Value::as_array) {
            for value in groups {
                let (Some(id), Some(name)) = (
                    value.get("id").and_then(Value::as_str),
                    value.get("name").and_then(Value::as_str),
                ) else {
                    continue;
                };
                let mut seen = HashSet::new();
                let order = value
                    .get("order")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .filter(|id| seen.insert(*id))
                    .take(2000)
                    .map(str::to_owned)
                    .collect();
                let color = string(value.get("color"));
                store.groups.push(Group {
                    id: id.into(),
                    name: name.into(),
                    order,
                    color: if PALETTE.contains(&color) {
                        color
                    } else {
                        PALETTE[store.groups.len() % PALETTE.len()]
                    }
                    .into(),
                });
                if store.groups.len() == 30 {
                    break;
                }
            }
        }
        if let Some(items) = data.get("items").and_then(Value::as_array) {
            for value in items {
                let (Some(id), Some(text)) = (
                    value.get("id").and_then(Value::as_str),
                    value.get("text").and_then(Value::as_str),
                ) else {
                    continue;
                };
                let image = if value.get("kind").and_then(Value::as_str) == Some("image") {
                    let media_id = string(value.get("mediaId"));
                    let width = legacy_number(value.get("width"));
                    let height = legacy_number(value.get("height"));
                    if !is_media_id(media_id) || width <= 0.0 || height <= 0.0 {
                        continue;
                    }
                    Some(ImageMetadata {
                        media_id: media_id.into(),
                        width,
                        height,
                        bytes: legacy_number(value.get("bytes")),
                    })
                } else {
                    None
                };
                let html = string(value.get("html"));
                let groups = value
                    .get("groups")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .filter(|id| store.groups.iter().any(|group| group.id == *id))
                    .map(str::to_owned)
                    .collect();
                store.items.push(Item {
                    id: id.into(),
                    text: text.into(),
                    html: if crate::utf16::bytes(html) <= MAX_BYTES {
                        html
                    } else {
                        ""
                    }
                    .into(),
                    title: prefix(string(value.get("title")), 100).into(),
                    source: string(value.get("source")).into(),
                    kind: if image.is_some() {
                        "image"
                    } else {
                        classify(text)
                    }
                    .into(),
                    image,
                    starred: value.get("starred").and_then(Value::as_bool) == Some(true),
                    groups,
                    created: timestamp(value.get("created"), now),
                    updated: timestamp(value.get("updated"), now),
                });
                if store.items.len() == 2000 {
                    break;
                }
            }
        }
        if let Some(settings) = data
            .get("settings")
            .filter(|settings| !settings.is_null() && **settings != Value::Bool(false))
        {
            store.settings.configure(settings)?;
        }
        store.paused = data.get("paused").and_then(Value::as_bool) == Some(true);
        store.pause_until = if store.paused {
            data.get("pauseUntil")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite())
                .unwrap_or(0.0)
                .max(0.0)
        } else {
            0.0
        };
        store.resume_expired(now);
        Ok(store)
    }

    pub fn resume_expired(&mut self, now: f64) -> bool {
        if self.paused && self.pause_until != 0.0 && self.pause_until <= now {
            self.paused = false;
            self.pause_until = 0.0;
            true
        } else {
            false
        }
    }

    pub fn prune(&mut self, now: f64) {
        if self.settings.retention_days != 0 {
            let cutoff = now - f64::from(self.settings.retention_days) * DAY;
            self.items
                .retain(|item| item.starred || !item.groups.is_empty() || item.updated >= cutoff);
        }
        let mut media_bytes: f64 = self
            .items
            .iter()
            .filter_map(|item| item.image.as_ref())
            .map(|image| image.bytes)
            .sum();
        let mut text_bytes: usize = self
            .items
            .iter()
            .map(|item| crate::utf16::bytes(&item.text) + crate::utf16::bytes(&item.html))
            .sum();
        while self.items.len() > 2000
            || media_bytes > (128 * MAX_BYTES) as f64
            || text_bytes > 64 * MAX_BYTES
        {
            let Some(index) = self
                .items
                .iter()
                .rposition(|item| !item.starred && item.groups.is_empty())
            else {
                break;
            };
            let removed = self.items.remove(index);
            media_bytes -= removed.image.as_ref().map_or(0.0, |image| image.bytes);
            text_bytes -= crate::utf16::bytes(&removed.text) + crate::utf16::bytes(&removed.html);
        }
    }

    pub fn add(&mut self, text: &str, source: &str, html: &str, now: f64) -> bool {
        if trim(text).is_empty() || crate::utf16::bytes(text) > MAX_BYTES {
            return false;
        }
        let existing = self
            .items
            .iter()
            .position(|item| item.image.is_none() && item.text.as_ref() == text);
        let mut item = if let Some(index) = existing {
            self.items.remove(index)
        } else {
            Item {
                id: Uuid::new_v4().to_string(),
                text: text.into(),
                html: "".into(),
                title: String::new(),
                source: String::new(),
                kind: classify(text).into(),
                starred: false,
                groups: Vec::new(),
                created: now,
                updated: now,
                image: None,
            }
        };
        item.html = if crate::utf16::bytes(html) <= MAX_BYTES {
            html
        } else {
            ""
        }
        .into();
        item.updated = now;
        if !source.is_empty() {
            item.source = prefix(source, 100).into();
        }
        let id = item.id.clone();
        self.items.retain(|other| other.id != id);
        self.items.insert(0, item);
        self.prune(now);
        self.items.iter().any(|item| item.id == id)
    }

    pub fn add_image(
        &mut self,
        metadata: ImageMetadata,
        source: &str,
        now: f64,
    ) -> Result<bool, &'static str> {
        if !metadata.valid() {
            return Err("图片数据无效");
        }
        let existing = self.items.iter().position(|item| {
            item.image
                .as_ref()
                .is_some_and(|image| image.media_id == metadata.media_id)
        });
        let mut item = if let Some(index) = existing {
            self.items.remove(index)
        } else {
            Item {
                id: Uuid::new_v4().to_string(),
                text: "".into(),
                html: "".into(),
                title: String::new(),
                source: String::new(),
                kind: "image".into(),
                starred: false,
                groups: Vec::new(),
                created: now,
                updated: now,
                image: None,
            }
        };
        item.image = Some(metadata);
        item.updated = now;
        if !source.is_empty() {
            item.source = source.into();
        }
        let id = item.id.clone();
        self.items.retain(|other| other.id != id);
        self.items.insert(0, item);
        self.prune(now);
        Ok(self.items.iter().any(|item| item.id == id))
    }

    pub fn replace_image(
        &mut self,
        id: &str,
        metadata: ImageMetadata,
        now: f64,
    ) -> Result<(), &'static str> {
        if !metadata.valid() || metadata.width.fract() != 0.0 || metadata.height.fract() != 0.0 {
            return Err("图片数据无效");
        }
        let item = self
            .items
            .iter_mut()
            .find(|item| item.id == id && item.image.is_some())
            .ok_or("图片数据无效")?;
        item.image = Some(metadata);
        self.prune(now);
        if self.items.iter().any(|item| item.id == id) {
            Ok(())
        } else {
            Err("图片容量不足，请先清理部分历史")
        }
    }

    pub fn group_item_ids(&self, id: &str) -> Vec<String> {
        let Some(group) = self.groups.iter().find(|group| group.id == id) else {
            return Vec::new();
        };
        let mut items: Vec<_> = self
            .items
            .iter()
            .filter(|item| item.groups.iter().any(|group| group == id))
            .collect();
        items.sort_by_key(|item| {
            group
                .order
                .iter()
                .position(|id| id == &item.id)
                .unwrap_or(usize::MAX)
        });
        items.into_iter().map(|item| item.id.clone()).collect()
    }

    pub fn mutate(
        &mut self,
        action: &str,
        ids: &[String],
        value: Option<&Value>,
        now: f64,
    ) -> Result<(), &'static str> {
        let id = ids.first().map(String::as_str).unwrap_or("");
        let selected: Vec<_> = self
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| ids.contains(&item.id))
            .map(|(index, _)| index)
            .collect();
        match action {
            "star" => {
                if selected.is_empty() {
                    return Err("内容不存在");
                }
                let starred = !selected.iter().all(|index| self.items[*index].starred);
                for index in selected {
                    self.items[index].starred = starred;
                }
            }
            "delete" => self.items.retain(|item| !ids.contains(&item.id)),
            "create" => {
                let text = string(value.and_then(|value| value.get("text")));
                if !self.add(text, "ClipShelf", "", now) {
                    return Err("内容为空、过大或历史已满");
                }
                self.items[0].title = prefix(
                    trim(string(value.and_then(|value| value.get("title")))),
                    100,
                )
                .into();
            }
            "edit" => {
                let index = *selected.first().ok_or("内容不存在")?;
                let value = value.filter(|value| !value.is_null()).ok_or("内容不存在")?;
                let item = &mut self.items[index];
                if item.image.is_none() {
                    let text = value
                        .get("text")
                        .and_then(Value::as_str)
                        .filter(|text| {
                            !trim(text).is_empty() && crate::utf16::bytes(text) <= MAX_BYTES
                        })
                        .ok_or("内容不能为空或超过 1 MiB")?;
                    if item.text.as_ref() != text {
                        item.html = "".into();
                    }
                    item.text = text.into();
                    item.kind = classify(text).into();
                }
                item.title = prefix(trim(string(value.get("title"))), 100).into();
            }
            "group-add" => {
                let name = value
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| string(value.and_then(|value| value.get("name"))));
                let name = prefix(trim(name), 30);
                if name.is_empty() {
                    return Err("请输入分组名称");
                }
                if self.groups.iter().any(|group| group.name == name) {
                    return Err("分组名称已存在");
                }
                if self.groups.len() >= 30 {
                    return Err("最多创建 30 个分组");
                }
                let color = string(value.and_then(|value| value.get("color")));
                self.groups.push(Group {
                    id: Uuid::new_v4().to_string(),
                    name: name.into(),
                    order: Vec::new(),
                    color: if PALETTE.contains(&color) {
                        color
                    } else {
                        PALETTE[self.groups.len() % PALETTE.len()]
                    }
                    .into(),
                });
            }
            "group-edit" => {
                let name = prefix(trim(string(value.and_then(|value| value.get("name")))), 30);
                let index = self
                    .groups
                    .iter()
                    .position(|group| group.id == id)
                    .filter(|_| !name.is_empty())
                    .ok_or("分组名称不能为空")?;
                if self
                    .groups
                    .iter()
                    .any(|group| group.id != id && group.name == name)
                {
                    return Err("分组名称已存在");
                }
                self.groups[index].name = name.into();
                let color = string(value.and_then(|value| value.get("color")));
                if PALETTE.contains(&color) {
                    self.groups[index].color = color.into();
                }
            }
            "group-delete" => {
                self.groups.retain(|group| group.id != id);
                for item in &mut self.items {
                    item.groups.retain(|group| group != id);
                }
            }
            "group-move" => {
                let before_id = string(value.and_then(|value| value.get("beforeId")));
                let index = self
                    .groups
                    .iter()
                    .position(|group| group.id == id)
                    .ok_or("分组不存在")?;
                if !self.groups.iter().any(|group| group.id == before_id) {
                    return Err("分组不存在");
                }
                if id != before_id {
                    let group = self.groups.remove(index);
                    let before = self
                        .groups
                        .iter()
                        .position(|group| group.id == before_id)
                        .ok_or("分组不存在")?;
                    let after = value
                        .and_then(|value| value.get("after"))
                        .and_then(Value::as_bool)
                        == Some(true);
                    self.groups.insert(before + usize::from(after), group);
                }
            }
            "group-item-move" => {
                let group_id = string(value.and_then(|value| value.get("groupId")));
                let index = self
                    .groups
                    .iter()
                    .position(|group| group.id == group_id)
                    .ok_or("只能排序同一分组里的内容")?;
                if selected.is_empty()
                    || selected.iter().any(|index| {
                        !self.items[*index]
                            .groups
                            .iter()
                            .any(|group| group == group_id)
                    })
                {
                    return Err("只能排序同一分组里的内容");
                }
                let before_id = string(value.and_then(|value| value.get("beforeId")));
                let ordered = self.group_item_ids(group_id);
                if ordered.iter().any(|id| id == before_id) && !ids.iter().any(|id| id == before_id)
                {
                    let (moving, mut rest): (Vec<_>, Vec<_>) =
                        ordered.into_iter().partition(|id| ids.contains(id));
                    let before = rest
                        .iter()
                        .position(|id| id == before_id)
                        .ok_or("只能排序同一分组里的内容")?;
                    let after = value
                        .and_then(|value| value.get("after"))
                        .and_then(Value::as_bool)
                        == Some(true);
                    rest.splice(
                        before + usize::from(after)..before + usize::from(after),
                        moving,
                    );
                    self.groups[index].order = rest;
                }
            }
            "group-toggle" | "group-set" => {
                let group_id = string(value);
                if selected.is_empty() || !self.groups.iter().any(|group| group.id == group_id) {
                    return Err("分组或内容不存在");
                }
                for index in selected {
                    let groups = &mut self.items[index].groups;
                    if groups.iter().any(|group| group == group_id) {
                        if action == "group-toggle" {
                            groups.retain(|group| group != group_id);
                        }
                    } else {
                        groups.push(group_id.into());
                    }
                }
            }
            "pause" => {
                if let Some(value) = value {
                    let minutes = value
                        .as_f64()
                        .filter(|minutes| [0.0, 5.0, 15.0, 60.0].contains(minutes))
                        .ok_or("暂停时长无效")?;
                    self.paused = true;
                    self.pause_until = if minutes == 0.0 {
                        0.0
                    } else {
                        now + minutes * 60_000.0
                    };
                } else {
                    self.paused = !self.paused;
                    self.pause_until = 0.0;
                }
            }
            "clear" => self
                .items
                .retain(|item| item.starred || !item.groups.is_empty()),
            "settings" => {
                self.settings.configure(value.ok_or("设置无效")?)?;
                self.prune(now);
            }
            _ => return Err("未知操作"),
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const NOW: f64 = 1_800_000_000_000.0;

    fn ids(store: &ClipStore) -> Vec<String> {
        store.items.iter().map(|item| item.id.clone()).collect()
    }

    #[test]
    fn recopy_keeps_identity_title_pin_and_groups() {
        let mut store = ClipStore::default();
        assert!(store.add("first", "Code", "<b>first</b>", NOW));
        let id = store.items[0].id.clone();
        store.mutate("star", &[id.clone()], None, NOW).unwrap();
        store
            .mutate("group-add", &[], Some(&json!("工作")), NOW)
            .unwrap();
        let group = store.groups[0].id.clone();
        store
            .mutate("group-set", &[id.clone()], Some(&json!(group)), NOW)
            .unwrap();
        store
            .mutate(
                "edit",
                &[id.clone()],
                Some(&json!({"text":"first","title":"名称"})),
                NOW,
            )
            .unwrap();
        store.add("second", "", "", NOW);
        store.add("first", "", "<i>first</i>", NOW + 1.0);
        assert_eq!(store.items.len(), 2);
        let item = &store.items[0];
        assert_eq!(item.id, id);
        assert!(item.starred);
        assert_eq!(item.title, "名称");
        assert_eq!(item.source, "Code");
        assert_eq!(item.groups, vec![group]);
        assert_eq!(item.html.as_ref(), "<i>first</i>");
    }

    #[test]
    fn legacy_snapshot_cleans_bad_records_and_preserves_valid_metadata() {
        let value = json!({"items":[null,{"id":"invalid","text":4},{"id":"legacy","text":"old text","starred":true,"groups":["missing","g"],"created":"123"}],"groups":[{"id":"g","name":"工作","order":["legacy","legacy",1],"color":"bad"}],"paused":true,"pauseUntil":NOW-1.0});
        let store = ClipStore::from_snapshot(&value, NOW).unwrap();
        assert_eq!(store.items.len(), 1);
        assert_eq!(store.items[0].groups, vec!["g"]);
        assert_eq!(store.items[0].created, 123.0);
        assert!(store.items[0].starred);
        assert_eq!(store.groups[0].order, vec!["legacy"]);
        assert_eq!(store.groups[0].color, PALETTE[0]);
        assert!(!store.paused);
        let snapshot = serde_json::to_value(&store).unwrap();
        let reloaded = ClipStore::from_snapshot(&snapshot, NOW).unwrap();
        assert_eq!(reloaded, store);
    }

    #[test]
    fn pinned_history_rejects_new_content_and_clear_preserves_grouped_items() {
        let items: Vec<_> = (0..2000).map(|i| json!({"id":format!("fixture-{i}"),"text":format!("pinned {i}"),"starred":true})).collect();
        let mut store = ClipStore::from_snapshot(&json!({"items":items}), NOW).unwrap();
        let before = ids(&store);
        assert!(!store.add("new", "", "", NOW));
        assert_eq!(ids(&store), before);
        store.items[0].starred = false;
        store.groups.push(Group {
            id: "g".into(),
            name: "工作".into(),
            color: PALETTE[0].into(),
            order: vec![],
        });
        store.items[0].groups.push("g".into());
        store.mutate("clear", &[], None, NOW).unwrap();
        assert_eq!(store.items.len(), 2000);
        store
            .mutate("group-delete", &["g".into()], None, NOW)
            .unwrap();
        assert_eq!(store.items.len(), 2000);
        store.mutate("clear", &[], None, NOW).unwrap();
        assert_eq!(store.items.len(), 1999);
    }

    #[test]
    fn byte_budgets_evict_oldest_unprotected_items_and_keep_exact_boundaries() {
        let mut store = ClipStore::default();
        let text = "中".repeat(MAX_BYTES / 3);
        assert!(store.add(&text, "", "", NOW));
        assert!(!store.add(&(text + "中"), "", "", NOW));
        let items: Vec<_> = (0..65).map(|i| json!({"id":format!("fixture-{i}"),"text":"x".repeat(MAX_BYTES),"starred":i==64})).collect();
        let mut store = ClipStore::from_snapshot(&json!({"items":items}), NOW).unwrap();
        store.prune(NOW);
        assert_eq!(store.items.len(), 64);
        assert!(!store.items.iter().any(|item| item.id == "fixture-63"));
        assert!(store.items.last().unwrap().starred);
    }

    #[test]
    fn retention_and_pause_use_deadline_boundaries_and_protect_pins() {
        let mut store = ClipStore::from_snapshot(&json!({"items":[{"id":"old","text":"old","updated":NOW-8.0*DAY},{"id":"edge","text":"edge","updated":NOW-7.0*DAY},{"id":"pin","text":"pin","updated":1,"starred":true}]}), NOW).unwrap();
        store
            .mutate("settings", &[], Some(&json!({"retentionDays":7})), NOW)
            .unwrap();
        assert_eq!(ids(&store), vec!["edge", "pin"]);
        store.mutate("pause", &[], Some(&json!(5)), NOW).unwrap();
        assert!(!store.resume_expired(NOW + 299_999.0));
        assert!(store.resume_expired(NOW + 300_000.0));
        store.mutate("pause", &[], None, NOW).unwrap();
        assert!(store.paused);
        store.mutate("pause", &[], Some(&json!(0)), NOW).unwrap();
        assert_eq!(store.pause_until, 0.0);
        assert!(!store.resume_expired(NOW + DAY));
        assert!(store.mutate("pause", &[], Some(&json!(null)), NOW).is_err());
    }

    #[test]
    fn edits_keep_position_source_and_groups_and_clear_only_changed_html() {
        let mut store = ClipStore::default();
        store.add("first", "Code", "<b>first</b>", NOW);
        let id = store.items[0].id.clone();
        store.add("second", "", "", NOW);
        store
            .mutate(
                "edit",
                &[id.clone()],
                Some(&json!({"text":"first","title":"renamed"})),
                NOW,
            )
            .unwrap();
        assert_eq!(store.items[1].html.as_ref(), "<b>first</b>");
        store
            .mutate(
                "edit",
                &[id.clone()],
                Some(&json!({"text":"https://example.com","title":"link"})),
                NOW,
            )
            .unwrap();
        assert_eq!(store.items[1].kind, "link");
        assert_eq!(store.items[1].source, "Code");
        assert!(store.items[1].html.is_empty());
        let before = store.clone();
        assert!(store
            .mutate("edit", &[id], Some(&json!({"text":" "})), NOW)
            .is_err());
        assert_eq!(store, before);
    }

    #[test]
    fn group_order_survives_recopy_and_repeated_assignment_is_idempotent() {
        let mut store = ClipStore::default();
        for text in ["a", "b", "c"] {
            store.add(text, "", "", NOW);
        }
        store
            .mutate("group-add", &[], Some(&json!({"name":"first"})), NOW)
            .unwrap();
        store
            .mutate("group-add", &[], Some(&json!("second")), NOW)
            .unwrap();
        let g = store.groups[0].id.clone();
        let h = store.groups[1].id.clone();
        let chosen = ids(&store);
        store
            .mutate("group-set", &chosen, Some(&json!(g)), NOW)
            .unwrap();
        store
            .mutate("group-set", &chosen, Some(&json!(g)), NOW)
            .unwrap();
        assert!(store.items.iter().all(|item| item.groups.len() == 1));
        store
            .mutate(
                "group-item-move",
                &[chosen[2].clone()],
                Some(&json!({"groupId":g,"beforeId":chosen[0]})),
                NOW,
            )
            .unwrap();
        store
            .mutate(
                "group-move",
                &[h.clone()],
                Some(&json!({"beforeId":g})),
                NOW,
            )
            .unwrap();
        assert_eq!(store.groups[0].id, h);
        store.add("b", "", "", NOW);
        assert_eq!(
            store.group_item_ids(&g),
            vec![chosen[2].clone(), chosen[0].clone(), chosen[1].clone()]
        );
        assert_eq!(
            ids(&store),
            vec![chosen[1].clone(), chosen[0].clone(), chosen[2].clone()]
        );
    }

    #[test]
    fn image_metadata_deduplicates_and_shares_the_media_budget() {
        let mut store = ClipStore::default();
        let metadata = ImageMetadata {
            media_id: "a".repeat(64),
            width: 1.0,
            height: 1.0,
            bytes: 16.0 * MAX_BYTES as f64,
        };
        assert!(store.add_image(metadata.clone(), "Fixture", NOW).unwrap());
        store.items[0].title = "keep".into();
        store.items[0].starred = true;
        let id = store.items[0].id.clone();
        assert!(store.add_image(metadata.clone(), "", NOW).unwrap());
        assert_eq!(store.items[0].id, id);
        assert_eq!(store.items[0].title, "keep");
        for number in 1..=9 {
            store
                .add_image(
                    ImageMetadata {
                        media_id: format!("{number:064x}"),
                        ..metadata.clone()
                    },
                    "",
                    NOW,
                )
                .unwrap();
        }
        assert_eq!(store.items.len(), 8);
        assert!(store.items.iter().any(|item| item.id == id));
        assert!(store
            .add_image(
                ImageMetadata {
                    width: 32_000_001.0,
                    ..metadata.clone()
                },
                "",
                NOW
            )
            .is_err());
        assert!(store
            .add_image(
                ImageMetadata {
                    media_id: "../bad".into(),
                    ..metadata
                },
                "",
                NOW
            )
            .is_err());
    }

    #[test]
    fn snapshots_share_immutable_bodies_without_sharing_metadata() {
        let mut store = ClipStore::default();
        store.add("正文", "", "", NOW);
        let copy = store.clone();
        assert!(std::sync::Arc::ptr_eq(
            &store.items[0].text,
            &copy.items[0].text
        ));
        store.items[0].starred = true;
        assert!(!copy.items[0].starred);
    }
}
