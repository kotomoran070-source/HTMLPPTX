// Новая презентация из шаблона: yarn new имя-папки ["Название презентации"]
import fs from 'node:fs';
import path from 'node:path';

const [name, ...titleParts] = process.argv.slice(2);
if (!name || !/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
  console.error('Использование: yarn new имя-папки ["Название презентации"]');
  console.error('Имя папки: латиница, цифры, дефис. Например: yarn new q3-report "Итоги третьего квартала"');
  process.exit(1);
}
const root = process.cwd();
const src = path.join(root, 'templates', 'basic');
const dst = path.join(root, 'presentations', name);
if (fs.existsSync(dst)) {
  console.error(`Папка presentations/${name} уже существует`);
  process.exit(1);
}
const title = titleParts.join(' ').trim() || 'Новая презентация';
fs.cpSync(src, dst, { recursive: true });
const deckFile = path.join(dst, 'deck.yaml');
fs.writeFileSync(deckFile, fs.readFileSync(deckFile, 'utf8').replaceAll('{{title}}', title.replace(/"/g, '\\"')));
console.log(`✓ Создана presentations/${name}/deck.yaml`);
console.log(`  Просмотр: yarn dev → http://localhost:5173/?deck=${name}`);
console.log(`  Файл:     yarn build ${name} → dist/${name}.html`);
