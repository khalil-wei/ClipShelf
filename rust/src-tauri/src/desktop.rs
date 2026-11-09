use crate::{
    media,
    runtime::{now, prepare_paste, Runtime},
    win32,
};
use serde_json::{json, Value};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::{
    path::PathBuf,
    str::FromStr,
    sync::{
        atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, RunEvent, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub struct AppState {
    pub runtime: Mutex<Runtime>,
    busy: AtomicBool,
    queue_busy: AtomicBool,
    modal: AtomicBool,
    showing: AtomicBool,
    hiding: AtomicBool,
    quitting: AtomicBool,
    flushed: AtomicBool,
    target: AtomicIsize,
    visibility: AtomicU64,
    latch: AtomicBool,
    ready: AtomicBool,
    search: AtomicU64,
    smoke: bool,
    operations: crate::serial::Serial,
}
impl AppState {
    fn new(runtime: Runtime, smoke: bool) -> Self {
        Self {
            runtime: Mutex::new(runtime),
            busy: AtomicBool::new(false),
            queue_busy: AtomicBool::new(false),
            modal: AtomicBool::new(false),
            showing: AtomicBool::new(false),
            hiding: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            flushed: AtomicBool::new(false),
            target: AtomicIsize::new(0),
            visibility: AtomicU64::new(0),
            latch: AtomicBool::new(false),
            ready: AtomicBool::new(false),
            search: AtomicU64::new(0),
            smoke,
            operations: crate::serial::Serial::default(),
        }
    }
}
struct Flag<'a>(&'a AtomicBool);
impl Drop for Flag<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
fn state(app: &tauri::AppHandle) -> Arc<AppState> {
    app.state::<Arc<AppState>>().inner().clone()
}
fn shelf(app: &tauri::AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("shelf")
}
fn hwnd(window: &WebviewWindow) -> isize {
    window.hwnd().map(|h| h.0 as isize).unwrap_or(0)
}
pub fn broadcast(app: &tauri::AppHandle) {
    if let Some(window) = shelf(app) {
        if window.is_visible().unwrap_or(false) {
            let s = state(app);
            let packet = s.runtime.lock().unwrap().packet(false);
            let _ = window.emit("state-changed", packet);
        }
    }
}
fn notice_error(app: &tauri::AppHandle, error: String) {
    state(app).runtime.lock().unwrap().error = error;
    broadcast(app);
}
fn emit_packet(app: &tauri::AppHandle, packet: &Value) {
    if let Some(window) = shelf(app) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.emit("state-changed", packet);
        }
    }
}
fn fit(app: &tauri::AppHandle, target: isize, height: Option<f64>) {
    let Some(window) = shelf(app) else {
        return;
    };
    let s = state(app);
    let runtime = s.runtime.lock().unwrap();
    let desired = height.unwrap_or(if runtime.store.settings.compact {
        302.0
    } else {
        f64::from(runtime.store.settings.height)
    });
    drop(runtime);
    let (x, y, width, height, scale) = win32::work_area(target);
    let panel_height = (desired * scale)
        .round()
        .min(f64::from(height) - 16.0 * scale)
        .max(1.0) as u32;
    let panel_width = (f64::from(width) - 24.0 * scale).max(280.0) as u32;
    let position = tauri::PhysicalPosition::new(
        x + (12.0 * scale) as i32,
        y + height - panel_height as i32 - (8.0 * scale) as i32,
    );
    let size = tauri::PhysicalSize::new(panel_width, panel_height);
    if window.inner_size().ok() != Some(size) {
        let _ = window.set_size(size);
    }
    if window.outer_position().ok() != Some(position) {
        let _ = window.set_position(position);
    }
}
fn hide(app: &tauri::AppHandle, immediate: bool) {
    let Some(window) = shelf(app) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    let s = state(app);
    if !immediate && s.hiding.swap(true, Ordering::SeqCst) {
        return;
    }
    let epoch = s.visibility.fetch_add(1, Ordering::SeqCst) + 1;
    let reduce = s.runtime.lock().unwrap().store.settings.reduce_motion;
    let _ = window.emit("shelf-hide", ());
    if immediate || reduce {
        s.hiding.store(false, Ordering::SeqCst);
        let _ = window.hide();
        let _ = window.emit("shelf-suspend", ());
    } else {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(135));
            if s.visibility.load(Ordering::SeqCst) == epoch {
                s.hiding.store(false, Ordering::SeqCst);
                let _ = window.hide();
                let _ = window.emit("shelf-suspend", ());
            }
        });
    }
}
fn show(app: &tauri::AppHandle, target: Option<isize>) {
    let Some(window) = shelf(app) else {
        return;
    };
    let s = state(app);
    if s.busy.load(Ordering::SeqCst)
        || s.modal.load(Ordering::SeqCst)
        || s.quitting.load(Ordering::SeqCst)
    {
        return;
    }
    if window.is_visible().unwrap_or(false) {
        if s.hiding.swap(false, Ordering::SeqCst) {
            s.visibility.fetch_add(1, Ordering::SeqCst);
            let _ = window.emit("shelf-show", json!({"preserve":true}));
            let _ = window.emit("shelf-visible", ());
            let _ = window.set_focus();
            return;
        }
        hide(app, false);
        return;
    }
    if s.showing.swap(true, Ordering::SeqCst) {
        return;
    }
    let _showing = Flag(&s.showing);
    s.visibility.fetch_add(1, Ordering::SeqCst);
    let target = target.filter(|id| *id != hwnd(&window)).unwrap_or(0);
    s.target.store(target, Ordering::SeqCst);
    fit(app, target, None);
    let packet = s.runtime.lock().unwrap().packet(false);
    let _ = window.emit("state-changed", packet);
    let _ = window.emit("shelf-show", json!({}));
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("shelf-visible", ());
}
fn toggle_shortcut(app: tauri::AppHandle) {
    let s = state(&app);
    if s.latch.swap(true, Ordering::SeqCst) {
        return;
    }
    let target = win32::foreground();
    std::thread::spawn(move || {
        let start = Instant::now();
        show(&app, Some(target));
        while win32::key_down(0x56) || start.elapsed() < Duration::from_millis(180) {
            if s.quitting.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        s.latch.store(false, Ordering::SeqCst);
    });
}
fn configure(app: &tauri::AppHandle, next: &crate::settings::Settings) -> Result<(), String> {
    let s = state(app);
    if s.smoke {
        return Ok(());
    }
    let shortcut = Shortcut::from_str(&next.shortcut).map_err(|_| "快捷键无效")?;
    if !app.global_shortcut().is_registered(shortcut) {
        app.global_shortcut()
            .register(shortcut)
            .map_err(|_| format!("{} 已被其他应用占用，请选择其他快捷键", next.shortcut))?;
    }
    if win32::startup_read() != next.open_at_login {
        win32::startup_set(next.open_at_login)?;
    }
    // 新快捷键和系统设置成功后再释放旧键，失败仍可恢复原快捷键。
    for old in ["Ctrl+Shift+V", "Ctrl+Alt+V", "Alt+V"] {
        if old != next.shortcut {
            if let Ok(key) = Shortcut::from_str(old) {
                let _ = app.global_shortcut().unregister(key);
            }
        }
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(format!("ClipShelf · {}", next.shortcut)));
    }
    Ok(())
}
fn use_content(
    app: &tauri::AppHandle,
    ids: &[String],
    copy_only: bool,
    plain: bool,
) -> Result<Value, String> {
    let s = state(app);
    let window = shelf(app).ok_or("面板不存在")?;
    let target = s.target.load(Ordering::SeqCst);
    let (payload, image, shortcut) = {
        let mut runtime = s.runtime.lock().unwrap();
        runtime.capture_epoch += 1;
        let mut seen = std::collections::HashSet::new();
        let selected: Vec<_> = ids
            .iter()
            .filter(|id| seen.insert(*id))
            .filter_map(|id| runtime.store.items.iter().find(|item| &item.id == id))
            .collect();
        let payload = prepare_paste(&selected, &runtime.store.settings, plain)?;
        let image = if let Some(id) = &payload.media_id {
            Some(media::decode(&runtime.media.read(id, false)?)?)
        } else {
            None
        };
        (payload, image, runtime.store.settings.shortcut.clone())
    };
    if s.smoke {
        return Ok(json!({"ok":true,"copied":copy_only,"simulated":true}));
    }
    let seq = if let Some(image) = image {
        win32::write_image(hwnd(&window), &image)?
    } else {
        win32::write_text(hwnd(&window), &payload.text, &payload.html)?
    };
    {
        let mut runtime = s.runtime.lock().unwrap();
        runtime.last_sequence = seq;
        runtime.last_signature = if let Some(id) = &payload.media_id {
            format!("image:{id}")
        } else {
            let html = if payload.html.is_empty() {
                String::new()
            } else {
                win32::parse_html(&win32::html_bytes(&payload.html))
            };
            media::hash(format!("{}\0{html}", payload.text).as_bytes())
        };
    }
    if copy_only {
        return Ok(json!({"ok":true,"copied":true}));
    }
    if target == 0 {
        return Err(format!(
            "已复制。请从目标应用按 {shortcut} 呼出面板，再直接粘贴。"
        ));
    }
    match win32::paste(target, hwnd(&window)) {
        Ok(()) => {
            let mut runtime = s.runtime.lock().unwrap();
            if runtime.error.starts_with("已复制；自动粘贴失败") {
                runtime.error.clear();
            }
            drop(runtime);
            hide(app, true);
            Ok(json!({"ok":true}))
        }
        Err(error) => {
            if !window.is_focused().unwrap_or(false) {
                hide(app, true);
            }
            let error = format!("已复制；自动粘贴失败，可回原窗口按 Ctrl+V。{error}");
            notice_error(app, error.clone());
            Err(error)
        }
    }
}
fn next_queue(
    app: &tauri::AppHandle,
    copy: bool,
    captured_target: Option<isize>,
) -> Result<Value, String> {
    let s = state(app);
    if let Some(target) = captured_target {
        if shelf(app).is_some_and(|window| hwnd(&window) != target) {
            s.target.store(target, Ordering::SeqCst);
        }
    }
    let id = {
        let mut runtime = s.runtime.lock().unwrap();
        runtime.clean_queue();
        runtime.queue.first().cloned().ok_or("顺序粘贴队列为空")?
    };
    let result = use_content(app, std::slice::from_ref(&id), copy, false)?;
    if result.get("ok").and_then(Value::as_bool) == Some(true) {
        let mut runtime = s.runtime.lock().unwrap();
        if runtime.queue.first() == Some(&id) {
            runtime.queue.remove(0);
        }
    }
    broadcast(app);
    Ok(result)
}
fn ids(value: Option<&Value>) -> Result<Vec<String>, String> {
    match value {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::String(id)) => Ok(vec![id.clone()]),
        Some(Value::Array(values)) if values.len() <= 2000 => values
            .iter()
            .map(|id| id.as_str().map(str::to_owned).ok_or("内容标识无效".into()))
            .collect(),
        _ => Err("内容标识无效".into()),
    }
}
fn string<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or("")
}
fn dispatch(app: &tauri::AppHandle, command: &str, args: &Value) -> Result<Value, String> {
    let s = state(app);
    match command {
        "state" => {
            let mut runtime = s.runtime.lock().unwrap();
            if !s.smoke {
                runtime.store.settings.open_at_login = win32::startup_read();
            }
            Ok(runtime.packet(true))
        }
        "ready" => {
            if !s.ready.swap(true, Ordering::SeqCst)
                && !std::env::args().any(|arg| arg == "--background")
            {
                show(app, None);
            }
            Ok(json!({"ok":true}))
        }
        "text" => {
            let runtime = s.runtime.lock().unwrap();
            let item = runtime
                .store
                .items
                .iter()
                .find(|item| item.id == string(args, "id"))
                .ok_or("内容已删除")?;
            Ok(json!({"ok":true,"text":item.text}))
        }
        "mutate" => {
            let action = string(args, "action");
            let ids = ids(args.get("id"))?;
            let mut runtime = s.runtime.lock().unwrap();
            let capture_was_enabled = runtime.store.settings.capture_images;
            runtime.mutate(action, &ids, args.get("value"), |settings| {
                configure(app, settings)
            })?;
            runtime.shortcut = runtime.store.settings.shortcut.clone();
            if ["pause", "settings"].contains(&action) {
                runtime.last_signature.clear();
                runtime.last_sequence =
                    if !capture_was_enabled && runtime.store.settings.capture_images {
                        0
                    } else {
                        win32::sequence()
                    };
            }
            let packet = runtime.packet(false);
            drop(runtime);
            emit_packet(app, &packet);
            if action == "settings" || action == "undo" {
                fit(app, s.target.load(Ordering::SeqCst), None);
            }
            Ok(json!({"ok":true,"state":packet}))
        }
        "image" => {
            let data = s.runtime.lock().unwrap().image(
                string(args, "id"),
                args.get("thumbnail")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            )?;
            Ok(json!({"ok":true,"dataUrl":data}))
        }
        "image-rotate" => {
            let rotation = args
                .get("rotation")
                .and_then(Value::as_u64)
                .and_then(|n| u32::try_from(n).ok())
                .ok_or("旋转角度无效")?;
            let mut runtime = s.runtime.lock().unwrap();
            runtime.rotate_image(string(args, "id"), rotation)?;
            let packet = runtime.packet(false);
            drop(runtime);
            emit_packet(app, &packet);
            Ok(json!({"ok":true,"state":packet}))
        }
        "image-import" | "image-export" => {
            if s.smoke {
                return Ok(json!({"ok":true,"canceled":true}));
            }
            let window = shelf(app).ok_or("面板不存在")?;
            let export = command == "image-export";
            let (default, bytes) = if export {
                let mut runtime = s.runtime.lock().unwrap();
                let item = runtime
                    .store
                    .items
                    .iter()
                    .find(|item| item.id == string(args, "id"))
                    .ok_or("图片不存在")?;
                let image = item.image.as_ref().ok_or("图片不存在")?.media_id.clone();
                let name = win32::export_name(&item.title, &item.id);
                let path = app
                    .path()
                    .picture_dir()
                    .unwrap_or_else(|_| {
                        std::env::var_os("USERPROFILE")
                            .map(PathBuf::from)
                            .unwrap_or_default()
                            .join("Pictures")
                    })
                    .join(std::ffi::OsString::from_wide(&crate::utf16::units(
                        &format!("{name}.png"),
                    )));
                (
                    crate::utf16::encode_units(&path.as_os_str().encode_wide().collect::<Vec<_>>()),
                    Some(runtime.media.read(&image, false)?),
                )
            } else {
                (String::new(), None)
            };
            let Some(path) = win32::choose_file(hwnd(&window), export, &default)? else {
                return Ok(json!({"ok":true,"canceled":true}));
            };
            // 不等待用户关对话框，但用户确认后的文件写盘必须在退出保存屏障之前完成。
            let ticket = s.operations.issue().ok_or("应用正在退出")?;
            let _turn = s.operations.wait(ticket);
            if s.quitting.load(Ordering::SeqCst) {
                return Err("应用正在退出".into());
            }
            if let Some(bytes) = bytes {
                std::fs::write(path, bytes.as_ref()).map_err(|_| "图片导出失败")?;
                Ok(json!({"ok":true}))
            } else {
                let mut runtime = s.runtime.lock().unwrap();
                if s.quitting.load(Ordering::SeqCst) {
                    return Err("应用正在退出".into());
                }
                let id = runtime.import_image(&path)?;
                let packet = runtime.packet(false);
                drop(runtime);
                emit_packet(app, &packet);
                Ok(json!({"ok":true,"id":id,"state":packet}))
            }
        }
        "use" => use_content(
            app,
            &ids(args.get("id"))?,
            args.get("copyOnly")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            args.get("plain").and_then(Value::as_bool).unwrap_or(false),
        ),
        "stack" => {
            let action = string(args, "action");
            if ["next", "copy"].contains(&action) {
                return next_queue(app, action == "copy", None);
            }
            let mut runtime = s.runtime.lock().unwrap();
            if s.busy.load(Ordering::SeqCst) || s.queue_busy.load(Ordering::SeqCst) {
                return Err("正在粘贴，请稍候".into());
            }
            match action {
                "add" => runtime.queue_add(&ids(args.get("ids"))?)?,
                "clear" => runtime.queue.clear(),
                "reverse" => runtime.queue.reverse(),
                _ => return Err("队列操作无效".into()),
            }
            drop(runtime);
            broadcast(app);
            Ok(json!({"ok":true}))
        }
        "hide" => {
            hide(app, false);
            Ok(json!({"ok":true}))
        }
        "smoke-exit" if s.smoke => {
            app.exit(0);
            Ok(json!({"ok":true}))
        }
        "resize" => {
            let height = args
                .get("height")
                .and_then(Value::as_f64)
                .filter(|n| n.is_finite())
                .ok_or("高度无效")?
                .clamp(290.0, 640.0);
            fit(app, s.target.load(Ordering::SeqCst), Some(height));
            if args.get("finish").and_then(Value::as_bool) == Some(true) {
                let window = shelf(app).ok_or("面板不存在")?;
                let height = window.inner_size().map_err(|_| "无法读取窗口高度")?.height as f64
                    / window.scale_factor().map_err(|_| "无法读取窗口缩放")?;
                let mut runtime = s.runtime.lock().unwrap();
                let before = runtime.store.settings.clone();
                runtime.store.settings.height = height.round() as u32;
                runtime.store.settings.compact = height < 345.0;
                if let Err(error) = runtime.save() {
                    runtime.store.settings = before;
                    return Err(error);
                }
                drop(runtime);
                broadcast(app);
            }
            Ok(json!({"ok":true}))
        }
        _ => Err("未知操作".into()),
    }
}
#[tauri::command]
async fn clips(
    app: tauri::AppHandle,
    command: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let shared = state(&app);
    if shared.quitting.load(Ordering::SeqCst) {
        return Err("应用正在退出".into());
    }
    // 在接收请求时占位，重复点击必须立即拒绝，不能在线程池排队后再次粘贴。
    let modal = ["image-import", "image-export"].contains(&command.as_str());
    let queue = command == "stack"
        && args
            .as_ref()
            .is_some_and(|args| ["next", "copy"].contains(&string(args, "action")));
    let busy = command == "use" || queue;
    if modal && shared.modal.swap(true, Ordering::SeqCst) {
        return Ok(json!({"ok":false,"error":"文件对话框已打开"}));
    }
    if queue && shared.queue_busy.swap(true, Ordering::SeqCst) {
        return Ok(json!({"ok":false,"error":"正在粘贴队列内容"}));
    }
    if busy
        && ((!queue && shared.queue_busy.load(Ordering::SeqCst))
            || shared.busy.swap(true, Ordering::SeqCst))
    {
        if queue {
            shared.queue_busy.store(false, Ordering::SeqCst);
        }
        return Ok(json!({"ok":false,"error":"正在粘贴，请稍候"}));
    }
    if shared.quitting.load(Ordering::SeqCst) {
        if modal {
            shared.modal.store(false, Ordering::SeqCst);
        }
        if queue {
            shared.queue_busy.store(false, Ordering::SeqCst);
        }
        if busy {
            shared.busy.store(false, Ordering::SeqCst);
        }
        return Err("应用正在退出".into());
    }
    let ticket = if ["mutate", "image-rotate", "resize"].contains(&command.as_str()) {
        Some(shared.operations.issue().ok_or("应用正在退出")?)
    } else {
        None
    };
    let request = if command == "search" {
        state(&app).search.fetch_add(1, Ordering::SeqCst) + 1
    } else {
        0
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _modal = modal.then(|| Flag(&shared.modal));
        let _queue = queue.then(|| Flag(&shared.queue_busy));
        let _busy = busy.then(|| Flag(&shared.busy));
        // blocking 线程池不保证启动顺序；票据保持原 stateTask 的请求顺序。
        let _turn = ticket.map(|ticket| shared.operations.wait(ticket));
        let args = args.unwrap_or_else(|| json!({}));
        let result = if command == "search" {
            search(&app, string(&args, "query"), request)
        } else {
            dispatch(&app, &command, &args)
        };
        match result {
            Err(error) if command != "search" && command != "state" => {
                broadcast(&app);
                Ok(json!({"ok":false,"error":error}))
            }
            result => result,
        }
    })
    .await
    .map_err(|_| "后台任务失败".to_owned())?;
    result
}
fn search(app: &tauri::AppHandle, query: &str, request: u64) -> Result<Value, String> {
    if crate::utf16::len(query) > 4096 {
        return Err("搜索内容过长".into());
    }
    let s = state(app);
    let (items, revision) = {
        let runtime = s.runtime.lock().unwrap();
        (runtime.store.items.clone(), runtime.revision())
    };
    let words = crate::utf16::Search::new(query)?;
    let mut ids = Vec::new();
    let mut chars = 0;
    for (index, item) in items.iter().enumerate() {
        if s.search.load(Ordering::SeqCst) != request {
            return Ok(json!({"ids":[],"revision":revision,"query":query}));
        }
        let content = format!("{}\n{}\n{}", item.text, item.title, item.source);
        if words.matches(&content) {
            ids.push(&item.id);
        }
        chars += item.text.len();
        if index % 32 == 31 || chars >= 524288 {
            std::thread::yield_now();
            chars = 0;
        }
    }
    Ok(json!({"ids":ids,"revision":revision,"query":query}))
}
fn monitor(app: tauri::AppHandle, events: std::sync::mpsc::Receiver<()>) {
    let s = state(&app);
    let event_mode = s.runtime.lock().unwrap().events;
    let mut next_poll = Instant::now();
    let mut retries: Vec<Instant> = Vec::new();
    let mut dirty_since: Option<Instant> = None;
    let mut storage_error = String::new();
    while !s.quitting.load(Ordering::SeqCst) {
        let current = Instant::now();
        let mut wait = next_poll
            .saturating_duration_since(current)
            .min(Duration::from_millis(500));
        if let Some(at) = dirty_since {
            wait = wait.min((at + Duration::from_millis(120)).saturating_duration_since(current));
        }
        for at in &retries {
            wait = wait.min(at.saturating_duration_since(current));
        }
        let event = events
            .recv_timeout(wait.max(Duration::from_millis(10)))
            .is_ok();
        if event {
            while events.try_recv().is_ok() {}
            std::thread::sleep(Duration::from_millis(40));
            retries = vec![
                Instant::now() + Duration::from_millis(120),
                Instant::now() + Duration::from_millis(410),
            ];
        }
        let current = Instant::now();
        let retry = retries.iter().any(|at| *at <= current);
        retries.retain(|at| *at > current);
        let mut changed = false;
        {
            let mut runtime = s.runtime.lock().unwrap();
            if runtime.store.resume_expired(now()) {
                runtime.capture_epoch += 1;
                runtime.last_signature.clear();
                runtime.last_sequence = win32::sequence();
                runtime.dirty = true;
                changed = true;
                dirty_since = Some(current);
            }
            if runtime.dirty
                && dirty_since
                    .is_some_and(|at| current.duration_since(at) >= Duration::from_millis(120))
            {
                match runtime.save() {
                    Ok(()) => {
                        if !storage_error.is_empty() && runtime.error == storage_error {
                            runtime.error.clear();
                            changed = true;
                        }
                        storage_error.clear();
                        runtime.collect();
                        dirty_since = None;
                    }
                    Err(error) => {
                        storage_error = error.clone();
                        runtime.error = error;
                        dirty_since = Some(current + Duration::from_secs(1));
                        changed = true;
                    }
                }
            }
        }
        if (event || retry || current >= next_poll) && !s.busy.load(Ordering::SeqCst) {
            next_poll = current + Duration::from_millis(if event_mode { 5000 } else { 750 });
            let (settings, epoch, paused, last) = {
                let runtime = s.runtime.lock().unwrap();
                (
                    runtime.store.settings.clone(),
                    runtime.capture_epoch,
                    runtime.store.paused,
                    runtime.last_sequence,
                )
            };
            let sequence = win32::sequence();
            if !paused && (sequence != last || last == 0) {
                let source = win32::source();
                let reason = win32::ignored(&settings, &source);
                {
                    let mut runtime = s.runtime.lock().unwrap();
                    let blocked = reason == Some("unknown-source");
                    if runtime.capture_blocked != blocked {
                        runtime.capture_blocked = blocked;
                        changed = true;
                    }
                }
                if reason.is_none() {
                    let packet = win32::read(&settings);
                    if win32::sequence() == sequence {
                        let mut runtime = s.runtime.lock().unwrap();
                        if !runtime.store.paused
                            && runtime.capture_epoch == epoch
                            && !s.busy.load(Ordering::SeqCst)
                            && !s.quitting.load(Ordering::SeqCst)
                        {
                            let captured=match packet{
                                Ok(Some(win32::Packet::Text{text,html}))=>{
                                    let signature=media::hash(format!("{text}\0{html}").as_bytes());
                                    if runtime.last_signature==signature{runtime.last_sequence=sequence;Ok(false)}
                                    else{
                                        runtime.last_signature=signature;
                                        let added=runtime.store.add(&text,&source,&html,now());
                                        if !added&&!crate::content::trim(&text).is_empty(){runtime.error="历史容量已满，固定内容较多；请清理部分收藏或分组后再复制".into();changed=true;}
                                        Ok(added)
                                    }
                                }
                                Ok(Some(win32::Packet::Image(image)))=>runtime.write_image(&image).and_then(|metadata|{
                                    let signature=format!("image:{}",metadata.media_id);
                                    if runtime.last_signature==signature{runtime.last_sequence=sequence;return Ok(false);}
                                    runtime.last_signature=signature;
                                    let added=runtime.store.add_image(metadata,&source,now()).map_err(str::to_owned)?;
                                    if !added{runtime.error="历史容量已满，固定内容较多；请清理部分收藏或分组后再复制".into();changed=true;}
                                    Ok(added)
                                }),
                                Ok(None)=>Ok(false),Err(error)=>Err(error),
                            };
                            match captured {
                                Ok(true) => {
                                    runtime.last_sequence = sequence;
                                    runtime.dirty = true;
                                    runtime.error.clear();
                                    changed = true;
                                    dirty_since = Some(current);
                                }
                                Ok(false) => {
                                    runtime.collect();
                                }
                                Err(error) => {
                                    if runtime.error != error {
                                        runtime.error = error;
                                        changed = true;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        if changed {
            broadcast(&app);
        }
    }
}
pub fn run() {
    use tauri::{
        image::Image,
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        WebviewUrl, WebviewWindowBuilder,
    };
    let smoke = std::env::args().any(|arg| arg == "--smoke");
    let mut builder = tauri::Builder::default();
    if !smoke {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _| {
            if !argv.iter().any(|arg| arg == "--background") {
                let app = app.clone();
                std::thread::spawn(move || show(&app, None));
            }
        }));
    }
    let builder = builder
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, triggered, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if triggered
                        == &Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP)
                    {
                        let s = state(app);
                        let target = win32::foreground();
                        if s.quitting.load(Ordering::SeqCst)
                            || s.queue_busy.swap(true, Ordering::SeqCst)
                        {
                            return;
                        }
                        if s.busy.swap(true, Ordering::SeqCst) {
                            s.queue_busy.store(false, Ordering::SeqCst);
                            return;
                        }
                        let Some(ticket) = s.operations.issue() else {
                            s.queue_busy.store(false, Ordering::SeqCst);
                            s.busy.store(false, Ordering::SeqCst);
                            return;
                        };
                        let app = app.clone();
                        std::thread::spawn(move || {
                            let _queue = Flag(&s.queue_busy);
                            let _busy = Flag(&s.busy);
                            let _turn = s.operations.wait(ticket);
                            if let Err(error) = next_queue(&app, false, Some(target)) {
                                notice_error(&app, error);
                            }
                        });
                    } else {
                        toggle_shortcut(app.clone());
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let directory = if smoke && std::env::var_os("CLIPSHELF_DATA_DIR").is_none() {
                std::env::temp_dir().join(format!("clipshelf-smoke-{}", std::process::id()))
            } else {
                crate::data_dir()
            };
            let import = std::env::args()
                .collect::<Vec<_>>()
                .windows(2)
                .find(|pair| pair[0] == "--import-legacy")
                .map(|pair| PathBuf::from(&pair[1]));
            let legacy = import.or_else(|| {
                if std::env::var_os("CLIPSHELF_DATA_DIR").is_none() {
                    std::env::var_os("APPDATA").map(|base| PathBuf::from(base).join("ClipShelf"))
                } else {
                    None
                }
            });
            let mut runtime = Runtime::load(directory.clone(), legacy.as_deref())
                .map_err(std::io::Error::other)?;
            if !smoke {
                runtime.store.settings.open_at_login = win32::startup_read();
            }
            let desired = runtime.store.settings.shortcut.clone();
            app.manage(Arc::new(AppState::new(runtime, smoke)));
            let mut window_builder =
                WebviewWindowBuilder::new(app, "shelf", WebviewUrl::App("index.html".into()))
                    .title("ClipShelf")
                    .visible(false)
                    .inner_size(1400.0, 390.0)
                    .resizable(false)
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .data_directory(directory.join("webview2"))
                    .background_color(tauri::window::Color(237, 240, 244, 255))
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .on_navigation(|url| {
                        url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
                    });
            // 远程调试仅在隔离 smoke 模式启用，普通启动不开放调试端口。
            if smoke {
                window_builder = window_builder.additional_browser_args(
                    "--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1",
                );
            }
            let window = window_builder.build()?;
            let dark = window.theme().ok() == Some(tauri::Theme::Dark);
            let s = state(app.handle());
            s.runtime.lock().unwrap().dark = dark;
            let open = MenuItem::with_id(app, "open", "打开 ClipShelf", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "暂停 / 继续记录", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &pause, &quit])?;
            TrayIconBuilder::with_id("main")
                .icon(Image::from_bytes(include_bytes!("../icons/256x256.png"))?)
                .tooltip("ClipShelf")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    let app = app.clone();
                    let id = event.id().as_ref().to_owned();
                    let s = state(&app);
                    let ticket = if id == "pause" {
                        let Some(ticket) = s.operations.issue() else {
                            return;
                        };
                        Some(ticket)
                    } else {
                        None
                    };
                    std::thread::spawn(move || {
                        let _turn = ticket.map(|ticket| s.operations.wait(ticket));
                        match id.as_str() {
                            "open" => show(&app, None),
                            "pause" => {
                                let result = dispatch(&app, "mutate", &json!({"action":"pause"}));
                                if let Err(error) = result {
                                    notice_error(&app, error);
                                }
                            }
                            "quit" => app.exit(0),
                            _ => {}
                        }
                    });
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        let app = tray.app_handle().clone();
                        std::thread::spawn(move || show(&app, None));
                    }
                })
                .build(app)?;
            if !smoke {
                if let Err(error) = app
                    .global_shortcut()
                    .register(Shortcut::from_str(&desired)?)
                {
                    s.runtime.lock().unwrap().error =
                        format!("{desired} 已被其他应用占用：{error}");
                } else {
                    s.runtime.lock().unwrap().shortcut = desired;
                }
                let stack = app
                    .global_shortcut()
                    .register(Shortcut::new(
                        Some(Modifiers::CONTROL | Modifiers::ALT),
                        Code::KeyP,
                    ))
                    .is_ok();
                s.runtime.lock().unwrap().stack_shortcut = stack;
                let (tx, rx) = std::sync::mpsc::channel();
                s.runtime.lock().unwrap().events = win32::listen(tx);
                let handle = app.handle().clone();
                std::thread::spawn(move || monitor(handle, rx));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            let s = state(app);
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let app = app.clone();
                    std::thread::spawn(move || hide(&app, false));
                }
                WindowEvent::Focused(false)
                    if !s.modal.load(Ordering::SeqCst)
                        && !s.busy.load(Ordering::SeqCst)
                        && !s.showing.load(Ordering::SeqCst) =>
                {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        if state(&app)
                            .runtime
                            .lock()
                            .unwrap()
                            .store
                            .settings
                            .hide_on_blur
                        {
                            hide(&app, false);
                        }
                    });
                }
                WindowEvent::ThemeChanged(theme) => {
                    let dark = *theme == tauri::Theme::Dark;
                    let app = app.clone();
                    std::thread::spawn(move || {
                        state(&app).runtime.lock().unwrap().dark = dark;
                        broadcast(&app);
                    });
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![clips]);
    match builder.build(tauri::generate_context!()) {
        Ok(app) => app.run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let s = state(app);
                if s.flushed.load(Ordering::SeqCst) {
                    return;
                }
                api.prevent_exit();
                if s.quitting.swap(true, Ordering::SeqCst) {
                    return;
                }
                let app = app.clone();
                let final_ticket = s.operations.seal();
                std::thread::spawn(move || {
                    let _turn = s.operations.wait(final_ticket);
                    while s.busy.load(Ordering::SeqCst) || s.queue_busy.load(Ordering::SeqCst) {
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    let mut runtime = s.runtime.lock().unwrap();
                    if let Err(error) = runtime.save() {
                        win32::error_dialog(&format!(
                            "历史暂未保存，已保留上次成功保存的历史。{error}"
                        ));
                    } else {
                        runtime.undo = None;
                        runtime.collect();
                    }
                    s.flushed.store(true, Ordering::SeqCst);
                    drop(runtime);
                    app.exit(0);
                });
            }
        }),
        Err(error) => win32::error_dialog(&format!("ClipShelf 启动失败，原文件未覆盖。{error}")),
    }
}
