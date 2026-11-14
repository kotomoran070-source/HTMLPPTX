// Аудит скорости и памяти — то, чего нет в замерах yarn perf (scripts/perf.mjs): node scripts/audit.mjs [параметры]
// Программа Electron во временных папках, как в замерах; к «Моей первой презентации» добавляются презентации проекта
// и тестовые (tests/prepare.mjs) — страница выбора как у живого пользователя, и большая (5 × шаблон, 155 слайдов).
//   load    — открытие студии (31 и 155 слайдов): на что уходит работа (скрипты, стили, раскладка), сколько кода
//             и стилей не пригодилось (покрытие), правил CSS, узлов DOM, памяти JS; самые тяжёлые модули
//             и функции (имена — по картам исходников сборки-двойника, см. --map);
//   idle    — простой: страница выбора, студия, студия с выделенным объектом, показ — работа главного потока
//             за секунду, пересчёты стилей и раскладки, кадры анимации (requestAnimationFrame), таймеры,
//             идущие анимации, процессор каждого процесса программы;
//   smooth  — плавность: прокрутка страницы выбора и ленты слайдов колесом, показ по всем слайдам с переходами —
//             интервалы кадров, пропущенные кадры, долгие кадры (Long Animation Frames) и их виновники;
//   input   — отклик на ввод (Event Timing, как INP в браузерах): вкладки ленты, «Файл», «Темы», «Блоки»,
//             миниатюры, выделение объекта, набор текста; и время до появления панелей;
//   export  — экспорт HTML, PowerPoint, PDF через «Файл → Экспорт»: время, вес, заминки студии, пик памяти;
//   session — долгая работа в студии: N кругов (слайд → выделить → сдвинуть → отменить → вкладки → «Файл»);
//             после каждых 10 — сборка мусора, память JS, узлы DOM (и отцепленные), слушатели, документы;
//             показ — 3 круга по всем слайдам;
//   mem     — память и процессор процессов программы (app.getAppMetrics) после каждого этапа.
// Параметры:
//   --only a,b   только эти сценарии (по умолчанию все)
//   --cycles N   кругов долгой работы (по умолчанию 60); --no-show — без кругов показа
//   --cpu K      замедлить страницу в K раз (слабый ноутбук)
//   --map папка  сборка-двойник с картами исходников (по умолчанию .tmp/audit/studio-map: если её нет —
//                имена функций остаются сжатыми). Собрать: node scripts/audit.mjs --build-map
// Итог — .tmp/audit/audit[-cpuK].json и .md; числа разных компьютеров между собой не сравнивают.
import { spawnSync } from 'node:child_process';
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
const ALL = ['load', 'idle', 'smooth', 'input', 'export', 'session', 'mem'];
const ONLY = new Set(String(opt('only', ALL.join(','))).split(',').map((s) => s.trim()));
const CYCLES = Math.max(10, Number(opt('cycles', 60)) || 60);
const CPU = Math.max(1, Number(opt('cpu', 1)) || 1);
const OUT = path.join(root, '.tmp', 'audit');
const MAP = path.resolve(String(opt('map', path.join(OUT, 'studio-map'))));
fs.mkdirSync(OUT, { recursive: true });

// Сборка-двойник: та же студия, что в программе, с картами исходников (без ссылки на них — файлы те же байт в байт)
if (argv.includes('--build-map')) {
  const { build } = await import('vite');
  Object.assign(process.env, { NODE_ENV: 'production', STUDIO: '1', OUT_DIR: MAP, STUDIO_LICENSES: path.join(OUT, 'licenses.json') });
  fs.rmSync(MAP, { recursive: true, force: true });
  await build({ configFile: path.join(root, 'vite.config.ts'), logLevel: 'warn', build: { sourcemap: 'hidden' } });
  const same = fs.readdirSync(path.join(MAP, 'assets')).filter((f) => f.endsWith('.js') && fs.existsSync(path.join(root, '.tmp', 'app', 'studio', 'assets', f))).length;
  console.log(`✓ двойник: ${MAP}; совпало файлов с программой: ${same}`);
  process.exit(0);
}

// Linux без экрана: под виртуальным экраном, как замеры
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

// ---------------- общее ----------------

const R = {};
const notes = [];
const log = (...a) => console.log(...a);
const dbg = (...a) => { if (argv.includes('--verbose')) console.log('   ·', ...a); };
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN;
};
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};
const r1 = (v) => Math.round(v * 10) / 10;
const MB = (b) => r1(b / 1048576);
async function guard(what, fn) {
  try {
    return await fn();
  } catch (e) {
    notes.push(`${what}: ${String(e?.message ?? e).split('\n')[0]}`);
    log(`  ✗ ${what}: ${String(e?.message ?? e).split('\n')[0]}`);
    return undefined;
  }
}

const MAIN = 'moya-pervaya-prezentaciya';
const BIG = 'audit-big';
const T = YAML.parse(fs.readFileSync(path.join(root, 'templates', 'basic', 'deck.yaml'), 'utf8'));
const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-audit-'));

async function launch(dirs) {
  const t0 = performance.now();
  const app = await electron.launch({
    args: ['.', ...sandbox],
    env: { ...process.env, SLIDERIA_DOCS_DIR: dirs.docs, SLIDERIA_USER_DATA: dirs.data, SLIDERIA_SAVE_DIR: dirs.saves },
    timeout: 120_000,
  });
  await app.firstWindow();
  let win;
  while (!(win = app.windows().find((w) => w.url().startsWith('http://127.')))) {
    if (performance.now() - t0 > 300_000) throw new Error('Окно программы не открыло страницу сервера');
    await new Promise((r) => setTimeout(r, 20));
  }
  await win.waitForURL(/\/\?all$/, { waitUntil: 'commit', timeout: 300_000 });
  await win.locator('.pk-card').first().waitFor({ timeout: 300_000 });
  return { app, win };
}

/** Папки: первый запуск создаёт «Мою первую презентацию»; к ней — презентации проекта, тестовые и большая */
async function prepare() {
  const d = path.join(tmpRoot, 'run');
  const dirs = { docs: path.join(d, 'docs'), data: path.join(d, 'data'), saves: path.join(d, 'saves') };
  fs.mkdirSync(dirs.saves, { recursive: true });
  const first = await launch(dirs);
  await first.app.close();
  const add = (from, name) => fs.cpSync(from, path.join(dirs.docs, name), { recursive: true });
  add(path.join(root, 'tests', 'perf', 'objects'), 'perf-objects');
  for (const n of fs.readdirSync(path.join(root, 'presentations'))) add(path.join(root, 'presentations', n), `p-${n}`);
  const tests = path.join(root, '.tmp', 'test-decks');
  if (fs.existsSync(tests)) for (const n of fs.readdirSync(tests)) if (!n.startsWith('zz')) add(path.join(tests, n), `t-${n}`);
  // Большая: шаблон пять раз подряд (свои id у слайдов), рядом — его файлы
  add(path.join(dirs.docs, MAIN), BIG);
  const deck = YAML.parse(fs.readFileSync(path.join(dirs.docs, MAIN, 'deck.yaml'), 'utf8'));
  const slides = [];
  for (let k = 0; k < 5; k++) for (const s of deck.slides) slides.push({ ...s, ...(s.id ? { id: `${s.id}-${k}` } : {}) });
  fs.writeFileSync(path.join(dirs.docs, BIG, 'deck.yaml'), YAML.stringify({ ...deck, title: 'Аудит: большая', slides }));
  return { dirs, decks: fs.readdirSync(dirs.docs).length, big: slides.length };
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

/** Страница успокоилась: quiet мс без долгих кадров */
const settle = (win, quiet = 500) => win.evaluate(async (quiet) => {
  const longs = [];
  const po = new PerformanceObserver((l) => longs.push(...l.getEntries()));
  po.observe({ type: 'long-animation-frame' });
  const t0 = performance.now();
  let last = t0;
  await new Promise((done) => {
    const tick = () => {
      for (const e of longs.splice(0)) last = Math.max(last, e.startTime + e.duration);
      if (performance.now() - last > quiet || performance.now() - t0 > 10000) done();
      else setTimeout(tick, 50);
    };
    tick();
  });
  po.disconnect();
}, quiet);

async function goto(win, query, ready) {
  const u = new URL(win.url());
  u.search = query;
  u.hash = '';
  const t0 = performance.now();
  await win.goto(u.toString(), { waitUntil: 'commit' });
  await win.locator(ready).first().waitFor({ timeout: 120_000 });
  return performance.now() - t0;
}

/** Процессы программы: тип, память (МБ), процессор за всё время (с) */
const procs = (app) => app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({
  type: m.type, name: m.serviceName || m.name || '', pid: m.pid,
  cum: m.cpu.cumulativeCPUUsage ?? null, pct: m.cpu.percentCPUUsage,
  ws: m.memory.workingSetSize, priv: m.memory.privateBytes ?? null,
})));
const procKey = (p) => `${p.type}${p.name && p.type !== 'Tab' ? ` (${p.name})` : ''}`;
function memTable(list) {
  const out = {};
  for (const p of list) {
    const k = procKey(p);
    out[k] ??= { n: 0, ws: 0, priv: 0 };
    out[k].n++;
    out[k].ws += p.ws / 1024;
    out[k].priv += (p.priv ?? 0) / 1024;
  }
  for (const v of Object.values(out)) { v.ws = r1(v.ws); v.priv = r1(v.priv); }
  return out;
}

/** Сборка мусора и снимок: память JS, узлы (всего / в документе), слушатели, документы */
async function heap(win, cdp) {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
  const m = await metrics(cdp);
  const live = await win.evaluate(() => {
    let n = 0;
    const walk = (r) => {
      const w = document.createTreeWalker(r, NodeFilter.SHOW_ALL);
      for (let x = w.currentNode; x; x = w.nextNode()) {
        n++;
        if (x.shadowRoot) walk(x.shadowRoot);
      }
    };
    walk(document);
    return { n, el: document.getElementsByTagName('*').length, frames: document.querySelectorAll('iframe').length };
  });
  return { heap: MB(m.JSHeapUsedSize), nodes: m.Nodes, live: live.n, elements: live.el, listeners: m.JSEventListeners, docs: m.Documents, frames: m.Frames, iframes: live.frames, layoutObjects: m.LayoutObjects };
}

// ---------------- карты исходников ----------------

let SM = null;
async function mapper() {
  if (SM) return SM;
  SM = { ok: false, at: () => null };
  const dir = path.join(MAP, 'assets');
  if (!fs.existsSync(dir)) { notes.push('Нет сборки-двойника с картами исходников: имена функций сжатые (node scripts/audit.mjs --build-map)'); return SM; }
  const { SourceMapConsumer } = await import('source-map-js');
  const maps = new Map();
  const get = (file) => {
    if (!maps.has(file)) {
      const p = path.join(dir, `${file}.map`);
      maps.set(file, fs.existsSync(p) ? new SourceMapConsumer(JSON.parse(fs.readFileSync(p, 'utf8'))) : null);
    }
    return maps.get(file);
  };
  SM = {
    ok: true,
    /** url, строка и столбец с 0 → исходник и имя */
    at(url, line, col) {
      const file = url.replace(/^https?:\/\/[^/]+\/assets\//, '').replace(/\?.*$/, '');
      if (file === url || line < 0 || col < 0) return null;
      const c = get(file);
      if (!c) return null;
      const o = c.originalPositionFor({ line: line + 1, column: col });
      if (!o.source) return null;
      const src = o.source.replace(/^(\.\.\/)+/, '').replace(/^.*node_modules\//, 'node_modules/');
      return { src, line: o.line, name: o.name };
    },
  };
  return SM;
}

// ---------------- load: открытие студии ----------------

async function countRules(win) {
  return win.evaluate(() => {
    let rules = 0;
    let sheets = 0;
    const walk = (list) => { for (const r of list) { rules++; if (r.cssRules) walk(r.cssRules); } };
    for (const s of document.styleSheets) {
      sheets++;
      try { walk(s.cssRules); } catch { /* чужой лист */ }
    }
    for (const el of document.querySelectorAll('*')) if (el.shadowRoot) for (const s of el.shadowRoot.adoptedStyleSheets ?? []) { sheets++; walk(s.cssRules); }
    return { rules, sheets };
  });
}

/** Покрытие JS (V8, по блокам): сколько символов кода выполнилось хоть раз */
function jsUsed(entry) {
  const len = entry.source?.length ?? 0;
  if (!len) return { len: 0, used: 0 };
  const ranges = entry.functions.flatMap((f) => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const mark = new Uint8Array(len);
  for (const r of ranges) mark.fill(r.count > 0 ? 1 : 0, r.startOffset, Math.min(len, r.endOffset));
  let used = 0;
  for (let i = 0; i < len; i++) used += mark[i];
  return { len, used };
}

async function openStudio(win, cdp, deck, { coverage = false, profile = false } = {}) {
  let bytes = 0;
  let files = 0;
  const fin = (e) => { bytes += e.encodedDataLength; files++; };
  cdp.on('Network.loadingFinished', fin);
  await cdp.send('Network.enable');
  dbg('открытие: сеть');
  // Покрытие — прямыми командами DevTools в своём сеансе (покрытие Playwright в Electron оставляет профилировщик
  // страницы без ответа)
  const cov = coverage ? await win.context().newCDPSession(win) : null;
  const sheets = new Map();
  if (cov) {
    dbg('покрытие: старт');
    // Только листы самой страницы: у вспомогательных рамок (снимки, вставки) — свои копии тех же файлов
    // Главный кадр сохраняет свой id и после перехода: листы прошлой страницы уходят — их не считать
    cov.on('CSS.styleSheetAdded', (e) => sheets.set(e.header.styleSheetId, { url: e.header.sourceURL, len: e.header.length, frame: e.header.frameId }));
    cov.on('CSS.styleSheetRemoved', (e) => sheets.delete(e.styleSheetId));
    await cov.send('Profiler.enable');
    await cov.send('Profiler.startPreciseCoverage', { callCount: false, detailed: true });
    await cov.send('DOM.enable');
    await cov.send('CSS.enable');
    await cov.send('CSS.startRuleUsageTracking');
  }
  // Профиль — в своём сеансе отладки: общий с покрытием (Profiler) после него не отвечает
  const prof = profile ? await win.context().newCDPSession(win) : null;
  if (prof) {
    dbg('профиль: старт');
    await prof.send('Profiler.enable');
    await prof.send('Profiler.setSamplingInterval', { interval: 250 });
    await prof.send('Profiler.start');
  }
  const m0 = await metrics(cdp);
  dbg('переход');
  const tSeen = await goto(win, `?deck=${deck}&studio`, '#st-canvas .slide.on');
  dbg('слайд виден');
  const r = await win.evaluate(async () => {
    const mk = (n) => performance.getEntriesByName(`slideria:${n}`)[0]?.startTime ?? 0;
    const longs = [];
    const po = new PerformanceObserver((l) => longs.push(...l.getEntries()));
    po.observe({ type: 'long-animation-frame', buffered: true });
    const end = () => longs.reduce((m, e) => Math.max(m, e.startTime + e.duration), mk('studio'));
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => (performance.now() - end() > 1000 || performance.now() - t0 > 30_000 ? done() : setTimeout(tick, 100));
      tick();
    });
    po.disconnect();
    const big = longs.filter((e) => e.duration > 50);
    return { studio: mk('studio'), ready: end(), longs: big.length, longMs: big.reduce((s, e) => s + e.duration, 0), longest: Math.max(0, ...big.map((e) => e.duration)) };
  });
  const m1 = await metrics(cdp);
  cdp.off('Network.loadingFinished', fin);
  await cdp.send('Network.disable');
  const out = {
    seen: r1(tSeen), studio: r1(r.studio), ready: r1(r.ready), files, bytes,
    longFrames: r.longs, longFramesMs: r1(r.longMs), longest: r1(r.longest),
    work: { task: r1((m1.TaskDuration - m0.TaskDuration) * 1000), script: r1((m1.ScriptDuration - m0.ScriptDuration) * 1000), style: r1((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000), layout: r1((m1.LayoutDuration - m0.LayoutDuration) * 1000), styleCount: m1.RecalcStyleCount - m0.RecalcStyleCount, layoutCount: m1.LayoutCount - m0.LayoutCount },
  };
  dbg('готова');
  if (cov) {
    const { result } = await cov.send('Profiler.takePreciseCoverage');
    await cov.send('Profiler.stopPreciseCoverage');
    const { ruleUsage } = await cov.send('CSS.stopRuleUsageTracking');
    const { frameTree } = await cov.send('Page.getFrameTree');
    for (const [id, sh] of [...sheets]) if (sh.frame !== frameTree.frame.id) sheets.delete(id);
    await cov.detach().catch(() => {});
    const assets = path.join(root, '.tmp', 'app', 'studio', 'assets');
    const file = (u) => (/\/assets\//.test(u) ? u.replace(/^.*\/assets\//, '').replace(/\?.*$/, '') : '');
    const jsRows = [];
    for (const s of result) {
      const f = file(s.url);
      if (!f || !fs.existsSync(path.join(assets, f))) continue;
      const u = jsUsed({ source: fs.readFileSync(path.join(assets, f), 'utf8'), functions: s.functions });
      // Ничего не выполнено — даже верхний уровень модуля: файл остался от прошлой страницы (страницы выбора)
      if (u.used) jsRows.push({ file: f, ...u });
    }
    // CSS: объём применённых правил к объёму листа — в файлах и во встроенных стилях (<style>);
    // отчёт браузера перечисляет только применённые правила, поэтому объём — по самим листам
    const css = new Map();
    const keyOf = (id) => { const sh = sheets.get(id); return sh && file(sh.url) ? file(sh.url) : '(встроенные)'; };
    for (const [id, sh] of sheets) {
      const key = keyOf(id);
      const row = css.get(key) ?? { file: key, len: 0, used: 0, n: 0 };
      row.len += sh.len;
      row.n++;
      css.set(key, row);
    }
    for (const r of ruleUsage) if (r.used && css.has(keyOf(r.styleSheetId))) css.get(keyOf(r.styleSheetId)).used += r.endOffset - r.startOffset;
    const inline = css.get('(встроенные)') ?? { len: 0, used: 0, n: 0 };
    css.delete('(встроенные)');
    out.coverage = {
      js: jsRows.sort((a, b) => b.len - a.len),
      css: [...css.values()].sort((a, b) => b.len - a.len),
      cssInline: { n: inline.n, len: inline.len, used: inline.used },
    };
  }
  if (prof) {
    const { profile: p } = await prof.send('Profiler.stop');
    await prof.detach().catch(() => {});
    out.profile = await profileTop(p);
  }
  return out;
}

/** Профиль: собственное время по модулям исходников и по функциям */
async function profileTop(p) {
  const sm = await mapper();
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const where = new Map();
  const place = (n) => {
    if (where.has(n.id)) return where.get(n.id);
    const cf = n.callFrame;
    let w;
    if (!cf.url) w = { mod: cf.functionName || '(служебное)', fn: cf.functionName || '(служебное)' };
    else {
      const o = sm.at(cf.url, cf.lineNumber, cf.columnNumber);
      const file = cf.url.replace(/^.*\/assets\//, '');
      w = o ? { mod: o.src, fn: `${o.name || cf.functionName || '(анонимная)'}  ${o.src}:${o.line}` } : { mod: file, fn: `${cf.functionName || '(анонимная)'}  ${file}:${cf.lineNumber + 1}` };
    }
    where.set(n.id, w);
    return w;
  };
  const mods = new Map();
  const fns = new Map();
  let total = 0;
  p.samples.forEach((id, k) => {
    const ms = (p.timeDeltas[k] ?? 0) / 1000;
    const w = place(byId.get(id));
    if (/^\((idle|program|root)\)$/.test(w.fn)) return;
    total += ms;
    mods.set(w.mod, (mods.get(w.mod) ?? 0) + ms);
    fns.set(w.fn, (fns.get(w.fn) ?? 0) + ms);
  });
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, ms]) => ({ name, ms: r1(ms) }));
  return { total: r1(total), mapped: sm.ok, modules: top(mods, 25), functions: top(fns, 30) };
}

async function loadCase(app, win, cdp, big) {
  const L = (R.load = {});
  log('Открытие студии: покрытие, работа, профиль…');
  L.main = await guard('открытие 31', async () => {
    const o = await openStudio(win, cdp, MAIN, { coverage: true });
    await settle(win);
    o.css = await countRules(win);
    o.heap = await heap(win, cdp);
    return o;
  });
  // Без покрытия (оно замедляет скрипты): числа второго, «тёплого» открытия и профиль
  L.warm = await guard('профиль открытия', async () => {
    const o = await openStudio(win, cdp, MAIN, { profile: true });
    await settle(win);
    o.heap = await heap(win, cdp);
    return o;
  });
  L.mainProfile = L.warm?.profile;
  L.big = await guard(`открытие ${big}`, async () => {
    const o = await openStudio(win, cdp, BIG, { profile: true });
    await settle(win);
    o.heap = await heap(win, cdp);
    o.slides = big;
    o.thumbs = await win.locator('.st-thumb').count();
    o.thumbsDrawn = await win.evaluate(() => [...document.querySelectorAll('.st-thumb')].filter((t) => t.querySelector('.slide')).length);
    return o;
  });
  // Листание в большой: PageDown 40 раз, как в yarn perf
  L.bigFlip = await guard('листание 155', () => flip(win, cdp, 40));
  if (ONLY.has('mem')) R.mem.studioBig = memTable(await procs(app));
}

async function flip(win, cdp, n) {
  await win.keyboard.press('Escape');
  await win.evaluate(() => { location.hash = '#1'; });
  await settle(win);
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
  }, n);
  const m1 = await metrics(cdp);
  return { median: r1(median(t)), p95: r1(pct(t, 95)), max: r1(Math.max(...t)), workPerSlide: r1(((m1.TaskDuration - m0.TaskDuration) * 1000) / n) };
}

// ---------------- idle: простой ----------------

/** Счётчики в странице: кадры анимации и срабатывания таймеров (обёртки над глобальными функциями) */
const counters = () => {
  const w = window;
  if (w.__aud) return;
  w.__aud = { raf: 0, timeout: 0, interval: 0 };
  const raf = w.requestAnimationFrame.bind(w);
  w.requestAnimationFrame = (cb) => raf((t) => { w.__aud.raf++; cb(t); });
  const st = w.setTimeout.bind(w);
  w.setTimeout = (cb, ms, ...a) => st(typeof cb === 'function' ? (...x) => { w.__aud.timeout++; cb(...x); } : cb, ms, ...a);
  const si = w.setInterval.bind(w);
  w.setInterval = (cb, ms, ...a) => si(typeof cb === 'function' ? (...x) => { w.__aud.interval++; cb(...x); } : cb, ms, ...a);
};

async function idleCase(app, win, cdp, label, ms = 10_000) {
  await settle(win, 800);
  await win.evaluate(counters);
  // Первое окно — сразу после того, как страница успокоилась (с профилем: чем занят поток), второе — следом:
  // работа, которая не затихает, — постоянная
  const prof = await win.context().newCDPSession(win);
  await prof.send('Profiler.enable');
  await prof.send('Profiler.setSamplingInterval', { interval: 500 });
  await prof.send('Profiler.start');
  const a0 = await metrics(cdp);
  await win.waitForTimeout(ms);
  const a1 = await metrics(cdp);
  const { profile } = await prof.send('Profiler.stop');
  await prof.detach().catch(() => {});
  const first = r1(((a1.TaskDuration - a0.TaskDuration) * 1000) / (ms / 1000));
  const top = await profileTop(profile);
  const c0 = await win.evaluate(() => ({ ...window.__aud }));
  const m0 = await metrics(cdp);
  const p0 = await procs(app);
  const t0 = performance.now();
  await win.waitForTimeout(ms);
  const dt = (performance.now() - t0) / 1000;
  const p1 = await procs(app);
  const m1 = await metrics(cdp);
  const c1 = await win.evaluate(() => ({ ...window.__aud }));
  const anims = await win.evaluate(() => {
    const name = (el) => (el instanceof Element ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : ''}` : '?');
    return document.getAnimations().filter((a) => a.playState === 'running').map((a) => ({
      name: a.animationName || a.transitionProperty || a.constructor.name,
      endless: a.effect?.getComputedTiming().endTime === Infinity,
      target: name(a.effect?.target),
    }));
  });
  // Процессор по типам процессов: доля одного ядра за время простоя
  const cpu = {};
  for (const p of p1) {
    const was = p0.find((x) => x.pid === p.pid);
    if (!was || p.cum === null) continue;
    const k = procKey(p);
    cpu[k] = r1((cpu[k] ?? 0) + ((p.cum - was.cum) / dt) * 100);
  }
  const per = (k) => r1((m1[k] - m0[k]) / dt);
  const row = {
    label,
    first,
    top: top.functions.filter((f) => !/^\(garbage collector\)/.test(f.name)).slice(0, 5),
    busyMsPerS: r1(((m1.TaskDuration - m0.TaskDuration) * 1000) / dt),
    scriptMsPerS: r1(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / dt),
    stylesPerS: per('RecalcStyleCount'),
    layoutsPerS: per('LayoutCount'),
    rafPerS: r1((c1.raf - c0.raf) / dt),
    timeoutsPerS: r1((c1.timeout - c0.timeout) / dt),
    intervalsPerS: r1((c1.interval - c0.interval) / dt),
    running: anims.length,
    endless: anims.filter((a) => a.endless).length,
    anims: Object.entries(anims.reduce((m, a) => ((m[`${a.name} → ${a.target}`] = (m[`${a.name} → ${a.target}`] ?? 0) + 1), m), {})).slice(0, 8),
    cpu,
  };
  log(`  простой «${label}»: поток ${first} → ${row.busyMsPerS} мс/с, кадров ${row.rafPerS}/с, стилей ${row.stylesPerS}/с, анимаций ${row.running}`);
  return row;
}

// ---------------- smooth: плавность ----------------

const recStart = () => {
  const w = window;
  w.__rec = { t: [], on: true, long: [] };
  const f = (ts) => { if (!w.__rec.on) return; w.__rec.t.push(ts); requestAnimationFrame(f); };
  requestAnimationFrame(f);
  w.__rec.po = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.duration < 50) continue;
      const s = [...(e.scripts ?? [])].sort((a, b) => b.duration - a.duration)[0];
      w.__rec.long.push({ d: e.duration, block: e.blockingDuration, style: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0, src: s ? `${s.invoker || s.sourceFunctionName || '?'} @ ${String(s.sourceURL).replace(/^.*\//, '')}:${s.sourceCharPosition}` : '', sd: s?.duration ?? 0 });
    }
  });
  w.__rec.po.observe({ type: 'long-animation-frame' });
};
const recStop = async () => {
  const w = window;
  w.__rec.on = false;
  await new Promise((r) => setTimeout(r, 50));
  w.__rec.po.disconnect();
  const t = w.__rec.t;
  return { gaps: t.slice(1).map((v, k) => v - t[k]), long: w.__rec.long };
};
function smoothRow(label, r, extra = {}) {
  const g = r.gaps;
  const frame = median(g) || 16.7;
  // Пропущенные кадры: интервал длиннее полутора обычных — столько кадров не показано
  const dropped = g.reduce((s, v) => s + (v > frame * 1.5 ? Math.round(v / frame) - 1 : 0), 0);
  const row = {
    label, frames: g.length, frame: r1(frame), p95: r1(pct(g, 95)), max: r1(Math.max(0, ...g)),
    dropped, droppedPct: r1((dropped / Math.max(1, g.length + dropped)) * 100),
    long: r.long.length, longMax: r1(Math.max(0, ...r.long.map((e) => e.d))),
    culprits: Object.entries(r.long.reduce((m, e) => { if (e.src) m[e.src] = (m[e.src] ?? 0) + e.sd; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => [k, r1(v)]),
    ...extra,
  };
  log(`  плавность «${label}»: кадров ${row.frames}, пропущено ${row.droppedPct} %, 95% — ${row.p95} мс, долгих ${row.long} (до ${row.longMax} мс)`);
  return row;
}

async function wheel(win, at, dy, steps) {
  await win.mouse.move(at.x, at.y);
  await win.evaluate(recStart);
  for (let i = 0; i < steps; i++) { await win.mouse.wheel(0, dy); await win.waitForTimeout(30); }
  await win.waitForTimeout(400);
  for (let i = 0; i < steps; i++) { await win.mouse.wheel(0, -dy); await win.waitForTimeout(30); }
  await win.waitForTimeout(400);
  return win.evaluate(recStop);
}

async function pickerScroll(win) {
  await goto(win, '?all', '.pk-card');
  await settle(win, 800);
  // Миниатюры проявляются по мере прокрутки — первый проход и второй (уже нарисованные)
  const h = await win.evaluate(() => ({ h: document.scrollingElement.scrollHeight, v: innerHeight, cards: document.querySelectorAll('.pk-card').length }));
  const vp = win.viewportSize() ?? { width: 1280, height: 800 };
  const at = { x: vp.width / 2, y: vp.height / 2 };
  const a = await wheel(win, at, 120, 30);
  const b = await wheel(win, at, 120, 30);
  return [smoothRow('страница выбора: первый проход', a, { cards: h.cards, scroll: h.h - h.v }), smoothRow('страница выбора: второй проход', b)];
}

async function panelScroll(win, deck, label) {
  await goto(win, `?deck=${deck}&studio`, '#st-canvas .slide.on');
  await settle(win, 1000);
  const box = await win.locator('#st-slides').boundingBox();
  const a = await wheel(win, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 120, 30);
  return smoothRow(label, a);
}

/** Показ: по всем слайдам стрелкой, на каждом — время перехода и появления */
async function showLap(win, n, wait = 900) {
  await win.evaluate(recStart);
  for (let i = 0; i < n - 1; i++) {
    await win.keyboard.press('ArrowRight');
    await win.waitForTimeout(wait);
  }
  return win.evaluate(recStop);
}

// ---------------- input: отклик на ввод ----------------

const evStart = () => {
  const w = window;
  w.__ev = { list: [], phases: [] };
  w.__ev.po = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (!e.interactionId && !/^key/.test(e.name)) continue;
      w.__ev.list.push({ name: e.name, start: e.startTime, dur: e.duration, delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart, id: e.interactionId });
    }
  });
  w.__ev.po.observe({ type: 'event', durationThreshold: 16, buffered: false });
};
const phase = (win, name) => win.evaluate((name) => window.__ev.phases.push({ name, t: performance.now() }), name);

async function shown(win, act, sel) {
  const t0 = performance.now();
  await act();
  await win.locator(sel).first().waitFor({ state: 'visible', timeout: 20_000 });
  await frames(win, 2);
  return performance.now() - t0;
}

async function inputCase(win, cdp) {
  await goto(win, `?deck=${MAIN}&studio`, '#st-canvas .slide.on');
  await settle(win, 1000);
  await win.evaluate(evStart);
  const visible = {};
  const add = (k, v) => (visible[k] ??= []).push(r1(v));
  let typing = null;

  // Каждая фаза — сама по себе: не нашлась кнопка в одной — остальные всё равно меряются
  const step = async (name, fn) => {
    await phase(win, name);
    dbg(`ввод: ${name}`);
    await guard(`ввод: ${name}`, fn);
    await win.keyboard.press('Escape');
    await win.keyboard.press('Escape');
    await settle(win, 300);
  };
  await step('вкладка ленты', async () => {
    const tabs = await win.locator('.st-tabs [data-tab]:visible').evaluateAll((l) => l.map((t) => t.dataset.tab));
    for (let k = 0; k < 2; k++) for (const t of [...tabs.filter((x) => x !== 'home'), 'home']) {
      await win.locator(`.st-tabs [data-tab="${t}"]`).click();
      await frames(win, 2);
    }
  });

  await step('«Файл»: открыть и закрыть', async () => {
    for (let k = 0; k < 3; k++) {
      add('«Файл»', await shown(win, () => win.locator('#st-file').click(), '.fp'));
      await settle(win, 300);
      await win.keyboard.press('Escape');
      await win.locator('.fp').first().waitFor({ state: 'hidden' }).catch(() => {});
      await settle(win, 300);
    }
  });

  await step('«Темы» и «Фон»', async () => {
    await win.locator('.st-tabs [data-tab="design"]').click();
    for (let k = 0; k < 2; k++) {
      add(k ? '«Темы» (второй раз)' : '«Темы» (первый раз)', await shown(win, () => win.locator('[data-cmd="design.themes"]:visible').first().click(), '.st-pop'));
      await settle(win, 300);
      await win.keyboard.press('Escape');
      await settle(win, 300);
    }
    add('«Фон»', await shown(win, () => win.locator('[data-cmd="design.bg"]:visible').first().click(), '.st-pop'));
    await win.keyboard.press('Escape');
    await settle(win, 300);
  });

  await step('«Блоки»', async () => {
    await win.locator('.st-tabs [data-tab="insert"]').click();
    for (let k = 0; k < 2; k++) {
      add(k ? '«Блоки» (второй раз)' : '«Блоки» (первый раз)', await shown(win, () => win.locator('[data-cmd="insert.blocks"]:visible').first().click(), '.st-lib'));
      await settle(win, 300);
      await win.keyboard.press('Escape');
      await settle(win, 300);
    }
    await win.locator('.st-tabs [data-tab="home"]').click();
  });

  await step('миниатюра → слайд', async () => {
    for (let i = 1; i <= 12; i++) {
      await win.locator(`.st-thumb[data-i="${i}"]`).click();
      await win.locator(`.st-thumb.cur[data-i="${i}"]`).waitFor();
      await settle(win, 200);
    }
  });

  await step('выделить объект', async () => {
    for (const id of ['contents', 'schemes', 'roadmap', 'design', 'media', 'flows']) {
      const i = T.slides.findIndex((s) => s.id === id);
      await win.locator(`.st-thumb[data-i="${i}"]`).click();
      await win.locator(`.st-thumb.cur[data-i="${i}"]`).waitFor();
      await settle(win, 300);
      const f = win.locator('#st-canvas .slide.on > .free').first();
      const b = await f.boundingBox();
      if (!b) continue;
      await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await frames(win, 2);
      await settle(win, 200);
      await win.keyboard.press('Escape');
      await win.keyboard.press('Escape');
    }
  });

  await step('набор текста', async () => {
    const ti = T.slides.findIndex((s) => (s.free ?? []).some((b) => b.type === 'text' && typeof b.text === 'string' && b.text.length > 3));
    if (ti >= 0) {
      await win.locator(`.st-thumb[data-i="${ti}"]`).click();
      await win.locator(`.st-thumb.cur[data-i="${ti}"]`).waitFor();
      await settle(win, 400);
      // Не в середину: там у невысокой надписи ручки рамки выделения (как в e2e)
      const text = win.locator('#st-canvas .slide.on > .free [data-type="text"]').first();
      const tb = await text.boundingBox();
      await text.dblclick({ position: { x: tb.width * 0.25, y: tb.height / 2 } });
      await win.locator('#st-canvas .slide.on [contenteditable="true"]').first().waitFor();
      await win.keyboard.press('End');
      // Профиль набора: что работает на каждое нажатие
      const prof = await win.context().newCDPSession(win);
      await prof.send('Profiler.enable');
      await prof.send('Profiler.setSamplingInterval', { interval: 250 });
      await prof.send('Profiler.start');
      const typed = ' проверка отклика набора текста на слайде';
      await win.keyboard.type(typed, { delay: 70 });
      const { profile } = await prof.send('Profiler.stop');
      await prof.detach().catch(() => {});
      typing = { keys: typed.length, ...(await profileTop(profile)) };
      await settle(win, 300);
      await win.keyboard.press('Escape');
    } else notes.push('Набор текста: в шаблоне нет надписи');
  });

  await phase(win, 'конец');
  await win.waitForTimeout(500);
  const ev = await win.evaluate(() => { window.__ev.po.disconnect(); return { list: window.__ev.list, phases: window.__ev.phases }; });
  const groups = [];
  for (let k = 0; k < ev.phases.length - 1; k++) {
    const p = ev.phases[k];
    const end = ev.phases[k + 1].t;
    const es = ev.list.filter((e) => e.start >= p.t && e.start < end);
    // Взаимодействие (interactionId) — самое долгое его событие; клавиши без него — по одному
    const by = new Map();
    for (const e of es) {
      const key = e.id || `${e.name}${e.start}`;
      if (!by.has(key) || by.get(key).dur < e.dur) by.set(key, e);
    }
    const ds = [...by.values()];
    const worst = ds.sort((a, b) => b.dur - a.dur)[0];
    groups.push({
      label: p.name, n: ds.length, p50: r1(median(ds.map((e) => e.dur))), p75: r1(pct(ds.map((e) => e.dur), 75)), max: r1(worst?.dur ?? 0),
      worst: worst ? { name: worst.name, delay: r1(worst.delay), proc: r1(worst.proc), paint: r1(worst.dur - worst.delay - worst.proc) } : null,
    });
  }
  const all = ev.list.filter((e) => e.id);
  const per = new Map();
  for (const e of all) if (!per.has(e.id) || per.get(e.id) < e.dur) per.set(e.id, e.dur);
  const inter = [...per.values()].sort((a, b) => b - a);
  // INP в браузерах — 98-й процентиль взаимодействий (при 50+ — без одного худшего на каждые 50)
  const inp = inter[Math.min(inter.length - 1, Math.floor(inter.length / 50))] ?? 0;
  R.input = { groups, inp: r1(inp), interactions: inter.length, typing, visible: Object.fromEntries(Object.entries(visible).map(([k, v]) => [k, { median: r1(median(v)), all: v }])) };
  for (const g of groups) log(`  ввод «${g.label}»: ${g.n} шт., 75% — ${g.p75} мс, худшее ${g.max} мс`);
  log(`  INP ≈ ${R.input.inp} мс (${inter.length} взаимодействий)`);
}

// ---------------- session: долгая работа ----------------

const TABS = ['insert', 'design', 'anim', 'view', 'home'];
async function cycle(win, i, n) {
  const s = i % n;
  await win.locator(`.st-thumb[data-i="${s}"]`).click();
  await win.locator(`.st-thumb.cur[data-i="${s}"]`).waitFor();
  await settle(win, 150);
  const f = win.locator('#st-canvas .slide.on > .free').first();
  const b = (await f.count()) ? await f.boundingBox() : null;
  if (b && b.width > 8 && b.height > 8) {
    const x = b.x + Math.min(b.width / 2, 40);
    const y = b.y + Math.min(b.height / 2, 40);
    await win.mouse.move(x, y);
    await win.mouse.down();
    for (let k = 1; k <= 6; k++) { await win.mouse.move(x + k * 5, y + k * 3); await frames(win, 1); }
    await win.mouse.up();
    await frames(win, 2);
    await win.keyboard.press('Control+z');
    await frames(win, 2);
  }
  for (const t of TABS) { await win.locator(`.st-tabs [data-tab="${t}"]`).click(); await frames(win, 1); }
  await win.locator('#st-file').click();
  await win.locator('.fp').first().waitFor({ state: 'visible' });
  await frames(win, 2);
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
  await frames(win, 2);
}

/** Отцепленные элементы в памяти — по корням оторванных поддеревьев: что именно держится после закрытия */
async function detached(cdp) {
  const proto = await cdp.send('Runtime.evaluate', { expression: 'Element.prototype' });
  const q = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId, objectGroup: 'aud' });
  const r = await cdp.send('Runtime.callFunctionOn', {
    objectId: q.objects.objectId,
    returnByValue: true,
    functionDeclaration: `function () {
      const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList && el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '');
      const roots = new Map();
      let total = 0;
      for (const el of this) {
        // В списке и сами прототипы (HTMLElement.prototype…): у них свойства узла читать нельзя
        try { if (el.nodeType !== 1 || el.isConnected || el.ownerDocument !== document) continue; } catch { continue; }
        total++;
        let top = el;
        while (top.parentElement) top = top.parentElement;
        const host = top.parentNode && top.parentNode.host ? ' (в тени ' + name(top.parentNode.host) + ')' : '';
        const k = name(top) + host;
        const v = roots.get(k) || { roots: new Set(), n: 0 };
        v.roots.add(top);
        v.n++;
        roots.set(k, v);
      }
      return { total, top: [...roots].map(([k, v]) => [k, v.roots.size, v.n]).sort((a, b) => b[2] - a[2]).slice(0, 12) };
    }`,
  });
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'aud' });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function sessionCase(app, win, cdp) {
  await goto(win, `?deck=${MAIN}&studio`, '#st-canvas .slide.on');
  await settle(win, 1000);
  const n = T.slides.length;
  const rows = [{ cycle: 0, t: 0, ...(await heap(win, cdp)) }];
  const times = [];
  for (let i = 1; i <= CYCLES; i++) {
    const t0 = performance.now();
    await guard(`круг ${i}`, () => cycle(win, i, n));
    times.push(performance.now() - t0);
    if (i % 10 === 0) {
      await settle(win, 500);
      rows.push({ cycle: i, t: r1(median(times.slice(-10))), ...(await heap(win, cdp)) });
      const r = rows.at(-1);
      log(`  круг ${i}: память JS ${r.heap} МБ, узлов ${r.nodes} (в документе ${r.live}), слушателей ${r.listeners}, документов ${r.docs}, круг ${r.t} мс`);
    }
  }
  const first = rows[1] ?? rows[0];
  const last = rows.at(-1);
  const det = await guard('отцепленные', () => detached(cdp));
  const k = Math.max(1, last.cycle - first.cycle);
  const slope = (key) => r1((last[key] - first[key]) / k);
  R.session = {
    cycles: CYCLES, rows,
    perCycle: { heapKB: r1(((last.heap - first.heap) * 1024) / k), nodes: slope('nodes'), live: slope('live'), listeners: slope('listeners'), docs: slope('docs') },
    detached: last.nodes - last.live,
    detachedRoots: det,
  };
  if (ONLY.has('mem')) R.mem.studioSession = memTable(await procs(app));
}

async function showSession(app, win, cdp) {
  await goto(win, `?deck=${MAIN}`, '.slide.on');
  await settle(win, 1000);
  const n = T.slides.length;
  const rows = [{ lap: 0, ...(await heap(win, cdp)) }];
  let smooth = null;
  for (let lap = 1; lap <= 3; lap++) {
    await win.keyboard.press('Home');
    await settle(win, 600);
    const r = await showLap(win, n, lap === 1 ? 1200 : 500);
    if (lap === 1) smooth = smoothRow('показ: все слайды по порядку', r, { slides: n });
    rows.push({ lap, ...(await heap(win, cdp)) });
    log(`  показ, круг ${lap}: память JS ${rows.at(-1).heap} МБ, узлов ${rows.at(-1).nodes}, документов ${rows.at(-1).docs}`);
  }
  R.showSession = rows;
  if (ONLY.has('mem')) R.mem.show = memTable(await procs(app));
  return smooth;
}

// ---------------- export: экспорт через «Файл → Экспорт» ----------------

async function exportCase(app, win, saves) {
  await goto(win, `?deck=${MAIN}&studio`, '#st-canvas .slide.on');
  await settle(win, 1000);
  const rows = [];
  for (const [mode, ext, toast, name] of [['clean', '.html', 'Сохранено', 'HTML'], ['pptx', '.pptx', 'Сохранено', 'PowerPoint'], ['pdf', '.pdf', 'PDF сохранён', 'PDF']]) {
    const row = await guard(`экспорт ${name}`, async () => {
      for (const f of fs.readdirSync(saves)) fs.rmSync(path.join(saves, f), { force: true, recursive: true });
      await win.evaluate(() => { const t = document.getElementById('ed-toast'); if (t) t.textContent = ''; });
      await win.locator('#st-file').click();
      await win.locator('.fp [data-fs="export"]').click();
      await win.locator(`.fp [data-x="${mode}"]`).click();
      await settle(win, 300);
      const p0 = await procs(app);
      await win.evaluate(recStart);
      const t0 = performance.now();
      await win.locator('.fp [data-a="export"]').click();
      // Пиковая память процессов во время экспорта — опросом
      let peak = 0;
      let done = false;
      const poll = (async () => {
        while (!done) {
          const ws = (await procs(app).catch(() => [])).reduce((s, p) => s + p.ws, 0);
          peak = Math.max(peak, ws);
          await new Promise((r) => setTimeout(r, 200));
        }
      })();
      await win.waitForFunction((s) => document.getElementById('ed-toast')?.textContent?.includes(s), toast, { timeout: 600_000, polling: 50 });
      const t = performance.now() - t0;
      done = true;
      await poll;
      const r = await win.evaluate(recStop);
      const file = fs.readdirSync(saves).find((f) => f.endsWith(ext));
      const before = p0.reduce((s, p) => s + p.ws, 0);
      await win.keyboard.press('Escape');
      await settle(win, 500);
      const s = smoothRow(`экспорт ${name}: студия во время`, r);
      return { name, t: r1(t), size: file ? fs.statSync(path.join(saves, file)).size : null, frozenMax: s.max, long: s.long, longMax: s.longMax, droppedPct: s.droppedPct, memBefore: r1(before / 1024), memPeak: r1(peak / 1024) };
    });
    if (row) {
      rows.push(row);
      log(`  экспорт ${name}: ${row.t} мс, ${MB(row.size ?? 0)} МБ; самая долгая заминка ${row.frozenMax} мс, память ${row.memBefore} → ${row.memPeak} МБ`);
    }
  }
  R.export = rows;
}

// ---------------- запуск ----------------

const meta = { date: new Date().toISOString(), cpu: `${os.cpus()[0]?.model} × ${os.cpus().length}`, mem: `${Math.round(os.totalmem() / 1073741824)} ГБ`, os: `${os.type()} ${os.release()}`, throttle: CPU, cycles: CYCLES };
log(`Аудит: ${[...ONLY].join(', ')}${CPU > 1 ? ` · страница медленнее в ${CPU} раз` : ''}`);
const { dirs, decks, big } = await prepare();
meta.decks = decks;
const t0 = performance.now();
const { app, win } = await launch(dirs);
meta.start = r1(performance.now() - t0);
meta.electron = await app.evaluate(() => `${process.versions.electron} (Chromium ${process.versions.chrome}, Node ${process.versions.node}, V8 ${process.versions.v8})`);
const cdp = await win.context().newCDPSession(win);
await cdp.send('Performance.enable');
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
R.mem = {};
try {
  if (ONLY.has('mem')) {
    await settle(win, 1000);
    R.mem.picker = memTable(await procs(app));
  }
  if (ONLY.has('load')) await guard('открытие', () => loadCase(app, win, cdp, big));
  if (ONLY.has('idle')) {
    log('Простой…');
    const rows = [];
    await goto(win, '?all', '.pk-card');
    rows.push(await guard('простой: выбор', () => idleCase(app, win, cdp, 'страница выбора')));
    await goto(win, `?deck=${MAIN}&studio`, '#st-canvas .slide.on');
    rows.push(await guard('простой: студия', () => idleCase(app, win, cdp, 'студия, ничего не выделено')));
    if (ONLY.has('mem')) R.mem.studio = memTable(await procs(app));
    await guard('выделение', async () => {
      const f = win.locator('#st-canvas .slide.on > .free').first();
      const b = await f.boundingBox();
      if (b) await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    });
    rows.push(await guard('простой: выделено', () => idleCase(app, win, cdp, 'студия, выделен объект')));
    await win.keyboard.press('Escape');
    const media = T.slides.findIndex((s) => s.id === 'media');
    await guard('слайд с видео', async () => {
      await win.locator(`.st-thumb[data-i="${media}"]`).click();
      await win.locator(`.st-thumb.cur[data-i="${media}"]`).waitFor();
    });
    rows.push(await guard('простой: видео', () => idleCase(app, win, cdp, 'студия, слайд «Медиа»')));
    await goto(win, `?deck=${MAIN}`, '.slide.on');
    rows.push(await guard('простой: показ', () => idleCase(app, win, cdp, 'показ, первый слайд')));
    await guard('показ: слайд', async () => { await win.evaluate((i) => { location.hash = `#${i + 1}`; }, T.slides.findIndex((s) => s.id === 'points')); });
    rows.push(await guard('простой: показ, текст', () => idleCase(app, win, cdp, 'показ, слайд с текстом')));
    R.idle = rows.filter(Boolean);
  }
  if (ONLY.has('smooth')) {
    log('Плавность…');
    const rows = [];
    const pk = await guard('прокрутка выбора', () => pickerScroll(win));
    if (pk) rows.push(...pk);
    rows.push(await guard('лента слайдов', () => panelScroll(win, MAIN, 'лента слайдов (31)')));
    rows.push(await guard('лента слайдов 155', () => panelScroll(win, BIG, `лента слайдов (${big})`)));
    if (!ONLY.has('session')) {
      await goto(win, `?deck=${MAIN}`, '.slide.on');
      await settle(win, 1000);
      rows.push(await guard('показ', async () => smoothRow('показ: все слайды по порядку', await showLap(win, T.slides.length, 1200))));
    }
    R.smooth = rows.filter(Boolean);
  }
  if (ONLY.has('input')) {
    log('Отклик на ввод…');
    await guard('ввод', () => inputCase(win, cdp));
  }
  if (ONLY.has('export')) {
    log('Экспорт…');
    await guard('экспорт', () => exportCase(app, win, dirs.saves));
  }
  if (ONLY.has('session')) {
    log(`Долгая работа: ${CYCLES} кругов…`);
    await guard('долгая работа', () => sessionCase(app, win, cdp));
    if (!argv.includes('--no-show')) {
      log('Показ: 3 круга…');
      const s = await guard('показ по кругу', () => showSession(app, win, cdp));
      if (s) (R.smooth ??= []).push(s);
    }
  }
} finally {
  await app.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

const name = `audit${CPU > 1 ? `-cpu${CPU}` : ''}`;
fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ meta, notes, ...R }, null, 2));
fs.writeFileSync(path.join(OUT, `${name}.md`), report());
log(`\nИтог: ${path.relative(root, path.join(OUT, `${name}.md`))}`);
if (notes.length) log(`Заметки:\n  ${notes.join('\n  ')}`);

// ---------------- отчёт ----------------

function report() {
  const L = [];
  const p = (s = '') => L.push(s);
  const table = (head, rows) => { p(`| ${head.join(' | ')} |`); p(`|${head.map((_, i) => (i ? '---:' : '---')).join('|')}|`); for (const r of rows) p(`| ${r.join(' | ')} |`); p(); };
  p(`**Аудит ${meta.date.slice(0, 16).replace('T', ' ')}** · ${meta.os}, ${meta.cpu}, ${meta.mem}; Electron ${meta.electron}${CPU > 1 ? ` · страница медленнее в ${CPU} раз` : ''}`);
  p(`Презентаций на странице выбора: ${meta.decks}; запуск до страницы выбора ${meta.start} мс`);
  p();
  if (R.load?.main) {
    const m = R.load.main;
    const cols = [['31 слайд, первое (с покрытием)', m], ['31 слайд, второе', R.load.warm], [`${R.load.big?.slides ?? '—'} слайдов`, R.load.big]];
    const row = (name, f) => [name, ...cols.map(([, o]) => (o ? f(o) : '—'))];
    p('### Открытие студии');
    table(['', ...cols.map(([t]) => t)], [
      row('построена, мс', (o) => o.studio),
      row('готова к работе, мс', (o) => o.ready),
      row('работа потока, мс', (o) => o.work.task),
      row('  скрипты', (o) => o.work.script),
      row('  стили (раз)', (o) => `${o.work.style} (${o.work.styleCount})`),
      row('  раскладка (раз)', (o) => `${o.work.layout} (${o.work.layoutCount})`),
      row('долгих кадров (сумма, самый долгий)', (o) => `${o.longFrames} (${o.longFramesMs}, ${o.longest})`),
      row('память JS, МБ', (o) => o.heap?.heap ?? '—'),
      row('узлов DOM (в документе)', (o) => (o.heap ? `${o.heap.nodes} (${o.heap.live})` : '—')),
      row('слушателей событий', (o) => o.heap?.listeners ?? '—'),
      row('документов (iframe)', (o) => (o.heap ? `${o.heap.docs} (${o.heap.iframes})` : '—')),
      row('файлов, МБ', (o) => `${o.files}, ${MB(o.bytes)}`),
    ]);
    if (R.load.big) p(`Миниатюр в ленте: ${R.load.big.thumbs}, нарисовано сразу: ${R.load.big.thumbsDrawn}. Листание ${R.load.big.slides} слайдов: медиана ${R.load.bigFlip?.median} мс, 95% — ${R.load.bigFlip?.p95}, работа на слайд ${R.load.bigFlip?.workPerSlide} мс`);
    p(`Правил CSS: ${m.css?.rules} в ${m.css?.sheets} листах`);
    p();
    if (m.coverage) {
      const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
      const js = m.coverage.js;
      const css = m.coverage.css;
      p(`Покрытие при открытии: JS ${(sum(js, 'len') / 1024).toFixed(0)} КБ загружено, выполнено ${((sum(js, 'used') / Math.max(1, sum(js, 'len'))) * 100).toFixed(0)} %; CSS-файлов ${(sum(css, 'len') / 1024).toFixed(0)} КБ, применено ${((sum(css, 'used') / Math.max(1, sum(css, 'len'))) * 100).toFixed(0)} %; встроенных стилей ${m.coverage.cssInline.n} (${(m.coverage.cssInline.len / 1024).toFixed(0)} КБ, применено ${((m.coverage.cssInline.used / Math.max(1, m.coverage.cssInline.len)) * 100).toFixed(0)} %)`);
      p();
      table(['Файл', 'КБ', 'выполнено, %'], [...js.slice(0, 10).map((r) => [r.file, (r.len / 1024).toFixed(0), ((r.used / Math.max(1, r.len)) * 100).toFixed(0)]), ...css.slice(0, 5).map((r) => [r.file, (r.len / 1024).toFixed(0), ((r.used / Math.max(1, r.len)) * 100).toFixed(0)])]);
    }
    for (const [title, pr] of [['Профиль открытия (31 слайд)', R.load.mainProfile], [`Профиль открытия (${R.load.big?.slides} слайдов)`, R.load.big?.profile]]) {
      if (!pr) continue;
      p(`#### ${title}: ${pr.total} мс работы${pr.mapped ? '' : ' (имена сжатые)'}`);
      table(['Модуль', 'мс'], pr.modules.slice(0, 15).map((x) => [`\`${x.name}\``, x.ms]));
      table(['Функция', 'мс'], pr.functions.slice(0, 15).map((x) => [`\`${x.name}\``, x.ms]));
    }
  }
  if (R.idle?.length) {
    p('### Простой (10 с)');
    const kinds = [...new Set(R.idle.flatMap((r) => Object.keys(r.cpu)))].filter((k) => R.idle.some((r) => (r.cpu[k] ?? 0) >= 0.5));
    p('Два окна по 10 с подряд: первое — сразу после того, как страница успокоилась, второе — следом (постоянная работа); остальные столбцы — по второму.');
    p();
    table(['Где', 'поток, мс/с: первые 10 с → следующие', 'скрипты, мс/с', 'стили/с', 'раскладка/с', 'кадров rAF/с', 'таймеров/с', 'анимаций (бесконечных)', ...kinds.map((k) => `ЦП ${k}, %`)],
      R.idle.map((r) => [r.label, `${r.first} → ${r.busyMsPerS}`, r.scriptMsPerS, r.stylesPerS, r.layoutsPerS, r.rafPerS, r1(r.timeoutsPerS + r.intervalsPerS), `${r.running} (${r.endless})`, ...kinds.map((k) => r.cpu[k] ?? 0)]));
    for (const r of R.idle) if (r.anims.length) p(`- ${r.label}: ${r.anims.map(([k, v]) => `${k}${v > 1 ? ` ×${v}` : ''}`).join('; ')}`);
    p();
    p('Чем занят поток в первые 10 с (профиль):');
    for (const r of R.idle) if (r.top?.length) p(`- ${r.label}: ${r.top.map((f) => `\`${f.name}\` ${f.ms} мс`).join('; ')}`);
    p();
  }
  if (R.smooth?.length) {
    p('### Плавность');
    table(['Что', 'кадров', 'обычный кадр, мс', '95%, мс', 'самый долгий, мс', 'пропущено, %', 'долгих кадров (до, мс)'], R.smooth.map((r) => [r.label, r.frames, r.frame, r.p95, r.max, r.droppedPct, `${r.long} (${r.longMax})`]));
    for (const r of R.smooth) if (r.culprits.length) p(`- ${r.label} — виновники долгих кадров: ${r.culprits.map(([k, v]) => `\`${k}\` ${v} мс`).join('; ')}`);
    p();
  }
  if (R.input) {
    p(`### Отклик на ввод — INP ≈ ${R.input.inp} мс (${R.input.interactions} взаимодействий)`);
    table(['Действие', 'событий', 'медиана, мс', '75%, мс', 'худшее, мс', 'худшее: ожидание / обработка / отрисовка'], R.input.groups.map((g) => [g.label, g.n, g.p50, g.p75, g.max, g.worst ? `${g.worst.delay} / ${g.worst.proc} / ${g.worst.paint} (${g.worst.name})` : '—']));
    table(['До появления', 'медиана, мс', 'все'], Object.entries(R.input.visible).map(([k, v]) => [k, v.median, v.all.join(', ')]));
    const ty = R.input.typing;
    if (ty) {
      p(`Набор текста: ${ty.keys} нажатий, работы ${ty.total} мс — ${r1(ty.total / ty.keys)} мс на нажатие. Самое тяжёлое:`);
      p();
      table(['Модуль', 'мс'], ty.modules.slice(0, 10).map((x) => [`\`${x.name}\``, x.ms]));
      table(['Функция', 'мс'], ty.functions.slice(0, 12).map((x) => [`\`${x.name}\``, x.ms]));
    }
  }
  if (R.export?.length) {
    p('### Экспорт («Файл → Экспорт», 31 слайд)');
    table(['Формат', 'время, мс', 'файл, МБ', 'самая долгая заминка студии, мс', 'долгих кадров (до, мс)', 'память процессов: до → пик, МБ'], R.export.map((r) => [r.name, r.t, MB(r.size ?? 0), r.frozenMax, `${r.long} (${r.longMax})`, `${r.memBefore} → ${r.memPeak}`]));
  }
  if (R.session) {
    p(`### Долгая работа: ${R.session.cycles} кругов в студии`);
    table(['Круг', 'круг, мс', 'память JS, МБ', 'узлов', 'в документе', 'слушателей', 'документов', 'объектов раскладки'], R.session.rows.map((r) => [r.cycle, r.t, r.heap, r.nodes, r.live, r.listeners, r.docs, r.layoutObjects]));
    const c = R.session.perCycle;
    p(`За круг (от 10-го до последнего): память JS ${c.heapKB} КБ, узлов ${c.nodes} (в документе ${c.live}), слушателей ${c.listeners}, документов ${c.docs}. Отцепленных узлов в конце: ${R.session.detached}`);
    p();
    const d = R.session.detachedRoots;
    if (d) {
      p(`Отцепленных элементов в памяти: ${d.total}. По корням оторванных поддеревьев:`);
      p();
      table(['Корень', 'поддеревьев', 'элементов с JS-обёрткой'], d.top.map(([k, roots, n]) => [`\`${k}\``, roots, n]));
    }
  }
  if (R.showSession) {
    p('### Показ: 3 круга по всем слайдам');
    table(['Круг', 'память JS, МБ', 'узлов', 'в документе', 'слушателей', 'документов'], R.showSession.map((r) => [r.lap, r.heap, r.nodes, r.live, r.listeners, r.docs]));
  }
  const memKeys = Object.keys(R.mem ?? {});
  if (memKeys.length) {
    p('### Память процессов, МБ (рабочий набор)');
    const kinds = [...new Set(memKeys.flatMap((k) => Object.keys(R.mem[k])))];
    const total = (t) => r1(Object.values(t).reduce((s, v) => s + v.ws, 0));
    table(['Этап', ...kinds, 'всего'], memKeys.map((k) => [k, ...kinds.map((x) => (R.mem[k][x] ? `${R.mem[k][x].ws}${R.mem[k][x].n > 1 ? ` (×${R.mem[k][x].n})` : ''}` : '—')), total(R.mem[k])]));
  }
  if (notes.length) { p('### Заметки'); for (const n of notes) p(`- ${n}`); }
  return L.join('\n');
}
