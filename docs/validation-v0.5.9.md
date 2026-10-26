# ClipShelf 0.5.9 图标兼容修复

日期：2026-10-26。保留已确认的蓝白卡片 Logo，不改变应用功能和历史格式。

## 修复

之前的 ICO 把所有尺寸都保存成 PNG。微软的 [Windows 图标设计指南](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-icons) 建议仅压缩 256 像素图像。本版把 16、20、24、32、40、48、64、128 像素改为 32 位 DIB 与按 DWORD 对齐的透明 AND 掩码，仅 256 像素使用 PNG。

构建时将 Electron 返回的顶向下、预乘 BGRA 转换为 ICO 的底向上直通 alpha 位图，保留半透明边缘。打包后从 EXE 的 RT_GROUP_ICON 引用逐项定位 RT_ICON，核对尺寸、编码与 ICO 帧内容；校验失败则构建失败。

使用新的 0.5.9 文件版本与独立目录，避免把旧目录内同名 EXE 的图标缓存当作新成品结果。旧 EXE 已存在的 PNG 资源不缺失，因此不能仅凭此次格式调整就断言此前 Explorer 显示旧图的唯一原因；旧路径缓存也可能参与。

## 验证

- `npm test`：58 项通过，包含 DIB 行顺序、半透明像素、掩码对齐及实际 ICO 各尺寸编码。
- `npm run pack`：成功；EXE 图标组的 9 个尺寸全部通过资源核对。
- 使用 Windows Shell `SHGetFileInfo(..., SHGFI_ICON | SHGFI_SMALLICON)` 获取新 EXE 的真实 16×16 小图标，确认显示蓝白卡片。结果为本地 `artifacts/shell-icon-v0.5.9.png`，不是直接读取 PNG 源图。
- 资源管理器前台界面验收待完成：当前桌面自动化返回 `failed to activate captured window`，已请用户将资源管理器置于前台。此项不计为通过。

成品：`dist/v0.5.9/ClipShelf-win32-x64/ClipShelf.exe`。若使用便携目录启动项，升级后重新启用自启动，以更新路径。
