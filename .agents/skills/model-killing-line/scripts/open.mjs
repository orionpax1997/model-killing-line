// open.mjs — 用系统默认浏览器打开 index.html（失败只打印路径，不抛错）
//
// 用法: node scripts/open.mjs [--dir <dir>] [--file <index.html>]
//   默认打开系统临时目录: os.tmpdir()/model-killing-line/index.html（可用 MKL_DIR 环境变量覆盖目录）
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const DIR = argv('--dir') ?? process.env.MKL_DIR ?? path.join(os.tmpdir(), 'model-killing-line');
const FILE = argv('--file') ?? path.join(DIR, 'index.html');

if (!existsSync(FILE)) {
  console.error(`not found: ${FILE} — 先跑 fetch → render → gen-html`);
  process.exit(1);
}

const url = `file://${FILE}`;
const plat = process.platform;
let cmd, args;
if (plat === 'darwin') [cmd, args] = ['open', [FILE]];
else if (plat === 'win32') [cmd, args] = ['cmd', ['/c', 'start', '""', FILE]];
else [cmd, args] = ['xdg-open', [FILE]];

try {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  if ((r.error ?? r.status !== 0) && plat !== 'win32') {
    // Linux 无桌面环境时 xdg-open 常失败，尝试兜底
    const fallback = spawnSync('sensible-browser', [url], { stdio: 'ignore' });
    if (fallback.error ?? fallback.status !== 0) {
      console.log(`auto-open failed, open manually: ${url}`);
      process.exit(0);
    }
  }
  console.log(`opened: ${url}`);
} catch {
  console.log(`auto-open failed, open manually: ${url}`);
}
