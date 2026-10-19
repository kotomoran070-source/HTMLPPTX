// yarn app:build — установщик приложения. Защита кода (docs/PROTECTION.md):
//   код программы — сжатыми копиями, а не исходниками (scripts/app-stage.mjs);
//   app.asar с загрузчиком программы, его целостность проверяет Electron (подпись .exe — docs/SIGNING.md);
//   остальной код рядом с app.asar, загрузчик сверяет его с отпечатками и с изменённым не запускается;
//   предохранители Electron (package.json → build.electronFuses): только app.asar, без запуска в роли Node и без отладчика.
// В копии — штамп desktop/build.json (дата и коммит): установленная программа показывает, от какого она числа.
//   SLIDERIA_FUSES_TEST=1 — отладчик не выключается: так автотест управляет собранной программой
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage, OWN, PACKED } from './app-stage.mjs';
import { licenseProblems } from './licenses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Библиотека с неподходящей лицензией в установщик не попадёт: сборка останавливается (yarn licenses — подробности)
const bad = licenseProblems();
if (bad.length) {
  console.error(`Лицензия вне разрешённого списка (plugins/licenses.mjs):\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
let commit = '';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  // Несохранённые изменения — тоже в штампе: сборка не совпадает ни с одним коммитом
  if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) commit += '+';
} catch { /* не репозиторий git */ }
const d = new Date();
const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
console.log(`Сборка от ${date}${commit ? ` (${commit})` : ''}`);
const STAGE = path.join(root, '.tmp', 'app-stage');
const st = stage(STAGE);
fs.writeFileSync(path.join(STAGE, 'desktop', 'build.json'), JSON.stringify({ date, commit }, null, 2));
console.log(`Код программы сжат: ${st.packed} файлов, отпечатков ${st.checked}`);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const config = {
  ...pkg.build,
  // Свой код — из сжатой копии; node_modules electron-builder кладёт сам
  files: ['package.json', { from: path.relative(root, STAGE), to: '.', filter: ['**/*'] }],
  asar: true,
  // В app.asar остаются загрузчик (desktop) и package.json; остальное — рядом, обычными файлами:
  // сервер Vite и esbuild внутри программы читают их с диска
  // (шаблоны — от папки проекта: файлы берутся из копии)
  asarUnpack: ['node_modules/**', ...OWN.filter((x) => !PACKED.includes(x)).map((x) => `${path.relative(root, STAGE).split(path.sep).join('/')}/${x}${fs.statSync(path.join(STAGE, x)).isDirectory() ? '/**' : ''}`)],
  // Предохранители — из package.json; автотесту собранной программы нужен отладчик
  electronFuses: { ...pkg.build.electronFuses, ...(process.env.SLIDERIA_FUSES_TEST === '1' ? { enableNodeCliInspectArguments: true } : {}) },
};
const configFile = path.join(root, '.tmp', 'electron-builder.json');
fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
// Подпись (docs/SIGNING.md). Сертификат — только из переменных окружения, в проект он не попадает:
// SLIDERIA_CERT_SHA1 — отпечаток сертификата из хранилища Windows (токен или .pfx, импортированный один раз);
// CSC_LINK + CSC_KEY_PASSWORD — файл .pfx: путь или base64 (так его передают секретом в GitHub Actions).
// Без них установщик собирается неподписанным.
const args = [...(process.argv.slice(2).length ? process.argv.slice(2) : ['--win']), '--config', configFile];
// Отпечаток, скопированный из окна сертификата, начинается с невидимого символа — оставляем только знаки отпечатка
const sha1 = (process.env.SLIDERIA_CERT_SHA1 || '').replace(/[^0-9a-f]/gi, '');
const pfx = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
if (sha1) args.push(`-c.win.signtoolOptions.certificateSha1=${sha1}`);
// Сертификат задан — без подписи сборка не закончится: неподписанный установщик молча не получится
if (sha1 || pfx) args.push('-c.forceCodeSigning=true');
console.log(sha1 ? `Подпись: сертификат ${sha1} из хранилища Windows` : pfx ? 'Подпись: файл .pfx (CSC_LINK)' : 'Без подписи: сертификат не задан (docs/SIGNING.md)');
const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const r = spawnSync(bin, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
process.exitCode = r.status ?? 1;
