// Привязка цветов вёрстки к теме у презентации в проекте (обычно импортированной).
//   yarn bind-theme имя              — привязать (прежний deck.yaml — в .backup/)
//   yarn bind-theme имя --dry-run    — только показать, что изменится
import path from 'node:path';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');
const [name] = args.filter((a) => !a.startsWith('-'));
if (!name) {
  console.error('Использование: yarn bind-theme имя-презентации [--dry-run]');
  process.exit(1);
}

const root = process.cwd();
const server = await createServer({ configFile: false, root, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
try {
  const { bindProject, themeLines } = await server.ssrLoadModule('/plugins/import.ts');
  const r = bindProject(path.join(root, 'presentations'), name, dryRun);
  const where = `presentations/${r.name}/deck.yaml`;
  if (!r.changed) console.log(`Изменений нет: цвета ${where} уже привязаны к теме (или привязывать нечего)`);
  else console.log(`${dryRun ? 'Будет обновлена' : 'Обновлена'} ${where}`);
  for (const l of themeLines(r.theme)) console.log(`  ${l}`);
  if (r.backup) console.log(`  Прежняя версия сохранена: ${r.backup}`);
  if (dryRun && r.changed) console.log('\nЭто предпросмотр. Чтобы записать, запустите без --dry-run.');
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await server.close();
}
