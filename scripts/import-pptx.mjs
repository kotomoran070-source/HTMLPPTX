// Импорт презентации PowerPoint в проект: yarn import-pptx файл.pptx [имя] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');
const [file, name] = args.filter((a) => !a.startsWith('-'));
if (!file || !fs.existsSync(file)) {
  console.error('Использование: yarn import-pptx путь/к/файлу.pptx [имя-презентации] [--dry-run]');
  process.exit(1);
}
const root = process.cwd();
const dir = process.env.SLIDERIA_DECKS ? path.resolve(process.env.SLIDERIA_DECKS) : path.join(root, 'presentations');
// Логика импорта на TypeScript: загружаем через Vite, без отдельной сборки
const server = await createServer({ configFile: false, root, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
try {
  const { importPptx } = await server.ssrLoadModule('/plugins/pptx/index.ts');
  const r = await importPptx(fs.readFileSync(file), { dir, fileName: path.basename(file), name, dryRun });
  console.log(`${dryRun ? 'Проверка' : 'Готово'}: «${r.title}» → ${path.relative(root, path.join(dir, r.name))} · слайдов: ${r.slides}, картинок: ${r.assets}`);
  for (const w of r.warnings) console.log(`  · ${w}`);
} catch (e) {
  console.error(`Не удалось: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await server.close();
}
