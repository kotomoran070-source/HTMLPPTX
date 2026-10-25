// Звук для живых слайдов и вставок: рамка со своего адреса получает микрофон, а до студии и её команд не дотягивается
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DECKS, deckFile, watchErrors } from './helpers';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test('вставка с микрофоном: свой адрес, звук есть, страница студии и команды проекта недоступны', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=audio#1');
  await expect(page.locator('.slide.on .embed-frame')).toHaveCount(1);
  const frame = page.frameLocator('.slide.on .embed-frame');
  await expect(frame.locator('#mic')).toHaveText('микрофон: 1');
  await expect(frame.locator('#up')).toHaveText('студия: SecurityError');
  await expect(frame.locator('#api')).not.toHaveText('…');
  expect(await page.locator('.slide.on .embed-frame').getAttribute('src')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  // Команда «удалить презентацию» со стороннего адреса сервер отклонил (403), презентация на месте
  await expect.poll(() => errors.some((e) => e.startsWith('http 403:') && e.includes('/__htmlpptx/delete?deck=audio'))).toBe(true);
  expect(fs.existsSync(deckFile('audio'))).toBe(true);
  expect(errors.filter((e) => !/403/.test(e))).toEqual([]);
});

test('«Визуализатор звука» из галереи: вставка со своим адресом сразу слушает микрофон', async ({ page }) => {
  const dir = path.join(DECKS, 'viz');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'deck.yaml'), 'title: Звук\nslides:\n  - template: canvas\n');
  try {
    await page.goto('/?deck=viz&studio#1');
    await page.locator('.st-tabs [data-tab="insert"]').click();
    await page.locator('#st-ribbon [data-cmd="ins.gal.live"]:visible').first().click();
    await page.locator('[title="Вставить: Визуализатор звука"]').click();
    await expect.poll(() => fs.readFileSync(deckFile('viz'), 'utf8')).toContain("const LOOK = 'bars'");
    await expect(page.locator('#st-canvas .slide.on .embed-frame')).toHaveAttribute('src', /^http:\/\/127\.0\.0\.1:\d+\/$/);
    await expect(page.frameLocator('#st-canvas .slide.on .embed-frame').locator('#mic')).toHaveClass('on');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
