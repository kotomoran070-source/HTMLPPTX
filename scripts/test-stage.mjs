// yarn test:stage — сквозные тесты на сжатом коде программы, как в установщике (scripts/app-stage.mjs):
// сжатие не должно ничего ломать. Аргументы передаются Playwright (например, -g «Экспорт»)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage } from './app-stage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, '.tmp', 'app-stage');
const r = stage(dest);
console.log(`Сжатый код: ${r.packed} файлов → ${path.relative(root, dest)}`);
const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');
const run = spawnSync(bin, ['test', '--project=e2e', ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, SLIDERIA_STAGE: dest },
});
process.exitCode = run.status ?? 1;
