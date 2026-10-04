// Мост страницы и окна приложения: только то, что нужно странице сообщить окну.
// Сейчас это тема — заголовок окна Windows становится тёмным или светлым вместе с ней.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('slideriaApp', {
  /** 'light' | 'dark' — выбранная тема; 'system' — тема следует за системой */
  theme: (mode) => ipcRenderer.send('slideria:theme', mode),
});
