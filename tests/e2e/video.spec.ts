// «Экспорт → Видео»: показ с ?render=video идёт по своим часам — кадр k ровно в момент k / fps, анимации стоят там,
// где должны, смена слайдов — в один и тот же кадр при каждой записи; раздел «Экспорт» — карточка «Видео» с настройками
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DECKS, deckFile, watchErrors } from './helpers';

const NAME = 'zz-video';
const DIR = path.join(DECKS, NAME);

/** WAV на sec секунд: тихий тон (8 кГц, моно) */
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

test.beforeAll(() => {
  fs.mkdirSync(path.join(DIR, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DIR, 'assets', 'tone.wav'), wav(8));
  // Первый слайд: надпись проявляется ровно за секунду (линейно) — автопоказ ждёт её и стоит ещё секунду
  fs.writeFileSync(deckFile(NAME), `title: Видео
css: |
  @keyframes zz-fade { from { opacity: 0; } to { opacity: 1; } }
music: {src: ./assets/tone.wav, fadeOut: 0.5}
autoplay: {after: 1}
progress: false
slides:
  - template: canvas
    free:
      - {type: text, id: fade, text: "Первый", style: "animation: zz-fade 1s linear both", place: {x: 80, y: 80, w: 600}}
  - template: canvas
    free:
      - {type: text, text: "Второй", place: {x: 80, y: 80, w: 600}}
  - template: canvas
    free:
      - {type: text, text: "Третий", place: {x: 80, y: 80, w: 600}}
`);
});
test.afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

interface Frame { t: number; slide: number; done: boolean; music: { pos: number | null; vol: number } }

/** Запись в браузере: страница показа по своим часам, кадры 0…, пока ролик не кончится */
async function record(page: Page, fps: number): Promise<{ frames: Frame[]; fade: number[] }> {
  await page.goto(`/?deck=${NAME}&render=video`);
  await page.waitForFunction(() => (window as unknown as { slideriaRender?: { ready: boolean } }).slideriaRender?.ready);
  const start = await page.evaluate(() => (window as unknown as { slideriaRender: { start(): Promise<{ estimate: number; musicUrl: string | null }> } }).slideriaRender.start());
  expect(start.musicUrl).toContain('tone.wav');
  const frames: Frame[] = [];
  const fade: number[] = [];
  for (let k = 0; k < 400; k++) {
    const f = await page.evaluate(([k, fps]) => (window as unknown as { slideriaRender: { frame(k: number, fps: number): Promise<Frame> } }).slideriaRender.frame(k, fps), [k, fps]);
    if (f.done) break;
    frames.push(f);
    // Надпись с проявлением (style — у самого текста) — пока она на экране
    fade.push(await page.evaluate(() => {
      const el = document.querySelector('.slide.on [style*="zz-fade"]');
      return el ? Number(getComputedStyle(el).opacity) : NaN;
    }));
  }
  return { frames, fade };
}

test('покадровая запись: время кадра — свои часы, анимации на месте, смена слайда в один и тот же кадр', async ({ page }) => {
  const errors = watchErrors(page);
  const { frames, fade } = await record(page, 30);
  // Кадр k — ровно k / 30 с
  expect(frames[15].t).toBeCloseTo(500, 6);
  // Надпись проявляется линейно за секунду: на 0,5 с — наполовину, к 1 с — целиком
  expect(fade[0]).toBeLessThan(0.05);
  expect(fade[15]).toBeCloseTo(0.5, 1);
  expect(fade[29]).toBeGreaterThan(0.9);
  // Автопоказ дождался проявления (1 с) и простоял ещё секунду: второй слайд — с кадра 2 с
  const second = frames.findIndex((f) => f.slide === 2);
  expect(frames[second].t).toBeGreaterThanOrEqual(2000);
  expect(frames[second].t).toBeLessThan(2100);
  // Музыка с начала: на кадре 1 с трек на 1-й секунде; ролик кончается после третьего слайда и затухания
  expect(frames[30].music.pos).toBeCloseTo(1, 2);
  expect(frames.at(-1)!.slide).toBe(3);
  // Вторая запись — те же кадры смены
  const again = await record(page, 30);
  expect(again.frames.findIndex((f) => f.slide === 2)).toBe(second);
  expect(again.frames.length).toBe(frames.length);
  expect(errors).toEqual([]);
});

test('«Файл → Экспорт → Видео»: размер, кадры, время слайдов, музыка, оценка размера; в браузере кнопка выключена', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/?deck=${NAME}&studio`);
  await page.locator('#st-file').click();
  await page.locator('[data-fs="export"]').click();
  await page.locator('[data-x="video"]').click();
  const side = page.locator('.fp-side');
  await expect(side.locator('h3')).toHaveText('Видео');
  await expect(side.locator('[data-vs]')).toHaveText(['720p', '1080p', '2K', '4K']);
  await side.locator('[data-vs="1440"]').click();
  await expect(side).toContainText('2560 × 1440');
  await side.locator('[data-vr="30"]').click();
  await expect(side).toContainText('30 — файл меньше');
  await expect(side).toContainText('По времени слайдов: 3 слайда, около 0:04');
  // Сколько займёт: 2K, 30 кадров — 16,6 Мбит/с видео и звук на 3,5 с
  const size = side.locator('.fp-vsize');
  await expect(size).toContainText('Оценка');
  await expect(size).toContainText('до 7,1 МБ');
  await expect(size.locator('span').last()).toHaveAttribute('title', /Поток видео 16,6 Мбит\/с/);
  await side.locator('[data-vt="5"]').click();
  await expect(side).toContainText('По 5 с на слайд: 3 слайда, около 0:16');
  await expect(size).toContainText('до 32 МБ');
  await expect(side).toContainText('tone.wav, с затуханием в конце');
  // Без музыки — без звука
  await side.locator('[data-vmusic]').uncheck();
  await expect(size).toContainText('до 31 МБ');
  await side.locator('[data-vmusic]').check();
  await expect(size).toContainText('до 32 МБ');
  await expect(side.locator('.fp-file')).toContainText(`${NAME}.mp4`);
  // Видео записывает программа: в браузере кнопка выключена
  await expect(side.locator('[data-a="export"]')).toBeDisabled();
  // Выбор запоминается
  await page.reload();
  await page.locator('#st-file').click();
  await page.locator('[data-fs="export"]').click();
  await expect(page.locator('.fp-side [data-vs="1440"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.fp-side [data-vt="5"]')).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});
