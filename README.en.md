# ClipShelf for Windows

[中文](README.md) | English

ClipShelf is a local-first clipboard history app for Windows. The repository contains two implementations with the same clipboard workflow. History and images stay on the local machine and are protected using the Windows account.

## Two versions

| | Electron 0.5.8 | Rust/Tauri 0.5.9 |
| --- | --- | --- |
| Source | Repository root | [`rust/`](rust/) |
| Desktop stack | Electron with a native Windows helper | Rust, Tauri 2 and the system WebView2 runtime |
| Data directory | `%APPDATA%\ClipShelf` | `%APPDATA%\ClipShelf-rs` |
| Distribution | Portable Windows package | Windows x64 installer ZIP; extract it before running setup |
| Best suited for | Continuing with the existing Electron version | Trying the Rust backend and smaller installer |

Both versions provide clipboard and image history, search, favorites, groups, undo and sequential paste. The Rust implementation follows the 0.5.8 behavior; system integrations still need to be verified separately for each version.

## Why use the Rust version?

- **Smaller installer:** the 0.5.9 Windows x64 installer ZIP is about 1.8 MiB. It uses the system WebView2 runtime, which is not included in that size and must be installed if missing.
- **Direct Windows integration:** the Rust backend calls Windows APIs for clipboard events, source identification, focus handling, shortcuts and input, reducing reliance on a separate native helper process and its communication protocol.
- **Familiar UI and local protection:** the existing interface is retained, while Windows DPAPI protects Rust history and images on the local machine.
- **Migration with a fallback:** Rust uses a separate data directory and can import the Electron history and images read-only on first launch, leaving the old files in place. Migration requires the same Windows account and the old `Local State`, `history.enc` and associated media files. Existing Rust history is not automatically merged.

Installer size does not establish memory use or startup speed. WebView2 also runs its own processes, and the two versions have not yet been benchmarked under the same workload.

## Download and run

Choose a version from [GitHub Releases](https://github.com/khalil-wei/ClipShelf/releases). For Rust 0.5.9, extract the installer ZIP to a normal user directory and run setup. Exit the older version from its tray menu first to avoid global shortcut conflicts.

Rust 0.5.9 passed unit tests and an isolated WebView2 UI smoke test. Real desktop cross-app paste, login startup, installation and uninstallation have not all completed acceptance testing. The installer is unsigned.

## Run from source

For Electron, run `npm install` and `npm start` in the repository root; run `npm test` for tests.

For Rust, Windows x64, a Rust GNU toolchain, Node.js, MinGW-w64 and WebView2 are required. In `rust/`, run `npm ci` and `npm run dev`; use `npm test` for tests and `npm run build -- --ci` for the installer. If MinGW is not in the sibling `tools/mingw64/bin` directory, set `CLIPSHELF_MINGW_BIN` to the actual `mingw64/bin`. The development script uses an isolated data directory by default.

For historical release notes, see the [Chinese README](README.md).
