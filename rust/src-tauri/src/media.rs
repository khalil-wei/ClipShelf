use crate::{crypto, store::ImageMetadata};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat, ImageReader};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn pixel_key(image: &DynamicImage) -> Option<String> {
    // 高位深不能量化后合并，仍按完整 PNG 哈希去重。
    if image.color().bits_per_pixel() > u16::from(image.color().channel_count()) * 8 {
        return None;
    }
    let mut digest = Sha256::new();
    digest.update(image.width().to_le_bytes());
    digest.update(image.height().to_le_bytes());
    if let Some(rgba) = image.as_rgba8() {
        digest.update(rgba.as_raw());
    } else {
        digest.update(image.to_rgba8().as_raw());
    }
    Some(format!("{:x}", digest.finalize()))
}
pub fn regular(path: &Path) -> Result<fs::Metadata, String> {
    use std::os::windows::fs::MetadataExt;
    let meta = fs::symlink_metadata(path).map_err(|_| "文件无法读取")?;
    if !meta.is_file() || meta.file_attributes() & 0x400 != 0 {
        return Err("文件不能是链接或目录".into());
    }
    Ok(meta)
}
pub fn exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("无法检查历史文件，已保留原文件".into()),
    }
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name().ok_or("保存路径无效")?.to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|_| "无法创建临时文件")?;
    let result = (|| {
        file.write_all(bytes).map_err(|_| "文件写入失败")?;
        file.sync_all().map_err(|_| "文件同步失败")?;
        Ok::<(), &str>(())
    })();
    drop(file);
    let result = result.and_then(|_| {
        fs::rename(&temp, path).map_err(|_| "文件替换失败，已保留上次成功保存的数据")
    });
    // 只删除本次创建的固定临时文件，启动时另行处理崩溃遗留。
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(str::to_owned)
}
pub fn decode(bytes: &[u8]) -> Result<DynamicImage, String> {
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("图片超过 16 MiB".into());
    }
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "图片格式无效")?;
    if !matches!(reader.format(), Some(ImageFormat::Png | ImageFormat::Jpeg)) {
        return Err("请选择有效的 PNG 或 JPEG 图片".into());
    }
    let (width, height) = reader.into_dimensions().map_err(|_| "图片头无效")?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 32_000_000 {
        return Err("图片超过 3200 万像素".into());
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "图片格式无效")?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(160_000_000);
    reader.limits(limits);
    reader.decode().map_err(|_| "无法解码图片".into())
}
pub fn load_image(path: &Path) -> Result<DynamicImage, String> {
    let before = regular(path)?;
    if before.len() == 0 || before.len() > 16 * 1024 * 1024 {
        return Err("请选择不超过 16 MiB 的图片文件".into());
    }
    let mut file = fs::File::open(path).map_err(|_| "无法打开图片文件")?;
    let mut bytes = Vec::new();
    (&mut file)
        .take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "图片读取失败")?;
    let after = file.metadata().map_err(|_| "无法检查图片文件")?;
    if bytes.len() as u64 != before.len()
        || after.len() != before.len()
        || after.modified().ok() != before.modified().ok()
    {
        return Err("图片文件正在变化，请稍后重试".into());
    }
    decode(&bytes)
}
pub fn png(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let mut out = Cursor::new(Vec::new());
    image
        .write_to(&mut out, ImageFormat::Png)
        .map_err(|_| "图片编码失败")?;
    Ok(out.into_inner())
}
#[derive(Clone)]
pub struct MediaStore {
    directory: PathBuf,
    pixel_ids: HashMap<String, ImageMetadata>,
    cache: HashMap<String, Arc<Vec<u8>>>,
    order: VecDeque<String>,
}
impl MediaStore {
    pub fn open(directory: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&directory).map_err(|_| "无法创建图片目录")?;
        use std::os::windows::fs::MetadataExt;
        if fs::symlink_metadata(&directory)
            .map_err(|_| "图片目录无效")?
            .file_attributes()
            & 0x400
            != 0
        {
            return Err("图片目录不能是链接".into());
        }
        Ok(Self {
            directory,
            pixel_ids: HashMap::new(),
            cache: HashMap::new(),
            order: VecDeque::new(),
        })
    }
    fn file(&self, id: &str, thumbnail: bool) -> Result<PathBuf, String> {
        if !valid_id(id) {
            return Err("图片标识无效".into());
        }
        Ok(self
            .directory
            .join(format!("{id}{}.enc", if thumbnail { ".thumb" } else { "" })))
    }
    pub fn write_image(&mut self, image: &DynamicImage) -> Result<ImageMetadata, String> {
        if u64::from(image.width()) * u64::from(image.height()) > 32_000_000 {
            return Err("图片超过 3200 万像素".into());
        }
        let pixel_key = pixel_key(image);
        if let Some(metadata) = pixel_key
            .as_ref()
            .and_then(|key| self.pixel_ids.get(key))
            .cloned()
        {
            let full = self.file(&metadata.media_id, false)?;
            let thumb = self.file(&metadata.media_id, true)?;
            if exists(&full)? && exists(&thumb)? {
                self.read(&metadata.media_id, false)?;
                self.read(&metadata.media_id, true)?;
                return Ok(metadata);
            }
        }
        let full = png(image)?;
        if full.len() > 16 * 1024 * 1024 {
            return Err("图片超过 16 MiB".into());
        }
        let thumb = png(&image.thumbnail(320, 320))?;
        if thumb.len() > 512 * 1024 {
            return Err("缩略图超过 512 KiB".into());
        }
        let id = hash(&full);
        for (bytes, small) in [(&full, false), (&thumb, true)] {
            let target = self.file(&id, small)?;
            if target.exists() {
                self.read(&id, small)?;
            } else {
                atomic_write(&target, &crypto::encrypt(bytes)?)?;
            }
        }
        let metadata = ImageMetadata {
            media_id: id,
            width: f64::from(image.width()),
            height: f64::from(image.height()),
            bytes: full.len() as f64,
        };
        if let Some(key) = pixel_key {
            self.pixel_ids.insert(key, metadata.clone());
        }
        Ok(metadata)
    }
    pub fn matching_id(&self, image: &DynamicImage) -> Option<String> {
        pixel_key(image)
            .and_then(|key| self.pixel_ids.get(&key).map(|image| image.media_id.clone()))
    }
    pub fn restore_index(&mut self, index: &HashMap<String, String>, items: &[crate::store::Item]) {
        for item in items {
            if let Some(metadata) = &item.image {
                if let Some(key) = index.get(&metadata.media_id).filter(|key| valid_id(key)) {
                    self.pixel_ids
                        .entry(key.clone())
                        .or_insert_with(|| metadata.clone());
                }
            }
        }
    }
    pub fn saved_index(&self, keep: &HashSet<String>) -> HashMap<String, String> {
        self.pixel_ids
            .iter()
            .filter(|(_, metadata)| keep.contains(&metadata.media_id))
            .map(|(key, metadata)| (metadata.media_id.clone(), key.clone()))
            .collect()
    }
    pub fn read(&mut self, id: &str, thumbnail: bool) -> Result<Arc<Vec<u8>>, String> {
        let key = format!("{id}:{thumbnail}");
        if thumbnail {
            if let Some(bytes) = self.cache.get(&key) {
                self.order.retain(|old| old != &key);
                self.order.push_back(key.clone());
                return Ok(bytes.clone());
            }
        }
        let path = self.file(id, thumbnail)?;
        let info = regular(&path)?;
        if info.len() > 24 * 1024 * 1024 {
            return Err("图片文件过大".into());
        }
        let bytes = crypto::decrypt(&fs::read(&path).map_err(|_| "图片读取失败")?)?;
        if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") || (!thumbnail && hash(&bytes) != id) {
            return Err("图片校验失败".into());
        }
        let bytes = Arc::new(bytes);
        if thumbnail {
            self.cache.insert(key.clone(), bytes.clone());
            self.order.push_back(key);
            if self.order.len() > 32 {
                if let Some(old) = self.order.pop_front() {
                    self.cache.remove(&old);
                }
            }
        }
        Ok(bytes)
    }
    pub fn collect(&mut self, keep: &HashSet<String>) -> Result<(), String> {
        for entry in fs::read_dir(&self.directory).map_err(|_| "图片目录读取失败")? {
            let entry = entry.map_err(|_| "图片目录读取失败")?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            let Some(stem) = name.strip_suffix(".enc") else {
                continue;
            };
            let id = stem.strip_suffix(".thumb").unwrap_or(stem);
            if !valid_id(id) || keep.contains(id) || regular(&entry.path()).is_err() {
                continue;
            }
            fs::remove_file(entry.path()).map_err(|_| "图片清理失败")?;
            let key = format!("{id}:true");
            self.cache.remove(&key);
            self.order.retain(|old| old != &key);
        }
        self.pixel_ids
            .retain(|_, image| keep.contains(&image.media_id));
        Ok(())
    }
    pub fn import_legacy(
        &mut self,
        old: &Path,
        codec: &crypto::LegacyCodec,
        id: &str,
    ) -> Result<(), String> {
        for small in [false, true] {
            let name = format!("{id}{}.enc", if small { ".thumb" } else { "" });
            let source = old.join("media").join(name);
            let info = regular(&source)?;
            if info.len() > 32 * 1024 * 1024 {
                return Err("旧版图片文件过大".into());
            }
            let encoded = codec.decrypt(&fs::read(source).map_err(|_| "旧版图片读取失败")?)?;
            let bytes = STANDARD.decode(encoded).map_err(|_| "旧版图片编码无效")?;
            if bytes.len() > if small { 512 * 1024 } else { 16 * 1024 * 1024 } {
                return Err("旧版图片超过容量限制".into());
            }
            if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") || (!small && hash(&bytes) != id) {
                return Err("旧版图片校验失败".into());
            }
            let image = decode(&bytes)?;
            if !small {
                if let Some(key) = pixel_key(&image) {
                    self.pixel_ids.entry(key).or_insert_with(|| ImageMetadata {
                        media_id: id.into(),
                        width: f64::from(image.width()),
                        height: f64::from(image.height()),
                        bytes: bytes.len() as f64,
                    });
                }
            }
            let target = self.file(id, small)?;
            if !target.exists() {
                atomic_write(&target, &crypto::encrypt(&bytes)?)?;
            } else {
                self.read(id, small)?;
            }
        }
        Ok(())
    }
}
