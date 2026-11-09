use crate::{
    content::prefix,
    crypto,
    media::{self, MediaStore},
    store::{ClipStore, Item},
    undo::UndoRecord,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use std::os::windows::ffi::OsStrExt;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Weak},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Saved<'a> {
    #[serde(flatten)]
    snapshot: &'a ClipStore,
    string_encoding: &'static str,
    pixel_index: HashMap<String, String>,
}
struct Body {
    text: Weak<str>,
    html: Weak<str>,
    digest: String,
    length: usize,
}
#[derive(Default)]
struct Updates {
    revision: u64,
    last: Option<HashMap<String, String>>,
    bodies: HashMap<String, Body>,
}
pub struct Runtime {
    pub store: ClipStore,
    pub media: MediaStore,
    pub undo: Option<UndoRecord>,
    pub queue: Vec<String>,
    pub error: String,
    pub events: bool,
    pub capture_blocked: bool,
    pub dark: bool,
    pub shortcut: String,
    pub stack_shortcut: bool,
    pub last_sequence: u32,
    pub last_signature: String,
    pub capture_epoch: u64,
    pub dirty: bool,
    pub directory: PathBuf,
    committed_media: HashSet<String>,
    updates: Updates,
}
impl Runtime {
    pub fn load(directory: PathBuf, legacy: Option<&Path>) -> Result<Self, String> {
        fs::create_dir_all(&directory).map_err(|_| "无法创建数据目录")?;
        let history = directory.join("history.enc");
        let mut media = MediaStore::open(directory.join("media"))?;
        let mut migrated = false;
        let mut pixel_index = HashMap::new();
        let history_exists = media::exists(&history)?;
        let legacy = if !history_exists {
            if let Some(old) = legacy {
                if media::exists(&old.join("history.enc"))? {
                    Some(old)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        let store = if history_exists {
            let info = media::regular(&history)?;
            if info.len() > 512 * 1024 * 1024 {
                return Err("历史文件过大，已保留原文件".into());
            }
            let bytes = crypto::decrypt(&fs::read(&history).map_err(|_| "历史读取失败")?)?;
            let mut value: Value =
                serde_json::from_slice(&bytes).map_err(|_| "历史内容无效，已保留原文件")?;
            if value.get("stringEncoding").and_then(Value::as_str) != Some(crate::utf16::ENCODING) {
                crate::utf16::encode_value(&mut value);
            }
            if let Some(index) = value.get("pixelIndex").and_then(Value::as_object) {
                for (id, key) in index {
                    if media::valid_id(id) {
                        if let Some(key) = key.as_str().filter(|key| media::valid_id(key)) {
                            pixel_index.insert(id.clone(), key.to_owned());
                        }
                    }
                }
            }
            ClipStore::from_snapshot(&value, now())?
        } else if let Some(old) = legacy {
            if fs::canonicalize(old).ok() == fs::canonicalize(&directory).ok() {
                return Err("迁移源目录和目标目录不能相同".into());
            }
            let codec = crypto::LegacyCodec::open(old)?;
            let source = old.join("history.enc");
            if media::regular(&source)?.len() > 512 * 1024 * 1024 {
                return Err("旧版历史过大".into());
            }
            let bytes = codec.decrypt(&fs::read(source).map_err(|_| "旧版历史读取失败")?)?;
            let value =
                crate::utf16::legacy_json(&bytes).map_err(|_| "旧版历史内容无效，已保留原文件")?;
            let store = ClipStore::from_snapshot(&value, now())?;
            for item in &store.items {
                if let Some(image) = &item.image {
                    media.import_legacy(old, &codec, &image.media_id)?;
                }
            }
            migrated = true;
            store
        } else {
            ClipStore::default()
        };
        let committed_media = store
            .items
            .iter()
            .filter_map(|item| item.image.as_ref().map(|image| image.media_id.clone()))
            .collect();
        let mut runtime = Self {
            store,
            media,
            undo: None,
            queue: Vec::new(),
            error: String::new(),
            events: false,
            capture_blocked: false,
            dark: false,
            shortcut: String::new(),
            stack_shortcut: false,
            last_sequence: 0,
            last_signature: String::new(),
            capture_epoch: 0,
            dirty: false,
            directory,
            committed_media,
            updates: Updates::default(),
        };
        runtime
            .media
            .restore_index(&pixel_index, &runtime.store.items);
        let previous_count = runtime.store.items.len();
        runtime.store.prune(now());
        if migrated || previous_count != runtime.store.items.len() {
            runtime.save()?;
        }
        runtime.collect();
        Ok(runtime)
    }
    pub fn save(&mut self) -> Result<(), String> {
        let bytes = serde_json::to_vec(&Saved {
            snapshot: &self.store,
            string_encoding: crate::utf16::ENCODING,
            pixel_index: self.media.saved_index(
                &self
                    .store
                    .items
                    .iter()
                    .filter_map(|item| item.image.as_ref().map(|image| image.media_id.clone()))
                    .collect(),
            ),
        })
        .map_err(|_| "历史序列化失败")?;
        media::atomic_write(
            &self.directory.join("history.enc"),
            &crypto::encrypt(&bytes)?,
        )?;
        self.dirty = false;
        self.committed_media = self
            .store
            .items
            .iter()
            .filter_map(|item| item.image.as_ref().map(|image| image.media_id.clone()))
            .collect();
        Ok(())
    }
    pub fn collect(&mut self) {
        let mut keep: HashSet<_> = self
            .store
            .items
            .iter()
            .filter_map(|item| item.image.as_ref().map(|image| image.media_id.clone()))
            .collect();
        // 待保存采集可能已淘汰内存中的旧图；磁盘历史仍引用的文件必须等提交后才能删。
        keep.extend(self.committed_media.iter().cloned());
        if let Some(undo) = &self.undo {
            keep.extend(
                undo.before
                    .items
                    .iter()
                    .filter_map(|item| item.image.as_ref().map(|image| image.media_id.clone())),
            );
        }
        if let Err(error) = self.media.collect(&keep) {
            self.error = format!("图片缓存清理暂未完成：{error}");
        }
    }
    pub fn mutate(
        &mut self,
        action: &str,
        ids: &[String],
        value: Option<&Value>,
        configure: impl Fn(&crate::settings::Settings) -> Result<(), String>,
    ) -> Result<(), String> {
        let before = self.store.clone();
        let result = (|| {
            if action == "undo" {
                self.store = self
                    .undo
                    .as_ref()
                    .ok_or("没有可撤销的操作")?
                    .restore(&self.store, now());
            } else {
                self.store.mutate(action, ids, value, now())?;
            }
            if action == "settings" {
                configure(&self.store.settings)?;
            }
            self.save()
        })();
        if let Err(error) = result {
            self.store = before;
            if action == "settings" {
                let _ = configure(&self.store.settings);
            }
            return Err(error);
        }
        if action == "undo" {
            self.undo = None;
        } else if !["settings", "pause"].contains(&action) {
            self.undo = Some(UndoRecord {
                before,
                after_ids: self
                    .store
                    .items
                    .iter()
                    .map(|item| item.id.clone())
                    .collect(),
            });
        }
        if ["pause", "settings"].contains(&action) {
            self.capture_epoch += 1;
        }
        self.collect();
        Ok(())
    }
    pub fn import_image(&mut self, path: &Path) -> Result<String, String> {
        let image = media::load_image(path)?;
        let title = path
            .file_stem()
            .map(|name| crate::utf16::encode_units(&name.encode_wide().collect::<Vec<_>>()))
            .unwrap_or_default();
        let title = prefix(crate::content::trim(&title), 100).into_owned();
        self.commit_image(image, None, Some(title))
    }
    pub fn rotate_image(&mut self, id: &str, rotation: u32) -> Result<String, String> {
        if ![90, 270].contains(&rotation) {
            return Err("旋转角度无效".into());
        }
        let media_id = self
            .store
            .items
            .iter()
            .find(|item| item.id == id)
            .and_then(|item| item.image.as_ref())
            .ok_or("图片不存在")?
            .media_id
            .clone();
        let bytes = self.media.read(&media_id, false)?;
        let image = media::decode(&bytes)?;
        self.commit_image(
            if rotation == 90 {
                image.rotate90()
            } else {
                image.rotate270()
            },
            Some(id),
            None,
        )
    }
    pub fn write_image(
        &mut self,
        image: &image::DynamicImage,
    ) -> Result<crate::store::ImageMetadata, String> {
        let previous = self.media.matching_id(image);
        let metadata = self.media.write_image(image)?;
        // 旧编码的原图丢失后只能重新编码；迁移引用以保留原卡片身份和收藏、分组。
        if let Some(previous) = previous.filter(|id| id != &metadata.media_id) {
            for item in self.store.items.iter_mut().chain(
                self.undo
                    .iter_mut()
                    .flat_map(|undo| undo.before.items.iter_mut()),
            ) {
                if item
                    .image
                    .as_ref()
                    .is_some_and(|image| image.media_id == previous)
                {
                    item.image = Some(metadata.clone());
                }
            }
        }
        Ok(metadata)
    }
    fn commit_image(
        &mut self,
        image: image::DynamicImage,
        id: Option<&str>,
        title: Option<String>,
    ) -> Result<String, String> {
        let before = self.store.clone();
        let mut undo_before = before.clone();
        let before_media = self.media.clone();
        let before_undo = self.undo.clone();
        let result = (|| {
            let metadata = self.write_image(&image)?;
            for item in &mut undo_before.items {
                if let Some(current) = self
                    .store
                    .items
                    .iter()
                    .find(|current| current.id == item.id)
                {
                    item.image = current.image.clone();
                }
            }
            let id = if let Some(id) = id {
                self.store.replace_image(id, metadata, now())?;
                id.to_owned()
            } else {
                if !self.store.add_image(metadata, "ClipShelf", now())? {
                    return Err("图片容量不足，请先清理部分历史".into());
                }
                let item = &mut self.store.items[0];
                if item.title.is_empty() {
                    item.title = title.unwrap_or_default();
                }
                item.id.clone()
            };
            self.save()?;
            Ok(id)
        })();
        match result {
            Ok(id) => {
                self.undo = Some(UndoRecord {
                    before: undo_before,
                    after_ids: self
                        .store
                        .items
                        .iter()
                        .map(|item| item.id.clone())
                        .collect(),
                });
                self.collect();
                Ok(id)
            }
            Err(error) => {
                self.store = before;
                self.media = before_media;
                self.undo = before_undo;
                self.collect();
                Err(error)
            }
        }
    }
    pub fn image(&mut self, id: &str, thumbnail: bool) -> Result<String, String> {
        let media_id = self
            .store
            .items
            .iter()
            .find(|item| item.id == id)
            .and_then(|item| item.image.as_ref())
            .ok_or("图片不存在")?
            .media_id
            .clone();
        Ok(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(self.media.read(&media_id, thumbnail)?.as_ref())
        ))
    }
    pub fn queue_add(&mut self, ids: &[String]) -> Result<(), String> {
        if ids.len() > 2000 {
            return Err("队列内容无效".into());
        }
        self.clean_queue();
        for id in ids {
            if self.store.items.iter().any(|item| &item.id == id)
                && !self.queue.contains(id)
                && self.queue.len() < 2000
            {
                self.queue.push(id.clone());
            }
        }
        Ok(())
    }
    pub fn clean_queue(&mut self) {
        self.queue
            .retain(|id| self.store.items.iter().any(|item| &item.id == id));
    }
    pub fn packet(&mut self, full: bool) -> Value {
        self.clean_queue();
        let mut descriptors = HashMap::new();
        let mut projected = Vec::with_capacity(self.store.items.len());
        for item in &self.store.items {
            let cached = self.updates.bodies.get(&item.id);
            let same = cached.is_some_and(|body| {
                body.text
                    .upgrade()
                    .is_some_and(|text| Arc::ptr_eq(&text, &item.text))
                    && body
                        .html
                        .upgrade()
                        .is_some_and(|html| Arc::ptr_eq(&html, &item.html))
            });
            if !same {
                self.updates.bodies.insert(
                    item.id.clone(),
                    Body {
                        text: Arc::downgrade(&item.text),
                        html: Arc::downgrade(&item.html),
                        digest: format!(
                            "{}:{}",
                            media::hash(item.text.as_bytes()),
                            media::hash(item.html.as_bytes())
                        ),
                        length: crate::utf16::len(&item.text),
                    },
                );
            }
            let body = self.updates.bodies.get(&item.id).expect("已缓存正文");
            let value = project(item, body.length);
            descriptors.insert(item.id.clone(), format!("{value}:{}", body.digest));
            projected.push(value);
        }
        self.updates
            .bodies
            .retain(|id, _| descriptors.contains_key(id));
        let queue:Vec<_>=self.queue.iter().filter_map(|id|self.store.items.iter().find(|item|&item.id==id)).map(|item|json!({"id":item.id,"title":if item.title.is_empty(){if item.image.is_some(){"图片".to_owned()}else{prefix(&item.text,60).into_owned()}}else{item.title.clone()},"kind":item.kind})).collect();
        let mut header = json!({"groups":self.store.groups,"settings":self.store.settings,"paused":self.store.paused,"pauseUntil":self.store.pause_until,"stack":queue,"status":{"version":env!("CARGO_PKG_VERSION"),"shortcut":self.shortcut,"native":true,"events":self.events,"reconnecting":false,"dark":self.dark,"error":self.error,"canUndo":self.undo.is_some(),"startupSupported":true,"captureBlocked":self.capture_blocked,"stackShortcut":self.stack_shortcut}});
        let base = self.updates.revision;
        self.updates.revision += 1;
        header["revision"] = json!(self.updates.revision);
        if full || self.updates.last.is_none() {
            header["items"] = json!(projected);
        } else {
            let previous = self.updates.last.as_ref().unwrap();
            let upserts: Vec<_> = projected
                .into_iter()
                .filter(|item| {
                    let id = item.get("id").and_then(Value::as_str).unwrap_or("");
                    previous.get(id) != descriptors.get(id)
                })
                .collect();
            header["baseRevision"] = json!(base);
            header["patch"] = json!({"upserts":upserts,"order":self.store.items.iter().map(|item|&item.id).collect::<Vec<_>>()});
        }
        self.updates.last = Some(descriptors);
        header
    }
    pub fn revision(&self) -> u64 {
        self.updates.revision
    }
}
fn project(item: &Item, length: usize) -> Value {
    let mut value = json!({"id":item.id,"text":prefix(&item.text,650),"textLength":length,"hasFormatting":!item.html.is_empty(),"title":item.title,"source":item.source,"kind":item.kind,"starred":item.starred,"groups":item.groups,"created":item.created,"updated":item.updated});
    if let Some(image) = &item.image {
        value["mediaId"] = json!(image.media_id);
        value["width"] = json!(image.width);
        value["height"] = json!(image.height);
        value["bytes"] = json!(image.bytes);
    }
    value
}
pub struct PastePayload {
    pub text: String,
    pub html: String,
    pub media_id: Option<String>,
}
pub fn prepare_paste(
    items: &[&Item],
    settings: &crate::settings::Settings,
    plain: bool,
) -> Result<PastePayload, String> {
    if items.is_empty() {
        return Err("内容已删除".into());
    }
    if let Some(image) = items.iter().find_map(|item| item.image.as_ref()) {
        if items.len() != 1 {
            return Err("图片请单独粘贴；文字可以多选组合".into());
        }
        return Ok(PastePayload {
            text: String::new(),
            html: String::new(),
            media_id: Some(image.media_id.clone()),
        });
    }
    let text = items
        .iter()
        .map(|item| item.text.as_ref())
        .collect::<Vec<_>>()
        .join(&settings.separator);
    if crate::utf16::bytes(&text) > 4 * 1024 * 1024 {
        return Err("一次最多复制 4 MiB，请减少选中内容".into());
    }
    Ok(PastePayload {
        text,
        html: if items.len() == 1 && !plain && !settings.always_plain_text {
            items[0].html.to_string()
        } else {
            String::new()
        },
        media_id: None,
    })
}
