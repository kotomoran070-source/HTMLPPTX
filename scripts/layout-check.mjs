// Проверка раскладки интерфейса студии: yarn layout [-- параметры]. Не тест: в yarn test и в проекты Playwright не входит,
// запускается руками после правок вёрстки студии. Свой сервер (Vite) — на своей папке презентаций в .tmp/layout-check,
// в ней — нагрузочная презентация: длинные название, автор, имя папки, тексты, подписи слайдов, имя картинки,
// заметки; 40 слайдов, на холсте 20 объектов с анимацией. Студия обходится в нескольких размерах окна и в обеих
// темах: вкладки ленты и все их выпадающие, объекты разных видов с их вкладками и выпадающими, область выделения,
// «Порядок» анимаций, контекстные меню, поиск команд (Ctrl+K), агент, все разделы «Файла» и форматы экспорта.
// На каждом шаге — сканер (layout-check/scan.js): вылезает за свой блок, срезано сбоку или без «…», уходит за край
// окна, текст на тексте. Содержимое слайдов не проверяется — там выход за рамки нормален.
// Итог — .tmp/layout-check/: report.html (находки по видам, где встретились, снимок с рамкой и номером),
// report.json и снимки shots/. Код выхода: 0 — находок нет, 1 — есть.
// Параметры:
//   --sizes 1093x614,1536x864  размеры окна; по умолчанию 1093×614 (экран 1366×768 при масштабе 125 %), 1280×720,
//                              1536×864 (1920×1080 при 125 %) и 1920×1080
//   --themes light,dark        темы (по умолчанию обе)
//   --jobs N                   окон одновременно (по умолчанию 4)
//   --port P                   порт своего сервера (по умолчанию 5197)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.tmp', 'layout-check');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SIZES = arg('sizes', '1093x614,1280x720,1536x864,1920x1080').split(',').map((s) => s.split('x').map(Number));
const THEMES = arg('themes', 'light,dark').split(',');
const JOBS = Math.max(1, Number(arg('jobs', 4)));
const PORT = Number(arg('port', 5197));
const THEME_NAME = { light: 'светлая', dark: 'тёмная' };

// ---------- нагрузочная презентация ----------
const KEY = 'sistema-avtomaticheskogo-monitoringa-parametrov-na-baze-seti-lorawan-s-udalyonnym-dostupom';
const L = 'Система автоматического мониторинга параметров микроклимата на базе сети LoRaWAN с удалённым доступом';
const W = 'Сверхдлинноесловобезпробеловкотороеневлезаетникуда_и_ещё_немного_для_верности_LoRaWAN_868МГц';
const IMG = 'Фотография_базовой_станции_LoRaWAN_на_крыше_корпуса_Б_вид_с_северо-западной_стороны_2026.png';
// Однопиксельная картинка: важно имя файла, а не она сама
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function writeDeck(decks) {
  const dir = path.join(decks, KEY);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', IMG), Buffer.from(PNG, 'base64'));
  const q = JSON.stringify;
  const free = [
    `{type: text, text: ${q(`${L}: заголовок, который не помещается в одну строку подписи`)}, styles: {text: {size: 40, weight: 800}}, place: {x: 40, y: 30, w: 1200}, enter: rise}`,
    `{type: text, text: ${q(W)}, place: {x: 40, y: 150, w: 400}, enter: fade, click: true}`,
    `{type: shape, kind: round, fill: accent, text: ${q(`**Главное**\n${L}`)}, place: {x: 460, y: 150, w: 360, h: 160}, enter: scale, click: true, clickWith: true}`,
    `{type: image, src: ./assets/${IMG}, place: {x: 860, y: 150, w: 380, h: 220}, enter: wipe, click: true}`,
    `{type: list, items: [${q(L)}, ${q(W)}, Коротко], place: {x: 40, y: 340, w: 600}, enter: left, byItem: true, click: true}`,
    `{type: table, header: [${q('Параметр измерения с длинным названием')}, Значение, ${q('Единица измерения')}], rows: [[${q(W)}, '23,5', '°C'], [Влажность, '45', '%']], place: {x: 660, y: 400, w: 580, h: 200}, enter: fade, exit: fade, exitAt: 1}`,
    `{type: stat, value: '1 234 567 890', label: ${q(L)}, delta: '+12 %', place: {x: 40, y: 560, w: 300, h: 140}, emphasis: pulse}`,
    `{type: math, text: 'x^2 + y^2 = r^2', place: {x: 360, y: 580, w: 260, h: 100}, enter: blur, click: true}`,
  ];
  for (let i = 0; i < 12; i++) free.push(`{type: text, text: ${q(`Подпись ${i + 1}: ${L}`)}, place: {x: ${20 + (i % 4) * 300}, y: ${640 + Math.floor(i / 4) * 20}, w: 280}, enter: fade, click: ${i % 2 === 0}}`);
  const slides = [
    `  - id: cover\n    template: cover\n    label: ${q(L)}\n    title: ${q(L)}\n    lead: ${q(`${L} — подзаголовок одним очень длинным предложением`)}\n    meta: ${q('Константин Константинопольский, кафедра информационно-измерительных систем и технологий, 2026')}\n    notes: ${q(`${L}. `.repeat(20))}`,
    `  - id: table\n    label: ${q(W)}\n    title: ${q(L)}\n    badge: ${q('Очень длинная метка над заголовком')}\n    body:\n      - type: kv\n        rows: {${q('Ключ с длинным названием параметра')}: ${q(L)}, Коротко: ${q(W)}}\n    notes: ${q(W)}`,
    `  - id: canvas\n    template: canvas\n    label: ${q(`Холст: ${L}`)}\n    transition: cube\n    free:\n${free.map((f) => `      - ${f}`).join('\n')}`,
  ];
  for (let i = 4; i <= 40; i++) slides.push(`  - id: s${i}\n    label: ${q(`${i}. ${L}`)}\n    title: ${q(`${i}. ${L}`)}\n    body:\n      - type: text\n        text: ${q(L)}`);
  fs.writeFileSync(path.join(dir, 'deck.yaml'), `title: ${q(L)}\nauthor: ${q('Константин Константинопольский, кафедра информационно-измерительных систем')}\nlang: ru\nslides:\n${slides.join('\n')}\n`);
}

// ---------- свой сервер ----------
async function startServer() {
  const env = { ...process.env, BROWSER: 'none', ANTHROPIC_API_KEY: '' };
  for (const [k, d] of [['SLIDERIA_DECKS', 'decks'], ['SLIDERIA_FONTS', 'fonts'], ['SLIDERIA_LIBRARY', 'library']]) {
    env[k] = path.join(OUT, d);
    fs.mkdirSync(env[k], { recursive: true });
  }
  writeDeck(env.SLIDERIA_DECKS);
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const end = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Сервер не запустился (порт ${PORT} занят? --port): ${err.trim().split('\n').pop()}`);
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return child; } catch { /* ещё не слушает */ }
    if (Date.now() > end) { child.kill(); throw new Error('Сервер не ответил за минуту'); }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// ---------- обход студии ----------
const SCAN = fs.readFileSync(path.join(ROOT, 'scripts', 'layout-check', 'scan.js'), 'utf8');
const found = [];
const failed = [];
const pageErrors = [];

async function pass(browser, [w, h], theme) {
  const tag = `${w}x${h}-${theme}`;
  const label = `${w}×${h}, ${THEME_NAME[theme] ?? theme}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  await ctx.addInitScript(SCAN);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => pageErrors.push(`${label}: ${e.message}`));
  await p.goto(`http://localhost:${PORT}/?deck=${KEY}&studio#3`);
  await p.waitForSelector('#st-canvas .slide.on', { timeout: 60_000 });
  await p.waitForTimeout(1500);
  // Одно и то же место (вид находки + элемент) — один раз за проход, со снимком того шага, где нашлось впервые
  const seen = new Set();
  let shot = 0, steps = 0, hits = 0;
  const scan = async (state) => {
    steps++;
    await p.waitForTimeout(250);
    const list = (await p.evaluate(() => window.__layoutScan())).filter((it) => !seen.has(`${it.kind}|${it.path}`));
    if (!list.length) return;
    list.forEach((it) => seen.add(`${it.kind}|${it.path}`));
    const file = `${tag}-${String(++shot).padStart(2, '0')}.png`;
    await p.evaluate((l) => window.__layoutMark(l), list);
    await p.screenshot({ path: path.join(OUT, 'shots', file) });
    await p.evaluate(() => window.__layoutMark([]));
    list.forEach((it, n) => found.push({ ...it, n: n + 1, tag, label, state, file }));
    hits += list.length;
  };
  const step = async (state, fn) => {
    try { await fn(); await scan(state); }
    catch (e) { failed.push(`${label} · ${state}: ${e.message.split('\n')[0]}`); }
  };
  const esc = async (n = 2) => { for (let i = 0; i < n; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(120); } };
  const tabs = () => p.$$eval('[data-tab]', (els) => els.filter((e) => e.checkVisibility()).map((e) => e.dataset.tab));
  // Кнопки с выпадающим помечаются номером заново перед каждым нажатием: лента перерисовывается после окон
  const popups = () => p.evaluate(() => {
    document.querySelectorAll('[data-layout-pop]').forEach((e) => e.removeAttribute('data-layout-pop'));
    return [...document.querySelectorAll('.st-ribbon [aria-haspopup]')]
      .filter((e) => e.checkVisibility() && !e.disabled && !e.closest('[aria-disabled="true"]') && getComputedStyle(e).pointerEvents !== 'none')
      .map((e, i) => { e.dataset.layoutPop = String(i); return { i, t: (e.title || e.textContent || '').trim().slice(0, 40) }; });
  });
  const openPopup = (pop) => async () => {
    await popups();
    await p.locator(`[data-layout-pop="${pop.i}"]`).click({ timeout: 3000 });
    await p.waitForTimeout(300);
  };
  const tab = (t) => p.locator(`[data-tab="${t}"]:visible`).first();

  await step('открыта студия', async () => {});
  for (const t of await tabs()) {
    await step(`вкладка ${t}`, () => tab(t).click());
    for (const pop of await popups()) {
      await step(`${t} → ${pop.t}`, openPopup(pop));
      await esc();
    }
  }
  // Объекты разных видов — через область выделения; у каждого свои вкладки и выпадающие
  await tab('home').click();
  await p.keyboard.press('Alt+F10');
  await step('область выделения', async () => {});
  const base = new Set(await tabs());
  const pick = (k) => p.locator(`.st-lyr[data-k="${k}"] .st-lyr-name`).click();
  for (const [k, what] of [[0, 'текст'], [2, 'фигура'], [3, 'картинка'], [4, 'список'], [5, 'таблица'], [6, 'число'], [7, 'формула']]) {
    await step(`выделен объект: ${what}`, () => pick(k));
    for (const t of (await tabs()).filter((x) => !base.has(x))) {
      await step(`${what}: вкладка ${t}`, () => tab(t).click());
      for (const pop of await popups()) {
        // Первый Esc закрывает окно, второй снял бы выделение — тогда объект и вкладка заново
        if (!(await tab(t).count())) { await pick(k); await tab(t).click(); await p.waitForTimeout(200); }
        await step(`${what}: ${t} → ${pop.t}`, openPopup(pop));
        await esc(1);
      }
    }
    await tab('home').click();
  }
  await step('выделены два объекта', async () => {
    await pick(0);
    await p.locator('.st-lyr[data-k="2"] .st-lyr-name').click({ modifiers: ['Control'] });
  });
  await p.keyboard.press('Alt+F10');
  await step('«Порядок» анимаций', async () => {
    await tab('anim').click();
    await p.locator('[data-cmd="anim.order"]:visible').first().click();
    await p.waitForTimeout(300);
  });
  await p.locator('[data-cmd="anim.order"]:visible').first().click().catch(() => {});
  await step('меню миниатюры', () => p.locator('.st-thumb').nth(1).click({ button: 'right' }));
  await esc();
  await step('меню объекта', async () => {
    const r = await p.locator('#st-canvas .slide.on .free').nth(2).boundingBox();
    await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: 'right' });
  });
  await esc();
  await step('меню холста', async () => {
    const r = await p.locator('#st-canvas').boundingBox();
    await p.mouse.click(r.x + 12, r.y + r.height - 12, { button: 'right' });
  });
  await esc();
  await step('поиск команд', async () => {
    await p.keyboard.press('Control+k');
    await p.keyboard.type('экспорт презентации в формат PDF с высоким качеством картинок');
  });
  await esc();
  const agent = p.locator('[data-cmd="agent.toggle"]:visible').first();
  await step('агент', () => agent.click({ timeout: 3000 }));
  await esc();
  await agent.click({ timeout: 3000 }).catch(() => {});
  await p.locator('#st-file').click();
  for (const s of await p.$$eval('.fp [data-fs]', (els) => [...new Set(els.map((e) => e.dataset.fs))])) {
    await step(`Файл → ${s}`, () => p.locator(`.fp [data-fs="${s}"]`).first().click());
    if (s === 'export') {
      for (const x of await p.$$eval('.fp [data-x]', (els) => els.map((e) => e.dataset.x))) await step(`Файл → экспорт ${x}`, () => p.locator(`.fp [data-x="${x}"]`).click());
    }
  }
  await ctx.close();
  console.log(`${label}: шагов ${steps}, находок ${hits}`);
}

// ---------- отчёт ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function report() {
  const groups = new Map();
  for (const it of found) {
    const k = `${it.kind}|${it.path}`;
    const g = groups.get(k) ?? { kind: it.kind, path: it.path, text: it.text, over: 0, where: new Set(), states: new Set(), file: it.file, n: it.n };
    g.over = Math.max(g.over, it.over);
    g.where.add(it.label);
    g.states.add(it.state);
    groups.set(k, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind, 'ru') || b.where.size - a.where.size);
  const json = rows.map((g) => ({ ...g, where: [...g.where], states: [...g.states] }));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ found: json, failed, pageErrors }, null, 1));
  const item = (g) => `<section><h2>${esc(g.kind)} <small>до ${g.over} px</small></h2>
<p><code>${esc(g.path)}</code>${g.text ? ` — «${esc(g.text)}»` : ''}</p>
<p class="mu">Где: ${esc([...g.where].join('; '))}<br>Шаги: ${esc([...g.states].slice(0, 4).join('; '))}${g.states.size > 4 ? ` и ещё ${g.states.size - 4}` : ''}</p>
<p class="mu">Снимок — рамка №${g.n}</p><a href="shots/${g.file}"><img src="shots/${g.file}" loading="lazy" alt=""></a></section>`;
  const list = (t, a) => (a.length ? `<h2>${t}</h2><ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  fs.writeFileSync(path.join(OUT, 'report.html'), `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Раскладка студии</title>
<style>body{margin:0 auto;max-width:1100px;padding:24px;font:14px/1.5 system-ui;color:#0f172a;background:#f8fafc}h1{font-size:22px}h2{font-size:16px;margin:0 0 4px}
section{margin:0 0 28px;padding:16px;background:#fff;border:1px solid #e2e8f0;border-radius:10px}small,.mu{color:#64748b}code{font-size:12.5px}img{max-width:100%;border:1px solid #e2e8f0;border-radius:6px}</style>
<h1>Раскладка студии: ${rows.length ? `разных находок ${rows.length}` : 'находок нет'}</h1>
<p class="mu">${esc(`${new Date().toLocaleString('ru-RU')} · окна: ${SIZES.map(([a, b]) => `${a}×${b}`).join(', ')} · темы: ${THEMES.map((t) => THEME_NAME[t] ?? t).join(', ')}`)}</p>
${rows.map(item).join('\n')}${list('Шаги, которые не удалось сделать', failed)}${list('Ошибки страницы', pageErrors)}</html>`);
  return rows.length;
}

fs.rmSync(path.join(OUT, 'shots'), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const server = await startServer();
const stop = () => { if (server.exitCode === null) server.kill(); };
process.on('SIGINT', () => { stop(); process.exit(130); });
let distinct = 0;
try {
  const browser = await chromium.launch();
  const combos = SIZES.flatMap((s) => THEMES.map((t) => [s, t]));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(JOBS, combos.length) }, async () => {
    while (next < combos.length) await pass(browser, ...combos[next++]);
  }));
  await browser.close();
  distinct = report();
} finally {
  stop();
}
console.log(`${distinct ? `Разных находок: ${distinct}` : 'Находок нет'}${failed.length ? `; шагов не удалось: ${failed.length}` : ''} — ${path.relative(ROOT, path.join(OUT, 'report.html'))}`);
process.exitCode = distinct ? 1 : 0;
