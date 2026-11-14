// Картинки слайдов для агента в программе (--mcp, view_slides — server/shot.ts): невидимое окно Electron
// открывает страницу снимка и снимает слайды по одному. Окно рисует себя в память (offscreen), а не на экран:
// размер картинки — как просили, независимо от масштаба экрана, и окно никто не увидит. Окно — на один запрос.
import { BrowserWindow } from 'electron';

const READY_MS = 60_000;

/** @param {{ url: string; count: number; width: number; height: number }} r */
export async function shootPages({ url, count, width, height }) {
  const win = new BrowserWindow({
    show: false, width, height, useContentSize: true, frame: false, enableLargerThanScreen: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  const page = win.webContents;
  // Только своя страница: ни новых окон, ни переходов
  page.setWindowOpenHandler(() => ({ action: 'deny' }));
  page.on('will-navigate', (e) => e.preventDefault());
  try {
    await win.loadURL(url);
    const until = Date.now() + READY_MS;
    let state = '';
    while (!(state = await page.executeJavaScript('document.documentElement.dataset.shot || ""'))) {
      if (Date.now() > until) throw new Error('Страница снимка не ответила за минуту');
      await new Promise((r) => setTimeout(r, 100));
    }
    if (state !== 'ready') throw new Error(`Слайды не нарисовались: ${state.replace(/^error: /, '')}`);
    const out = [];
    for (let k = 0; k < count; k++) {
      await page.executeJavaScript(`window.slideriaShot.show(${k})`);
      let img = await page.capturePage();
      if (img.isEmpty()) throw new Error('Снимок слайда пустой');
      const size = img.getSize();
      if (size.width !== width || size.height !== height) img = img.resize({ width, height, quality: 'best' });
      out.push(img.toPNG());
    }
    return out;
  } finally {
    win.destroy();
  }
}
