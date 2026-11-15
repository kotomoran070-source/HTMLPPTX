// Разные проверки студии: что пересоздаётся при правке, простой без фона, число кнопок-команд, слушателей, медиа скрытых слайдов
import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:5192';
const browser = await chromium.launch({ executablePath: process.env.SLIDERIA_CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'light' });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
const reqs = [];
page.on('request', (r) => reqs.push([r.resourceType(), r.url().replace(BASE, '')]));
await page.goto(`${BASE}/?deck=tpl&studio`);
await page.waitForSelector('#st-canvas .slide.on');
await page.waitForTimeout(5000);

console.log('кнопок с командой [data-cmd]:', await page.evaluate(() => document.querySelectorAll('[data-cmd]').length), '· слушателей событий:', (await metrics()).JSEventListeners, '· узлов:', (await metrics()).Nodes);
console.log('медиа всех слайдов в DOM при открытии:', JSON.stringify(await page.evaluate(() => {
  const st = document.querySelector('#st-canvas');
  const off = (sel) => [...st.querySelectorAll(`.slide:not(.on) ${sel}`)];
  return {
    'img на скрытых слайдах': off('img').length, 'из них загружено': off('img').filter((i) => i.complete && i.naturalWidth > 0).length, 'с loading=lazy': off('img[loading=lazy]').length,
    'video на скрытых': off('video').length, 'video preload': off('video').map((v) => v.preload), 'iframe на скрытых': off('iframe').length, 'iframe src': off('iframe').map((f) => (f.getAttribute('src') || f.getAttribute('srcdoc') || '').slice(0, 40)),
    'model-viewer на скрытых': off('model-viewer').length, 'canvas на скрытых': off('canvas').length,
    'миниатюры: img': document.querySelectorAll('.st-slides-list img').length, 'миниатюры: video/iframe/model': document.querySelectorAll('.st-slides-list :is(video, iframe, model-viewer)').length,
  };
})));
console.log('запросы медиа и вставок при открытии:', reqs.filter(([t]) => t === 'media' || t === 'document' || t === 'image').length, JSON.stringify(reqs.filter(([t, u]) => t === 'media' || (t === 'document' && !u.startsWith('/?')) || /\.(glb|htm)(\?|$)/.test(u)).map(([t, u]) => `${t}:${u.slice(-40)}`)));

// Простой: слайд с живым фоном (титул) и без него (слайд 3)
const idle = async (label) => { await page.waitForTimeout(1500); const a = await metrics(); await page.waitForTimeout(5000); const b = await metrics(); console.log(`простой 5 с, ${label}: работа ${Math.round((b.TaskDuration - a.TaskDuration) * 1000)} мс, скрипты ${Math.round((b.ScriptDuration - a.ScriptDuration) * 1000)} мс, кадров анимации ${await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : r(n); }; requestAnimationFrame(f); }))}/с`); };
await idle('слайд 1 (живой фон aurora)');
await page.evaluate(() => { location.hash = '#3'; });
await page.waitForTimeout(600);
await idle('слайд 3 (без живого фона)');

// Слайд 20: видео, 3D-модель, картинка. Сдвигаем картинку — что стало с видео и моделью?
await page.evaluate(() => { location.hash = '#20'; });
await page.waitForTimeout(3500);
const mark = () => page.evaluate(() => {
  const s = document.querySelector('#st-canvas .slide.on');
  const out = {};
  for (const sel of ['video', 'model-viewer', 'canvas', 'img', '.backdrop']) { const el = s.querySelector(sel); if (el) { out[sel] = el.__zz === true ? 'тот же' : 'новый'; el.__zz = true; } }
  out.slide = s.__zz === true ? 'тот же' : 'новый'; s.__zz = true;
  return out;
});
await mark();
const before = reqs.length;
const img = page.locator('#st-canvas .slide.on [data-free]').first();
const b = await img.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await page.mouse.down();
await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2 + 6, { steps: 4 });
const m0 = await metrics();
await page.mouse.up();
await page.waitForTimeout(2500);
const m1 = await metrics();
console.log('слайд 20, сдвинули один объект на 12 px — элементы слайда после правки:', JSON.stringify(await mark()));
console.log('  работа после отпускания (2,5 с):', Math.round((m1.TaskDuration - m0.TaskDuration) * 1000), 'мс; скрипты', Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000), 'мс; новые запросы:', JSON.stringify(reqs.slice(before).map(([t, u]) => `${t}:${u.slice(0, 60)}`)));

// Слайд 22 и 30: живая вставка (iframe)
for (const n of [22, 30]) {
  await page.evaluate((n) => { location.hash = `#${n}`; }, n);
  await page.waitForTimeout(2500);
  const fr = () => page.evaluate(() => { const s = document.querySelector('#st-canvas .slide.on'); const f = s.querySelector('iframe'); if (!f) return 'нет iframe'; const r = f.__zz === true ? 'тот же' : 'новый'; f.__zz = true; return r; });
  await fr();
  const o = page.locator('#st-canvas .slide.on [data-free]').first();
  const bb = await o.boundingBox();
  if (!bb) { console.log(`слайд ${n}: нет свободных объектов`); continue; }
  const k = reqs.length;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + 12, bb.y + bb.height / 2 + 6, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(2000);
  console.log(`слайд ${n}, сдвинули объект — iframe вставки: ${await fr()}; новые запросы: ${JSON.stringify(reqs.slice(k).map(([t, u]) => `${t}:${u.slice(0, 50)}`))}`);
}
await browser.close();
