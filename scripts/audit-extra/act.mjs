// Профиль действий студии: листание, выделение, перетаскивание, отмена, ввод текста, вкладки ленты
import { BASE, open, prof, frames } from './prof.mjs';

const deck = process.argv[2] || 'tpl';
const only = new Set((process.argv[3] || 'flip,select,drag,undo,type,tabs,zoom').split(','));
const { browser, page, cdp } = await open();
await page.goto(`${BASE}/?deck=${deck}&studio`);
await page.waitForSelector('#st-canvas .slide.on');
await page.waitForTimeout(4500);
const N = await page.evaluate(() => document.querySelectorAll('#st-canvas .slide').length);
console.log('слайдов на холсте', N, 'узлов', await page.evaluate(() => document.querySelectorAll('*').length));

if (only.has('flip')) {
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await prof(page, cdp, 'листать 30 слайдов', async () => {
    const ts = await frames(page, 30, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))`);
    return { медиана: ts.slice().sort((a, b) => a - b)[15], макс: Math.max(...ts) };
  }, { n: 26 });
  await frames(page, 30, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }))`);
  await page.waitForTimeout(500);
}

// Слайд с объектами: первый (титул) — свободные объекты
const obj = page.locator('#st-canvas .slide.on [data-free]').nth(1);
if (only.has('select')) {
  const b = await obj.boundingBox();
  await prof(page, cdp, 'выделить объект (щелчок)', async () => {
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  }, { n: 22 });
  await prof(page, cdp, 'снять выделение (щелчок мимо)', async () => {
    await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  }, { n: 14 });
}
if (only.has('drag')) {
  const b = await obj.boundingBox();
  const x0 = b.x + b.width / 2;
  const y0 = b.y + b.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await prof(page, cdp, 'перетаскивание, 60 шагов', async () => {
    const gaps = [];
    for (let k = 1; k <= 60; k++) {
      const t = k / 60;
      await page.mouse.move(x0 + 140 * Math.sin(2 * Math.PI * t) + 40 * t, y0 + 70 * Math.sin(4 * Math.PI * t) + 30 * t);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    }
    return gaps;
  }, { n: 22, settle: 0 });
  await prof(page, cdp, 'отпустить', async () => { await page.mouse.up(); }, { n: 22, settle: 400 });
}
if (only.has('undo')) {
  await prof(page, cdp, 'отменить (Ctrl+Z)', async () => { await page.keyboard.press('Control+z'); }, { n: 22, settle: 400 });
  await prof(page, cdp, 'вернуть (Ctrl+Y)', async () => { await page.keyboard.press('Control+y'); }, { n: 12, settle: 400 });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
}
if (only.has('type')) {
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  const tx = page.locator('#st-canvas .slide.on [data-edit]').first();
  await tx.click();
  if (!(await page.locator('#st-canvas .ed-active').count())) await tx.click();
  if (!(await page.locator('#st-canvas .ed-active').count())) await tx.dblclick();
  console.log('правка текста активна:', await page.locator('#st-canvas .ed-active').count());
  await page.keyboard.press('End');
  await prof(page, cdp, 'ввод 30 букв', async () => {
    const ts = await frames(page, 30, `document.execCommand('insertText', false, 'а')`);
    return { медиана: ts.slice().sort((a, b) => a - b)[15], макс: Math.max(...ts) };
  }, { n: 26 });
  await page.keyboard.press('Escape');
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(600);
}
if (only.has('tabs')) {
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.st-tabs [data-tab]')].map((t) => t.getAttribute('data-tab')));
  console.log('вкладки', tabs.join(','));
  for (const t of tabs) {
    await prof(page, cdp, `вкладка ленты ${t}`, async () => { await page.locator(`.st-tabs [data-tab="${t}"]`).click(); }, { n: 8, settle: 300 });
  }
  await page.locator('.st-tabs [data-tab]').first().click();
}
if (only.has('zoom')) {
  await prof(page, cdp, 'колесо с Ctrl над холстом ×20 (масштаб)', async () => {
    const b = await page.locator('#st-canvas').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.keyboard.down('Control');
    for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, i < 10 ? -100 : 100); await page.evaluate(() => new Promise((r) => requestAnimationFrame(r))); }
    await page.keyboard.up('Control');
  }, { n: 16 });
}
await browser.close();
