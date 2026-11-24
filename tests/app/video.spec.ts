// «Файл → Экспорт → Видео» в программе: показ в невидимом окне по своим часам, кадры — в H.264, трек — звуковой
// дорожкой, файл — MP4 (moov, две дорожки), длина — по автопоказу. Папки временные, «Сохранить как» не спрашивается
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const EXE = process.env.SLIDERIA_APP_EXE;
const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];

async function mainWindow(app: ElectronApplication): Promise<Page> {
  let win: Page | undefined;
  await expect.poll(() => (win = app.windows().find((w) => w.url().startsWith('http://127.'))) !== undefined, { timeout: 90_000 }).toBe(true);
  return win!;
}

/** WAV на sec секунд: тон (8 кГц, моно) */
function wav(sec: number, rate = 8000): Buffer {
  const n = Math.round(sec * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 3000), 44 + i * 2);
  return b;
}

/** MP4: длина из mvhd (с), число дорожек и их кодеки (по меткам sample entry) */
function mp4Info(buf: Buffer): { duration: number; tracks: number; codecs: string[] } {
  let duration = 0;
  let tracks = 0;
  const walk = (from: number, to: number) => {
    for (let p = from; p + 8 <= to;) {
      const size = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      if (size < 8) break;
      if (type === 'moov' || type === 'trak' || type === 'mdia') walk(p + 8, p + size);
      if (type === 'trak') tracks++;
      if (type === 'mvhd') duration = buf.readUInt32BE(p + 24) / buf.readUInt32BE(p + 20);
      p += size;
    }
  };
  walk(0, buf.length);
  const codecs = ['avc1', 'mp4a', 'Opus'].filter((c) => buf.includes(Buffer.from(c, 'latin1')));
  return { duration, tracks, codecs };
}

test('«Экспорт → Видео»: MP4 покадрово — H.264 и звук трека, длина по автопоказу', async () => {
  test.setTimeout(300_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-video-test-'));
  const docs = path.join(tmp, 'docs');
  const saves = path.join(tmp, 'saves');
  const deck = path.join(docs, 'zz-video');
  fs.mkdirSync(path.join(deck, 'assets'), { recursive: true });
  fs.mkdirSync(saves, { recursive: true });
  fs.writeFileSync(path.join(deck, 'assets', 'tone.wav'), wav(8));
  fs.writeFileSync(path.join(deck, 'deck.yaml'), `title: Видео
css: |
  @keyframes zz-fade { from { opacity: 0; } to { opacity: 1; } }
music: {src: ./assets/tone.wav, fadeOut: 0.5}
autoplay: {after: 1}
slides:
  - template: canvas
    free:
      - {type: text, text: "Первый", style: "animation: zz-fade 1s linear both", place: {x: 80, y: 80, w: 600}}
  - template: canvas
    free:
      - {type: text, text: "Второй", place: {x: 80, y: 80, w: 600}}
`);
  const app = await electron.launch({
    ...(EXE ? { executablePath: EXE, args: sandbox } : { args: ['.', ...sandbox] }),
    env: { ...process.env, SLIDERIA_DOCS_DIR: docs, SLIDERIA_USER_DATA: path.join(tmp, 'data'), SLIDERIA_SAVE_DIR: saves },
    timeout: 60_000,
  });
  try {
    const win = await mainWindow(app);
    await win.waitForURL(/\/\?all$/, { timeout: 90_000 });
    await win.goto(win.url().replace(/\?all$/, '?deck=zz-video&studio'));
    await win.locator('#st-file').click();
    await win.locator('[data-fs="export"]').click();
    await win.locator('[data-x="video"]').click();
    const side = win.locator('.fp-side');
    await side.locator('[data-vs="720"]').click();
    await side.locator('[data-vr="30"]').click();
    await side.locator('[data-vt="0"]').click();
    // Сколько займёт — оценка сверху
    const est = /до ([\d,]+) МБ/.exec((await side.locator('.fp-vsize span').last().textContent()) ?? '');
    expect(est).not.toBeNull();
    await side.locator('[data-a="export"]').click();
    // Пока пишется — полоса и «Отменить»; готово — файл и сообщение
    await expect(side.locator('.fp-vbar')).toBeVisible();
    await expect(win.getByText('Видео сохранено:')).toBeVisible({ timeout: 240_000 });
    await expect(side.locator('[data-a="export"]')).toBeEnabled();
    const file = path.join(saves, 'zz-video.mp4');
    expect(fs.existsSync(`${file}.part`)).toBe(false);
    // Настоящий файл — не больше оценки
    expect(fs.statSync(file).size).toBeLessThanOrEqual(Number(est![1].replace(',', '.')) * 1048576);
    const info = mp4Info(fs.readFileSync(file));
    // Первый слайд: проявление 1 с и ещё 1 с; второй — 1 с; затухание музыки — 0,5 с
    expect(info.duration).toBeGreaterThan(3.2);
    expect(info.duration).toBeLessThan(4.5);
    expect(info.tracks).toBe(2);
    expect(info.codecs).toContain('avc1');
    expect(info.codecs.some((c) => c === 'mp4a' || c === 'Opus')).toBe(true);
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
