use std::path::PathBuf;

pub mod content;
pub mod crypto;
mod desktop;
pub mod media;
pub mod runtime;
mod serial;
pub mod settings;
pub mod store;
pub mod undo;
pub mod utf16;
pub mod win32;

fn data_dir() -> PathBuf {
    resolve_data_dir(
        std::env::var_os("CLIPSHELF_DATA_DIR").map(PathBuf::from),
        std::env::var_os("APPDATA").map(PathBuf::from),
    )
}

fn resolve_data_dir(override_dir: Option<PathBuf>, appdata: Option<PathBuf>) -> PathBuf {
    if let Some(dir) = override_dir {
        return dir;
    }
    match appdata {
        Some(appdata) if !appdata.as_os_str().is_empty() => appdata.join("ClipShelf-rs"),
        _ => std::env::temp_dir().join("ClipShelf-rs"),
    }
}

pub fn run() {
    desktop::run();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn data_dir_is_separate_from_electron_and_accepts_isolation() {
        let base = PathBuf::from("synthetic-appdata");
        assert_eq!(
            resolve_data_dir(None, Some(base.clone())),
            base.join("ClipShelf-rs")
        );
        assert_eq!(
            resolve_data_dir(Some(PathBuf::from("fixture")), Some(base)),
            PathBuf::from("fixture")
        );
        assert_eq!(
            resolve_data_dir(None, None),
            std::env::temp_dir().join("ClipShelf-rs")
        );
    }
}
