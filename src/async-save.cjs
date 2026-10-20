const fs = require('node:fs/promises');
class AsyncSave {
  constructor(file, background, encode) { this.file = file; this.background = background; this.encode = encode; this.queue = Promise.resolve(); }
  save(snapshot) {
    const serialized = this.background.run('serialize', snapshot); serialized.catch(() => {});
    const result = this.queue.catch(() => {}).then(async () => {
      const data = this.encode(await serialized), temp = this.file + '.tmp';
      await fs.writeFile(temp, data); await fs.rename(temp, this.file);
    });
    this.queue = result; return result;
  }
  flush() { return this.queue; }
}
module.exports = { AsyncSave };
