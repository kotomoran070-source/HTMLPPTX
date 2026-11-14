// yarn mcp — MCP-сервер для Claude и других агентов на этом компьютере (docs/MCP.md): презентации читаются
// и правятся инструментами. Запускает его сам клиент (Claude Code, Claude Desktop) и говорит с ним через
// stdin/stdout; вручную запускать не нужно.
//   --decks=папка  — папка презентаций (по умолчанию presentations/ проекта или SLIDERIA_DECKS)
// Открыта студия с той же папкой — правки идут через неё и сразу видны; закрыта — пишутся в файлы.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

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
/**
 * Картинки слайдов (view_slides, server/shot.ts): невидимый Chromium из Playwright — он есть в зависимостях
 * разработки. Браузер Playwright не скачан — Chrome или Edge этого компьютера. Запускается при первой картинке
 * и живёт, пока агент на связи
 */
let browser = null;
async function launch() {
  const { chromium } = await import('playwright');
  let first;
  for (const how of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try { return await chromium.launch(how); } catch (e) { first ??= e; }
  }
  throw new Error(`Для картинок слайдов нужен браузер: npx playwright install chromium (или Chrome на компьютере). ${String(first?.message ?? '').split('\n')[0]}`);
}
async function shoot({ url, count, width, height }) {
  browser ??= launch().catch((e) => { browser = null; throw e; });
  const page = await (await browser).newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    await page.goto(url);
    await page.waitForFunction(() => document.documentElement.dataset.shot, null, { timeout: 60_000 });
    const state = await page.evaluate(() => document.documentElement.dataset.shot);
    if (state !== 'ready') throw new Error(`Слайды не нарисовались: ${state.replace(/^error: /, '')}`);
    const out = [];
    for (let k = 0; k < count; k++) {
      await page.evaluate((n) => window.slideriaShot.show(n), k);
      out.push(await page.screenshot({ type: 'png' }));
    }
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}

const { createDecksCore } = await vite.ssrLoadModule('/server/core.ts');
const { createMcp, serveStdio } = await vite.ssrLoadModule('/server/mcp.ts');
const core = createDecksCore({ dir, root });
await serveStdio(createMcp({ core, dir, root, version, shoot }), process.stdin, process.stdout);
await (await browser?.catch(() => null))?.close();
await vite.close();
