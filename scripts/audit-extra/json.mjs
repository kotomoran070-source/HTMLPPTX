// Сколько JSON сериализуется и разбирается на одну правку (сдвиг объекта) вместе с автосохранением
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.SLIDERIA_CHROMIUM || undefined });
for (const deck of process.argv.slice(2)) {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await page.goto(`http://127.0.0.1:5192/?deck=${deck}&studio`);
  await page.waitForSelector('#st-canvas .slide.on');
  await page.waitForTimeout(4000);
  const size = await page.evaluate(async (d) => (await (await fetch(`/__slideria/deck/${d}`)).text()).length, deck);
  await page.evaluate(() => {
    const s = JSON.stringify, p = JSON.parse;
    window.__j = { sN: 0, sC: 0, pN: 0, pC: 0, sT: 0, pT: 0 };
    JSON.stringify = function (...a) { const t = performance.now(); const r = s.apply(this, a); const j = window.__j; j.sT += performance.now() - t; if (typeof r === 'string') { j.sN++; j.sC += r.length; } return r; };
    JSON.parse = function (...a) { const t = performance.now(); const r = p.apply(this, a); const j = window.__j; j.pT += performance.now() - t; j.pN++; j.pC += String(a[0]).length; return r; };
  });
  const o = page.locator('#st-canvas .slide.on [data-free]').nth(1);
  const b = await o.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 14, b.y + b.height / 2 + 5, { steps: 4 });
  await page.evaluate(() => { Object.assign(window.__j, { sN: 0, sC: 0, pN: 0, pC: 0, sT: 0, pT: 0 }); });
  await page.mouse.up();
  await page.waitForTimeout(4000);
  const j = await page.evaluate(() => window.__j);
  console.log(`${deck}: презентация ${(size / 1024).toFixed(0)} КБ JSON. Одна правка (отпустили объект) + автосохранение: JSON.stringify ${j.sN} вызовов, ${(j.sC / 1024).toFixed(0)} КБ (${(j.sC / size).toFixed(1)} размера презентации), ${j.sT.toFixed(0)} мс; JSON.parse ${j.pN} вызовов, ${(j.pC / 1024).toFixed(0)} КБ (${(j.pC / size).toFixed(1)}×), ${j.pT.toFixed(0)} мс`);
  await page.close();
}
await browser.close();
