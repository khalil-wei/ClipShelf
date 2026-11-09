use image::{DynamicImage, ImageFormat};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::{
    ffi::c_void,
    path::{Path, PathBuf},
    sync::{mpsc::Sender, OnceLock},
    time::Duration,
};

type Handle = isize;
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Point {
    x: i32,
    y: i32,
}
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}
#[repr(C)]
#[derive(Default)]
struct MonitorInfo {
    size: u32,
    monitor: Rect,
    work: Rect,
    flags: u32,
}
#[repr(C)]
struct Message {
    hwnd: Handle,
    message: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    point: Point,
    private: u32,
}
#[repr(C)]
struct WindowClass {
    style: u32,
    proc: Option<unsafe extern "system" fn(Handle, u32, usize, isize) -> isize>,
    class_extra: i32,
    window_extra: i32,
    instance: Handle,
    icon: Handle,
    cursor: Handle,
    background: Handle,
    menu: *const u16,
    name: *const u16,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Keyboard {
    key: u16,
    scan: u16,
    flags: u32,
    time: u32,
    extra: usize,
}
#[repr(C)]
union InputData {
    keyboard: Keyboard,
    pad: [u64; 4],
}
#[repr(C)]
struct Input {
    kind: u32,
    data: InputData,
}
#[repr(C)]
struct OpenFile {
    size: u32,
    owner: Handle,
    instance: Handle,
    filter: *const u16,
    custom_filter: *mut u16,
    max_custom: u32,
    filter_index: u32,
    file: *mut u16,
    max_file: u32,
    file_title: *mut u16,
    max_title: u32,
    initial_dir: *const u16,
    title: *const u16,
    flags: u32,
    offset: u16,
    extension: u16,
    default_extension: *const u16,
    custom: isize,
    hook: usize,
    template: *const u16,
    reserved: *mut c_void,
    reserved2: u32,
    flags_ex: u32,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn OpenClipboard(owner: Handle) -> i32;
    fn CloseClipboard() -> i32;
    fn EmptyClipboard() -> i32;
    fn GetClipboardData(format: u32) -> Handle;
    fn SetClipboardData(format: u32, data: Handle) -> Handle;
    fn IsClipboardFormatAvailable(format: u32) -> i32;
    fn RegisterClipboardFormatW(name: *const u16) -> u32;
    fn GetClipboardSequenceNumber() -> u32;
    fn GetClipboardOwner() -> Handle;
    fn GetWindowThreadProcessId(window: Handle, pid: *mut u32) -> u32;
    fn GetForegroundWindow() -> Handle;
    fn GetAsyncKeyState(key: i32) -> i16;
    fn IsWindow(window: Handle) -> i32;
    fn SetForegroundWindow(window: Handle) -> i32;
    fn IsIconic(window: Handle) -> i32;
    fn ShowWindow(window: Handle, command: i32) -> i32;
    fn SendInput(count: u32, inputs: *const Input, size: i32) -> u32;
    fn SendMessageTimeoutW(
        window: Handle,
        message: u32,
        wparam: usize,
        lparam: isize,
        flags: u32,
        timeout: u32,
        result: *mut usize,
    ) -> isize;
    fn MonitorFromWindow(window: Handle, flags: u32) -> Handle;
    fn MonitorFromPoint(point: Point, flags: u32) -> Handle;
    fn GetMonitorInfoW(monitor: Handle, info: *mut MonitorInfo) -> i32;
    fn GetCursorPos(point: *mut Point) -> i32;
    fn GetDpiForWindow(window: Handle) -> u32;
    fn RegisterClassW(class: *const WindowClass) -> u16;
    fn CreateWindowExW(
        ex: u32,
        class: *const u16,
        name: *const u16,
        style: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: Handle,
        menu: Handle,
        instance: Handle,
        param: *mut c_void,
    ) -> Handle;
    fn AddClipboardFormatListener(window: Handle) -> i32;
    fn GetMessageW(message: *mut Message, window: Handle, min: u32, max: u32) -> i32;
    fn TranslateMessage(message: *const Message) -> i32;
    fn DispatchMessageW(message: *const Message) -> isize;
    fn DefWindowProcW(window: Handle, message: u32, wparam: usize, lparam: isize) -> isize;
    fn MessageBoxW(window: Handle, text: *const u16, title: *const u16, kind: u32) -> i32;
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GlobalAlloc(flags: u32, size: usize) -> Handle;
    fn GlobalLock(memory: Handle) -> *mut u8;
    fn GlobalUnlock(memory: Handle) -> i32;
    fn GlobalSize(memory: Handle) -> usize;
    fn GlobalFree(memory: Handle) -> Handle;
    fn GetModuleHandleW(name: *const u16) -> Handle;
    fn GetDriveTypeW(root: *const u16) -> u32;
    fn QueryDosDeviceW(name: *const u16, target: *mut u16, length: u32) -> u32;
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
    fn QueryFullProcessImageNameW(
        process: Handle,
        flags: u32,
        name: *mut u16,
        size: *mut u32,
    ) -> i32;
    fn CloseHandle(handle: Handle) -> i32;
}
#[link(name = "shell32")]
unsafe extern "system" {
    fn DragQueryFileW(drop: Handle, index: u32, file: *mut u16, count: u32) -> u32;
}
#[link(name = "shcore")]
unsafe extern "system" {
    fn GetDpiForMonitor(monitor: Handle, kind: u32, x: *mut u32, y: *mut u32) -> i32;
}
#[link(name = "comdlg32")]
unsafe extern "system" {
    fn GetOpenFileNameW(file: *mut OpenFile) -> i32;
    fn GetSaveFileNameW(file: *mut OpenFile) -> i32;
    fn CommDlgExtendedError() -> u32;
}
#[link(name = "advapi32")]
unsafe extern "system" {
    fn RegOpenKeyExW(
        key: Handle,
        subkey: *const u16,
        options: u32,
        access: u32,
        result: *mut Handle,
    ) -> i32;
    fn RegCreateKeyExW(
        key: Handle,
        subkey: *const u16,
        reserved: u32,
        class: *mut u16,
        options: u32,
        access: u32,
        security: usize,
        result: *mut Handle,
        disposition: *mut u32,
    ) -> i32;
    fn RegQueryValueExW(
        key: Handle,
        name: *const u16,
        reserved: usize,
        kind: *mut u32,
        data: *mut u8,
        size: *mut u32,
    ) -> i32;
    fn RegSetValueExW(
        key: Handle,
        name: *const u16,
        reserved: u32,
        kind: u32,
        data: *const u8,
        size: u32,
    ) -> i32;
    fn RegDeleteValueW(key: Handle, name: *const u16) -> i32;
    fn RegCloseKey(key: Handle) -> i32;
}
pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}
pub fn sequence() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}
pub fn foreground() -> isize {
    unsafe { GetForegroundWindow() }
}
pub fn key_down(key: i32) -> bool {
    unsafe { GetAsyncKeyState(key) < 0 }
}
pub fn error_dialog(text: &str) {
    unsafe {
        MessageBoxW(0, wide(text).as_ptr(), wide("ClipShelf").as_ptr(), 0x10);
    }
}
pub fn format(name: &str) -> u32 {
    unsafe { RegisterClipboardFormatW(wide(name).as_ptr()) }
}
pub fn source() -> String {
    unsafe {
        let mut pid = 0;
        GetWindowThreadProcessId(GetClipboardOwner(), &mut pid);
        let process = OpenProcess(0x1000, 0, pid);
        if process == 0 {
            return String::new();
        }
        let mut name = vec![0u16; 32768];
        let mut size = name.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, name.as_mut_ptr(), &mut size);
        CloseHandle(process);
        if ok == 0 {
            return String::new();
        }
        Path::new(&crate::utf16::encode_units(&name[..size as usize]))
            .file_stem()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default()
    }
}
struct Clipboard;
impl Clipboard {
    fn open(owner: isize) -> Result<Self, String> {
        for _ in 0..10 {
            if unsafe { OpenClipboard(owner) } != 0 {
                return Ok(Self);
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Err("剪贴板正被其他应用占用，请重试".into())
    }
}
impl Drop for Clipboard {
    fn drop(&mut self) {
        unsafe {
            CloseClipboard();
        }
    }
}
fn available(id: u32) -> bool {
    unsafe { IsClipboardFormatAvailable(id) != 0 }
}
fn raw(id: u32, limit: usize) -> Result<Vec<u8>, String> {
    unsafe {
        let memory = GetClipboardData(id);
        if memory == 0 {
            return Err("剪贴板格式暂不可读".into());
        }
        let size = GlobalSize(memory);
        if size > limit {
            return Err("剪贴板内容过大".into());
        }
        let pointer = GlobalLock(memory);
        if pointer.is_null() {
            return Err("剪贴板数据无法锁定".into());
        }
        let bytes = std::slice::from_raw_parts(pointer, size).to_vec();
        GlobalUnlock(memory);
        Ok(bytes)
    }
}
fn put(id: u32, bytes: &[u8]) -> Result<(), String> {
    unsafe {
        let memory = GlobalAlloc(0x42, bytes.len());
        if memory == 0 {
            return Err("剪贴板分配失败".into());
        }
        let pointer = GlobalLock(memory);
        if pointer.is_null() {
            GlobalFree(memory);
            return Err("剪贴板分配失败".into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer, bytes.len());
        GlobalUnlock(memory);
        // 成功后内存归系统；失败时仍由本进程释放。
        if SetClipboardData(id, memory) == 0 {
            GlobalFree(memory);
            return Err("剪贴板写入失败".into());
        }
        Ok(())
    }
}
pub fn ignored(settings: &crate::settings::Settings, source: &str) -> Option<&'static str> {
    let normalize = |text: &str| {
        let text = crate::content::trim(text).to_lowercase();
        text.strip_suffix(".exe").unwrap_or(&text).to_owned()
    };
    let source = normalize(source);
    if !settings.ignored_apps.is_empty() && source.is_empty() {
        return Some("unknown-source");
    }
    if settings
        .ignored_apps
        .iter()
        .any(|app| normalize(app) == source)
    {
        return Some("application");
    }
    None
}
pub enum Packet {
    Text { text: String, html: String },
    Image(DynamicImage),
}
pub fn read(settings: &crate::settings::Settings) -> Result<Option<Packet>, String> {
    let clipboard = Clipboard::open(0)?;
    let mut file_image = None;
    if settings.ignore_confidential {
        if available(format("ExcludeClipboardContentFromMonitorProcessing")) {
            return Ok(None);
        }
        let id = format("CanIncludeInClipboardHistory");
        if available(id) {
            let bytes = raw(id, 1024)?;
            if bytes.len() >= 4 && bytes[..4] == [0, 0, 0, 0] {
                return Ok(None);
            }
        }
    }
    if settings.capture_images {
        for id in [format("PNG"), format("image/png")] {
            if available(id) {
                let bytes = raw(id, 16 * 1024 * 1024)?;
                // 系统剪贴板锁只保护句柄复制；解码和磁盘 I/O 必须放在释放之后。
                drop(clipboard);
                return Ok(Some(Packet::Image(crate::media::decode(&bytes)?)));
            }
        }
        for id in [17, 8] {
            if available(id) {
                let bytes = raw(id, 128_000_256)?;
                drop(clipboard);
                return Ok(Some(Packet::Image(decode_dib(&bytes)?)));
            }
        }
        if available(15) {
            let path = unsafe {
                let drop = GetClipboardData(15);
                if DragQueryFileW(drop, u32::MAX, std::ptr::null_mut(), 0) == 1 {
                    let count = DragQueryFileW(drop, 0, std::ptr::null_mut(), 0);
                    if count < 32768 {
                        let mut name = vec![0u16; count as usize + 1];
                        DragQueryFileW(drop, 0, name.as_mut_ptr(), count + 1);
                        Some(PathBuf::from(std::ffi::OsString::from_wide(
                            &name[..count as usize],
                        )))
                    } else {
                        None
                    }
                } else {
                    None
                }
            };
            if let Some(path) = path {
                let extension = path
                    .extension()
                    .map(|x| x.to_string_lossy().to_ascii_lowercase())
                    .unwrap_or_default();
                let name = path.to_string_lossy();
                let name = name.as_bytes();
                // 被动采集只接受本地盘符路径，不能因剪贴板文件名访问网络共享。
                let local = name.len() >= 3
                    && name[0].is_ascii_alphabetic()
                    && name[1] == b':'
                    && [b'\\', b'/'].contains(&name[2]);
                if ["png", "jpg", "jpeg"].contains(&extension.as_str()) && local {
                    file_image = Some(path);
                }
            }
        }
    }
    let text = if available(13) {
        let bytes = raw(13, 2 * 1024 * 1024 + 4096)?;
        let units: Vec<_> = bytes
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .take_while(|u| *u != 0)
            .collect();
        crate::utf16::encode_units(&units)
    } else {
        String::new()
    };
    if crate::utf16::bytes(&text) > 1024 * 1024 {
        return Err("文本超过 1 MiB，未保存".into());
    }
    let html_id = format("HTML Format");
    let html = if available(html_id)
        && unsafe { GlobalSize(GetClipboardData(html_id)) } <= 2 * 1024 * 1024
    {
        parse_html(&raw(html_id, 2 * 1024 * 1024)?)
    } else {
        String::new()
    };
    drop(clipboard);
    if let Some(path) = file_image.filter(|path| local_capture_path(path)) {
        return Ok(Some(Packet::Image(crate::media::load_image(&path)?)));
    }
    // 富文本超限只去掉格式，不应连同合规纯文本一起丢弃。
    Ok(Some(Packet::Text {
        text,
        html: if crate::utf16::bytes(&html) <= 1024 * 1024 {
            html
        } else {
            String::new()
        },
    }))
}
fn local_capture_path(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    let units: Vec<_> = path.as_os_str().encode_wide().collect();
    if units.len() < 3 {
        return false;
    }
    let root = [units[0], 58, 92, 0];
    let drive = [units[0], 58, 0];
    let mut device = [0u16; 1024];
    unsafe {
        if ![2, 3, 5, 6].contains(&GetDriveTypeW(root.as_ptr())) {
            return false;
        }
        if QueryDosDeviceW(drive.as_ptr(), device.as_mut_ptr(), device.len() as u32) == 0 {
            return false;
        }
    }
    let device = String::from_utf16_lossy(
        &device[..device.iter().position(|c| *c == 0).unwrap_or(device.len())],
    );
    if !device.starts_with("\\Device\\")
        || device.contains("\\Mup")
        || device.contains("\\LanmanRedirector")
    {
        return false;
    }
    // 从盘符向下检查，不能先访问已穿过 junction 的深层路径再回查父目录。
    let mut current = PathBuf::new();
    let components: Vec<_> = path.components().collect();
    for component in components.iter().take(components.len().saturating_sub(1)) {
        if matches!(component, std::path::Component::ParentDir) {
            return false;
        }
        current.push(component.as_os_str());
        if matches!(
            component,
            std::path::Component::RootDir | std::path::Component::Normal(_)
        ) {
            let Ok(metadata) = std::fs::symlink_metadata(&current) else {
                return false;
            };
            if metadata.file_attributes() & 0x400 != 0 {
                return false;
            }
        }
    }
    true
}
pub fn parse_html(bytes: &[u8]) -> String {
    fn offset(bytes: &[u8], key: &str) -> Option<usize> {
        let header = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
        header
            .lines()
            .find_map(|line| line.strip_prefix(key)?.trim().parse().ok())
    }
    if let (Some(start), Some(end)) = (offset(bytes, "StartHTML:"), offset(bytes, "EndHTML:")) {
        if start <= end && end <= bytes.len() {
            return crate::utf16::encode(&String::from_utf8_lossy(&bytes[start..end]));
        }
    }
    String::new()
}
pub fn html_bytes(html: &str) -> Vec<u8> {
    let html = crate::utf16::lossy(html);
    let body = if html.to_lowercase().contains("<html") {
        html.to_owned()
    } else {
        format!("<html><body><!--StartFragment-->{html}<!--EndFragment--></body></html>")
    };
    let template="Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:0000000000\r\nEndFragment:0000000000\r\n";
    let start = template.len();
    let end = start + body.len();
    let fragment = start
        + body
            .find("<!--StartFragment-->")
            .map(|i| i + 20)
            .unwrap_or(0);
    let fragment_end = start + body.find("<!--EndFragment-->").unwrap_or(body.len());
    let mut bytes=format!("Version:0.9\r\nStartHTML:{start:010}\r\nEndHTML:{end:010}\r\nStartFragment:{fragment:010}\r\nEndFragment:{fragment_end:010}\r\n{body}").into_bytes();
    bytes.push(0);
    bytes
}
pub fn write_text(owner: isize, text: &str, html: &str) -> Result<u32, String> {
    let _clipboard = Clipboard::open(owner)?;
    if unsafe { EmptyClipboard() } == 0 {
        return Err("无法清空剪贴板".into());
    }
    let bytes: Vec<_> = crate::utf16::units(text)
        .into_iter()
        .chain(Some(0))
        .flat_map(u16::to_le_bytes)
        .collect();
    put(13, &bytes)?;
    if !html.is_empty() {
        put(format("HTML Format"), &html_bytes(html))?;
    }
    Ok(sequence())
}
pub fn write_image(owner: isize, image: &DynamicImage) -> Result<u32, String> {
    let png = crate::media::png(image)?;
    let dib = encode_dib(image)?;
    let _clipboard = Clipboard::open(owner)?;
    if unsafe { EmptyClipboard() } == 0 {
        return Err("无法清空剪贴板".into());
    }
    put(format("PNG"), &png)?;
    put(17, &dib)?;
    Ok(sequence())
}
pub fn encode_dib(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 32_000_000 {
        return Err("图片尺寸无效".into());
    }
    let mut out = vec![0u8; 124];
    out[0..4].copy_from_slice(&124u32.to_le_bytes());
    out[4..8].copy_from_slice(&width.to_le_bytes());
    out[8..12].copy_from_slice(&(-(height as i32)).to_le_bytes());
    out[12..14].copy_from_slice(&1u16.to_le_bytes());
    out[14..16].copy_from_slice(&32u16.to_le_bytes());
    out[16..20].copy_from_slice(&3u32.to_le_bytes());
    for (at, mask) in [
        (40, 0x00ff0000u32),
        (44, 0x0000ff00),
        (48, 0x000000ff),
        (52, 0xff000000),
        (56, 0x73524742),
    ] {
        out[at..at + 4].copy_from_slice(&mask.to_le_bytes());
    }
    for pixel in image.to_rgba8().pixels() {
        out.extend([pixel[2], pixel[1], pixel[0], pixel[3]]);
    }
    Ok(out)
}
pub fn decode_dib(dib: &[u8]) -> Result<DynamicImage, String> {
    let value = |at: usize| {
        dib.get(at..at + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
    };
    let header = value(0).ok_or("位图头无效")? as usize;
    if header < 40 || header > dib.len() {
        return Err("位图头无效".into());
    }
    let width = value(4).ok_or("位图宽度无效")? as i32;
    let height = value(8).ok_or("位图高度无效")? as i32;
    if width <= 0
        || height == 0
        || u64::from(width.unsigned_abs()) * u64::from(height.unsigned_abs()) > 32_000_000
    {
        return Err("图片超过 3200 万像素".into());
    }
    let depth = u16::from_le_bytes(dib.get(14..16).ok_or("位图头无效")?.try_into().unwrap());
    let compression = value(16).unwrap_or(0);
    let palette = if depth <= 8 {
        let used = value(32).unwrap_or(0);
        if used == 0 {
            1usize << depth
        } else {
            used as usize
        }
    } else {
        0
    };
    let masks = if header == 40 && compression == 3 {
        12
    } else {
        0
    };
    let offset = header
        .checked_add(masks)
        .and_then(|n| n.checked_add(palette.checked_mul(4)?))
        .ok_or("位图头无效")?;
    if offset > dib.len() {
        return Err("位图数据不完整".into());
    }
    let mut bmp = Vec::with_capacity(dib.len() + 14);
    bmp.extend(b"BM");
    bmp.extend(((dib.len() + 14) as u32).to_le_bytes());
    bmp.extend([0u8; 4]);
    bmp.extend(((offset + 14) as u32).to_le_bytes());
    bmp.extend(dib);
    image::load_from_memory_with_format(&bmp, ImageFormat::Bmp)
        .map_err(|_| "无法解码剪贴板位图".into())
}
pub fn paste(target: isize, shelf: isize) -> Result<(), String> {
    if target == 0 || unsafe { IsWindow(target) } == 0 {
        return Err("目标窗口已失效".into());
    }
    let mut released = false;
    for _ in 0..200 {
        if ![1, 2, 0x10, 0x11, 0x12, 0x5b, 0x5c, 0x0d, 0x56, 0x50]
            .iter()
            .any(|key| key_down(*key))
        {
            released = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if !released {
        return Err("请松开鼠标和修饰键后重试".into());
    }
    if foreground() != shelf && foreground() != target {
        return Err("焦点已切换到其他应用，已取消粘贴".into());
    }
    unsafe {
        if IsIconic(target) != 0 {
            ShowWindow(target, 9);
        }
        if foreground() != target {
            SetForegroundWindow(target);
        }
    }
    for _ in 0..60 {
        if foreground() == target {
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    if foreground() != target {
        return Err("无法恢复目标窗口焦点；未向其他窗口发送粘贴".into());
    }
    let mut result = 0;
    if unsafe { SendMessageTimeoutW(target, 0, 0, 0, 3, 300, &mut result) } == 0 {
        return Err("目标窗口暂未响应，已取消粘贴".into());
    }
    if foreground() != target {
        return Err("焦点已切换到其他应用，已取消粘贴".into());
    }
    let key = |key, up| Input {
        kind: 1,
        data: InputData {
            keyboard: Keyboard {
                key,
                scan: 0,
                flags: if up { 2 } else { 0 },
                time: 0,
                extra: 0,
            },
        },
    };
    let inputs = [
        key(0x11, false),
        key(0x56, false),
        key(0x56, true),
        key(0x11, true),
    ];
    let count = unsafe { SendInput(4, inputs.as_ptr(), std::mem::size_of::<Input>() as i32) };
    if count != 4 {
        if count > 0 {
            let release = [key(0x56, true), key(0x11, true)];
            unsafe {
                SendInput(2, release.as_ptr(), std::mem::size_of::<Input>() as i32);
            }
        }
        return Err("系统未接受粘贴按键，请确认目标应用的权限".into());
    }
    Ok(())
}
pub fn work_area(target: isize) -> (i32, i32, i32, i32, f64) {
    unsafe {
        let monitor = if target != 0 {
            MonitorFromWindow(target, 2)
        } else {
            let mut p = Point::default();
            GetCursorPos(&mut p);
            MonitorFromPoint(p, 2)
        };
        let mut info = MonitorInfo {
            size: std::mem::size_of::<MonitorInfo>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return (0, 0, 1400, 900, 1.0);
        }
        let r = info.work;
        let mut dpi = 0;
        let mut y_dpi = 0;
        if GetDpiForMonitor(monitor, 0, &mut dpi, &mut y_dpi) != 0 {
            dpi = if target != 0 {
                GetDpiForWindow(target)
            } else {
                96
            };
        }
        (
            r.left,
            r.top,
            r.right - r.left,
            r.bottom - r.top,
            if dpi == 0 { 1.0 } else { f64::from(dpi) / 96.0 },
        )
    }
}
static EVENTS: OnceLock<Sender<()>> = OnceLock::new();
unsafe extern "system" fn clipboard_proc(
    hwnd: Handle,
    message: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if message == 0x31d {
        if let Some(events) = EVENTS.get() {
            let _ = events.send(());
        }
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}
pub fn listen(events: Sender<()>) -> bool {
    let _ = EVENTS.set(events);
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || unsafe {
        let name = wide("ClipShelfClipboardListener");
        let instance = GetModuleHandleW(std::ptr::null());
        let class = WindowClass {
            style: 0,
            proc: Some(clipboard_proc),
            class_extra: 0,
            window_extra: 0,
            instance,
            icon: 0,
            cursor: 0,
            background: 0,
            menu: std::ptr::null(),
            name: name.as_ptr(),
        };
        RegisterClassW(&class);
        let window = CreateWindowExW(
            0,
            name.as_ptr(),
            name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            -3,
            0,
            instance,
            std::ptr::null_mut(),
        );
        let ok = window != 0 && AddClipboardFormatListener(window) != 0;
        let _ = tx.send(ok);
        if !ok {
            return;
        }
        let mut message: Message = std::mem::zeroed();
        while GetMessageW(&mut message, 0, 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    });
    rx.recv_timeout(Duration::from_secs(3)).unwrap_or(false)
}
pub fn export_name(title: &str, id: &str) -> String {
    let source = if title.is_empty() {
        format!("ClipShelf-{}", crate::utf16::prefix(id, 8))
    } else {
        title.to_owned()
    };
    let mut name = crate::utf16::units(&source);
    for unit in &mut name {
        if *unit < 32 || [60, 62, 58, 34, 47, 92, 124, 63, 42].contains(unit) {
            *unit = 95;
        }
    }
    while name.last().is_some_and(|unit| [46, 32].contains(unit)) {
        name.pop();
    }
    name.truncate(80);
    if name.is_empty() {
        "ClipShelf".into()
    } else {
        crate::utf16::encode_units(&name)
    }
}
pub fn choose_file(owner: isize, save: bool, default: &str) -> Result<Option<PathBuf>, String> {
    let mut buffer = vec![0u16; 32768];
    let initial: Vec<_> = crate::utf16::units(default)
        .into_iter()
        .chain(Some(0))
        .collect();
    let count = initial.len().min(buffer.len() - 1);
    buffer[..count].copy_from_slice(&initial[..count]);
    let filter = wide(if save {
        "PNG 图片\0*.png\0\0"
    } else {
        "PNG / JPEG 图片\0*.png;*.jpg;*.jpeg\0\0"
    });
    let title = wide(if save {
        "图片另存为"
    } else {
        "导入本地图片"
    });
    let extension = wide("png");
    let mut file: OpenFile = unsafe { std::mem::zeroed() };
    file.size = std::mem::size_of::<OpenFile>() as u32;
    file.owner = owner;
    file.filter = filter.as_ptr();
    file.filter_index = 1;
    file.file = buffer.as_mut_ptr();
    file.max_file = buffer.len() as u32;
    file.title = title.as_ptr();
    file.default_extension = extension.as_ptr();
    file.flags = 0x80000 | 0x800 | 0x8 | if save { 0x2 } else { 0x1000 };
    let ok = unsafe {
        if save {
            GetSaveFileNameW(&mut file)
        } else {
            GetOpenFileNameW(&mut file)
        }
    };
    if ok == 0 {
        if unsafe { CommDlgExtendedError() } != 0 {
            return Err("文件对话框无法打开".into());
        }
        return Ok(None);
    }
    Ok(Some(PathBuf::from(std::ffi::OsString::from_wide(
        &buffer[..buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len())],
    ))))
}
struct Registry(Handle);
impl Drop for Registry {
    fn drop(&mut self) {
        unsafe {
            RegCloseKey(self.0);
        }
    }
}
fn registry(path: &str, create: bool) -> Result<Registry, String> {
    let mut key = 0;
    let root = 0x80000001u32 as i32 as isize;
    let status = unsafe {
        if create {
            RegCreateKeyExW(
                root,
                wide(path).as_ptr(),
                0,
                std::ptr::null_mut(),
                0,
                0x2001f,
                0,
                &mut key,
                std::ptr::null_mut(),
            )
        } else {
            RegOpenKeyExW(root, wide(path).as_ptr(), 0, 0x20019, &mut key)
        }
    };
    if status != 0 {
        return Err(format!("无法读取 Windows 自启动设置（系统错误 {status}）"));
    }
    Ok(Registry(key))
}
fn registry_value(key: &Registry, name: &str) -> Option<Vec<u8>> {
    let mut size = 0;
    let mut kind = 0;
    if unsafe {
        RegQueryValueExW(
            key.0,
            wide(name).as_ptr(),
            0,
            &mut kind,
            std::ptr::null_mut(),
            &mut size,
        )
    } != 0
        || size > 65536
    {
        return None;
    }
    let mut bytes = vec![0u8; size as usize];
    if unsafe {
        RegQueryValueExW(
            key.0,
            wide(name).as_ptr(),
            0,
            &mut kind,
            bytes.as_mut_ptr(),
            &mut size,
        )
    } != 0
    {
        return None;
    }
    Some(bytes)
}
fn startup_command() -> Result<String, String> {
    Ok(format!(
        "\"{}\" --background",
        crate::utf16::encode_units(
            &std::env::current_exe()
                .map_err(|_| "无法确定程序路径")?
                .as_os_str()
                .encode_wide()
                .collect::<Vec<_>>()
        )
    ))
}
const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED_KEY: &str =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
pub fn startup_read() -> bool {
    startup_read_named("ClipShelf")
}
fn startup_read_named(name: &str) -> bool {
    let Ok(key) = registry(RUN_KEY, false) else {
        return false;
    };
    let Some(bytes) = registry_value(&key, name) else {
        return false;
    };
    let units: Vec<_> = bytes
        .chunks_exact(2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .take_while(|u| *u != 0)
        .collect();
    if Some(crate::utf16::encode_units(&units).to_lowercase())
        != startup_command().ok().map(|s| s.to_lowercase())
    {
        return false;
    }
    if let Ok(key) = registry(APPROVED_KEY, false) {
        if let Some(bytes) = registry_value(&key, name) {
            if bytes
                .first()
                .is_some_and(|value| *value == 3 || *value == 7)
            {
                return false;
            }
        }
    }
    true
}
pub fn startup_set(value: bool) -> Result<(), String> {
    startup_set_named("ClipShelf", value)
}
fn registry_set(key: &Registry, name: &str, kind: u32, bytes: Option<&[u8]>) -> Result<(), String> {
    let code = unsafe {
        if let Some(bytes) = bytes {
            RegSetValueExW(
                key.0,
                wide(name).as_ptr(),
                0,
                kind,
                bytes.as_ptr(),
                bytes.len() as u32,
            )
        } else {
            RegDeleteValueW(key.0, wide(name).as_ptr())
        }
    };
    if code == 0 || bytes.is_none() && code == 2 {
        Ok(())
    } else {
        Err("自启动设置未生效".into())
    }
}
fn startup_set_named(name: &str, value: bool) -> Result<(), String> {
    let key = registry(RUN_KEY, true)?;
    let previous = registry_value(&key, name);
    let approved = if value {
        Some(registry(APPROVED_KEY, true)?)
    } else {
        None
    };
    let previous_approved = approved.as_ref().and_then(|key| registry_value(key, name));
    let result = (|| {
        if let Some(approved) = &approved {
            let bytes: Vec<_> = crate::utf16::units(&startup_command()?)
                .into_iter()
                .chain(Some(0))
                .flat_map(u16::to_le_bytes)
                .collect();
            registry_set(&key, name, 1, Some(&bytes))?;
            let mut enabled = [0u8; 12];
            enabled[0] = 2;
            registry_set(approved, name, 3, Some(&enabled))?;
        } else {
            let command: Vec<_> = crate::utf16::units(&startup_command()?)
                .into_iter()
                .chain(Some(0))
                .flat_map(u16::to_le_bytes)
                .collect();
            if previous.as_deref() == Some(&command) {
                registry_set(&key, name, 1, None)?;
            }
        }
        if startup_read_named(name) != value {
            return Err("自启动设置未生效，请检查 Windows 启动应用设置".into());
        }
        Ok(())
    })();
    if result.is_err() {
        // Run 和 StartupApproved 必须一起成功；不能在失败时留下半启用的启动项。
        let _ = registry_set(&key, name, 1, previous.as_deref());
        if let Some(approved) = &approved {
            let _ = registry_set(approved, name, 3, previous_approved.as_deref());
        }
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_names_match_javascript_utf16_and_sanitizing_order() {
        assert_eq!(export_name("", "123456789"), "ClipShelf-12345678");
        assert_eq!(export_name("<>\u{7f}. ", "id"), "__\u{7f}");
        assert_eq!(export_name("... ", "id"), "ClipShelf");
        let title = crate::utf16::encode(&format!("{}😀", "a".repeat(79)));
        let result = crate::utf16::units(&export_name(&title, "id"));
        assert_eq!(result.len(), 80);
        assert_eq!(result[79], 0xd83d);
        let marker = crate::utf16::encode(&"\u{e000}".repeat(90));
        assert_eq!(
            crate::utf16::units(&export_name(&marker, "id")),
            vec![0xe000; 80]
        );
    }
    #[test]
    fn input_layout_and_cf_html_use_windows_byte_offsets() {
        assert_eq!(std::mem::size_of::<Input>(), 40);
        let html = "<b>合成测试 😀</b>";
        let bytes = html_bytes(html);
        assert!(parse_html(&bytes).contains(html));
    }
    #[test]
    fn dib_roundtrip_preserves_dimensions_and_color() {
        let source = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            2,
            3,
            image::Rgba([12, 34, 56, 255]),
        ));
        let bytes = encode_dib(&source).unwrap();
        let image = decode_dib(&bytes).unwrap();
        assert_eq!((image.width(), image.height()), (2, 3));
        assert_eq!(image.to_rgba8().get_pixel(0, 0).0, [12, 34, 56, 255]);
    }
    #[test]
    fn privacy_keeps_unknown_sources_closed() {
        let mut settings = crate::settings::Settings::default();
        settings.ignored_apps = vec![" Code.exe ".into()];
        assert_eq!(ignored(&settings, ""), Some("unknown-source"));
        assert_eq!(ignored(&settings, "CODE"), Some("application"));
        assert_eq!(ignored(&settings, "Other.exe"), None);
    }
}
