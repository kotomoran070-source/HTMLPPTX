// Сборка презентаций в самодостаточные HTML-файлы: dist/<имя>.html
//   yarn build            — все презентации
//   yarn build microclimate — одну
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';

const root = process.cwd();
const presDir = path.join(root, 'presentations');
const all = fs.existsSync(presDir)
  ? fs.readdirSync(presDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .filter((d) => fs.existsSync(path.join(presDir, d.name, 'deck.yaml')))
    .map((d) => d.name)
    .sort()
  : [];

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
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
fs.mkdirSync(dist, { recursive: true });

for (const name of names) {
  const tmp = path.join(dist, `.build-${name}`);
  process.env.DECK = name;
  process.env.OUT_DIR = tmp;
  try {
    await build({ configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn' });
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.error(`✗ ${name}: ${String(e?.message ?? e).replace(/^\[[\w-]+\]\s*/, '')}`);
    process.exitCode = 1;
    continue;
  }
  const out = path.join(dist, `${name}.html`);
  fs.renameSync(path.join(tmp, 'index.html'), out);
  fs.rmSync(tmp, { recursive: true, force: true });
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`✓ ${path.relative(root, out)}  ${kb} КБ`);
}
