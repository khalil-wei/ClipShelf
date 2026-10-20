# Paste → ClipShelf 本地核心版

参考日期：2026-10-19。

REA Evidence：`ev_a7206745120d112d8239022b599eacd19bb1c67a69a873d681351742c698817c`。

采集对象是 https://pasteapp.io/ 官网。REA 在独立无账户 Edge 中导航并等待 h1 可见，采集 DOM 与 accessibility；场景完成后关闭自有浏览器。没有获取 Mac 安装包，也没有分析客户端代码。

| 官网可确认的能力 | 本版实现 |
| --- | --- |
| 保存剪贴板历史 | Windows 纯文本轮询与去重，最多 2000 项 |
| 历史搜索 | 全量 Unicode 文本子串匹配 |
| 固定常用内容与 Pinboards | 收藏、命名分组、组内筛选 |
| 跨 Mac/iPhone/iPad 同步 | 未实现，用户选择本地核心版 |
| 应用排除规则 | 未实现，提供手动暂停 |
| Apple Intelligence / AI 工具接入 | 未实现 |

底部卡片面板、Ctrl+Shift+V、Windows 窗口恢复、safeStorage 加密及 Electron 技术栈是本项目实现决策，不是关于 Paste 内部实现的逆向结论。
