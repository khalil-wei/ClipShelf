fn main() {
    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    tauri_build::try_build(attributes).expect("Tauri 构建失败");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // lib 单测也会链接 Windows 对话框 API，清单不能只嵌入应用二进制。
        embed_resource::compile_for_everything("windows-manifest.rc", embed_resource::NONE)
            .manifest_required()
            .expect("Windows 激活清单编译失败");
    }
}
