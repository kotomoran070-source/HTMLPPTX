import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:5192';
const deck = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.SLIDERIA_CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'light' });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
let bytes = 0, n = 0; const types = {};
page.on('response', async (r) => { try { const len = Number(r.headers()['content-length'] || 0); bytes += len; n++; const t = r.request().resourceType(); types[t] = (types[t] || 0) + len; } catch {} });
await page.addInitScript(() => { window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); });
const t0 = Date.now();
await page.goto(`${BASE}/?deck=${deck}&studio`);
await page.waitForSelector('#st-canvas .slide.on');
const ready = Date.now() - t0;
await page.waitForTimeout(6000);
const m = await metrics();
const info = await page.evaluate(() => ({ slides: document.querySelectorAll('#st-canvas .slide').length, nodes: document.querySelectorAll('*').length, img: document.querySelectorAll('img').length, imgLoaded: [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth).length, px: [...document.querySelectorAll('img')].reduce((s, i) => s + i.naturalWidth * i.naturalHeight, 0), lt: window.__lt }));
console.log(deck, 'слайд виден через', ready, 'мс; запросов', n, 'байт', bytes, JSON.stringify(types));
console.log('  слайдов', info.slides, 'узлов', info.nodes, 'img', info.img, 'загружено', info.imgLoaded, 'сумма точек картинок (МП)', Math.round(info.px / 1e6), '→ в памяти до', Math.round(info.px * 4 / 1048576), 'МБ, если все раскодировать');
console.log('  работа при открытии', Math.round(m.TaskDuration * 1000), 'мс, скрипты', Math.round(m.ScriptDuration * 1000), 'мс; куча JS', Math.round(m.JSHeapUsedSize / 1048576), 'МБ; долгие задачи', JSON.stringify(info.lt));
// Прокрутка ленты миниатюр вниз-вверх: кадры
const fr = await page.evaluate(async () => {
  const list = document.querySelector('.st-slides-list');
  const sc = [list, list.parentElement].find((e) => e.scrollHeight > e.clientHeight + 10) || list;
  const ts = []; let on = true; const f = (t) => { if (!on) return; ts.push(t); requestAnimationFrame(f); }; requestAnimationFrame(f);
  const max = sc.scrollHeight - sc.clientHeight;
  for (let k = 0; k <= 60; k++) { sc.scrollTop = (max * k) / 60; await new Promise((r) => requestAnimationFrame(r)); }
  for (let k = 60; k >= 0; k--) { sc.scrollTop = (max * k) / 60; await new Promise((r) => requestAnimationFrame(r)); }
  on = false;
  const g = ts.slice(1).map((v, i) => v - ts[i]);
  return { max, кадров: g.length, дольше33: g.filter((v) => v > 33).length, дольше50: g.filter((v) => v > 50).length, самый: Math.round(Math.max(...g)) };
});
console.log('  прокрутка ленты миниатюр (120 шагов):', JSON.stringify(fr));
const p = await (await ctx.newCDPSession(page)).send('Memory.getAllTimeSamplingProfile').catch(() => null);
await browser.close();
