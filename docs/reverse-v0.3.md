# Paste 包逆向与 ClipShelf 0.3

日期：2026-10-19。对象为实际下载的官方 Paste 7.0.3（29869046）Universal Mac 包，身份和下载链见 `paste-package-findings.md`。此前 0.2 依据网页资料实现；本次新增功能使用包内结构化证据指导，并由独立代码实现。

## 实际完成的分析

- REA 解析 v11.mom 的 NSKeyedArchiver：234 个对象、857 个引用。证据 `ev_182f1e2d4255508e558e9aec875122d0aae1a3d3d0e6284d91d11e9c0eda22f9`。
- REA 解码 Interface Builder：4 份界面归档，其中两份属于 PasteStack，另两份属于 Sparkle。总图 365 节点、172 条边，部分对象未识别。证据 `ev_345dee17b4fb00e44537d3f9dc528eb74057351c2fec4b3f8ff309cbef1bf6f2`。
- 自编格式解析器 `artifacts/reverse-paste.py` 按 Mach-O section、符号表、函数起点表和 Swift 相对类型描述符解析两种架构，保留偏移和地址。每种架构解析到 3,106 个 Swift 类型描述符；函数起点分别 73,354 / 73,494。这是元数据解析，不是函数反编译。
- 按资源格式解码本地化字符串和 Core Data 模型，不执行归档对象。输出位于 `reference/paste/reverse/`；REA 证据导出 `rea-resource-evidence.json`，3 条记录，481,601 字节。已导出后关闭会话。

## 证据与实现的对应关系

| 实际观测 | 本版实现与证据边界 |
| --- | --- |
| ItemEntity.rawPreview、ItemDataEntity.rawPasteboardItems：预览与原内容分离 | 图片元数据进入历史，PNG 与缩略图独立加密保存。具体文件格式与 Windows 加密方案是本项目设计。 |
| ApplicationEntity.bundleIdentifier/name，隐私排除相关本地化键 | 新增 Windows 进程名排除、机密标记跳过。这是平台适配，不是恢复了 Mac 排除算法。 |
| 纯文本复制/粘贴相关本地化键 | 保存文本及 HTML，默认单项恢复格式，Shift+Enter 强制纯文本，多项输出纯文本。 |
| 图片编辑、旋转、背景移除及 OCR 相关资源/类型 | 本版先完成图片历史、预览、收藏与粘贴；尚未实现旋转、背景移除或 OCR。 |
| FilterBrowserViewModel、FilterSuggestionRow、FilterType 等类型 | 保留并扩展现有类型、应用和时间筛选，新增图片筛选。不能仅凭类型名断言原版筛选算法。 |
| PasteStack 场景、PasteStackWindowController、DirectPasteAction、StackDirection | 确认包内有对应结构。本版尚未实现队列粘贴。 |
| ItemEntity.displayOrderInPinboard | 确认存在分组排序字段；本版分组仍按历史顺序排列。 |

## 验证及尚未确定的部分

19 项 Node 测试覆盖原有历史功能、媒体完整性/清理、应用排除、隐私标记、格式处理及图片去重。Electron 回归验证图片缩略图与全图能实际解码显示，图片/富文本/纯文本经过对应 IPC 路由，混合图片多选被拒绝，图片通过真实 safeStorage 加密落盘。测试不改写用户真实剪贴板。

1,852 条历史仅渲染约 10 张卡片。44 帧采样 p95 约 10.1ms，只代表本机测试；不能与未运行的 Mac 原版比较。Windows 剪贴板事件和测试快捷键注册通过；本会话被系统阻止切换前台窗口，跨窗口自动粘贴测试未执行成功。

当前没有 Mac。native-macos 分析器在 Windows 不可用；未完成函数反编译、恢复源代码或运行原版。类型、字段和本地化键可以证明结构/资源存在，不能证明完整执行分支、动画曲线、弹簧参数或实际手感。因此本版不声称 100% 复刻。

参考包、资源及证据均在 reference/ 下，被便携打包规则排除；Windows 成品不包含 Paste 原始二进制或界面资源。
