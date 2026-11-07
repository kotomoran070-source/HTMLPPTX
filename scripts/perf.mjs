// Замеры главных сценариев программы: npm run perf [-- параметры]
// Программа Electron запускается во временных папках (как тесты tests/app), действия — через Playwright:
//   start  — запуск: первый после установки (кэша сервера ещё нет) и обычный — до окна, до сервера, до страницы выбора;
//   open   — студия на «Моей первой презентации» (шаблон, 31 слайд): построена, готова к работе, сколько загружено;
//            второе открытие (перезагрузка страницы);
//   edit   — отклик студии: перетаскивание фигуры, схем, группы, картинки, всех объектов слайда, фигуры
//            с соединителями, диаграммы из текста, графика; растягивание схемы; отпускание; отмена; листание.
//            На каждое — нажатие (выделить), кадр во время перетаскивания, работа браузера на шаг, долгие кадры,
//            самый долгий кадр после отпускания и отмены. Перед каждым — страница успокоилась (нет долгих кадров);
//   export — HTML, PowerPoint, PDF: время и вес файла.
// Каждый сценарий — несколько прогонов (--runs), в таблице медиана и разброс. Итог — в .tmp/perf/ (JSON и таблица)
// и сравнение с базовой линией той же машины: числа разных компьютеров между собой не сравнивают.
// Параметры:
//   --runs N       прогонов (по умолчанию 5)
//   --only a,b     только эти сценарии: start, open, edit, export
//   --cpu K        замедлить страницу в K раз (как слабый ноутбук); запуск программы не замедляется
//   --dpr K        масштаб экрана (2 — как экран высокой чёткости)
//   --label текст  подпись замера (например, этап)
//   --base файл    с чем сравнить (по умолчанию .tmp/perf/baseline.json)
//   --save-base    записать этот замер базовой линией
//   --profile      профиль процессора каждого действия правки (.cpuprofile — открыть в DevTools → Performance)
//                  и самые тяжёлые функции в консоли
//   --trace        запись работы браузера (trace.json — открыть в DevTools → Performance): на что уходит
//                  время перетаскивания и отпускания — скрипты, стили, раскладка, отрисовка
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { _electron as electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const k = argv.indexOf(`--${name}`);
  return k >= 0 && argv[k + 1] !== undefined ? argv[k + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);
const RUNS = Math.max(1, Math.round(Number(opt('runs', 5))) || 5);
const ONLY = new Set(String(opt('only', 'start,open,edit,export')).split(',').map((s) => s.trim()));
const CPU = Math.max(1, Number(opt('cpu', 1)) || 1);
const DPR = Number(opt('dpr', 0)) || 0;
const LABEL = String(opt('label', ''));
const OUT = path.join(root, '.tmp', 'perf');
const BASE = path.resolve(String(opt('base', path.join(OUT, 'baseline.json'))));
const PROFILE = flag('profile');
const TRACE = flag('trace');

// Linux без экрана (сервер, контейнер): тот же запуск под виртуальным экраном
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.SLIDERIA_PERF_XVFB) {
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', process.execPath, ...process.argv.slice(1)], {
    stdio: 'inherit', env: { ...process.env, SLIDERIA_PERF_XVFB: '1' },
  });
  if (r.error) {
    console.error('Нет экрана: установите xvfb (xvfb-run) или запустите там, где есть экран');
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

// ---------------- результаты ----------------

/** ключ → { group, name, unit, values } ; unit: ms | B | n */
const res = new Map();
function put(key, group, name, unit, v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return;
  let r = res.get(key);
  if (!r) res.set(key, (r = { group, name, unit, values: [] }));
  r.values.push(Math.round(v * 10) / 10);
}
const notes = [];
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};

// ---------------- программа ----------------

const MAIN = 'moya-pervaya-prezentaciya';
const OBJ = 'perf-objects';
const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-perf-'));
let dirN = 0;
/** Чистые папки: документы (их ещё нет — первый запуск создаст), данные программы, сохранённые файлы */
function freshDirs() {
  const d = path.join(tmpRoot, String(dirN++));
  const dirs = { docs: path.join(d, 'docs'), data: path.join(d, 'data'), saves: path.join(d, 'saves') };
  fs.mkdirSync(dirs.saves, { recursive: true });
  return dirs;
}

async function launch(dirs) {
  const t0 = performance.now();
  const app = await electron.launch({
    args: ['.', ...sandbox, ...(DPR ? [`--force-device-scale-factor=${DPR}`] : [])],
    env: { ...process.env, SLIDERIA_DOCS_DIR: dirs.docs, SLIDERIA_USER_DATA: dirs.data, SLIDERIA_SAVE_DIR: dirs.saves },
    timeout: 120_000,
  });
  // Первым может появиться слой заставки — время окна по нему; страница программы — окно своего сервера
  await app.firstWindow();
  const tWin = performance.now() - t0;
  let win;
  while (!(win = app.windows().find((w) => w.url().startsWith('http://127.')))) {
    if (performance.now() - t0 > 300_000) throw new Error('Окно программы не открыло страницу сервера');
    await new Promise((r) => setTimeout(r, 20));
  }
  await win.waitForURL(/\/\?all$/, { waitUntil: 'commit', timeout: 300_000 });
  const tServer = performance.now() - t0;
  await win.locator('.pk-card').first().waitFor({ timeout: 300_000 });
  const tPicker = performance.now() - t0;
  return { app, win, t: { win: tWin, server: tServer, picker: tPicker } };
}

const frames = (win, n = 1) => win.evaluate((n) => new Promise((done) => {
  let k = 0;
  const f = () => (++k >= n ? done() : requestAnimationFrame(f));
  requestAnimationFrame(f);
}), n);

async function metrics(cdp) {
  const r = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));
}
const work = (a, b, k) => Math.round((b[k] - a[k]) * 1000 * 10) / 10;

/**
 * Открыть студию: «построена» — студия нарисовала слайды и ленту (метка slideria:studio),
 * «готова» — после неё секунда без долгих кадров (Long Animation Frames): страница больше ничем не занята
 */
async function openStudio(win, cdp, deck) {
  let bytes = 0;
  let files = 0;
  const fin = (e) => { bytes += e.encodedDataLength; files++; };
  cdp.on('Network.loadingFinished', fin);
  await cdp.send('Network.enable');
  const u = new URL(win.url());
  u.search = `?deck=${deck}&studio`;
  u.hash = '';
  const t0 = performance.now();
  await win.goto(u.toString(), { waitUntil: 'commit' });
  await win.locator('#st-canvas .slide.on').first().waitFor({ timeout: 120_000 });
  const tSeen = performance.now() - t0;
  const r = await win.evaluate(async () => {
    const mk = (n) => performance.getEntriesByName(`slideria:${n}`)[0]?.startTime ?? 0;
    const longs = [];
    const po = new PerformanceObserver((l) => longs.push(...l.getEntries()));
    po.observe({ type: 'long-animation-frame', buffered: true });
    const end = () => longs.reduce((m, e) => Math.max(m, e.startTime + e.duration), mk('studio'));
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => (performance.now() - end() > 1000 || performance.now() - t0 > 20_000 ? done() : setTimeout(tick, 100));
      tick();
    });
    po.disconnect();
    return { code: mk('studio-code'), studio: mk('studio'), ready: end(), longs: longs.filter((e) => e.duration > 50).length };
  });
  cdp.off('Network.loadingFinished', fin);
  await cdp.send('Network.disable');
  return { ...r, seen: tSeen, bytes, files };
}

// ---------------- правка ----------------

const T = YAML.parse(fs.readFileSync(path.join(root, 'templates', 'basic', 'deck.yaml'), 'utf8'));
const O = YAML.parse(fs.readFileSync(path.join(root, 'tests', 'perf', 'objects', 'deck.yaml'), 'utf8'));
/** Слайд и номер свободного объекта по id слайда и признаку объекта */
function at(deck, id, pick) {
  const i = deck.slides.findIndex((s) => s.id === id);
  const k = i < 0 ? -1 : (deck.slides[i].free ?? []).findIndex(pick);
  if (k < 0) throw new Error(`perf: на слайде «${id}» нет нужного объекта`);
  return [i, k];
}
const type = (t) => (b) => b?.type === t;
const EDITS = [
  { key: 'shape', name: 'фигура', deck: MAIN, at: at(T, 'contents', type('shape')) },
  { key: 'cycle', name: 'схема «цикл»', deck: MAIN, at: at(T, 'schemes', type('cycle')) },
  { key: 'cycle-size', name: 'схема «цикл»: растянуть', deck: MAIN, at: at(T, 'schemes', type('cycle')), mode: 'resize' },
  { key: 'roadmap', name: 'схема «дорожная карта»', deck: MAIN, at: at(T, 'roadmap', type('roadmap')) },
  { key: 'group', name: 'группа', deck: MAIN, at: at(T, 'design', type('group')) },
  { key: 'image', name: 'картинка', deck: MAIN, at: at(T, 'media', type('image')) },
  { key: 'all', name: `все объекты слайда (${T.slides.find((s) => s.id === 'flows').free.length})`, deck: MAIN, at: at(T, 'flows', type('shape')), mode: 'all' },
  { key: 'linked', name: 'фигура с соединителями', deck: OBJ, at: at(O, 'links', (b) => b.id === 'n3') },
  { key: 'diagram', name: 'диаграмма из текста', deck: OBJ, at: at(O, 'diagrams', type('diagram')) },
  { key: 'chart', name: 'график', deck: OBJ, at: at(O, 'charts', type('lines')) },
];
const STEPS = 60;

/**
 * Страница успокоилась: quiet мс без долгих кадров (Long Animation Frames). Слайд с видео или 3D-моделью
 * после перехода ещё загружается — замер действия не должен попадать на эту работу
 */
const settle = (win, quiet = 400) => win.evaluate(async (quiet) => {
  const longs = [];
  const po = new PerformanceObserver((l) => longs.push(...l.getEntries()));
  po.observe({ type: 'long-animation-frame' });
  const t0 = performance.now();
  let last = t0;
  await new Promise((done) => {
    const tick = () => {
      for (const e of longs.splice(0)) last = Math.max(last, e.startTime + e.duration);
      if (performance.now() - last > quiet || performance.now() - t0 > 8000) done();
      else setTimeout(tick, 50);
    };
    tick();
  });
  po.disconnect();
}, quiet);

async function gotoSlide(win, i) {
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  await win.evaluate((n) => { location.hash = `#${n + 1}`; }, i);
  await win.locator(`.st-thumb.cur[data-i="${i}"]`).waitFor();
  await win.locator('#st-canvas').click({ position: { x: 4, y: 4 } });
  await frames(win, 3);
  await settle(win);
}

/** Самый долгий кадр за время после действия: заминка, которую видно глазом */
async function longestFrame(win, act, ms = 300) {
  await win.evaluate(recStart);
  const t0 = performance.now();
  await act();
  await frames(win, 2);
  const t = performance.now() - t0;
  await win.waitForTimeout(ms);
  const gaps = await win.evaluate(recStop);
  return { t, max: gaps.length ? Math.max(...gaps) : NaN };
}

/** В странице: каждый кадр (requestAnimationFrame) — его время; долгие кадры — с подписью скриптов */
const recStart = () => {
  const w = window;
  w.__perf = { t: [], on: true };
  const f = (ts) => { if (!w.__perf.on) return; w.__perf.t.push(ts); requestAnimationFrame(f); };
  requestAnimationFrame(f);
};
const recStop = () => {
  const w = window;
  w.__perf.on = false;
  const t = w.__perf.t;
  return t.slice(1).map((v, k) => v - t[k]);
};

async function profileStart(cdp) {
  if (!PROFILE) return;
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
}
async function profileStop(cdp, key) {
  if (!PROFILE) return;
  const { profile } = await cdp.send('Profiler.stop');
  const dir = path.join(OUT, 'profiles');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}.cpuprofile`), JSON.stringify(profile));
  // Собственное время функций: сумма интервалов, на которых функция была наверху стека
  // и полное время (с вызванными) — у функций проекта: какой шаг дорогой целиком
  const self = new Map();
  const total = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const nameOf = (n) => {
    const cf = n.callFrame;
    const file = cf.url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
    return `${cf.functionName || '(анонимная)'}  ${file ? `${file}:${cf.lineNumber + 1}` : ''}`.trim();
  };
  profile.samples.forEach((id, k) => {
    const ms = (profile.timeDeltas[k] ?? 0) / 1000;
    const name = nameOf(byId.get(id));
    self.set(name, (self.get(name) ?? 0) + ms);
    const seen = new Set();
    for (let x = id; x !== undefined; x = parent.get(x)) {
      const nm = nameOf(byId.get(x));
      if (!nm.includes('/src/') || seen.has(nm)) continue;
      seen.add(nm);
      total.set(nm, (total.get(nm) ?? 0) + ms);
    }
  });
  const top = (m, n) => [...m].filter(([k]) => !/^\((idle|program|garbage collector|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log(`  профиль «${key}» — собственное время:`);
  for (const [n, ms] of top(self, 10)) console.log(`    ${ms.toFixed(1).padStart(7)} мс  ${n}`);
  console.log('  с вызванными (код проекта):');
  for (const [n, ms] of top(total, 14)) console.log(`    ${ms.toFixed(1).padStart(7)} мс  ${n}`);
}

// Запись работы браузера: собственное время событий главного потока страницы — до отпускания и после
let traceEvents = [];
const tracing = new WeakSet();
async function traceStart(cdp) {
  if (!TRACE) return;
  traceEvents = [];
  if (!tracing.has(cdp)) {
    tracing.add(cdp);
    cdp.on('Tracing.dataCollected', (e) => traceEvents.push(...e.value));
  }
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,blink.user_timing,v8.execute', transferMode: 'ReportEvents' });
}
async function traceStop(cdp, key, steps) {
  if (!TRACE) return;
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  await done;
  const dir = path.join(OUT, 'traces');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({ traceEvents }));
  const mains = traceEvents.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const count = (m) => traceEvents.filter((e) => e.pid === m.pid && e.tid === m.tid).length;
  const main = mains.sort((a, b) => count(b) - count(a))[0];
  if (!main) return;
  const up = traceEvents.find((e) => e.name === 'perf:up')?.ts ?? Infinity;
  const mv = traceEvents.find((e) => e.name === 'perf:move')?.ts ?? -Infinity;
  const xs = traceEvents.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && e.dur > 0).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  // Собственное время: длительность события минус вложенные
  const self = [new Map(), new Map(), new Map()];
  const stack = [];
  const add = (e, ms) => { const m = self[e.ts < mv ? 2 : e.ts < up ? 0 : 1]; m.set(e.name, (m.get(e.name) ?? 0) + ms); };
  for (const e of xs) {
    while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) add(parent, -Math.min(e.dur, parent.ts + parent.dur - e.ts) / 1000);
    add(e, e.dur / 1000);
    stack.push(e);
  }
  const top = (m, k) => [...m].filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, v]) => `${(v / k).toFixed(1).padStart(6)} мс  ${n}`);
  if (self[2].size) console.log(`  работа браузера «${key}» — нажатие (выделение):\n    ${top(self[2], 1).join('\n    ')}`);
  console.log(`  работа браузера «${key}» — на шаг перетаскивания:\n    ${top(self[0], steps).join('\n    ')}`);
  console.log(`  отпускание:\n    ${top(self[1], 1).join('\n    ')}`);
}

/** Перетащить объект (или растянуть за угол) по петле: STEPS движений, по одному на кадр */
async function editCase(win, cdp, c) {
  await gotoSlide(win, c.at[0]);
  const sel = `#st-canvas .slide.on [data-free='${JSON.stringify(['slides', c.at[0], 'free', c.at[1]])}']`;
  const el = win.locator(sel).first();
  await el.waitFor();
  const b0 = await el.boundingBox();
  let x0 = b0.x + b0.width / 2;
  let y0 = b0.y + b0.height / 2;
  let amp = [140, 70];
  if (c.mode === 'all') {
    await win.keyboard.press('Control+a');
    await frames(win, 2);
    await settle(win);
  }
  if (c.mode === 'resize') {
    await win.mouse.click(x0, y0);
    await frames(win, 2);
    await settle(win);
    const h = await win.locator('#ed-frame i.h-se').boundingBox();
    x0 = h.x + h.width / 2;
    y0 = h.y + h.height / 2;
    amp = [90, 45];
  }
  const pt = (k) => {
    const t = k / STEPS;
    return [x0 + amp[0] * Math.sin(2 * Math.PI * t) + 40 * t, y0 + amp[1] * Math.sin(4 * Math.PI * t) + 30 * t];
  };
  await win.mouse.move(x0, y0);
  await frames(win, 2);
  await profileStart(cdp);
  await traceStart(cdp);
  // Нажатие: объект выделяется (панель свойств, вкладка объекта) — до первого движения
  const d0 = performance.now();
  await win.mouse.down();
  await frames(win, 2);
  const down = performance.now() - d0;
  await win.evaluate(recStart);
  if (TRACE) await win.evaluate(() => performance.mark('perf:move'));
  const m0 = await metrics(cdp);
  for (let k = 1; k <= STEPS; k++) {
    await win.mouse.move(...pt(k));
    await frames(win, 1);
  }
  const m1 = await metrics(cdp);
  const gaps = await win.evaluate(recStop);
  if (TRACE) await win.evaluate(() => performance.mark('perf:up'));
  const rel = await longestFrame(win, () => win.mouse.up());
  const up = rel.t;
  const m2 = await metrics(cdp);
  await profileStop(cdp, c.key);
  await traceStop(cdp, c.key, STEPS);
  // Проверка: объект действительно сдвинулся (растянулся) — иначе числа ни о чём
  const b1 = await el.boundingBox();
  const changed = c.mode === 'resize' ? Math.abs(b1.width - b0.width) > 10 : Math.abs(b1.x - b0.x) + Math.abs(b1.y - b0.y) > 20;
  if (!changed) notes.push(`«${c.name}»: объект не сдвинулся — замер недействителен`);
  // Отмена — и всё как было
  await settle(win);
  const z = await longestFrame(win, () => win.keyboard.press('Control+z'));
  const undo = z.t;
  const g = `Правка: ${c.name}`;
  if (!c.mode) put(`edit.${c.key}.down`, g, 'нажать (выделить)', 'ms', down);
  put(`edit.${c.key}.frame`, g, 'кадр, медиана', 'ms', median(gaps));
  put(`edit.${c.key}.frame95`, g, 'кадр, 95%', 'ms', pct(gaps, 95));
  put(`edit.${c.key}.long`, g, 'кадров дольше 50 мс', 'n', gaps.filter((v) => v > 50).length);
  put(`edit.${c.key}.work`, g, 'работа на шаг', 'ms', work(m0, m1, 'TaskDuration') / STEPS);
  put(`edit.${c.key}.script`, g, '  из неё скрипты', 'ms', work(m0, m1, 'ScriptDuration') / STEPS);
  put(`edit.${c.key}.style`, g, '  стили', 'ms', work(m0, m1, 'RecalcStyleDuration') / STEPS);
  put(`edit.${c.key}.layout`, g, '  раскладка', 'ms', work(m0, m1, 'LayoutDuration') / STEPS);
  put(`edit.${c.key}.up`, g, 'отпустить', 'ms', up);
  put(`edit.${c.key}.upmax`, g, '  самый долгий кадр', 'ms', rel.max);
  put(`edit.${c.key}.upwork`, g, '  работа', 'ms', work(m1, m2, 'TaskDuration'));
  put(`edit.${c.key}.undo`, g, 'отменить', 'ms', undo);
  put(`edit.${c.key}.undomax`, g, '  самый долгий кадр', 'ms', z.max);
}

/** Листание: 30 слайдов подряд PageDown — от нажатия до кадра с новым слайдом */
async function flipCase(win, cdp) {
  await gotoSlide(win, 0);
  await profileStart(cdp);
  await traceStart(cdp);
  const m0 = await metrics(cdp);
  const t = await win.evaluate(async (n) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const out = [];
    for (let i = 0; i < n; i++) {
      await raf();
      const t0 = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
      await raf();
      await raf();
      out.push(performance.now() - t0);
    }
    return out;
  }, T.slides.length - 1);
  const m1 = await metrics(cdp);
  await profileStop(cdp, 'flip');
  await traceStop(cdp, 'flip', T.slides.length - 1);
  const g = 'Правка: листать слайды';
  put('edit.flip.t', g, 'до нового слайда, медиана', 'ms', median(t));
  put('edit.flip.t95', g, 'до нового слайда, 95%', 'ms', pct(t, 95));
  put('edit.flip.work', g, 'работа на слайд', 'ms', work(m0, m1, 'TaskDuration') / t.length);
}

// ---------------- экспорт ----------------

async function exportCase(win, saves, mode, ext, toast) {
  for (const f of fs.readdirSync(saves)) fs.rmSync(path.join(saves, f), { force: true, recursive: true });
  await win.evaluate(() => { const t = document.getElementById('ed-toast'); if (t) t.textContent = ''; });
  await win.locator('[data-cmd="file.export"]').first().click();
  const t0 = performance.now();
  await win.locator(`[data-x="${mode}"]`).click();
  await win.waitForFunction((s) => document.getElementById('ed-toast')?.textContent?.includes(s), toast, { timeout: 600_000, polling: 50 });
  const t = performance.now() - t0;
  const file = fs.readdirSync(saves).find((f) => f.endsWith(ext));
  return { t, size: file ? fs.statSync(path.join(saves, file)).size : NaN };
}

// ---------------- прогоны ----------------

async function run(n, shared) {
  const dirs = shared ?? freshDirs();
  if (!shared || !fs.existsSync(dirs.docs)) {
    // Первый запуск: программа создаёт «Мою первую презентацию» и кэш сервера
    const first = await launch(dirs);
    if (ONLY.has('start') && n >= 0) {
      put('start.first.win', 'Запуск: первый после установки', 'окно', 'ms', first.t.win);
      put('start.first.server', 'Запуск: первый после установки', 'сервер', 'ms', first.t.server);
      put('start.first.picker', 'Запуск: первый после установки', 'страница выбора', 'ms', first.t.picker);
    }
    await first.app.close();
    fs.cpSync(path.join(root, 'tests', 'perf', 'objects'), path.join(dirs.docs, OBJ), { recursive: true });
  }
  if (n < 0) return dirs;
  const { app, win, t } = await launch(dirs);
  try {
    if (ONLY.has('start')) {
      put('start.warm.win', 'Запуск: обычный', 'окно', 'ms', t.win);
      put('start.warm.server', 'Запуск: обычный', 'сервер', 'ms', t.server);
      put('start.warm.picker', 'Запуск: обычный', 'страница выбора', 'ms', t.picker);
    }
    if (!shared || n === 0) meta.electron ??= await app.evaluate(() => `${process.versions.electron} (Chromium ${process.versions.chrome})`);
    const cdp = await win.context().newCDPSession(win);
    await cdp.send('Performance.enable');
    if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    const o1 = await openStudio(win, cdp, MAIN);
    if (ONLY.has('open')) {
      const g = `Студия: открыть (${T.slides.length} слайд)`;
      put('open.first.studio', g, 'построена', 'ms', o1.studio);
      put('open.first.ready', g, 'готова к работе', 'ms', o1.ready);
      put('open.first.files', g, 'загружено файлов', 'n', o1.files);
      put('open.first.bytes', g, 'загружено', 'B', o1.bytes);
      const o2 = await openStudio(win, cdp, MAIN);
      const g2 = 'Студия: открыть второй раз';
      put('open.again.studio', g2, 'построена', 'ms', o2.studio);
      put('open.again.ready', g2, 'готова к работе', 'ms', o2.ready);
    }
    if (ONLY.has('edit')) {
      for (const c of EDITS.filter((e) => e.deck === MAIN)) await guard(c.name, () => editCase(win, cdp, c));
      await guard('листать', () => flipCase(win, cdp));
    }
    if (ONLY.has('export')) {
      const g = 'Экспорт';
      for (const [mode, ext, toast, name] of [['clean', '.html', 'Сохранено', 'HTML'], ['pptx', '.pptx', 'Сохранено', 'PowerPoint'], ['pdf', '.pdf', 'PDF сохранён', 'PDF']]) {
        await guard(`экспорт ${name}`, async () => {
          const r = await exportCase(win, dirs.saves, mode, ext, toast);
          put(`export.${mode}.t`, g, `${name}: время`, 'ms', r.t);
          put(`export.${mode}.size`, 'Вес файла', name, 'B', r.size);
        });
      }
    }
    if (ONLY.has('edit')) {
      await openStudio(win, cdp, OBJ);
      for (const c of EDITS.filter((e) => e.deck === OBJ)) await guard(c.name, () => editCase(win, cdp, c));
    }
  } finally {
    await app.close();
  }
  return dirs;
}

async function guard(what, fn) {
  try {
    await fn();
  } catch (e) {
    notes.push(`${what}: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}

const git = (cmd) => { try { return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const meta = {
  date: new Date().toISOString(),
  label: LABEL,
  commit: git('rev-parse --short HEAD') + (git('status --porcelain -- src desktop scripts templates') ? ' + правки' : ''),
  runs: RUNS,
  cpu: CPU,
  dpr: DPR || 1,
  machine: `${os.type()} ${os.release()}, ${os.cpus()[0]?.model?.trim()} × ${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} ГБ`,
  electron: undefined,
};

// ---------------- вывод ----------------

/** Строки по группам — в порядке первого появления группы */
function ordered() {
  const groups = [...new Set([...res.values()].map((r) => r.group))];
  return groups.flatMap((g) => [...res].filter(([, r]) => r.group === g));
}

const fmt = (unit, v) => {
  if (!Number.isFinite(v)) return '—';
  if (unit === 'B') return v >= 1048576 ? `${(v / 1048576).toFixed(1)} МБ` : `${Math.round(v / 1024)} КБ`;
  if (unit === 'n') return String(Math.round(v));
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} с`;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} мс`;
};

function report(base) {
  const lines = [];
  const row = (a, b, c, d, e) => `| ${a} | ${b} | ${c} | ${d} | ${e} |`;
  const head = `Замер ${meta.date.slice(0, 16).replace('T', ' ')} · ${meta.commit}${meta.label ? ` · ${meta.label}` : ''} · прогонов: ${meta.runs}`
    + `${meta.cpu > 1 ? ` · страница медленнее в ${meta.cpu} раза` : ''}${meta.dpr > 1 ? ` · масштаб экрана ${meta.dpr}` : ''}`;
  lines.push(`**${head}**`, '', `${meta.machine}; Electron ${meta.electron ?? '—'}`, '');
  if (base) lines.push(`Сравнение — с замером ${base.meta.date.slice(0, 16).replace('T', ' ')} · ${base.meta.commit}${base.meta.label ? ` · ${base.meta.label}` : ''}`, '');
  lines.push(row('Сценарий', 'Медиана', 'Разброс', 'Было', 'Изменение'), '|---|---:|---:|---:|---:|');
  let group = '';
  for (const [key, r] of ordered()) {
    if (r.group !== group) {
      group = r.group;
      lines.push(row(`**${group}**`, '', '', '', ''));
    }
    const m = median(r.values);
    const spread = r.values.length > 1 ? `${fmt(r.unit, Math.min(...r.values))} – ${fmt(r.unit, Math.max(...r.values))}` : '';
    const b = base?.results?.[key];
    const bm = b ? median(b.values) : NaN;
    const d = Number.isFinite(bm) && bm !== 0 ? Math.round(((m - bm) / bm) * 100) : NaN;
    lines.push(row(r.name.trim() === r.name ? r.name : `  ${r.name.trim()}`, fmt(r.unit, m), spread, Number.isFinite(bm) ? fmt(r.unit, bm) : '', Number.isFinite(d) ? `${d > 0 ? '+' : ''}${d} %` : ''));
  }
  if (notes.length) lines.push('', 'Замечания:', ...[...new Set(notes)].map((n) => `- ${n}`));
  return lines.join('\n');
}

function printTable(base) {
  const pad = (s, n, left) => (left ? String(s).padEnd(n) : String(s).padStart(n));
  console.log('');
  let group = '';
  for (const [key, r] of ordered()) {
    if (r.group !== group) {
      group = r.group;
      console.log(`\n${group}`);
    }
    const m = median(r.values);
    const b = base?.results?.[key];
    const bm = b ? median(b.values) : NaN;
    const d = Number.isFinite(bm) && bm !== 0 ? Math.round(((m - bm) / bm) * 100) : NaN;
    console.log(`  ${pad(r.name, 34, true)}${pad(fmt(r.unit, m), 10)}${pad(Number.isFinite(bm) ? fmt(r.unit, bm) : '', 11)}${pad(Number.isFinite(d) ? `${d > 0 ? '+' : ''}${d} %` : '', 9)}`);
  }
  if (notes.length) console.log(`\nЗамечания:\n${[...new Set(notes)].map((n) => `  ${n}`).join('\n')}`);
}

// ---------------- запуск ----------------

try {
  console.log(`Замеры: ${[...ONLY].join(', ')}; прогонов: ${RUNS}${CPU > 1 ? `; замедление ×${CPU}` : ''}`);
  // Прогрев: диск (Electron, node_modules) уже прочитан — первый прогон не выбивается из ряда
  console.log('Прогрев…');
  const shared = ONLY.has('start') ? null : await run(-1, null);
  if (ONLY.has('start')) await (await launch(freshDirs())).app.close();
  for (let n = 0; n < RUNS; n++) {
    const t0 = Date.now();
    await run(n, shared);
    console.log(`Прогон ${n + 1} из ${RUNS}: ${Math.round((Date.now() - t0) / 1000)} с`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const base = fs.existsSync(BASE) && !flag('save-base') ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : null;
  const data = { meta, results: Object.fromEntries(ordered()), notes };
  const stamp = meta.date.slice(0, 19).replace(/[:T]/g, '-');
  fs.writeFileSync(path.join(OUT, `${stamp}.json`), JSON.stringify(data, null, 1));
  fs.writeFileSync(path.join(OUT, `${stamp}.md`), `${report(base)}\n`);
  fs.writeFileSync(path.join(OUT, 'last.md'), `${report(base)}\n`);
  if (flag('save-base')) fs.writeFileSync(BASE, JSON.stringify(data, null, 1));
  printTable(base);
  console.log(`\nТаблица: .tmp/perf/${stamp}.md${flag('save-base') ? '; записан базовой линией' : base ? '' : '; базовой линии нет (--save-base)'}`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
