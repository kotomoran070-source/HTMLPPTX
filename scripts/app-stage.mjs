// Код программы для установщика (yarn app:build): сжатые копии вместо исходников и список их отпечатков.
//   node scripts/app-stage.mjs [папка]   — собрать копию отдельно (по умолчанию .tmp/app-stage)
// Каждый файл сжимается отдельно — без комментариев, отступов и понятных имён переменных, но с теми же
// импортами и экспортами: сервер Vite внутри программы и «Экспорт» работают с ними так же, как с исходниками.
// Отпечатки (SHA-256) кода, который лежит рядом с app.asar, записываются внутрь app.asar
// (desktop/integrity.json): программа сверяет их при запуске и с изменённым кодом не запускается.
// Там же — готовый проигрыватель для «Экспорта» в HTML, все варианты (player/, server/player.ts):
// программа не собирает его на компьютере пользователя.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Что входит в программу (кроме package.json и node_modules — их кладёт electron-builder) */
export const OWN = ['LICENSE', 'index.html', 'vite.config.ts', 'tsconfig.json', 'desktop', 'src', 'plugins', 'server', 'scripts', 'templates'];
/** Внутри app.asar: загрузчик программы. Его целостность проверяет сам Electron, остальное — он */
export const PACKED = ['desktop'];
/** Собирается при подготовке копии, а не копируется: готовый проигрыватель */
export const BUILT = ['player'];
const SKIP = /\.d\.m?ts$/;
const LOADER = { '.ts': 'ts', '.mts': 'ts', '.mjs': 'js', '.js': 'js', '.cjs': 'js', '.css': 'css' };

/**
 * Сжатие одного файла. Только пробелы и имена: «синтаксическое» сжатие пишет true как !0, а Vite
 * разбирает параметры import.meta.glob как обычные значения. Тексты лицензий в коде (/*! … *\/) остаются
 */
export function minify(file, code) {
  const ext = path.extname(file);
  const loader = LOADER[ext];
  if (!loader) return null;
  const format = ext === '.cjs' ? 'cjs' : loader === 'css' ? undefined : 'esm';
  return transformSync(code, {
    loader, format, sourcefile: path.basename(file),
    minifyWhitespace: true, minifyIdentifiers: true, minifySyntax: false,
    legalComments: 'inline', charset: 'utf8', target: 'es2022',
  }).code;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Собрать копию в dest; ответ — сколько файлов сжато и сколько скопировано как есть */
export function stage(dest) {
  // Проигрыватель — из исходников (сборка Vite и так сжимает код), во все варианты
  const players = path.join(dest, 'player');
  fs.rmSync(dest, { recursive: true, force: true });
  const built = spawnSync(process.execPath, [path.join(root, 'scripts', 'build.mjs'), '--players', `--out=${players}`], { cwd: root, stdio: 'inherit' });
  if (built.status !== 0) throw new Error('Проигрыватель для экспорта не собрался');
  let packed = 0;
  let copied = 0;
  const files = OWN.flatMap((x) => {
    const p = path.join(root, x);
    return fs.statSync(p).isDirectory() ? walk(p) : [p];
  }).filter((f) => !SKIP.test(f) && path.basename(f) !== 'build.json' && path.basename(f) !== 'integrity.json');
  const sums = {};
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // Скрипты пользователя (templates/scripts) — как есть: их заголовок (// @name…) — описание скрипта
    const small = rel.startsWith('templates/scripts/') ? null : minify(f, fs.readFileSync(f, 'utf8'));
    if (small === null) {
      fs.copyFileSync(f, out);
      copied++;
    } else {
      fs.writeFileSync(out, small);
      packed++;
    }
    if (!PACKED.some((d) => rel === d || rel.startsWith(`${d}/`))) sums[rel] = createHash('sha256').update(fs.readFileSync(out)).digest('base64');
  }
  for (const f of walk(players)) {
    sums[path.relative(dest, f).split(path.sep).join('/')] = createHash('sha256').update(fs.readFileSync(f)).digest('base64');
  }
  fs.writeFileSync(path.join(dest, 'desktop', 'integrity.json'), JSON.stringify({ files: sums }));
  return { packed, copied, checked: Object.keys(sums).length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dest = path.resolve(process.argv[2] ?? path.join(root, '.tmp', 'app-stage'));
  const r = stage(dest);
  console.log(`Код программы: ${path.relative(root, dest) || dest} · сжато ${r.packed}, как есть ${r.copied}, с отпечатками ${r.checked}`);
}
