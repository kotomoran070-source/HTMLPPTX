// Программа Electron: заминка ввода в окне, пока главный процесс занят автосохранением
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from '@playwright/test';

const DECK = process.argv[2] || 'moya-pervaya-prezentaciya';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-slideria-'));
const dirs = { docs: path.join(tmp, 'docs'), data: path.join(tmp, 'data'), saves: path.join(tmp, 'saves') };
fs.mkdirSync(dirs.saves, { recursive: true });
const app = await electron.launch({ args: ['.', '--no-sandbox'], env: { ...process.env, SLIDERIA_DOCS_DIR: dirs.docs, SLIDERIA_USER_DATA: dirs.data, SLIDERIA_SAVE_DIR: dirs.saves }, timeout: 120_000 });
await app.firstWindow();
let win;
const t0 = Date.now();
while (!(win = app.windows().find((w) => w.url().startsWith('http://127.')))) { if (Date.now() - t0 > 60000) throw new Error('нет окна'); await new Promise((r) => setTimeout(r, 20)); }
await win.waitForURL(/\/\?all$/, { waitUntil: 'commit' });
await win.locator('.pk-card').first().waitFor();
// Большая презентация: копия шаблона ×K в папку документов
if (process.argv[3]) {
  const YAML = (await import('yaml')).default;
  const k = Number(process.argv[3]);
  const src = path.join(dirs.docs, DECK);
  const dst = path.join(dirs.docs, 'zzbig');
  fs.cpSync(src, dst, { recursive: true });
  const d = YAML.parse(fs.readFileSync(path.join(src, 'deck.yaml'), 'utf8'));
  const base = d.slides; d.slides = [];
  for (let r = 0; r < k; r++) for (const s of base) d.slides.push({ ...structuredClone(s), ...(s.id ? { id: `${s.id}${r ? '-' + r : ''}` } : {}) });
  fs.writeFileSync(path.join(dst, 'deck.yaml'), YAML.stringify(d));
  await win.waitForTimeout(3000);
}
const deck = process.argv[3] ? 'zzbig' : DECK;
const u = new URL(win.url()); u.search = `?deck=${deck}&studio`; u.hash = '';
await win.goto(u.toString(), { waitUntil: 'commit' });
await win.locator('#st-canvas .slide.on').first().waitFor();
await win.waitForTimeout(5000);
console.log('студия открыта');
console.log('слайдов', await win.evaluate(() => document.querySelectorAll('#st-canvas .slide').length));

// Главный процесс: задержка его цикла событий (таймер раз в 5 мс — насколько опоздал)
await app.evaluate(() => {
  globalThis.__lag = [];
  let last = performance.now();
  setInterval(() => { const n = performance.now(); if (n - last > 30) globalThis.__lag.push([Math.round(n), Math.round(n - last - 5)]); last = n; }, 5);
});
// Страница: когда приходят движения мыши и когда уходят и возвращаются запросы сохранения
await win.evaluate(() => {
  window.__mv = [];
  addEventListener('pointermove', (e) => window.__mv.push([performance.now(), performance.now() - e.timeStamp]), true);
  window.__saves = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name.includes('/__htmlpptx/save')) window.__saves.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'resource' });
});

const obj = win.locator('#st-canvas .slide.on [data-free]').first();
const b = await obj.boundingBox();
const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
async function wiggle(ms, label) {
  await win.evaluate(() => { window.__mv = []; });
  await app.evaluate(() => { globalThis.__lag = []; });
  const calls = [];
  const t = Date.now();
  let k = 0;
  while (Date.now() - t < ms) {
    const c0 = performance.now();
    await win.mouse.move(x0 + 60 * Math.sin(k / 9), y0 + 200 + 30 * Math.cos(k / 7));
    calls.push(performance.now() - c0);
    k++;
    await new Promise((r) => setTimeout(r, 8));
  }
  const mv = await win.evaluate(() => window.__mv);
  const gaps = mv.slice(1).map((v, i) => v[0] - mv[i][0]);
  const lag = await app.evaluate(() => globalThis.__lag);
  const saves = await win.evaluate(() => window.__saves.splice(0));
  const big = (a, lim) => a.filter((v) => v > lim).map((v) => Math.round(v));
  console.log(`${label}: движений ${mv.length}; паузы между движениями > 50 мс: ${JSON.stringify(big(gaps, 50))}; самая долгая ${Math.round(Math.max(...gaps))} мс; задержка события (макс) ${Math.round(Math.max(...mv.map((v) => v[1])))} мс; вызов mouse.move макс ${Math.round(Math.max(...calls))} мс`);
  console.log(`   главный процесс стоял (мс): ${JSON.stringify(lag.map((l) => l[1]))}; запросы сохранения (длительность, мс): ${JSON.stringify(saves.map((s) => s[1]))}`);
}

await wiggle(2500, 'без правки (ничего не сохраняется)');
for (let i = 0; i < 3; i++) {
  // Правка: сдвинуть объект на 10 px и отпустить — через 0,6 с автосохранение
  await win.mouse.move(x0, y0);
  await win.mouse.down();
  await win.mouse.move(x0 + 10 + i, y0 + 4, { steps: 3 });
  await win.mouse.up();
  await wiggle(2500, `после правки ${i + 1} (автосохранение через 0,6 с)`);
}
console.log('закрываю');
await Promise.race([app.close(), new Promise((r) => setTimeout(r, 5000))]);
try { app.process().kill('SIGKILL'); } catch {}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
