// Голосовой ввод в чате «Агент» (src/studio/agent-voice.ts, server/voice.ts): модели нет — карточка «Скачать»,
// загрузка с ходом, «Начать запись», полоса записи с таймером, Enter — текст в поле (не отправляется), Esc — без
// текста, закрыли панель — микрофон выключается; «Файл → Параметры» → «Удалить модель». Микрофон — поддельный
// (Chromium), модель — образец
// tests/fixtures/voice-model.tar.bz2 с подставного сервера (порт 5193), распознавание — подставной текст
// (SLIDERIA_VOICE_STUB): адреса и текст — у сервера тестов в playwright.config.ts
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';
import { startMockClaude, type MockClaude } from '../mock-claude';

test.use({
  colorScheme: 'light',
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

const ARCHIVE = fs.readFileSync(path.resolve('tests/fixtures/voice-model.tar.bz2'));
let mock: MockClaude;
let srv: http.Server;
test.beforeAll(async () => {
  mock = await startMockClaude(5191);
  // Сервер модели отдаёт архив медленно: виден ход загрузки
  srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': ARCHIVE.length });
    let off = 0;
    const tick = setInterval(() => {
      res.write(ARCHIVE.subarray(off, off + 8000));
      off += 8000;
      if (off >= ARCHIVE.length) { clearInterval(tick); res.end(); }
    }, 120);
    req.on('close', () => clearInterval(tick));
  });
  await new Promise<void>((ok) => srv.listen(5193, '127.0.0.1', ok));
  // Модели у сервера тестов ещё нет
  fs.rmSync(path.resolve('.tmp/test-voice'), { recursive: true, force: true });
});
test.afterAll(async () => {
  await mock.close();
  srv.closeAllConnections();
  await new Promise((ok) => srv.close(ok));
});

test('«Диктовать»: модель — скачать, запись с таймером, текст — в поле и не отправляется; Esc — без текста', async ({ page }) => {
  const errors = watchErrors(page);
  expect((await fetch('http://localhost:5190/__htmlpptx/chat-connect', { method: 'POST', body: JSON.stringify({ key: 'sk-ant-test-12345678' }) })).status).toBe(200);
  await page.goto('/?deck=chat&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Заголовок до агента');
  await page.keyboard.press('Control+j');
  const chat = page.locator('#st-chat');
  const ta = chat.locator('.ac-ta');
  const mic = chat.locator('.ac-mic');
  await expect(ta).toBeEnabled();
  await expect(mic).toHaveAttribute('title', 'Диктовать');
  await ta.fill('Сделай слайд:');

  // Модели нет — карточка над полем: сколько весит, что речь не уходит с компьютера, «Скачать» и «Указать файл…»
  await mic.click();
  const card = chat.locator('.ac-vcard');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Для распознавания речи нужна модель');
  await expect(card).toContainText('никуда не отправляется');
  await expect(card.locator('[data-v="file"]')).toHaveText('Указать файл…');
  await card.locator('[data-v="get"]').click();
  await expect(card).toContainText('Загрузка модели распознавания речи');
  await expect(card.locator('.vbar')).toBeVisible();
  // Готово — «Начать запись»
  await expect(card).toContainText('Модель распознавания установлена', { timeout: 20_000 });
  await card.locator('[data-v="start"]').click();
  await expect(card).toBeHidden();

  // Запись: полоса с таймером, микрофон — красный, «Отправить» недоступна, поле — только для чтения
  const strip = chat.locator('.ac-rec');
  await expect(strip.locator('.vt')).toBeVisible();
  await expect(strip).toContainText('Не уходит с компьютера');
  await expect(mic).toHaveClass(/\bon\b/);
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await expect(chat.locator('.ac-send')).toBeDisabled();
  await expect(ta).toHaveJSProperty('readOnly', true);
  await expect(strip.locator('.vt')).toHaveText('0:01', { timeout: 5000 });
  // Enter — «Готово»: текст на место курсора, через пробел; сообщение не уходит
  await ta.press('Enter');
  await expect(strip).toBeHidden();
  await expect(ta).toHaveValue('Сделай слайд: Добавь слайд с итогами');
  await expect(ta).toHaveJSProperty('readOnly', false);
  await expect(chat.locator('.ac-send')).toBeEnabled();
  await expect(chat.locator('.ac-u')).toHaveCount(0);
  expect(mock.requests).toHaveLength(0);

  // Модель уже есть — микрофон сразу пишет; Esc — без текста
  await mic.click();
  await expect(strip.locator('.vt')).toBeVisible();
  await expect(chat.locator('.ac-vcard')).toBeHidden();
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await expect(strip).toBeHidden();
  await expect(ta).toHaveValue('Сделай слайд: Добавь слайд с итогами');

  // Закрыли панель посреди записи — запись останавливается, текста нет
  await mic.click();
  await expect(strip.locator('.vt')).toBeVisible();
  await chat.locator('[data-a="close"]').click();
  await expect(chat).toBeHidden();
  await page.keyboard.press('Control+j');
  await expect(strip).toBeHidden();
  await expect(mic).not.toHaveClass(/\bon\b/);
  await expect(ta).toHaveValue('Сделай слайд: Добавь слайд с итогами');
  expect(errors).toEqual([]);
});

test('«Файл → Параметры» → «Удалить модель»: подтверждение в строке, модель — с диска, микрофон снова предлагает скачать', async ({ page }) => {
  const errors = watchErrors(page);
  const api = (cmd: string) => fetch(`http://localhost:5190/__htmlpptx/${cmd}`, { method: 'POST' }).then((r) => r.json() as Promise<{ state: string }>);
  // Модель — как после первого теста; запущен отдельно — поставить
  if ((await api('voice-status')).state !== 'ready') {
    await api('voice-install');
    await expect.poll(async () => (await api('voice-status')).state, { timeout: 20_000 }).toBe('ready');
  }
  expect((await fetch('http://localhost:5190/__htmlpptx/chat-connect', { method: 'POST', body: JSON.stringify({ key: 'sk-ant-test-12345678' }) })).status).toBe(200);
  await page.goto('/?deck=chat&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Заголовок до агента');
  await page.locator('#st-file').click();
  await page.locator('.fp [data-fs="prefs"]').click();
  const row = page.locator('.fp-voice');
  await expect(row).toContainText('Модель распознавания речи');
  await expect(row).toContainText('на диске');
  // «Отмена» — ничего не удаляется
  await row.locator('[data-voice="ask"]').click();
  await expect(row).toContainText('Удалить модель? Для голосового ввода понадобится скачать модель заново');
  await expect(row.locator('[data-voice="keep"]')).toBeFocused();
  await row.locator('[data-voice="keep"]').click();
  expect((await api('voice-status')).state).toBe('ready');
  // «Удалить»
  await row.locator('[data-voice="ask"]').click();
  await row.locator('[data-voice="remove"]').click();
  await expect(page.locator('#ed-toast')).toContainText('Модель распознавания речи удалена');
  await expect(row).toContainText('Модель распознавания речи не установлена');
  expect((await api('voice-status')).state).toBe('none');
  expect(fs.existsSync(path.resolve('.tmp/test-voice/gigaam-v3'))).toBe(false);
  // Микрофон в чате — снова карточка «Скачать»
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+j');
  await page.locator('#st-chat .ac-mic').click();
  await expect(page.locator('#st-chat .ac-vcard [data-v="get"]')).toBeVisible();
  expect(errors).toEqual([]);
});
