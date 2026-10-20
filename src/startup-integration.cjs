const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { LoginStartup } = require('./login-startup.cjs');
async function run({ app, win }) {
  const startup = new LoginStartup(app, { supported: true });
  const name = 'ClipShelf-Verification-' + process.pid;
  app.setAppUserModelId(name);
  startup.options = { path: process.execPath, args: ['--background', '--startup-probe=' + process.pid], name };
  try {
    assert.equal(win.isVisible(), false);
    startup.set(true); assert.equal(startup.read(), true);
    const result = app.getLoginItemSettings(startup.options);
    assert.ok(result.launchItems.some(x => x.name === name && x.enabled));
    const registration = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', name], { windowsHide: true, encoding: 'utf8' });
    assert.match(registration, /--background/); assert.ok(registration.includes('--startup-probe=' + process.pid));
    startup.set(false); assert.equal(startup.read(), false);
    console.log('STARTUP_PASS ' + JSON.stringify({ registered: true, backgroundArgument: true, registrationRemoved: true, windowInitiallyHidden: true }));
  } finally {
    app.setLoginItemSettings({ ...startup.options, openAtLogin: false });
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Remove-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run' -Name '" + name + "' -ErrorAction SilentlyContinue; exit 0"], { windowsHide: true, stdio: 'ignore' });
    app.quit();
  }
}
module.exports = { run };
