// Картинки слайдов вне программы (server/shot.ts): невидимый Chromium из Playwright — он есть в зависимостях
// разработки. Браузер Playwright не скачан — Chrome или Edge этого компьютера. Запускается при первой картинке и
// живёт, пока жив процесс. Берут: yarn mcp (view_slides), yarn dev и yarn serve (чат «Агент» смотрит на слайд).
// В программе снимает скрытое окно Electron (desktop/shot.mjs)
let browser = null;

async function launch() {
  const { chromium } = await import('playwright');
  let first;
  for (const how of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try { return await chromium.launch(how); } catch (e) { first ??= e; }
  }
  throw new Error(`Для картинок слайдов нужен браузер: npx playwright install chromium (или Chrome на компьютере). ${String(first?.message ?? '').split('\n')[0]}`);
}

/** @param {{ url: string; count: number; width: number; height: number }} r */
export async function playwrightShoot({ url, count, width, height }) {
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

/** Закрыть браузер (сервер останавливается) */
export async function closePlaywrightShoot() {
  const b = browser;
  browser = null;
  if (b) await (await b.catch(() => null))?.close().catch(() => {});
}
