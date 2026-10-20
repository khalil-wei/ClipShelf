class LoginStartup {
  constructor(app, { supported = process.platform === 'win32' && app.isPackaged, simulate = false } = {}) {
    this.app = app; this.supported = supported; this.simulate = simulate; this.value = false;
    this.options = { path: process.execPath, args: ['--background'], name: 'ClipShelf' };
  }
  read() {
    if (!this.supported) return false;
    if (this.simulate) return this.value;
    const result = this.app.getLoginItemSettings({ path: '"' + this.options.path + '"', args: this.options.args });
    if (Array.isArray(result.launchItems)) return result.openAtLogin && result.launchItems.some(item => item.scope === 'user' && item.name === this.options.name && item.path.toLowerCase() === this.options.path.toLowerCase() && item.enabled);
    return result.openAtLogin && result.executableWillLaunchAtLogin !== false;
  }
  set(value) {
    if (!this.supported) { if (value) throw Error('请在 Windows 便携版中启用自启动'); return; }
    if (this.simulate) { this.value = value; return; }
    this.app.setLoginItemSettings({ ...this.options, openAtLogin: value, ...(value ? { enabled: true } : {}) });
    if (this.read() !== value) throw Error('自启动设置未生效，请检查 Windows 启动应用设置');
  }
}
module.exports = { LoginStartup };
