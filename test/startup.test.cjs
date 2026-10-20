const test = require('node:test');
const assert = require('node:assert/strict');
const { LoginStartup } = require('../src/login-startup.cjs');
test('startup registers background launch and detects externally disabled entries', () => {
  let value = false, enabled = true, registered;
  const app = { getLoginItemSettings: () => ({ openAtLogin: value, launchItems: value ? [{name:'ClipShelf',path:process.execPath,args:[],scope:'user',enabled}] : [] }), setLoginItemSettings: options => { registered = options; value = options.openAtLogin; if ('enabled' in options) enabled = options.enabled; } };
  const startup = new LoginStartup(app, { supported: true });
  startup.set(true); assert.equal(startup.read(), true); assert.deepEqual(registered.args, ['--background']);
  enabled = false; assert.equal(startup.read(), false);
  startup.set(true); assert.equal(startup.read(), true);
  startup.set(false); assert.equal(startup.read(), false);
});
