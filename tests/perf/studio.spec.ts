// Скорость студии: yarn test:perf. Одни и те же действия — листать слайды, тянуть акцент по палитре,
// применить его, примерить темы наведением, применить тему, открыть «Фон», печатать — сначала без темы,
// потом с темой. На каждое — время и работа браузера (скрипты, пересчёт стилей, раскладка) по CDP.
// Итог — таблицей в консоли и в .tmp/perf.json: сравнивать версии (git stash / другая ветка) на одной машине
import fs from 'node:fs';
import { expect, test, type CDPSession, type Page } from '@playwright/test';

test.use({ colorScheme: 'light' });
test.setTimeout(300_000);

type M = Record<string, number>;
async function metrics(cdp: CDPSession): Promise<M> {
  const r = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(r.metrics.map((m: { name: string; value: number }) => [m.name, m.value]));
}
const KEYS = ['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'];
const out: Record<string, Record<string, number>> = {};

async function measure(page: Page, cdp: CDPSession, name: string, fn: () => Promise<number | void>): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const a = await metrics(cdp);
  const t0 = Date.now();
  const inPage = await fn();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const wall = Date.now() - t0;
  const b = await metrics(cdp);
  out[name] = { wall, ...(typeof inPage === 'number' ? { page: Math.round(inPage) } : {}), ...Object.fromEntries(KEYS.map((k) => [k.replace('Duration', ''), Math.round((b[k] - a[k]) * 1000)])) };
}

/** В странице: действие n раз, после каждого — два кадра; итог — мс в странице */
const frames = (page: Page, n: number, body: string) => page.evaluate(async ([n, body]) => {
  const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // eslint-disable-next-line no-new-func
  const step = new Function('i', body) as (i: number) => void;
  const t0 = performance.now();
  for (let i = 0; i < (n as number); i++) { step(i); await raf(); }
  return performance.now() - t0;
}, [n, body] as const);

test('скорость студии', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  let t0 = Date.now();
  await page.goto('/?deck=design&studio#2');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  out.load = { wall: Date.now() - t0 };
  for (let round = 0; round < 2; round++) {
    const sfx = round ? ' (тема)' : '';
    await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
    await measure(page, cdp, `листать 12 слайдов${sfx}`, () => frames(page, 12, `document.dispatchEvent(new KeyboardEvent('keydown', { key: i % 2 ? 'PageUp' : 'PageDown', bubbles: true }))`));
    await page.locator('.st-tabs [data-tab="design"]').click();
    await measure(page, cdp, `тянуть акцент ×30${sfx}`, () => frames(page, 30, `const a = document.getElementById('st-accent'); a.value = '#' + (0x2040A0 + i * 0x030507).toString(16).slice(-6); a.dispatchEvent(new Event('input', { bubbles: true }))`));
    await measure(page, cdp, `применить акцент${sfx}`, () => frames(page, 1, `const a = document.getElementById('st-accent'); a.value = '#${round ? 'c2410c' : '0d9488'}'; a.dispatchEvent(new Event('change', { bubbles: true })); a.dispatchEvent(new Event('blur'))`));
    await page.waitForTimeout(400);
    await measure(page, cdp, `примерка тем наведением ×10${sfx}`, () => frames(page, 10, `const t = [...document.querySelectorAll('#st-dz-strip .st-dz-mini')][i + 2]; t.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))`));
    await page.locator('#st-dz-strip').dispatchEvent('pointerleave');
    await measure(page, cdp, `открыть «Фон»${sfx}`, async () => {
      await page.locator('[data-cmd="design.bg"]').click();
      await expect(page.locator('.st-pop .st-dz-opt').first()).toBeVisible();
    });
    await page.keyboard.press('Escape');
    if (!round) {
      await measure(page, cdp, 'применить тему', async () => {
        await page.locator('.st-dz-mini[data-theme-id="midnight"]').click();
        await page.waitForFunction(() => document.querySelector('#st-canvas .slide.on')?.getAttribute('data-th'));
      });
      await page.waitForTimeout(600);
    }
    // Ввод текста в заголовок
    const tx = page.locator('#st-canvas .slide.on h2[data-edit], #st-canvas .slide.on h1[data-edit]').first();
    const editing = () => page.locator('#st-canvas .ed-active').count();
    await tx.click();
    if (!(await editing())) await tx.click();
    if (!(await editing())) await tx.dblclick();
    await expect(page.locator('#st-canvas .ed-active')).toHaveCount(1);
    await page.keyboard.press('End');
    await measure(page, cdp, `ввод 30 букв${sfx}`, () => frames(page, 30, `document.execCommand('insertText', false, 'а')`));
    await page.keyboard.press('Escape');
    await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(400);
  }
  const file = process.env.PERF_OUT ?? '.tmp/perf.json';
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  const pad = (v: unknown, n: number) => String(v ?? '').padStart(n);
  console.log(`\n${'действие'.padEnd(36)}${pad('мс', 7)}${pad('стили', 8)}${pad('раскладка', 11)}${pad('скрипты', 9)}`);
  for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(36)}${pad(v.wall, 7)}${pad(v.RecalcStyle, 8)}${pad(v.Layout, 11)}${pad(v.Script, 9)}`);
});
