# Paste 官方包：获取与首次检查

日期：2026-10-19。本记录来自实际下载的客户端包；此前的 ClipShelf v0.2 主要依据官网资料开发，不能追溯地说成已基于此包逆向实现。

## 文件身份

- 官方下载页：https://pasteapp.io/download
- 官方入口：https://pasteapp.io/download/mac
- 最终文件：https://downloads.pasteapp.io/dist/stable/Paste-7.0.3.zip
- 本地文件：`D:/personal/REA/reference/paste/Paste-7.0.3.zip`
- 大小：31,210,090 字节。
- SHA-256：`0556756dcf0b1215512101234ac355226c6c49d862398c83b911e6656fbd7426`。
- ZIP 所有条目通过 CRC 校验。该 SHA-256 记录本地文件身份，不是供应商公布的签名或校验值。

## 已观测的包内事实

从 `Paste.app/Contents/Info.plist` 读取：版本 7.0.3、构建号 29869046、标识符 `com.wiheads.paste-direct`、最低 macOS 14.0、主程序 `Paste`。

主程序是包含 x86_64 与 arm64 的 Universal Mach-O，37,344,112 字节；SHA-256 为 `c682601116877d918d775f353cdcc1149f39e329cac38dd6a95bfbcb2a671750`。

ZIP 共 295 个条目，未压缩总大小 58,499,735 字节。可见 Sparkle、Sentry framework，以及 `PastePackages_PasteCore.bundle` 中的 `Assets.car` 和多个版本的 Core Data `.momd/.mom/.omo` 模型资源。文件存在不等于证明其运行时被使用。

REA 已打开 ZIP、执行 `inspect_artifact` 并调用 `extract_artifact`，提取 162 个普通文件。保留目录：`D:/personal/REA/reference/paste/unpacked/Paste.app`。符号链接未作为可执行路径展开。

## 证据与工具边界

- REA ZIP inspection parent：`ev_b5e5646c2af6232250f4072f1cd4d6ca205ed7e50f9cf1f228938bd6c85f1efa`。
- REA inventory：`ev_fa417d396087f23dc44c40d036beab6599a88dea2e033c223762e123026e7455`。
- REA extraction：`ev_e566c826f51d6a362a328bc408a9f3b6dd1c6fc65444228878f3cec58050ed65`。
- REA 包清单证据：`reference/paste/rea-package-evidence.json`；原提取调用的证据另存为 `reference/paste/rea-extraction-evidence.json`。切换目标会清空当前目标的 ledger，故两类证据分开保留。
- 独立 ZIP CRC、plist、架构头及字面字符串检查：`reference/paste/package-inspection.json`；脚本 `artifacts/inspect-paste-zip.py`。

REA 也已打开解包后的主程序，正确识别为 `mach-o-universal`。随后 `inspect_macho` 返回 `capability_unavailable`，明确原因是当前选中的 native-macos provider 依赖 macOS 工具。未把这一调用失败当成已经完成 Mach-O 深度分析，也未反复重试。

本轮没有反编译函数、恢复源代码、执行 Mac 应用、核验 macOS 代码签名或测量原版动画参数。已有字符串扫描只是字面候选，包含可能来自机器码的偶然 ASCII，不能直接当成类名或功能实现证据。下一步应限定到真实资源、Core Data 模型和结构化 Mach-O 元数据，再选择可用的反编译工具。

原始包和提取文件已被 Git 忽略，也被 Windows 应用打包规则排除。
