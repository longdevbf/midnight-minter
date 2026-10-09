import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const COMPILER = '0.31.1';
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'contracts/token.compact');
const dest = resolve(root, 'managed/token');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\nBiên dịch thất bại (mã ${r.status}).`);
    process.exit(r.status ?? 1);
  }
}

// Xoá bản build cũ trước khi biên dịch: nếu biên dịch lỗi thì không còn artifact cũ lọt qua.
rmSync(dest, { recursive: true, force: true });

if (process.platform === 'win32') {
  // `compact` trên Windows là công cụ nén NTFS, không phải compiler. Phải chạy trong WSL.
  const toWsl = (p) => p.replace(/^([A-Za-z]):[\\/]/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
  const script = [
    'set -e',
    'rm -rf ~/.minter-build && mkdir -p ~/.minter-build',
    `cp '${toWsl(source)}' ~/.minter-build/token.compact`,
    'cd ~/.minter-build',
    `compact compile +${COMPILER} token.compact out`,
    `rm -rf '${toWsl(dest)}' && mkdir -p '${toWsl(dest)}'`,
    `cp -r out/. '${toWsl(dest)}'`,
  ].join(' && ');
  run('wsl', ['-d', 'Ubuntu', '--', 'bash', '-lc', script]);
} else {
  run('compact', ['compile', `+${COMPILER}`, source, dest]);
}

if (!existsSync(resolve(dest, 'contract/index.js'))) {
  console.error('Không thấy managed/token/contract/index.js sau khi biên dịch.');
  process.exit(1);
}

// Sourcemap trỏ tới file nguồn không có trong managed/, làm vitest cảnh báo mỗi lần chạy. Bỏ đi.
const entryJs = resolve(dest, 'contract/index.js');
rmSync(resolve(dest, 'contract/index.js.map'), { force: true });
writeFileSync(entryJs, readFileSync(entryJs, 'utf8').replace(/^\/\/# sourceMappingURL=.*(\r?\n)?/gm, ''));

console.log(`\nĐã biên dịch contract vào ${dest}`);
