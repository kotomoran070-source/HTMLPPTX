// Аудит: профиль процессора по действиям студии (на yarn dev — имена функций и файлы читаемы)
import fs from 'node:fs';
import { chromium } from '@playwright/test';

export const BASE = process.env.BASE || 'http://localhost:5193';
const KEYS = ['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'];

export async function open() {
  const browser = await chromium.launch({ executablePath: process.env.SLIDERIA_CHROMIUM || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  return { browser, ctx, page, cdp };
}

export async function metrics(cdp) {
  const r = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));
}
export const diff = (a, b) => Object.fromEntries(KEYS.map((k) => [k.replace('Duration', ''), Math.round((b[k] - a[k]) * 1000)]));

/** Самые тяжёлые функции профиля: своё время и суммарно по файлам */
export function top(profile, n = 22) {
  const { nodes, samples, timeDeltas } = profile;
  const byId = new Map(nodes.map((x) => [x.id, x]));
  const self = new Map();
  for (let i = 0; i < samples.length; i++) self.set(samples[i], (self.get(samples[i]) || 0) + (timeDeltas[i] || 0));
  const fn = new Map();
  const file = new Map();
  let total = 0;
  for (const [id, us] of self) {
    const c = byId.get(id).callFrame;
    if (c.functionName === '(idle)' || c.functionName === '(program)') continue;
    total += us;
    const u = c.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
    const k = `${c.functionName || '(anon)'} ${u}:${c.lineNumber + 1}`;
    fn.set(k, (fn.get(k) || 0) + us);
    file.set(u || '(native)', (file.get(u || '(native)') || 0) + us);
  }
  // Суммарное время (с вложенными) по функциям своего кода
  const parent = new Map();
  for (const x of nodes) for (const ch of x.children || []) parent.set(ch, x.id);
  const incl = new Map();
  for (const [id, us] of self) {
    const seen = new Set();
    for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
      const c = byId.get(cur).callFrame;
      if (!c.url.includes('/src/') && !c.url.includes('/plugins/')) continue;
      const k = `${c.functionName || '(anon)'} ${c.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')}:${c.lineNumber + 1}`;
      if (seen.has(k)) continue;
      seen.add(k);
      incl.set(k, (incl.get(k) || 0) + us);
    }
  }
  const fmt = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => `  ${(us / 1000).toFixed(1).padStart(7)} мс  ${k}`).join('\n');
  return `всего в скриптах ${(total / 1000).toFixed(0)} мс\n— своё время:\n${fmt(fn)}\n— по файлам:\n${fmt(file)}\n— вместе с вложенными (свой код):\n${fmt(incl)}`;
}

export async function prof(page, cdp, name, fn, { n = 18, settle = 250 } = {}) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const a = await metrics(cdp);
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  const r = await fn();
  await page.waitForTimeout(settle);
  const wall = Date.now() - t0 - settle;
  const { profile } = await cdp.send('Profiler.stop');
  const b = await metrics(cdp);
  fs.mkdirSync('.tmp/zz-prof', { recursive: true });
  fs.writeFileSync(`.tmp/zz-prof/${name.replace(/[^\wа-яё]+/gi, '_')}.cpuprofile`, JSON.stringify(profile));
  console.log(`\n##### ${name}: ${wall} мс; работа браузера ${JSON.stringify(diff(a, b))}${r !== undefined ? ` · ${JSON.stringify(r)}` : ''}`);
  console.log(top(profile, n));
}

/** n раз действие, после каждого — два кадра; длительности кадров */
export const frames = (page, n, body) => page.evaluate(async ([n, body]) => {
  const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const step = new Function('i', body);
  const ts = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); step(i); await raf(); ts.push(Math.round(performance.now() - t)); }
  return ts;
}, [n, body]);
