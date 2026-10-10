// Мост страницы и окна приложения: только то, что нужно странице от окна.
//   theme — заголовок окна Windows становится тёмным или светлым вместе с темой;
//   pdf — «Экспорт → PDF» средствами Electron (в окне печати Electron нет «Сохранить как PDF»);
//   build — какая это сборка программы (страница выбора показывает, от какого она числа).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slideriaApp', {
  /** 'light' | 'dark' — выбранная тема; 'system' — тема следует за системой */
  theme: (mode) => ipcRenderer.send('slideria:theme', mode),
  /** Страница (уже с листами для печати) → PDF; ответ — путь к файлу или null, если не сохранили */
  pdf: (name) => ipcRenderer.invoke('slideria:pdf', name),
  /** { version, date, commit } — сборка установленной программы; date пустая — запуск из проекта */
  build: ipcRenderer.sendSync('slideria:build'),
});
