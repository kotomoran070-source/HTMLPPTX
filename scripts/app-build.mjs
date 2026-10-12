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
// Подпись (docs/SIGNING.md). Сертификат — только из переменных окружения, в проект он не попадает:
// SLIDERIA_CERT_SHA1 — отпечаток сертификата из хранилища Windows (токен или .pfx, импортированный один раз);
// CSC_LINK + CSC_KEY_PASSWORD — файл .pfx: путь или base64 (так его передают секретом в GitHub Actions).
// Без них установщик собирается неподписанным.
const args = process.argv.slice(2).length ? process.argv.slice(2) : ['--win'];
// Отпечаток, скопированный из окна сертификата, начинается с невидимого символа — оставляем только знаки отпечатка
const sha1 = (process.env.SLIDERIA_CERT_SHA1 || '').replace(/[^0-9a-f]/gi, '');
const pfx = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
if (sha1) args.push(`-c.win.signtoolOptions.certificateSha1=${sha1}`);
// Сертификат задан — без подписи сборка не закончится: неподписанный установщик молча не получится
if (sha1 || pfx) args.push('-c.forceCodeSigning=true');
console.log(sha1 ? `Подпись: сертификат ${sha1} из хранилища Windows` : pfx ? 'Подпись: файл .pfx (CSC_LINK)' : 'Без подписи: сертификат не задан (docs/SIGNING.md)');
try {
  const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
  const r = spawnSync(bin, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  process.exitCode = r.status ?? 1;
} finally {
  fs.rmSync(stamp, { force: true });
}
