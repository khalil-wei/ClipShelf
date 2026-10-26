# ClipShelf Logo

最终方案：米白圆角底座、蓝白叠放卡片与小托架，采用轻拟物质感。2026-10-26 用户确认采用，应用、托盘和面板统一使用此方案。

- 确认原图：`clipshelf-logo-approved-original.png`。
- 透明图标母版：`clipshelf-logo-approved-transparent.png`。
- 运行时资源：`src/assets/clipshelf-64.png`、`clipshelf-256.png`、`clipshelf.ico`。
- ICO 包含 16、20、24、32、40、48、64、128、256 九种尺寸；小尺寸采用 32 位 DIB 和 AND 掩码，仅 256 像素采用 PNG。
- `npm run build:icons` 使用已有 Electron 图像库从透明母版生成图标，不增加依赖。
- `npm run pack` 生成当前版本目录（0.5.9 为 `dist/v0.5.9/ClipShelf-win32-x64`），并校验 EXE 内嵌图标组。打包排除 design 目录，仅携带小尺寸 PNG 和 ICO。

使用内置 image_gen 生成及适配图稿，提示词见 [图标适配说明](approved-logo.md)。本目录只保留最终方案。
