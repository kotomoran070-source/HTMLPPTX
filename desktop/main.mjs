// Приложение Slideria: окно Electron поверх сервера Slideria (server/serve.ts) — без Vite. Студия собрана
// заранее, сервер — одним файлом (scripts/build.mjs --app); сохранение, файлы, шрифты, экспорт — тем же ядром,
// что и в yarn dev. Отличаются только папки:
//   презентации — «Документы/Slideria» (при первом запуске там появляется презентация из шаблона),
//   библиотека шрифтов и свои темы — папка данных приложения (%APPDATA%/Slideria).
// Код программы: в установленной — app/ рядом с app.asar; при запуске из проекта (yarn app) — .tmp/app,
// он собирается перед запуском, если код поменялся.
// Установленная программа (docs/PROTECTION.md): этот загрузчик — в app.asar, его проверяет сам Electron;
// сжатый код программы — рядом, в app.asar.unpacked, и перед запуском сверяется с отпечатками из app.asar.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, Menu, WebContentsView, desktopCapturer, dialog, ipcMain, nativeTheme, screen, session, shell, utilityProcess } from 'electron';
import { FIX_FLAG, allowFirewall, runFirewallFix } from './firewall.mjs';
import { lanGateway } from './lan.mjs';
import { splashPage } from './splash.mjs';

// Экземпляр, запущенный кнопкой «Разрешить в брандмауэре» с правами администратора:
// меняет правила и выходит, окно не открывает
if (process.argv.includes(FIX_FLAG)) runFirewallFix();

// Имя задаёт папку данных (%APPDATA%/Slideria) и в yarn app, и в установленной программе
app.setName('Slideria');
// Автотесты (tests/app) запускают приложение во временных папках, не трогая настоящие
if (process.env.SLIDERIA_USER_DATA) app.setPath('userData', process.env.SLIDERIA_USER_DATA);
const APP_DIR = app.getAppPath();
// Код программы: в установленной — рядом с app.asar (обычными файлами), из проекта — сам проект
const PACKED = APP_DIR.endsWith('.asar');
const ROOT = PACKED ? `${APP_DIR}.unpacked` : APP_DIR;
// Собранная студия и сервер одним файлом (scripts/build.mjs --app)
const CODE = PACKED ? path.join(ROOT, 'app') : path.join(ROOT, '.tmp', 'app');
const DATA = app.getPath('userData');
const DECKS = process.env.SLIDERIA_DOCS_DIR || path.join(app.getPath('documents'), 'Slideria');
const LOG = path.join(DATA, 'slideria.log');

/** Сервер Slideria (server/serve.ts): { url, port, close } */
let server;
/** @type {BrowserWindow | undefined} */
let main;
let origin = '';
let port = 0;
// Пульт с телефона: вход в локальной сети открывается, когда в показе нажимают R (desktop/lan.mjs)
const lan = lanGateway(() => port, DECKS, (...a) => log(...a));
/**
 * Сборка (код программы при запуске из проекта, недостающий вариант проигрывателя для «Экспорта») —
 * отдельным служебным процессом Electron. Запуск самого Electron в роли Node в установленной программе
 * выключен (docs/PROTECTION.md), служебный процесс работает и без него
 */
const runNode = (script, args, { cwd, env }) => new Promise((resolve) => {
  let stderr = '';
  let code = null;
  let left = 2;
  // Ответ — когда процесс вышел и его сообщения об ошибках дочитаны (они приходят и после выхода)
  const done = () => { if (--left === 0) resolve({ code, stderr }); };
  const child = utilityProcess.fork(script, args, { cwd, env, stdio: 'pipe', serviceName: 'Slideria — сборка' });
  child.stdout?.resume();
  if (child.stderr) {
    child.stderr.on('data', (d) => { stderr += d; });
    child.stderr.once('end', done);
  } else done();
  child.once('exit', (c) => { code = c; done(); });
});

function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map(String).join(' ')}\n`;
  try { fs.appendFileSync(LOG, line); } catch { /* нет доступа — не страшно */ }
  process.stdout.write(line);
}

// Второй запуск просто поднимает уже открытое окно
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.focus();
});

/**
 * Первый запуск: папка «Документы/Slideria» и в ней одна презентация из шаблона —
 * шаблон с подсказками и примерами по разделам, тот же, что «Новая презентация → с примерами»
 */
const FIRST_TITLE = 'Моя первая презентация';
const FIRST_DIR = 'moya-pervaya-prezentaciya';

function ensureDecks() {
  if (fs.existsSync(DECKS)) return;
  fs.mkdirSync(DECKS, { recursive: true });
  const tpl = path.join(ROOT, 'templates', 'basic');
  if (!fs.existsSync(tpl)) return;
  const dst = path.join(DECKS, FIRST_DIR);
  fs.cpSync(tpl, dst, { recursive: true });
  const file = path.join(dst, 'deck.yaml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('{{title}}', FIRST_TITLE));
  log('Создана первая презентация в', dst);
}

/**
 * Изменённый код программы — какие файлы не совпали с отпечатками сборки (scripts/app-stage.mjs).
 * Отпечатки лежат в app.asar: подменить их, не сломав проверку самого Electron, нельзя
 */
function tampered() {
  if (!PACKED) return [];
  let files;
  try {
    files = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'desktop', 'integrity.json'), 'utf8')).files;
  } catch {
    return ['desktop/integrity.json'];
  }
  return Object.entries(files).filter(([rel, sum]) => {
    try {
      return createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('base64') !== sum;
    } catch {
      return true;
    }
  }).map(([rel]) => rel);
}

/**
 * Запуск из проекта (yarn app): студия и сервер собираются заново, если код поменялся (scripts/build.mjs --app;
 * не поменялся — доли секунды). Установленная программа везёт их готовыми
 */
async function ensureCode() {
  if (PACKED) return;
  const t0 = Date.now();
  const r = await runNode(path.join(ROOT, 'scripts', 'build.mjs'), ['--app', `--out=${CODE}`], { cwd: ROOT, env: { ...process.env } });
  if (r.code) throw new Error(`Код программы не собрался: ${r.stderr.trim().split('\n').slice(-3).join(' ')}`);
  log('Код программы проверен:', `${Date.now() - t0} мс`);
}

async function startServer() {
  // package.json и штамп сборки — в app.asar, а не рядом с кодом (страница лицензий)
  if (PACKED) {
    Object.assign(process.env, {
      SLIDERIA_PACKAGE: path.join(APP_DIR, 'package.json'),
      SLIDERIA_BUILD_STAMP: path.join(APP_DIR, 'desktop', 'build.json'),
    });
  }
  // Ядро считает пути сообщений от текущей папки
  process.chdir(ROOT);
  const { startServer: start } = await import(pathToFileURL(path.join(CODE, 'server.mjs')).href);
  server = await start({
    dir: DECKS,
    root: ROOT,
    studio: path.join(CODE, 'studio'),
    fonts: path.join(DATA, 'fonts'),
    library: path.join(DATA, 'library'),
    // Проигрыватель для экспорта собран с программой (player/); вариант, которого там нет, собирается
    // к данным программы: её папка может быть только для чтения (server/player.ts)
    ...(PACKED ? { playerCache: path.join(DATA, 'player') } : {}),
    // Окно приложения — единственный клиент: сервер слушает только этот компьютер
    host: '127.0.0.1',
    port: 47320,
    env: { app: true, decks: 'Документы/Slideria/' },
    lan: (deck) => lan.open(deck),
    ...(process.platform === 'win32' ? { firewall: () => allowFirewall((...a) => log(...a)) } : {}),
    run: runNode,
    log: (m) => log(m),
  });
  port = server.port;
  origin = server.url;
  log('Сервер:', origin);
}

// ---------- окно ----------

const STATE = path.join(DATA, 'window.json');

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch { /* первый запуск */ }
  return { width: 1360, height: 860 };
}

function saveState(win) {
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(STATE, JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch { /* не страшно */ }
}

const ICON = path.join(APP_DIR, 'desktop', 'icon.png');
const PRELOAD = path.join(APP_DIR, 'desktop', 'preload.cjs');
// Звук слайда (аудиовизуализатор во вставке) — без щелчка по ней: слушать начинает сразу
const WEB = { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: PRELOAD, autoplayPolicy: 'no-user-gesture-required' };

// Тема Slideria → заголовок окна Windows (тёмный или светлый). Цвет заголовка рисует система,
// поэтому точного цвета темы здесь нет — только светлый или тёмный вариант. Выбор запоминается:
// при следующем запуске заставка и фон окна сразу в этой теме, без вспышки другого цвета
const UI = path.join(DATA, 'ui.json');
ipcMain.on('slideria:theme', (e, mode) => {
  if (!ours(e.senderFrame?.url ?? '')) return;
  if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return;
  nativeTheme.themeSource = mode;
  try { fs.writeFileSync(UI, JSON.stringify({ theme: mode })); } catch { /* не страшно */ }
});
/** Тема с прошлого раза (до первой страницы): светлая, тёмная или как в системе */
function savedTheme() {
  try {
    const t = JSON.parse(fs.readFileSync(UI, 'utf8')).theme;
    if (t === 'light' || t === 'dark' || t === 'system') nativeTheme.themeSource = t;
  } catch { /* первый запуск — как в системе */ }
  return nativeTheme.shouldUseDarkColors;
}
/** Фон страниц Slideria (src/styles/tokens.css, --bg) — фон окна до первой страницы */
const pageBg = (dark) => (dark ? '#0F172A' : '#F8FAFC');

/**
 * Свой заголовок окна: системной полосы с названием нет — её место занимает элемент страницы: на странице выбора
 * её шапка, в студии — тонкая полоса над шапкой. Его пустые места перетаскивают окно. Кнопки окна в Windows
 * и Linux рисует сама страница (src/engine/titlebar.ts) — в цвет темы, вместе с ней; на Mac — системный
 * «светофор» слева, по середине полосы (её высоту страница сообщает: slideria:titlebar).
 * Главное окно и окно «Лицензии» (у его страницы та же шапка); окна показа, докладчика и печати — с системной рамкой
 */
const TITLE_H = 48;
/** «Светофор» Mac — по середине полосы высотой h */
const lights = (h) => ({ x: Math.round(h * 0.375), y: Math.round((h - 14) / 2) });
const titleBar = () => (process.platform === 'darwin'
  ? { titleBarStyle: 'hidden', titleBarOverlay: true, trafficLightPosition: lights(TITLE_H) }
  : { titleBarStyle: 'hidden' });
const framed = new WeakSet();
/** Окно со своим заголовком, если просит его страница программы */
const framedWin = (e) => (framed.has(e.sender) && ours(e.senderFrame?.url ?? '') ? BrowserWindow.fromWebContents(e.sender) : null);
/** { max, full } — развёрнуто, во весь экран: от этого зависят кнопки окна на странице */
const winState = (win) => ({ max: win.isMaximized(), full: win.isFullScreen() });
/** Окно со своим заголовком: страница рисует его сама и узнаёт, развёрнуто ли окно */
function frame(win) {
  framed.add(win.webContents);
  const state = () => { if (!win.isDestroyed()) win.webContents.send('slideria:window-state', winState(win)); };
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, state);
}
/** Страница «Лицензии» (src/engine/licenses-page.ts) — окном со своим заголовком */
const licensesUrl = (url) => { try { return ours(url) && new URL(url).searchParams.has('licenses'); } catch { return false; } };
ipcMain.on('slideria:frame', (e) => { e.returnValue = framed.has(e.sender); });
ipcMain.on('slideria:window-state', (e) => { const win = framedWin(e); e.returnValue = win ? winState(win) : null; });
ipcMain.on('slideria:window', (e, a) => {
  const win = framedWin(e);
  if (!win) return;
  if (a === 'min') win.minimize();
  else if (a === 'max') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  else if (a === 'close') win.close();
});
ipcMain.on('slideria:titlebar', (e, c) => {
  const win = framedWin(e);
  const h = Math.round(Number(c?.height));
  if (!win || process.platform !== 'darwin' || !(h >= 28 && h <= 64)) return;
  try { win.setWindowButtonPosition(lights(h)); } catch { /* окно без своего заголовка */ }
});
const ours = (url) => !!origin && (url === origin || url.startsWith(origin + '/'));

/**
 * Сборка программы: yarn app:build пишет desktop/build.json (дата и коммит). Его нет — запуск из
 * проекта (yarn app), код всегда свежий. Установленная программа — снимок кода на день сборки:
 * то, что добавлено в проект позже, появится после новой сборки установщика
 */
function buildInfo() {
  try {
    return { version: app.getVersion(), ...JSON.parse(fs.readFileSync(path.join(APP_DIR, 'desktop', 'build.json'), 'utf8')) };
  } catch {
    return { version: app.getVersion(), date: '', commit: '' };
  }
}
const BUILD = buildInfo();
ipcMain.on('slideria:build', (e) => { e.returnValue = BUILD; });

/** Имя файла без запрещённых в Windows знаков */
const fileName = (s) => String(s || 'Презентация').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Презентация';

/**
 * PDF: окно печати Electron — системное, без «Сохранить как PDF» и без фонов. Поэтому страница
 * готовит листы, как для печати, а PDF делает сам Electron: размер листа — слайд (@page), с фонами.
 * Тесты (SLIDERIA_SAVE_DIR) сохраняют без вопроса
 */
/**
 * «Интеграции → Скрипты → Открыть папку»: открыть можно только папку скриптов в папке презентаций
 * (страница не откроет через это что угодно на диске)
 */
ipcMain.handle('slideria:open-path', async (e, p) => {
  if (!ours(e.senderFrame?.url ?? '')) return false;
  const scripts = path.join(DECKS, 'scripts');
  if (typeof p !== 'string' || path.resolve(p) !== scripts) return false;
  fs.mkdirSync(scripts, { recursive: true });
  return (await shell.openPath(scripts)) === '';
});

// «Показать в папке» на странице выбора: только папка презентации внутри «Документы/Slideria», со своей страницы
ipcMain.handle('slideria:reveal', (e, name) => {
  if (!ours(e.senderFrame?.url ?? '')) return false;
  if (typeof name !== 'string' || !name || name.startsWith('.') || /[\\/]/.test(name)) return false;
  const file = path.resolve(DECKS, name, 'deck.yaml');
  if (path.dirname(path.dirname(file)) !== path.resolve(DECKS) || !fs.existsSync(file)) return false;
  shell.showItemInFolder(file);
  return true;
});

ipcMain.handle('slideria:pdf', async (e, name) => {
  if (!ours(e.senderFrame?.url ?? '')) return null;
  const data = await e.sender.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
  const file = `${fileName(name)}.pdf`;
  let out = process.env.SLIDERIA_SAVE_DIR ? path.join(process.env.SLIDERIA_SAVE_DIR, file) : '';
  if (!out) {
    // Окно PDF скрыто — диалог встаёт над редактором
    const own = BrowserWindow.fromWebContents(e.sender);
    const win = own?.isVisible() ? own : main ?? own;
    const r = await dialog.showSaveDialog(win, { title: 'Сохранить PDF', defaultPath: path.join(app.getPath('documents'), file), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    out = r.filePath;
  }
  fs.writeFileSync(out, data);
  log('PDF:', out);
  if (!process.env.SLIDERIA_SAVE_DIR) shell.showItemInFolder(out);
  return out;
});

/** Новое окно (показ, заметки) — крупное, по центру экрана, где открыт редактор: 80 % рабочей области */
function openSize(from) {
  const area = screen.getDisplayMatching(from.getBounds()).workArea;
  const width = Math.round(area.width * 0.8);
  const height = Math.round(area.height * 0.8);
  return { width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2) };
}

/** Окно для чтения («Лицензии»): до 1280 × 860, по центру экрана, где открыт редактор */
function readSize(from) {
  const area = screen.getDisplayMatching(from.getBounds()).workArea;
  const width = Math.min(1280, Math.round(area.width * 0.8));
  const height = Math.min(860, Math.round(area.height * 0.85));
  return { width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2) };
}

/** Общие правила для всех окон: свои страницы открываются окнами (показ, заметки), чужие — в браузере */
function guard(win) {
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (ours(url)) {
      const base = { icon: ICON, autoHideMenuBar: true, backgroundColor: '#0b0d12', webPreferences: WEB };
      // «Лицензии»: окно для чтения, не во весь экран; заголовок — шапка страницы, фон — её, без вспышки
      if (licensesUrl(url)) {
        return { action: 'allow', overrideBrowserWindowOptions: { ...base, ...titleBar(), ...readSize(win), minWidth: 720, minHeight: 480, title: 'Лицензии · Slideria', backgroundColor: pageBg(nativeTheme.shouldUseDarkColors) } };
      }
      // «Экспорт → PDF»: листы готовятся в невидимом окне, оно закрывается само (src/engine/print.ts)
      if (frameName.startsWith('htmlpptx-print-')) {
        return { action: 'allow', overrideBrowserWindowOptions: { ...base, show: false, webPreferences: { ...WEB, backgroundThrottling: false } } };
      }
      // Докладчик уже 900 px складывается в столбик, как на телефоне; показ меньше 640 × 400 — уже не показ.
      // Фоном не притормаживают: окно показа, закрытое докладчиком, продолжает автопоказ
      const min = frameName.startsWith('htmlpptx-presenter-') ? { minWidth: 960, minHeight: 600 } : { minWidth: 640, minHeight: 400 };
      return { action: 'allow', overrideBrowserWindowOptions: { ...base, ...min, ...openSize(win), webPreferences: { ...WEB, backgroundThrottling: false } } };
    }
    if (/^https?:|^mailto:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (ours(url)) return;
    e.preventDefault();
    if (/^https?:|^mailto:/i.test(url)) void shell.openExternal(url);
  });
}

app.on('web-contents-created', (_e, wc) => {
  zoomKeys(wc);
  wc.on('did-create-window', (w, d) => {
    guard(w);
    if (licensesUrl(d.url)) frame(w);
  });
});

/**
 * Заставка «Колода» (desktop/splash.mjs) — слоем поверх окна, в цвет темы: ни белой вспышки, ни страницы, которая
 * «догружается» на глазах. Полоска на ней идёт по шагам запуска (splashStep), а когда страница нарисована
 * (src/engine/boot.ts → slideria:ready), слайды разлетаются и слой убирается
 */
const splashSteps = new WeakMap();
/** Шаг запуска на заставке окна: p — доля пути, k — номер подписи (desktop/splash.mjs, NOTES) */
const splashStep = (win, p, k) => splashSteps.get(win)?.(p, k);

function createWindow() {
  const st = loadState();
  const dark = savedTheme();
  const win = new BrowserWindow({
    ...st,
    minWidth: 720,
    minHeight: 480,
    title: 'Slideria',
    icon: ICON,
    backgroundColor: pageBg(dark),
    autoHideMenuBar: true,
    ...titleBar(),
    show: false,
    webPreferences: WEB,
  });
  // Кнопки окна на странице: развернуть ↔ восстановить, во весь экран — без них
  frame(win);
  if (st.maximized) win.maximize();
  guard(win);
  win.on('close', () => saveState(win));
  win.on('closed', () => { if (main === win) main = undefined; });
  // Заставка — слоем поверх окна; окно показывается, когда она нарисована
  const splash = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  splash.setBackgroundColor('#00000000');
  win.contentView.addChildView(splash);
  const fit = () => { const [w, h] = win.getContentSize(); splash.setBounds({ x: 0, y: 0, width: w, height: h }); };
  fit();
  win.on('resize', fit);
  splash.webContents.once('did-finish-load', () => win.show());
  void splash.webContents.loadURL(splashPage(dark));
  let gone = false;
  splashSteps.set(win, (p, k) => {
    if (!gone && !splash.webContents.isDestroyed()) splash.webContents.executeJavaScript(`step(${Number(p)},${Number(k)})`).catch(() => {});
  });
  /** Страница нарисована — слайды заставки разлетаются, слой убирается, когда они улетели */
  const drop = () => {
    if (gone || win.isDestroyed()) return;
    gone = true;
    win.off('resize', fit);
    const remove = () => {
      if (win.isDestroyed()) return;
      win.contentView.removeChildView(splash);
      if (!splash.webContents.isDestroyed()) splash.webContents.close();
    };
    const left = splash.webContents.executeJavaScript('done()').catch(() => {});
    void Promise.race([left, new Promise((r) => setTimeout(r, 1500))]).then(remove);
  };
  win.webContents.ipc.on('slideria:ready', drop);
  // Страница загружена — почти готово; так и не сказала «готова» (сбой до неё) — заставка всё равно уходит
  win.webContents.on('did-finish-load', () => {
    splashStep(win, 0.85, 3);
    setTimeout(drop, 4000);
  });
  return win;
}

// ---------- масштаб ----------
// Стандартное «Крупнее» в Electron — Ctrl + «+», то есть с Shift: Ctrl + «=» не срабатывал.
// Шаги — как в Chrome
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const focused = () => BrowserWindow.getFocusedWindow()?.webContents;

/** dir: 1 — крупнее, -1 — мельче, 0 — обычный масштаб */
function zoom(wc, dir) {
  if (!wc) return;
  if (!dir) return wc.setZoomFactor(1);
  const f = wc.getZoomFactor();
  const next = dir > 0 ? ZOOMS.find((z) => z > f + 0.001) : [...ZOOMS].reverse().find((z) => z < f - 0.001);
  if (next) wc.setZoomFactor(next);
}

function zoomKeys(wc) {
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const k = input.key;
    const c = input.code;
    const dir = k === '+' || k === '=' || c === 'NumpadAdd' || c === 'Equal' ? 1
      : k === '-' || k === '_' || c === 'NumpadSubtract' || c === 'Minus' ? -1
      : k === '0' || c === 'Numpad0' || c === 'Digit0' ? 0 : null;
    if (dir === null) return;
    e.preventDefault();
    zoom(wc, dir);
  });
}

/** Меню скрыто (Alt показывает): нужно ради привычных клавиш — обновить, масштаб, полный экран */
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Файл',
      submenu: [
        { label: 'Папка с презентациями', click: () => void shell.openPath(DECKS) },
        { label: 'Все презентации', accelerator: 'CmdOrCtrl+Shift+H', click: () => void main?.loadURL(origin + '/?all') },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' },
      ],
    },
    { role: 'editMenu', label: 'Правка' },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Обновить' },
        { role: 'forceReload', label: 'Обновить без кэша' },
        // В установленной программе инструментов разработчика нет: только при запуске из проекта
        ...(PACKED ? [] : [{ role: 'toggleDevTools', label: 'Инструменты разработчика' }]),
        { type: 'separator' },
        // Клавиши масштаба ловит zoomKeys: так Ctrl + «=/+» работает без Shift и на цифровом блоке
        { label: 'Обычный масштаб', accelerator: 'CmdOrCtrl+0', registerAccelerator: false, click: () => zoom(focused(), 0) },
        { label: 'Крупнее', accelerator: 'CmdOrCtrl+=', registerAccelerator: false, click: () => zoom(focused(), 1) },
        { label: 'Мельче', accelerator: 'CmdOrCtrl+-', registerAccelerator: false, click: () => zoom(focused(), -1) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        { label: 'Журнал работы', click: () => void shell.openPath(LOG) },
        // Та же страница, что у кнопки на вкладке «Инструменты»: окно программы со своим заголовком (src/engine/licenses-page.ts)
        { label: 'Лицензии', click: () => void main?.webContents.executeJavaScript("window.open('/?licenses', 'slideria-licenses')?.focus()") },
        { label: `Версия ${BUILD.version}${BUILD.date ? ` · сборка от ${BUILD.date}` : ''}`, enabled: false },
      ],
    },
  ]));
}

/** Скачивания (PPTX, HTML): обычное окно «Сохранить как»; в тестах — сразу в папку */
function downloads() {
  session.defaultSession.on('will-download', (_e, item, wc) => {
    const dir = process.env.SLIDERIA_SAVE_DIR;
    if (dir) item.setSavePath(path.join(dir, item.getFilename()));
    else item.setSaveDialogOptions({ title: 'Сохранить', defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
    item.once('done', (_x, state) => {
      log('Скачивание:', item.getFilename(), state, item.getSavePath());
      // Странице — что файл сохранён (или сохранение отменили): она скажет об этом
      if (!wc.isDestroyed()) wc.send('slideria:saved', { file: state === 'completed' ? item.getSavePath() : null });
    });
  });
}

/**
 * Разрешения страниц (таблица с объяснениями — docs/PERMISSIONS.md). Только то, чем пользуется программа:
 * буфер обмена, полный экран, второй монитор, сохранение файла, шрифты компьютера (только своим страницам).
 * Микрофон и звук компьютера просят живые слайды и вставки (аудиовизуализаторы) — один вопрос за запуск.
 * Камера, местоположение, уведомления, USB и прочее — запрещены.
 */
const ALLOWED = new Set(['clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'window-management', 'fileSystem', 'pointerLock', 'keyboardLock', 'mediaKeySystem']);
const asked = new Map();
async function askOnce(key, message, detail) {
  if (!asked.has(key)) {
    const win = BrowserWindow.getFocusedWindow() ?? main;
    asked.set(key, dialog.showMessageBox(win, { type: 'question', buttons: ['Разрешить', 'Запретить'], defaultId: 0, cancelId: 1, message, detail })
      .then((r) => { log('Разрешение', key, r.response === 0 ? 'дано' : 'не дано'); return r.response === 0; }));
  }
  return asked.get(key);
}
const MIC = ['mic', 'Слайд просит доступ к микрофону', 'Живой слайд или вставка хочет слышать микрофон — например, аудиовизуализатор. Разрешение действует до закрытия программы.'];
const SYS = ['sys', 'Слайд просит звук компьютера', 'Живой слайд или вставка хочет слышать звук, который играет на компьютере, — например, аудиовизуализатор под музыку. Разрешение действует до закрытия программы.'];

function permissions() {
  const ours = (o) => !!origin && typeof o === 'string' && o.replace(/\/$/, '') === origin;
  const audioOnly = (types) => Array.isArray(types) && types.length > 0 && types.every((t) => t === 'audio');
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (permission === 'local-fonts') return ours(requestingOrigin);
    if (permission === 'media') return details?.mediaType !== 'video' && asked.has(MIC[0]);
    return ALLOWED.has(permission);
  });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) => {
    if (permission === 'local-fonts') return done(ours(new URL(details.requestingUrl).origin));
    // Только звук: камере в программе делать нечего. Захват экрана (getDisplayMedia) приходит без типов —
    // пропускаем к обработчику ниже, вопрос задаёт он
    if (permission === 'media') {
      const types = details.mediaTypes ?? [];
      if (!types.length) return done(true);
      return audioOnly(types) ? void askOnce(...MIC).then(done) : done(false);
    }
    done(ALLOWED.has(permission));
  });
  // «Звук вкладки или экрана» из слайда: в программе — звук всего компьютера (Windows умеет отдавать его напрямую)
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    void (async () => {
      try {
        if (!await askOnce(...SYS)) return callback({});
        const [src] = await desktopCapturer.getSources({ types: ['screen'] });
        callback(process.platform === 'win32' ? { video: src, audio: 'loopback' } : { video: src });
      } catch (e) {
        log('Захват звука:', e?.message ?? e);
        callback({});
      }
    })();
  });
}

app.whenReady().then(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  permissions();
  downloads();
  log('Сборка:', BUILD.date ? `${BUILD.version} от ${BUILD.date} (${BUILD.commit})` : 'из проекта');
  const bad = tampered();
  if (bad.length) {
    log('Код программы изменён, запуск остановлен:', bad.slice(0, 10).join(', '));
    // Автотесты (SLIDERIA_USER_DATA) проверяют это без окна с вопросом
    if (!process.env.SLIDERIA_USER_DATA) dialog.showErrorBox('Slideria повреждена', 'Файлы программы изменены после установки. Переустановите Slideria.');
    app.exit(1);
    return;
  }
  buildMenu();
  main = createWindow();
  try {
    ensureDecks();
    await ensureCode();
    splashStep(main, 0.3, 1);
    await startServer();
    splashStep(main, 0.55, 2);
    await main?.loadURL(origin + '/?all');
  } catch (e) {
    log('Ошибка запуска:', e?.stack ?? e);
    dialog.showErrorBox('Slideria не запустилась', `${e?.message ?? e}\n\nПодробности: ${LOG}`);
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: окно закрыли, программа осталась в доке
  if (!main && origin) {
    main = createWindow();
    void main.loadURL(origin + '/?all');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let closing = false;
app.on('before-quit', (e) => {
  if (closing || !server) return;
  e.preventDefault();
  closing = true;
  lan.close();
  void server.close().finally(() => app.quit());
});
