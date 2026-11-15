// Аудит: загрузка страницы выбора и студии, простой, размер DOM
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:5192';
const browser = await chromium.launch({ executablePath: process.env.SLIDERIA_CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'light' });

async function metrics(cdp) {
  const r = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));
}
const KEYS = ['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'];
const diff = (a, b) => Object.fromEntries(KEYS.map((k) => [k.replace('Duration', ''), Math.round((b[k] - a[k]) * 1000)]));

async function load(url, ready, label) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const reqs = [];
  page.on('response', async (r) => {
    try {
      const len = Number(r.headers()['content-length'] || 0) || (await r.body()).length;
      reqs.push({ url: r.url().replace(BASE, ''), len, type: r.request().resourceType(), status: r.status(), from: r.fromServiceWorker() ? 'sw' : '' });
    } catch { /* тело недоступно */ }
  });
  await page.addInitScript(() => {
    window.__lt = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(BASE + url);
  await page.waitForSelector(ready);
  const tReady = Date.now() - t0;
  await page.waitForTimeout(3000);
  const m1 = await metrics(cdp);
  const info = await page.evaluate(() => ({
    nodes: document.querySelectorAll('*').length,
    canvases: document.querySelectorAll('canvas').length,
    iframes: document.querySelectorAll('iframe').length,
    slides: document.querySelectorAll('.slide').length,
    styles: document.querySelectorAll('style').length,
    sheets: document.styleSheets.length,
    rules: [...document.styleSheets].reduce((s, sh) => { try { return s + sh.cssRules.length; } catch { return s; } }, 0),
    anims: document.getAnimations().length,
    animsRunning: document.getAnimations().filter((a) => a.playState === 'running').length,
    lt: window.__lt,
    nav: (() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) }; })(),
    paint: performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]),
  }));
  // Простой: 5 секунд без действий
  const a = await metrics(cdp);
  await page.waitForTimeout(5000);
  const b = await metrics(cdp);
  const byType = {};
  for (const r of reqs) { const t = byType[r.type] ??= { n: 0, bytes: 0 }; t.n++; t.bytes += r.len; }
  console.log(`\n=== ${label} (${url}) ===`);
  console.log('ready ms', tReady, 'nav', info.nav, 'paint', JSON.stringify(info.paint));
  console.log('requests', reqs.length, 'bytes', reqs.reduce((s, r) => s + r.len, 0), JSON.stringify(byType));
  console.log('top requests:', reqs.sort((x, y) => y.len - x.len).slice(0, 14).map((r) => `${r.url.slice(0, 70)} ${r.len}`).join('\n  '));
  console.log('total load work', JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, Math.round(m1[k] * 1000)]))), 'heapMB', Math.round(m1.JSHeapUsedSize / 1048576), 'nodes(cdp)', m1.Nodes, 'listeners', m1.JSEventListeners);
  console.log('dom', JSON.stringify({ ...info, lt: undefined, nav: undefined, paint: undefined }));
  console.log('longtasks', JSON.stringify(info.lt));
  console.log('idle 5s work', JSON.stringify(diff(a, b)));
  return { page, cdp };
}

const what = process.argv[2] || 'all';
if (what === 'all' || what === 'picker') { const { page } = await load('/', '.pk, #pk, [class*="pk-"]', 'страница выбора'); await page.close(); }
if (what === 'all' || what === 'studio') { const { page } = await load('/?deck=tpl&studio', '#st-canvas .slide.on', 'студия tpl (31 слайд)'); await page.close(); }
if (what === 'all' || what === 'studio2') { const { page } = await load('/?deck=tpl&studio', '#st-canvas .slide.on', 'студия tpl, второй раз (кэш)'); await page.close(); }
if (what === 'all' || what === 'show') { const { page } = await load('/?deck=tpl', '.slide.on', 'показ tpl'); await page.close(); }
await browser.close();
