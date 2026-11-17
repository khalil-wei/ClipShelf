#!/usr/bin/env node
// 以 MinGW 工具链环境运行 Tauri CLI。
// 本机没有 MSVC 链接器，rustc 需要 DLL 工具(dlltool)在 PATH 中；
// 同时把 TMP/TEMP 指到工作区，避免受限令牌下 gcc 无法创建临时文件。
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
const updateRelease = !cargoMode && args[0] === 'build-update';
const bundleBuild = !cargoMode && (updateRelease || (args[0] === 'build' && !args.includes('--no-bundle')));
const tauriDir = join(root, 'src-tauri');
const { productName, version } = bundleBuild ? JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8')) : {};
const releaseDir = updateRelease ? join(root, 'dist', 'updates', `v${version}`) : null;
const releases = 'https://github.com/khalil-wei/ClipShelf/releases';
let pubkey;
if (updateRelease) {
  const pinnedKey = join(tauriDir, 'updater.pub');
  pubkey = existsSync(pinnedKey) ? readFileSync(pinnedKey, 'utf8').trim() : '';
  if (!pubkey || !process.env.TAURI_SIGNING_PRIVATE_KEY) {
    console.error('[clipshelf] 签名构建需要固定公钥 src-tauri/updater.pub 和 TAURI_SIGNING_PRIVATE_KEY。');
    process.exit(1);
  }
  if (existsSync(releaseDir)) {
    console.error(`[clipshelf] 发布目录已存在，请先归档：${releaseDir}`);
    process.exit(1);
  }
  args.splice(0, args.length, 'build', '--ci', '--config', JSON.stringify({
    bundle: { createUpdaterArtifacts: true },
    // 签名同时绑定版本号，防止更新清单把旧安装包冒充成新版本。
    plugins: { updater: { pubkey, endpoints: [`${releases}/latest/download/latest.json`], requireSignedVersion: true } },
  }));
}

function zipInstaller(directory, installer) {
  // ZIP stores bytes rather than the build directory's Windows integrity label.
  const archive = join(directory, installer.replace(/\.exe$/, '.zip'));
  const packaged = spawnSync('tar.exe', ['-a', '-c', '-f', archive, '-C', directory, installer], { stdio: 'inherit', windowsHide: true });
  if (packaged.status !== 0) throw new Error(packaged.error?.message ?? '无法生成安装 ZIP。');
  return archive;
}

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
  if (code !== 0 || !bundleBuild) process.exit(code ?? 1);
  try {
    const bundle = join(tauriDir, 'target', 'x86_64-pc-windows-gnu', 'release', 'bundle', 'nsis');
    const installer = `${productName}_${version}_x64-setup.exe`;
    if (!existsSync(join(bundle, installer))) throw new Error(`NSIS installer not found: ${installer}`);
    if (!updateRelease) {
      console.log(`Installer distribution: ${zipInstaller(bundle, installer)}`);
      return;
    }
    const signatureFile = `${installer}.sig`;
    const signatureContent = readFileSync(join(bundle, signatureFile), 'utf8');
    const signature = signatureContent.trim();
    // Tauri 只警告密钥不匹配；禁止发布已安装客户端无法验证的签名。
    const keyId = encoded => Buffer.from(Buffer.from(encoded, 'base64').toString('utf8').split('\n')[1] ?? '', 'base64').subarray(2, 10);
    const signingKey = keyId(signature);
    if (signingKey.length !== 8 || !signingKey.equals(keyId(pubkey))) throw new Error('更新签名与固定公钥不匹配。');

    mkdirSync(dirname(releaseDir), { recursive: true });
    const staging = mkdtempSync(join(dirname(releaseDir), '.staging-'));
    try {
      copyFileSync(join(bundle, installer), join(staging, installer));
      writeFileSync(join(staging, signatureFile), signatureContent);
      zipInstaller(staging, installer);
      const url = `${releases}/download/v${version}/${encodeURIComponent(installer)}`;
      writeFileSync(join(staging, 'latest.json'), JSON.stringify({ version, platforms: { 'windows-x86_64': { signature, url } } }, null, 2) + '\n');
      // 整套产物一次移入版本目录，失败时不留下可误发的不完整发布。
      renameSync(staging, releaseDir);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    console.log(`Updater distribution: ${releaseDir}`);
  } catch (error) {
    console.error(`[clipshelf] ${error.message}`);
    process.exitCode = 1;
  }
});
