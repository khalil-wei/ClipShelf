#!/usr/bin/env node
// 以 MinGW 工具链环境运行 Tauri CLI。
// 本机没有 MSVC 链接器，rustc 需要 DLL 工具(dlltool)在 PATH 中；
// 同时把 TMP/TEMP 指到工作区，避免受限令牌下 gcc 无法创建临时文件。
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const workspace = root;

const mingwBin = process.env.CLIPSHELF_MINGW_BIN || resolve(root, '..', '..', 'tools', 'mingw64', 'bin');
if (!existsSync(join(mingwBin, 'dlltool.exe'))) {
  console.error(`[clipshelf] 未找到 MinGW binutils: ${mingwBin}`);
  console.error('[clipshelf] 设置 CLIPSHELF_MINGW_BIN 指向 mingw64\\bin 目录，或安装 Visual Studio Build Tools 后删除 src-tauri/.cargo/config.toml。');
  process.exit(1);
}

const tmp = join(workspace, '.tmp');
const args = process.argv.slice(2);
const cargoMode = args[0] === '--cargo';
if (cargoMode) args.shift();
mkdirSync(tmp, { recursive: true });
const cargoBin = join(homedir(), '.cargo', 'bin');
const command = cargoMode ? 'cargo' : process.execPath;
const commandArgs = cargoMode ? args : [join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), ...args];

const child = spawn(command, commandArgs, {
  // Cargo 从工作目录向上找配置；--manifest-path 不会加载子目录的 .cargo。
  cwd: cargoMode ? join(root, 'src-tauri') : root,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    PATH: `${mingwBin};${cargoBin};${process.env.PATH}`,
    TMP: tmp,
    TEMP: tmp,
    CLIPSHELF_DATA_DIR: process.env.CLIPSHELF_DATA_DIR ?? join(workspace, '.data'),
  },
});

child.on('error', error => {
  console.error(`[clipshelf] 无法启动构建工具：${error.message}`);
  process.exitCode = 1;
});
child.on('exit', code => {
  if (code === 0 && !cargoMode && args[0] === 'build') {
    const bundle = join(root, 'src-tauri', 'target', 'x86_64-pc-windows-gnu', 'release', 'bundle', 'nsis');
    const { productName, version } = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    const installer = `${productName}_${version}_x64-setup.exe`;
    if (!existsSync(join(bundle, installer))) { console.error(`NSIS installer not found: ${installer}`); process.exit(1); }
    // ZIP stores bytes rather than the build directory's Windows integrity label.
    const archive = join(bundle, installer.replace(/\.exe$/, '.zip'));
    const packaged = spawnSync('tar.exe', ['-a', '-c', '-f', archive, '-C', bundle, installer], { stdio: 'inherit', windowsHide: true });
    if (packaged.status === 0) console.log(`Installer distribution: ${archive}`);
    process.exit(packaged.status ?? 1);
  }
  process.exit(code ?? 1);
});
