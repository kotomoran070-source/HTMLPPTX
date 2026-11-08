// Мост страницы и окна приложения: только то, что нужно странице от окна.
//   theme — заголовок окна Windows становится тёмным или светлым вместе с темой;
//   pdf — «Экспорт → PDF» средствами Electron (в окне печати Electron нет «Сохранить как PDF»);
//   build — какая это сборка программы (страница выбора показывает, от какого она числа).
const { contextBridge, ipcRenderer } = require('electron');

// Окно закрывается: программа ждёт, пока страница допишет своё (onBeforeClose), и только потом закрывает окно
let beforeClose = null;
ipcRenderer.on('slideria:before-close', async (_e, id) => {
  try {
    if (beforeClose) await beforeClose();
  } catch { /* окно закрывается в любом случае */ }
  ipcRenderer.send('slideria:closed-ready', id);
});

contextBridge.exposeInMainWorld('slideriaApp', {
  /** cb() → Promise — перед закрытием окна (студия: записать правки и поставить точку «Закрытие») */
  onBeforeClose: (cb) => { beforeClose = typeof cb === 'function' ? cb : null; },
  /** 'light' | 'dark' — выбранная тема; 'system' — тема следует за системой */
  theme: (mode) => ipcRenderer.send('slideria:theme', mode),
  /** Страница (уже с листами для печати) → PDF; ответ — путь к файлу или null, если не сохранили */
  pdf: (name) => ipcRenderer.invoke('slideria:pdf', name),
  /** { version, date, commit } — сборка установленной программы; date пустая — запуск из проекта */
  build: ipcRenderer.sendSync('slideria:build'),
  /** Скачанный файл сохранён: cb({ file }) — путь, или file: null, если сохранение отменили */
  onSaved: (cb) => ipcRenderer.on('slideria:saved', (_e, info) => cb(info)),
  /** Открыть папку скриптов в Проводнике или Finder (другие пути программа не откроет) */
  openPath: (p) => ipcRenderer.invoke('slideria:open-path', p),
  /** Страница выбора: «Показать в папке» — папка презентации в Проводнике или Finder (только папки презентаций) */
  reveal: (name) => ipcRenderer.invoke('slideria:reveal', name),
  /** Страница нарисована (src/engine/boot.ts): программа убирает заставку */
  ready: () => ipcRenderer.send('slideria:ready'),
  /** true — окно без системного заголовка, шапка страницы — заголовок (src/engine/titlebar.ts); окна показа — false */
  frame: ipcRenderer.sendSync('slideria:frame'),
  /** Mac — системный «светофор» слева; Windows и Linux — кнопки окна рисует страница, справа */
  platform: process.platform,
  /** Высота полосы заголовка: { height } — на Mac по ней ставится «светофор» */
  titleBar: (c) => ipcRenderer.send('slideria:titlebar', c),
  /** Кнопки окна страницы (Windows, Linux): 'min' | 'max' (развернуть или восстановить) | 'close' */
  control: (a) => ipcRenderer.send('slideria:window', a),
  /** { max, full } — окно развёрнуто, во весь экран; onWindowState(cb) — при каждой смене */
  windowState: () => ipcRenderer.sendSync('slideria:window-state'),
  onWindowState: (cb) => ipcRenderer.on('slideria:window-state', (_e, s) => cb(s)),
});
