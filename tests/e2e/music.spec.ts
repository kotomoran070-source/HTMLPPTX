// Музыка показа: трек через все слайды, автопоказ по времени трека, «Записать время», лента студии, собранный файл
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { DECKS, deckFile, readDeck, watchErrors } from './helpers';

const NAME = 'zz-music';
const DIR = path.join(DECKS, NAME);

/** WAV на sec секунд: щелчок каждые полсекунды (8 кГц, моно) */
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
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    b.writeInt16LE(t % 0.5 < 0.02 ? Math.round(Math.sin(2 * Math.PI * 440 * t) * 12000) : 0, 44 + i * 2);
  }
  return b;
}

const SLIDES = `slides:
  - title: Первый
    at: 0.2
  - title: Второй
    at: 1.0
  - title: Третий
    at: 1.8
`;

function writeDeck(head: string, slides = SLIDES): void {
  fs.mkdirSync(path.join(DIR, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DIR, 'assets', 'beat.wav'), wav(4));
  fs.writeFileSync(deckFile(NAME), `title: Музыка\n${head}${slides}`);
}

test.afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

/** Браузер не дал звуку начаться без действия — «Включить» в подсказке показа */
async function unlock(page: Page): Promise<void> {
  const go = page.locator('#snote .show-note-go');
  if (await go.isVisible().catch(() => false)) await go.click();
}

const audioTime = (page: Page) => page.evaluate(() => document.querySelector<HTMLAudioElement>('audio.show-music')!.currentTime);
const audioPaused = (page: Page) => page.evaluate(() => document.querySelector<HTMLAudioElement>('audio.show-music')!.paused);

test('автопоказ по музыке: слайды сменяются на записанных секундах трека, в конце музыка стихает', async ({ page }) => {
  const errors = watchErrors(page);
  writeDeck('music:\n  src: ./assets/beat.wav\n  end: 2.6\n  fadeOut: 0.3\nautoplay:\n  music: true\n  start: true\n');
  await page.goto(`/?deck=${NAME}#1`);
  await expect(page.locator('audio.show-music')).toHaveCount(1);
  // Смена слайда — какая секунда трека в этот миг
  await page.evaluate(() => {
    const w = window as unknown as { marks: [string, number][] };
    w.marks = [];
    const ct = document.getElementById('ct')!;
    new MutationObserver(() => w.marks.push([ct.textContent ?? '', document.querySelector<HTMLAudioElement>('audio.show-music')!.currentTime]))
      .observe(ct, { childList: true, characterData: true, subtree: true });
  });
  await unlock(page);
  await expect(page.locator('#ct')).toHaveText('3 из 3', { timeout: 8000 });
  const marks = await page.evaluate(() => (window as unknown as { marks: [string, number][] }).marks);
  const at = (label: string) => marks.find(([l]) => l === label)?.[1] ?? NaN;
  expect(Math.abs(at('2 из 3') - 1.0)).toBeLessThan(0.15);
  expect(Math.abs(at('3 из 3') - 1.8)).toBeLessThan(0.15);
  // После end (2,6 с) автопоказ кончился, музыка затухла и встала
  await expect.poll(() => audioPaused(page), { timeout: 6000 }).toBe(true);
  expect(await audioTime(page)).toBeGreaterThan(2.5);
  expect(errors).toEqual([]);
});

test('пауза A и листание руками: трек стоит вместе со слайдом и перематывается к слайду', async ({ page }) => {
  writeDeck('music:\n  src: ./assets/beat.wav\nautoplay:\n  music: true\n');
  await page.goto(`/?deck=${NAME}#1`);
  await expect(page.locator('#ct')).toHaveText('1 из 3');
  // Без автопоказа «по музыке» трек молчит: часы — автопоказ
  expect(await audioPaused(page)).toBe(true);
  await page.keyboard.press('a');
  await unlock(page);
  await expect(page.locator('#ct')).toHaveText('2 из 3', { timeout: 5000 });
  await page.keyboard.press('a');
  await expect.poll(() => audioPaused(page)).toBe(true);
  // Руками — на третий: трек перемотан к его секунде, следующий переход снова в такт
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#ct')).toHaveText('3 из 3');
  await expect.poll(() => audioTime(page)).toBeCloseTo(1.8, 1);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#ct')).toHaveText('2 из 3');
  await expect.poll(() => audioTime(page)).toBeCloseTo(1.0, 1);
});

test('долгая сборка слайда при переходе автопоказа: трек не прыгает назад к отметке слайда', async ({ page }) => {
  writeDeck('music:\n  src: ./assets/beat.wav\nautoplay:\n  music: true\n  start: true\n');
  // Каждая перемотка трека: откуда и куда
  await page.addInitScript(() => {
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
    const w = window as unknown as { seeks: [number, number][] };
    w.seeks = [];
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() { return d.get!.call(this); },
      set(v: number) {
        w.seeks.push([d.get!.call(this), v]);
        d.set!.call(this, v);
      },
    });
  });
  await page.goto(`/?deck=${NAME}#1`);
  await expect(page.locator('audio.show-music')).toHaveCount(1);
  // Второй слайд собирается полсекунды (картинки, сборка мусора) — счётчик слайдов пишется посреди перехода
  await page.evaluate(() => {
    const ct = document.getElementById('ct')!;
    const d = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!;
    Object.defineProperty(ct, 'textContent', {
      get() { return d.get!.call(this); },
      set(v: string) {
        if (v.startsWith('2 ')) for (const t = performance.now(); performance.now() - t < 500;) { /* занято */ }
        d.set!.call(this, v);
      },
    });
  });
  await unlock(page);
  await expect(page.locator('#ct')).toHaveText('3 из 3', { timeout: 8000 });
  const seeks = await page.evaluate(() => (window as unknown as { seeks: [number, number][] }).seeks);
  expect(seeks.filter(([from, to]) => to < from - 0.05)).toEqual([]);
});

test('музыка фоном (без «Листать по музыке»): играет с начала трека, слайды — руками', async ({ page }) => {
  writeDeck('music:\n  src: ./assets/beat.wav\n  start: 0.5\n  volume: 0.4\n');
  await page.goto(`/?deck=${NAME}#1`);
  await unlock(page);
  await expect.poll(() => audioPaused(page)).toBe(false);
  expect(await audioTime(page)).toBeGreaterThanOrEqual(0.5);
  expect(await page.evaluate(() => document.querySelector<HTMLAudioElement>('audio.show-music')!.volume)).toBeCloseTo(0.4, 2);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#ct')).toHaveText('2 из 3');
  // Листание руками трек не трогает
  expect(await audioPaused(page)).toBe(false);
});

test('«Записать время»: удары пробелом — секунды трека у слайдов и шагов, конец показа, «Листать по музыке»', async ({ page }) => {
  // У второго слайда — шаг по щелчку
  writeDeck('music:\n  src: ./assets/beat.wav\n', `slides:
  - title: Первый
  - title: Второй
    free:
      - {type: card, title: Шаг, click: true, place: {x: 64, y: 200, w: 340}}
  - title: Третий
`);
  await page.goto(`/?deck=${NAME}&rehearse#1`);
  const rh = page.locator('.rh');
  await expect(rh).toBeVisible();
  // Адрес — уже без rehearse: перезагрузка открывает обычный показ
  expect(page.url()).not.toContain('rehearse');
  await rh.locator('#rh-snap').uncheck();
  await expect(page.locator('#rh-w')).toHaveText('Слайд 1 из 3');
  await page.keyboard.press('Space');
  await expect.poll(() => audioPaused(page)).toBe(false);
  const beat = async (label: string) => {
    await page.waitForTimeout(350);
    await page.keyboard.press('Space');
    await expect(page.locator('#rh-w')).toHaveText(label);
  };
  await beat('Слайд 2 из 3 · шаг 0 из 1');
  await beat('Слайд 2 из 3 · шаг 1 из 1');
  await beat('Слайд 3 из 3');
  // Backspace — назад на шаг, удар записывается заново
  await page.keyboard.press('Backspace');
  await expect(page.locator('#rh-w')).toHaveText('Слайд 2 из 3 · шаг 1 из 1');
  await beat('Слайд 3 из 3');
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await expect(page.locator('#rh-h')).toContainText('Конец показа записан');
  await rh.locator('#rh-ok').click();
  await expect(rh).toHaveCount(0);
  await expect.poll(() => readDeck(NAME)).toContain('music: true');
  const y = readDeck(NAME);
  const nums = (re: RegExp) => [...y.matchAll(re)].map((m) => Number(m[1]));
  const ats = nums(/^\s+at: ([\d.]+)$/gm);
  expect(ats).toHaveLength(3);
  expect(ats[0]).toBe(0);
  expect(ats[1]).toBeGreaterThan(ats[0]);
  expect(ats[2]).toBeGreaterThan(ats[1]);
  const step = nums(/steps:\s*\n\s+- ([\d.]+)/g)[0] ?? Number(/steps: \[([\d.]+)\]/.exec(y)?.[1]);
  expect(step).toBeGreaterThan(ats[1]);
  expect(step).toBeLessThan(ats[2]);
  const end = Number(/^\s+end: ([\d.]+)$/m.exec(y)?.[1]);
  expect(end).toBeGreaterThan(ats[2]);
  expect(y).toContain('src: ./assets/beat.wav');
});

test('притягивание к доле: нажатия встают на сетку темпа', async ({ page }) => {
  await page.goto('/?deck=tpl#1');
  const r = await page.evaluate(async () => {
    const { snapToBeat } = await import('/src/engine/music.ts');
    // 120 уд/мин — доля 0,5 с, удары чуть мимо сетки со сдвигом 0,1
    return snapToBeat([0.62, 1.08, 1.63, 2.57], 120);
  }).catch(() => null);
  test.skip(r === null, 'модули исходников — только yarn dev');
  expect(r).toEqual([0.6, 1.1, 1.6, 2.6]);
});

test('студия: «Показ → Музыка» — файл, начало трека, громкость, «Листать по музыке», «Записать время»', async ({ page }) => {
  writeDeck('');
  await page.goto(`/?deck=${NAME}&studio`);
  await page.locator('[data-tab="show"]').first().click();
  const rec = page.locator('[data-cmd="show.music.record"]:visible');
  await expect(rec).toBeDisabled();
  await expect(page.locator('#st-mus-start')).toBeDisabled();
  // Файл — из меню «Музыка»
  await page.locator('[data-cmd="show.music"]:visible').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.st-menu').getByText('Выбрать файл…').click();
  await (await chooser).setFiles({ name: 'beat.wav', mimeType: 'audio/wav', buffer: wav(4) });
  await expect.poll(() => readDeck(NAME)).toContain('src: ./assets/beat.wav');
  await expect(rec).toBeEnabled();
  // Начало трека — «0:00.5», затухание — 1,5 с
  await page.locator('#st-mus-start').fill('0:00.5');
  await page.locator('#st-mus-start').press('Enter');
  await expect.poll(() => readDeck(NAME)).toMatch(/start: 0\.5/);
  await expect(page.locator('#st-mus-start')).toHaveValue('0:00.5');
  await page.locator('#st-mus-fade').fill('1.5');
  await page.locator('#st-mus-fade').press('Enter');
  await expect.poll(() => readDeck(NAME)).toMatch(/fadeOut: 1\.5/);
  await page.locator('#st-mus-vol').fill('60');
  await expect.poll(() => readDeck(NAME)).toMatch(/volume: 0\.6/);
  // «Листать по музыке» — флажок
  const drive = page.locator('[data-cmd="show.music.drive"]:visible');
  await drive.click();
  await expect(drive).toHaveClass(/active/);
  await expect.poll(() => readDeck(NAME)).toMatch(/autoplay:\s*\n\s+music: true/);
  // «Записать время» — показ с окном записи
  const popup = page.waitForEvent('popup');
  await rec.click();
  const show = await popup;
  await expect(show.locator('.rh')).toBeVisible();
  await show.close();
  // «Убрать музыку» — и «Листать по музыке» уходит вместе с ней
  await page.locator('[data-cmd="show.music"]:visible').click();
  await page.locator('.st-menu').getByText('Убрать музыку').click();
  await expect.poll(() => readDeck(NAME)).not.toContain('music:');
});

test('собранный файл: музыка внутри, автопоказ по ней работает без сервера', async ({ page }) => {
  writeDeck('music:\n  src: ./assets/beat.wav\nautoplay:\n  music: true\n  start: true\n');
  const r = await fetch(`http://localhost:5190/__htmlpptx/export?deck=${NAME}&mode=clean`, { method: 'POST' });
  const html = await r.text();
  expect(r.ok).toBe(true);
  expect(html).toContain('data:audio/wav;base64,');
  const out = path.resolve('.tmp', 'test-export');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `${NAME}.html`);
  fs.writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  await unlock(page);
  await expect(page.locator('#ct')).toHaveText('2 из 3', { timeout: 6000 });
});
