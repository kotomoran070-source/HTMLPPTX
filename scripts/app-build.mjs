// yarn app:build — установщик приложения. Перед сборкой — штамп desktop/build.json (дата и коммит):
// установленная программа показывает, от какого она числа, и сразу видно, что она отстала от проекта.
// После сборки штамп удаляется: yarn app из проекта всегда «из проекта».
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = path.join(root, 'desktop', 'build.json');
let commit = '';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  // Несохранённые изменения — тоже в штампе: сборка не совпадает ни с одним коммитом
  if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) commit += '+';
} catch { /* не репозиторий git */ }
const d = new Date();
const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
fs.writeFileSync(stamp, JSON.stringify({ date, commit }, null, 2));
console.log(`Сборка от ${date}${commit ? ` (${commit})` : ''}`);
try {
  const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
  const r = spawnSync(bin, process.argv.slice(2).length ? process.argv.slice(2) : ['--win'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  process.exitCode = r.status ?? 1;
} finally {
  fs.rmSync(stamp, { force: true });
}
