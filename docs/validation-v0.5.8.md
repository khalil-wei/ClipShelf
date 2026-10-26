# ClipShelf 0.5.8 图标兼容修复

日期：2026-10-26。按用户要求在 0.5.8 内修复并替换 Release 附件，保留已确认的蓝白卡片 Logo。

## 修复

之前的 ICO 把所有尺寸都保存成 PNG。微软的 [Windows 图标设计指南](https://learn.microsoft.com/en-us/windows/win32/uxguide/vis-icons) 建议仅压缩 256 像素图像。现在把 16、20、24、32、40、48、64、128 像素改为 32 位 DIB 与按 DWORD 对齐的透明 AND 掩码，仅 256 像素使用 PNG。

构建时将 Electron 返回的顶向下、预乘 BGRA 转换为 ICO 的底向上直通 alpha 位图，保留半透明边缘。打包后从 EXE 的 RT_GROUP_ICON 引用逐项定位 RT_ICON，核对尺寸、编码与 ICO 帧内容；校验失败则构建失败。完成后通过 SHChangeNotify 通知 Windows Shell 更新该 EXE 的显示。

旧 EXE 已存在的 PNG 资源不缺失，不能仅凭格式调整断言原先显示旧图的唯一原因；旧路径缓存也可能参与。此次保持 0.5.8 产品版本，重新构建 EXE 和便携 ZIP，不使用 0.5.9 发布版本。

## 验证

- 58 项单元测试通过，覆盖 DIB 行顺序、半透明像素、掩码对齐及实际 ICO 各尺寸编码。
- 成品 EXE 的 9 个图标资源与 ICO 各帧逐项核对通过。
- Windows Shell 的 SHGetFileInfo 小图标接口返回蓝白新版图标。
- 同一 DIB 图标在此前修复候选包的资源管理器中已观察到正确显示；这不等于当前 0.5.8 旧路径缓存已在所有桌面刷新完成。

成品：`dist/v0.5.8/ClipShelf-win32-x64/ClipShelf.exe`。历史格式与路径不变。
