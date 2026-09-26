// Импорт HTML-файла презентации обратно в проект.
//   yarn merge-html путь/к/файлу.html        — в презентацию, из которой файл собран
//   yarn merge-html файл.html имя            — в указанную (или новую) презентацию
//   yarn merge-html файл.html --dry-run      — только показать, что изменится
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');
const [file, name] = args.filter((a) => !a.startsWith('-'));
if (!file) {
  console.error('Использование: yarn merge-html путь/к/файлу.html [имя-презентации] [--dry-run]');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`Файл не найден: ${file}`);
  process.exit(1);
}

const root = process.cwd();
// Логика импорта написана на TypeScript: загружаем её через Vite, без отдельной сборки
const server = await createServer({ configFile: false, root, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
try {
  const { importHtml, report } = await server.ssrLoadModule('/plugins/import.ts');
  const result = importHtml(fs.readFileSync(file, 'utf8'), {
    dir: path.join(root, 'presentations'),
    name,
    fileName: path.basename(file),
    dryRun,
  });
  console.log(report(result));
  if (dryRun && result.changed) console.log('\nЭто предпросмотр. Чтобы записать, запустите без --dry-run.');
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await server.close();
}
