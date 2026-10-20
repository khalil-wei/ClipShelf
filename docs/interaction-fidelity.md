# Paste 交互对照与实现说明

日期：2026-10-19；版本：ClipShelf 0.2。

## 证据

REA MCP 在独立 Edge 中导航 https://pasteapp.io/help/paste-on-mac 并采集 accessibility：`ev_3fd1a54970fc5f5a34781bd734a02074aa4c0e1281a951079aef28e8b799f182`。

REA 还在浏览器中打开该官方帮助页引用的截图，采集图像。卡片截图 Evidence：`ev_898ae56f06c5f90c7e128beb5244d0e0fbb037fe82f92148a49467dc5da1eab1`；原始采集内容及 provider/limitations 均保留在 bundle 内。截图显示底部横条、彩色分组、方形卡片、蓝色选中环、代码深色预览与内联内容预览。

官方帮助：https://pasteapp.io/help/paste-on-mac
快捷键：https://pasteapp.io/help/keyboard-shortcuts
编辑：https://pasteapp.io/help/edit-items-before-pasting
数字粘贴：https://pasteapp.io/help/quick-paste-with-numbered-shortcuts

## 对照矩阵

| 公开描述的行为 | Windows 实现 | 验证边界 |
| --- | --- | --- |
| 底部横向内容时间线 | 全宽底部面板，虚拟化卡片，平滑横向滚轮 | 截图及 1852 条历史滚动测试 |
| 方形卡片、内联预览与来源信息 | 文本 / 代码 / 链接 / 颜色，来源进程徽标 | 未复用品牌图标，也未分析原版内部渲染 |
| 多显示器跟随工作区域 | 优先使用唤起前窗口的屏幕坐标，失败时使用鼠标所在屏幕 | 本机自动化覆盖不足，需多屏实测 |
| 改变窗口高度和 Compact Mode | 顶部拖拽高度、紧凑开关、自适应卡片 | 主题、紧凑状态已测试 |
| 空格 Quick Look | 本地完整文本预览弹窗 | 不支持原版链接浏览器和图片/PDF 预览 |
| 编辑、重命名、新建片段 | Ctrl+E / Ctrl+R / Ctrl+N | 加密保存与元数据保留测试 |
| Ctrl 对应 Command 的多选、范围选择 | Ctrl+单击、Shift+单击/方向键、Ctrl+A | DOM 与主进程路由已测试 |
| 快速粘贴 1–9 | Ctrl+1 … Ctrl+9 | 测试模式记录请求；真实目标仍须人工验收 |
| 搜索、类型和时间/来源筛选 | 名称和内容多词搜索、类型/来源/时间筛选 | 中文输入焦点与纯模型测试 |
| 彩色 Pinboard 与拖入分组 | 彩色分组、右键加入/移出、拖放 | 批量 pinning 已测试；真实鼠标拖放仍需人工体验检查 |
| 删除和撤销 | 单步撤销，保留撤销前新复制的内容 | 工作流回归测试 |
| 暂停、设置、历史保留 | 手动暂停、主题、快捷键、保留周期、动效选项 | 偏好保存与固定内容保留测试 |
| 原版连续动画手感 | compositor transform/opacity、保留 DOM、横向虚拟滚动 | 当前 235ms 呼出/125ms 收起为本项目设计值，非从原版提取 |

## 保留的差异

图片/文件/富文本、OCR、Paste Stack、共享和云同步、AI、敏感应用排除未实现。Windows acrylic 依赖系统版本与系统绘制规则，不能保证复现 macOS 材质。未获取 Mac 安装包、未执行反编译、未测量原版帧级动画或输入延迟。

性能报告是本机短时测试；用户窗口中的自动粘贴测试被 Windows 前台激活规则阻止时明确记录 not-run。不能把测试模式的复制请求拦截当成真实粘贴成功，也不能把 renderer 帧采样解释为原版一致性证明。
