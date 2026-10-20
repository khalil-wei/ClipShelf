const { spawn } = require('node:child_process');
const readline = require('node:readline');
class NativeClient {
  constructor(file, { onChange = () => {}, onStatus = () => {}, spawnProcess = spawn, restartDelays = [1000, 2000, 5000, 10000], readyTimeoutMs = 15000, requestTimeoutMs = 5000 } = {}) {
    Object.assign(this, { file, onChange, onStatus, spawnProcess, restartDelays, readyTimeoutMs, requestTimeoutMs });
    this.queue = Promise.resolve(); this.pending = null; this.alive = false; this.closed = false; this.generation = 0; this.failures = 0;
    this.launch();
  }
  launch() {
    if (this.closed) return;
    const generation = ++this.generation;
    this.onStatus(false, false, { connecting: true, generation });
    this.ready = new Promise(resolve => {
      let failed = false;
      const executable=this.file.toLowerCase().endsWith('.exe');
      const child = this.spawnProcess(executable?this.file:'powershell.exe', executable?[]:['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', this.file], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      const fail = () => {
        if (failed) return; failed = true; clearTimeout(timeout); this.alive = false; this.events = false;
        if (this.pending?.generation === generation) { const pending = this.pending; this.pending = null; clearTimeout(pending.timer); pending.reject(Error('Windows 助手已断开，请重试')); }
        resolve(false); child.kill();
        if (!this.closed) {
          const delay = this.restartDelays[Math.min(this.failures++, this.restartDelays.length - 1)];
          this.onStatus(false, false, { retryInMs: delay, generation });
          this.restartTimer = setTimeout(() => this.launch(), delay);
        }
      };
      this.failActive = fail;
      const timeout = setTimeout(fail, this.readyTimeoutMs);
      readline.createInterface({ input: child.stdout }).on('line', line => {
        if (failed || this.closed || generation !== this.generation) return;
        if (line.startsWith('CLIPBOARD ')) { const match = /^CLIPBOARD (\d+) ?(.*)$/.exec(line); if (match) this.onChange({ sequence: match[1], source: match[2] }); return; }
        if (line === 'READY' || line === 'READY_FALLBACK') { clearTimeout(timeout); this.alive = true; this.events = line === 'READY'; this.failures = 0; this.onStatus(true, this.events, { generation, recovered: generation > 1 }); resolve(true); return; }
        if (this.pending?.generation === generation) { const p = this.pending; this.pending = null; clearTimeout(p.timer); line.startsWith('ERROR ') ? p.reject(Error(line.slice(6))) : p.resolve(line); }
      });
      child.stderr.on('data', () => {}); child.stdin.on('error', fail); child.on('error', fail); child.on('exit', fail);
    });
  }
  request(command) {
    const generation = this.generation, ready = this.ready;
    const run = async () => {
      if (this.closed || !await ready || !this.alive || generation !== this.generation) throw Error('Windows 助手未就绪，请稍后重试');
      return new Promise((resolve, reject) => {
        this.pending = { resolve, reject, generation, timer: setTimeout(() => this.failActive(), this.requestTimeoutMs) };
        this.child.stdin.write(command + '\n');
      });
    };
    const result = this.queue.then(run); this.queue = result.catch(() => {}); return result;
  }
  close() { this.closed = true; clearTimeout(this.restartTimer); this.failActive?.(); this.child?.stdin.end(); }
}
module.exports = { NativeClient };
