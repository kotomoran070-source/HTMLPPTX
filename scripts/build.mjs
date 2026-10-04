// Сборка презентаций в самодостаточные HTML-файлы: dist/<имя>.html
//   yarn build            — все презентации
//   yarn build microclimate — одну
//   --clean                — «для показа»: без режима правки, файл dist/<имя>.show.html
//   --out=путь             — куда положить файл (одна презентация; так собирает кнопка «Экспорт» редактора)
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const root = process.cwd();
// Приложение Slideria держит презентации вне папки программы (SLIDERIA_DECKS)
const presDir = process.env.SLIDERIA_DECKS ? path.resolve(process.env.SLIDERIA_DECKS) : path.join(root, 'presentations');
const all = fs.existsSync(presDir)
  ? fs.readdirSync(presDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .filter((d) => fs.existsSync(path.join(presDir, d.name, 'deck.yaml')))
    .map((d) => d.name)
    .sort()
  : [];

const args = process.argv.slice(2);
const wanted = args.filter((a) => !a.startsWith('-'));
const clean = args.includes('--clean');
const outArg = args.find((a) => a.startsWith('--out='))?.slice(6);
// Временная папка сборки: для «Экспорта» — вне проекта, чтобы не будить наблюдение за файлами
const tmpRoot = process.env.BUILD_TMP || null;
const names = wanted.length ? wanted : all;
const missing = names.filter((n) => !all.includes(n));
if (missing.length) {
  console.error(`Не найдены презентации: ${missing.join(', ')}. Есть: ${all.join(', ') || 'ни одной'}`);
  process.exit(1);
}
if (!names.length) {
  console.error('В папке presentations нет ни одной презентации. Создайте: yarn new имя');
  process.exit(1);
}

const dist = path.join(root, 'dist');
// С --out папка dist не нужна: приложение может стоять там, куда писать нельзя
if (!outArg) fs.mkdirSync(dist, { recursive: true });

if (outArg && names.length !== 1) {
  console.error('--out работает для одной презентации: yarn build имя --out=файл.html');
  process.exit(1);
}
if (clean) process.env.CLEAN = '1';

for (const name of names) {
  const tmp = path.join(tmpRoot ?? dist, `.build-${name}-${process.pid}`);
  process.env.DECK = name;
  process.env.OUT_DIR = tmp;
  try {
    await build({
      configFile: path.join(root, 'vite.config.ts'),
      logLevel: 'warn',
      // Приложение: конфиг читается без временного файла рядом с ним (папка программы может быть только для чтения)
      ...(process.env.SLIDERIA_APP === '1' ? { configLoader: 'runner' } : {}),
    });
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.error(`✗ ${name}: ${String(e?.message ?? e).replace(/^\[[\w-]+\]\s*/, '')}`);
    process.exitCode = 1;
    continue;
  }
  const out = outArg ? path.resolve(outArg) : path.join(dist, `${name}${clean ? '.show' : ''}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // copyFile: временная папка может быть на другом диске
  fs.copyFileSync(path.join(tmp, 'index.html'), out);
  fs.rmSync(tmp, { recursive: true, force: true });
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`✓ ${path.relative(root, out)}  ${kb} КБ${clean ? ' · для показа' : ''}`);
}
