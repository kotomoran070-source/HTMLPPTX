// yarn mcp — MCP-сервер для Claude и других агентов на этом компьютере (docs/MCP.md): презентации читаются
// и правятся инструментами. Запускает его сам клиент (Claude Code, Claude Desktop) и говорит с ним через
// stdin/stdout; вручную запускать не нужно.
//   --decks=папка  — папка презентаций (по умолчанию presentations/ проекта или SLIDERIA_DECKS)
// Открыта студия с той же папкой — правки идут через неё и сразу видны; закрыта — пишутся в файлы.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { playwrightShoot } from './pw-shot.mjs';

// stdout — только для протокола: всё остальное (предупреждения библиотек) — в stderr
console.log = console.error;
console.info = console.error;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.slice(2).find((a) => a.startsWith('--decks='))?.slice(8);
const dir = path.resolve(arg || process.env.SLIDERIA_DECKS || path.join(root, 'presentations'));
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Сервер и инструменты — TypeScript: Vite загружает их как модули, без сервера страниц и наблюдения за файлами
const vite = await createServer({
  configFile: false, root, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
});
// Картинки слайдов (view_slides, server/shot.ts) — невидимый Chromium из Playwright (scripts/pw-shot.mjs)
const shoot = playwrightShoot;

const { createDecksCore } = await vite.ssrLoadModule('/server/core.ts');
const { createMcp, serveStdio } = await vite.ssrLoadModule('/server/mcp.ts');
const core = createDecksCore({ dir, root });
// Ссылки на этот компьютер и во внутреннюю сеть — только тестам (tests/unit/mcp.spec.ts: свой сервер картинок)
await serveStdio(createMcp({ core, dir, root, version, shoot, localUrls: process.env.SLIDERIA_MCP_LOCAL_URLS === '1' }), process.stdin, process.stdout);
await (await browser?.catch(() => null))?.close();
await vite.close();
