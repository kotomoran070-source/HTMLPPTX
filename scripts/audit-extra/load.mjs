// Профиль открытия студии и показа
import { BASE, open, prof } from './prof.mjs';

const deck = process.argv[2] || 'tpl';
const { browser, page, cdp } = await open();
// Прогрев сервера разработки (преобразование модулей) и та же вкладка-источник для профиля
await page.goto(`${BASE}/?deck=${deck}&studio`);
await page.waitForSelector('#st-canvas .slide.on');
await page.waitForTimeout(3000);
await page.goto(`${BASE}/src/styles/tokens.css`);
await prof(page, cdp, `открыть студию ${deck}`, async () => {
  await page.goto(`${BASE}/?deck=${deck}&studio`);
  await page.waitForSelector('#st-canvas .slide.on');
  await page.waitForTimeout(3500);
}, { n: 40, settle: 0 });
await page.goto(`${BASE}/src/styles/tokens.css`);
await prof(page, cdp, `открыть показ ${deck}`, async () => {
  await page.goto(`${BASE}/?deck=${deck}`);
  await page.waitForSelector('.slide.on');
  await page.waitForTimeout(1500);
}, { n: 25, settle: 0 });
await browser.close();
