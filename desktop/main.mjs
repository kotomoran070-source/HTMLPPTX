// Приложение Slideria: окно Electron поверх того же сервера, что и yarn dev.
// Сервер Vite с плагинами проекта запускается прямо здесь, в главном процессе, — сохранение,
// ассеты, шрифты, экспорт работают тем же кодом, что в браузере. Отличаются только папки:
//   презентации — «Документы/Slideria» (при первом запуске там появляется презентация из шаблона),
//   библиотека шрифтов и кэш Vite — папка данных приложения (%APPDATA%/Slideria).
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, session, shell } from 'electron';
import { FIX_FLAG, allowFirewall, runFirewallFix } from './firewall.mjs';
import { lanGateway } from './lan.mjs';

// Экземпляр, запущенный кнопкой «Разрешить в брандмауэре» с правами администратора:
// меняет правила и выходит, окно не открывает
if (process.argv.includes(FIX_FLAG)) runFirewallFix();

// Имя задаёт папку данных (%APPDATA%/Slideria) и в yarn app, и в установленной программе
app.setName('Slideria');
// Автотесты (tests/app) запускают приложение во временных папках, не трогая настоящие
if (process.env.SLIDERIA_USER_DATA) app.setPath('userData', process.env.SLIDERIA_USER_DATA);
const APP_DIR = app.getAppPath();
const DATA = app.getPath('userData');
const DECKS = process.env.SLIDERIA_DOCS_DIR || path.join(app.getPath('documents'), 'Slideria');
const LOG = path.join(DATA, 'slideria.log');

/** @type {import('vite').ViteDevServer | undefined} */
let server;
/** @type {BrowserWindow | undefined} */
let main;
let origin = '';
let port = 0;
// Пульт с телефона: вход в локальной сети открывается, когда в показе нажимают R (desktop/lan.mjs)
const lan = lanGateway(() => port, DECKS, (...a) => log(...a));
globalThis.__slideriaLan = (deck) => lan.open(deck);
if (process.platform === 'win32') globalThis.__slideriaFirewall = () => allowFirewall((...a) => log(...a));

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
  const tpl = path.join(APP_DIR, 'templates', 'basic');
  if (!fs.existsSync(tpl)) return;
  const dst = path.join(DECKS, FIRST_DIR);
  fs.cpSync(tpl, dst, { recursive: true });
  const file = path.join(dst, 'deck.yaml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('{{title}}', FIRST_TITLE));
  log('Создана первая презентация в', dst);
}

async function startServer() {
  Object.assign(process.env, {
    SLIDERIA_APP: '1',
    SLIDERIA_DECKS: DECKS,
    SLIDERIA_DECKS_LABEL: 'Документы/Slideria/',
    SLIDERIA_FONTS: path.join(DATA, 'fonts'),
    SLIDERIA_CACHE: path.join(DATA, 'vite-cache'),
  });
  // Плагины и сборка считают пути от корня проекта
  process.chdir(APP_DIR);
  const { createServer } = await import('vite');
  server = await createServer({
    configFile: path.join(APP_DIR, 'vite.config.ts'),
    // Без временного файла рядом с конфигом: папка программы может быть только для чтения
    configLoader: 'runner',
    root: APP_DIR,
    clearScreen: false,
    server: { port: 47320, strictPort: false },
  });
  await server.listen();
  const a = server.httpServer?.address();
  port = a && typeof a === 'object' ? a.port : 47320;
  origin = `http://127.0.0.1:${port}`;
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
const WEB = { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: PRELOAD };

// Тема Slideria → заголовок окна Windows (тёмный или светлый). Цвет заголовка рисует система,
// поэтому точного цвета темы здесь нет — только светлый или тёмный вариант
ipcMain.on('slideria:theme', (e, mode) => {
  if (!ours(e.senderFrame?.url ?? '')) return;
  if (mode === 'light' || mode === 'dark' || mode === 'system') nativeTheme.themeSource = mode;
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
ipcMain.handle('slideria:pdf', async (e, name) => {
  if (!ours(e.senderFrame?.url ?? '')) return null;
  const data = await e.sender.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
  const file = `${fileName(name)}.pdf`;
  let out = process.env.SLIDERIA_SAVE_DIR ? path.join(process.env.SLIDERIA_SAVE_DIR, file) : '';
  if (!out) {
    const win = BrowserWindow.fromWebContents(e.sender) ?? main;
    const r = await dialog.showSaveDialog(win, { title: 'Сохранить PDF', defaultPath: path.join(app.getPath('documents'), file), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    out = r.filePath;
  }
  fs.writeFileSync(out, data);
  log('PDF:', out);
  if (!process.env.SLIDERIA_SAVE_DIR) shell.showItemInFolder(out);
  return out;
});

/** Общие правила для всех окон: свои страницы открываются окнами (показ, заметки), чужие — в браузере */
function guard(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ours(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, backgroundColor: '#0b0d12', webPreferences: WEB } };
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
  wc.on('did-create-window', (w) => guard(w));
});

const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#0b0d12;color:#cbd5e1;font:15px system-ui,"Segoe UI",sans-serif}
.s{display:flex;gap:12px;align-items:center}.d{width:14px;height:14px;border-radius:50%;border:2px solid #5B8DEF;border-top-color:transparent;animation:r .8s linear infinite}
@keyframes r{to{transform:rotate(1turn)}}</style><div class="s"><div class="d"></div>Slideria запускается…</div>`)}`;

function createWindow() {
  const st = loadState();
  const win = new BrowserWindow({
    ...st,
    minWidth: 720,
    minHeight: 480,
    title: 'Slideria',
    icon: ICON,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    show: false,
    webPreferences: WEB,
  });
  if (st.maximized) win.maximize();
  guard(win);
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveState(win));
  win.on('closed', () => { if (main === win) main = undefined; });
  void win.loadURL(SPLASH);
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
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
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
        { label: `Версия ${BUILD.version}${BUILD.date ? ` · сборка от ${BUILD.date}` : ' · из проекта'}`, enabled: false },
      ],
    },
  ]));
}

/**
 * Шрифты компьютера в списке шрифтов студии: доступ без вопроса — только страницам своего сервера.
 * Остальные разрешения — как по умолчанию в Electron (разрешены).
 */
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

function allowLocalFonts() {
  const ours = (o) => !!origin && typeof o === 'string' && o.replace(/\/$/, '') === origin;
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permission !== 'local-fonts' || ours(requestingOrigin));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done, details) => done(permission !== 'local-fonts' || ours(new URL(details.requestingUrl).origin)));
}

app.whenReady().then(async () => {
  fs.mkdirSync(DATA, { recursive: true });
  allowLocalFonts();
  downloads();
  log('Сборка:', BUILD.date ? `${BUILD.version} от ${BUILD.date} (${BUILD.commit})` : 'из проекта');
  buildMenu();
  main = createWindow();
  try {
    ensureDecks();
    await startServer();
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
