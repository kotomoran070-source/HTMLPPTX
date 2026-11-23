// «Экспорт → Видео» (src/studio/video-export.ts): невидимое окно открывает показ с ?render=video, и кадры идут
// по одному — время страницы стоит, пока программа не попросит следующий кадр (src/engine/render-clock.ts).
// Студия просит кадр, получает его пикселями (BGRA), сама кодирует (WebCodecs, H.264) и присылает куски MP4 —
// они пишутся в файл «…mp4.part», который становится видео, только когда запись закончилась.
// Окно — размером с кадр. Если система урезала его до размера экрана (2K и 4K на ноутбуке с экраном 1366 × 768),
// размер задаёт сама страница (Emulation.setDeviceMetricsOverride) — снимок окна тогда тоже нужного размера.
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';

const SIZES = new Set(['1280x720', '1920x1080', '2560x1440', '3840x2160']);
/** Ждать, пока страница показа соберётся (шрифты, первый слайд, модели) */
const READY_MS = 60_000;

/** Имя файла без запрещённых в Windows знаков */
const fileName = (s) => String(s || 'Видео').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Видео';

/**
 * @param {{ ours: (url: string) => boolean; origin: () => string; decks: string; log: (...a: unknown[]) => void; parent: () => BrowserWindow | undefined }} o
 */
export function setupVideo({ ours, origin, decks, log, parent }) {
  /** Куда сохранять — выбрано в диалоге (страница путь не задаёт) */
  const picked = new WeakMap();
  /** Одна запись за раз: окно-кадр, файл, кто её ведёт */
  let job = null;

  const stop = (ok) => {
    if (!job) return null;
    const j = job;
    job = null;
    try { j.win.destroy(); } catch { /* окно уже закрыто */ }
    try { fs.closeSync(j.fd); } catch { /* уже закрыт */ }
    if (ok) {
      fs.renameSync(j.part, j.file);
      log('Видео:', j.file, `${Math.round(fs.statSync(j.file).size / 1024)} КБ`);
      return j.file;
    }
    fs.rmSync(j.part, { force: true });
    return null;
  };
  const mine = (e) => !!job && job.owner === e.sender;

  ipcMain.handle('slideria:video-pick', async (e, name) => {
    if (!ours(e.senderFrame?.url ?? '')) return null;
    const file = `${fileName(name)}.mp4`;
    let out = process.env.SLIDERIA_SAVE_DIR ? path.join(process.env.SLIDERIA_SAVE_DIR, file) : '';
    if (!out) {
      const own = BrowserWindow.fromWebContents(e.sender) ?? parent();
      const r = await dialog.showSaveDialog(own, { title: 'Сохранить видео', defaultPath: path.join(app.getPath('videos') || app.getPath('documents'), file), filters: [{ name: 'Видео MP4', extensions: ['mp4'] }] });
      if (r.canceled || !r.filePath) return null;
      out = r.filePath;
    }
    picked.set(e.sender, out);
    return out;
  });

  ipcMain.handle('slideria:video-open', async (e, o) => {
    if (!ours(e.senderFrame?.url ?? '')) throw new Error('Не та страница');
    const file = picked.get(e.sender);
    if (!file) throw new Error('Файл не выбран');
    const deck = String(o?.deck ?? '');
    if (!deck || deck.startsWith('.') || /[\\/]/.test(deck) || !fs.existsSync(path.join(decks, deck, 'deck.yaml'))) throw new Error('Презентация не найдена');
    const size = `${o?.width}x${o?.height}`;
    if (!SIZES.has(size)) throw new Error('Такого размера нет');
    // Одна запись за раз: свою прежнюю (оборвалась) — бросить, чужую — не трогать
    if (job && job.owner !== e.sender && !job.owner.isDestroyed()) throw new Error('Уже идёт запись другого видео');
    if (job) stop(false);
    const width = Number(o.width);
    const height = Number(o.height);
    const win = new BrowserWindow({
      show: false, width, height, useContentSize: true, frame: false, ...(process.platform === 'darwin' ? { enableLargerThanScreen: true } : {}),
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    const wc = win.webContents;
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (ev) => ev.preventDefault());
    const part = `${file}.part`;
    job = { win, owner: e.sender, file, part, fd: fs.openSync(part, 'w'), width, height };
    // Студию закрыли или ушли с неё посреди записи — запись бросается, недописанный файл удаляется
    const drop = () => { if (job?.win === win) stop(false); };
    e.sender.once('destroyed', drop);
    e.sender.once('did-navigate', drop);
    e.sender.once('render-process-gone', drop);
    try {
      const u = new URL(origin());
      u.searchParams.set('deck', deck);
      u.searchParams.set('render', 'video');
      if (Number(o.each) > 0) u.searchParams.set('each', String(Number(o.each)));
      await win.loadURL(u.toString()).catch(() => {});
      const [iw, ih] = await wc.executeJavaScript('[innerWidth, innerHeight]');
      if (iw !== width || ih !== height) {
        wc.debugger.attach('1.3');
        await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      }
      const until = Date.now() + READY_MS;
      while (!(await wc.executeJavaScript('!!window.slideriaRender?.ready'))) {
        if (Date.now() > until) throw new Error('Показ не открылся за минуту');
        await new Promise((r) => setTimeout(r, 100));
      }
      return await wc.executeJavaScript('window.slideriaRender.start()');
    } catch (err) {
      stop(false);
      throw err;
    }
  });

  ipcMain.handle('slideria:video-frame', async (e, k, fps) => {
    if (!mine(e)) throw new Error('Запись не идёт');
    const { win, width, height } = job;
    const wc = win.webContents;
    const info = await wc.executeJavaScript(`window.slideriaRender.frame(${Number(k)}, ${Number(fps)})`);
    let img = await wc.capturePage();
    const s = img.getSize();
    // Экран с масштабом (125 %, 150 %) — кадр крупнее заказанного: приводим к размеру видео
    if (s.width !== width || s.height !== height) img = img.resize({ width, height, quality: 'best' });
    return { ...info, width, height, data: img.toBitmap() };
  });

  ipcMain.handle('slideria:video-write', (e, pos, data) => {
    if (!mine(e)) return false;
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    fs.writeSync(job.fd, buf, 0, buf.length, Number(pos));
    return true;
  });

  // Программу закрыли посреди записи — недописанный файл не остаётся
  app.on('will-quit', () => stop(false));

  ipcMain.handle('slideria:video-close', (e, ok) => {
    if (!mine(e)) return null;
    const file = stop(!!ok);
    if (file && !process.env.SLIDERIA_SAVE_DIR) shell.showItemInFolder(file);
    return file;
  });
}
