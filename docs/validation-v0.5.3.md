# 0.5.3 焦点交接修复候选版

问题：面板双击先隐藏，独立助手随后直接调用 SetForegroundWindow。助手既不是前台输入接收者，也没有完成输入队列交接，Windows 可能拒绝恢复目标窗口。

修正：保持面板前台，等待双击及修饰键释放；确认焦点仍属于面板或目标；短暂连接当前前台输入队列，发出目标激活请求，在 finally 中断开连接。确认目标为前台后才发送 Ctrl+V，完成后隐藏面板。命令线程创建消息窗口以满足输入队列连接的前提。没有改变目标文本框的选区，交由目标程序恢复原焦点及光标。PowerShell 回退路径同步处理。

验证（2026-10-20）：

- 单元测试 41/41 通过。
- 打包应用 smoke 通过，覆盖界面工作流、图片工具、加密存储、原生助手恢复。pasteDelivered=false 明确表示普通 smoke 不做真实粘贴验证。
- 打包应用 Windows 图片剪贴板集成通过，原剪贴板已恢复。
- 编译助手及 PowerShell 助手均成功启动，均拒绝零句柄目标。
- 独立 --paste-integration **失败，不能算验收通过**：测试接收窗口请求显示和聚焦后，GetForegroundWindow 仍返回其他窗口，未进入目标输入测试。此测试使用合成文本并恢复剪贴板，不忽略失败。自动化桌面限制的具体原因尚未确定。

真实粘贴尚待交互桌面确认。退出旧版，从 dist/v0.5.3/ClipShelf-win32-x64/ClipShelf.exe 启动，在记事本输入两行，将光标放到中间，按 Ctrl+Shift+V 呼出并双击卡片；预期插入原光标位置且不再出现原错误。从托盘打开仍没有可靠的输入目标，应从目标输入框通过快捷键呼出。

源依据：[SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)、[AttachThreadInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-attachthreadinput)。代码保持窗口一致性检查，不向后来切换的其他应用发送粘贴。
