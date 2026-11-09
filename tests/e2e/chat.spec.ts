// Чат «Агент» (src/studio/agent-chat.ts, server/agent.ts) на подставном Claude (tests/mock-claude.ts, порт 5191 —
// его адрес у сервера тестов в playwright.config.ts): ключ, ответ с шагами и правками, Ctrl+Z — весь ответ,
// «Вернуть», «Стоп», картинки, прошлые разговоры, панель на месте «Свойств»
import { expect, test, type Page } from '@playwright/test';
import { readDeck, watchErrors } from './helpers';
import { startMockClaude, type MockClaude } from '../mock-claude';

test.use({ colorScheme: 'light' });
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let mock: MockClaude;
test.beforeAll(async () => { mock = await startMockClaude(5191); });
test.afterAll(async () => { await mock.close(); });

const set = (object: number, text: string, slide = 1) => ({ name: 'edit_presentation', input: { ops: [{ op: 'object.set', slide, object, set: { text } }] } });
const slide = (page: Page) => page.locator('#st-canvas .slide.on');

/** Ключ у сервера тестов: подключён (sk-ant-test… подставной Claude принимает) или нет */
async function key(on: boolean): Promise<void> {
  const r = await fetch(`http://localhost:5190/__htmlpptx/${on ? 'chat-connect' : 'chat-disconnect'}`, { method: 'POST', body: on ? JSON.stringify({ key: 'sk-ant-test-12345678' }) : undefined });
  expect(r.status).toBe(200);
}

async function open(page: Page, connected = true): Promise<void> {
  await key(connected);
  await page.goto('/?deck=chat&studio#1');
  await expect(slide(page)).toContainText('Заголовок до агента');
}

test('подключение: панель на месте «Свойств», неверный ключ — понятный отказ, примеры — в поле', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, false);
  await expect(page.locator('#st-props')).toBeVisible();
  await page.keyboard.press('Control+j');
  const chat = page.locator('#st-chat');
  await expect(chat).toBeVisible();
  await expect(page.locator('#st-props')).toBeHidden();
  await expect(page.locator('.st-foot [data-cmd="agent.toggle"]')).toHaveClass(/active/);
  await expect(chat.locator('.ac-ta')).toBeDisabled();
  await expect(chat.locator('.ac-key')).toContainText('Подключите Claude');
  await chat.locator('#ac-key-in').fill('sk-ant-wrong-12345678');
  await chat.locator('.ac-key button[type=submit]').click();
  await expect(chat.locator('.ac-kerr')).toContainText('Ключ не подошёл');
  await chat.locator('#ac-key-in').fill('sk-ant-test-12345678');
  await chat.locator('.ac-key button[type=submit]').click();
  await expect(chat.locator('.ac-ta')).toBeEnabled();
  await chat.locator('[data-sug="Сократи текст на этом слайде вдвое"]').click();
  await expect(chat.locator('.ac-ta')).toHaveValue('Сократи текст на этом слайде вдвое');
  await expect(chat.locator('.ac-ctx')).toContainText('Слайд 1');
  // «Свойства» (Ctrl+Shift+2) — на место чата; Ctrl+J — снова чат
  await page.keyboard.press('Control+Shift+Digit2');
  await expect(page.locator('#st-props')).toBeVisible();
  await expect(chat).toBeHidden();
  await page.locator('.st-top [data-cmd="agent.toggle"]').click();
  await expect(chat).toBeVisible();
  await chat.locator('[data-a="close"]').click();
  await expect(chat).toBeHidden();
  // Неверный ключ — ответ 400 (и строка о нём в консоли браузера): так и задумано
  expect(errors.filter((e) => !/chat-connect|status of 400/.test(e))).toEqual([]);
});

test('ответ с правками: шаги и текст, карточка, Ctrl+Z — весь ответ одним шагом, «Вернуть» — только его', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.keyboard.press('Control+j');
  const chat = page.locator('#st-chat');
  await chat.locator('[data-a="new"]').click();
  mock.requests.length = 0;
  mock.queue(
    { think: true, tool: { name: 'read_presentation', input: { slide: 1 } } },
    { tool: set(1, 'Заголовок агента') },
    { tool: set(2, 'Число 48') },
    { text: 'Поменял заголовок и число: **42 → 48**.', delay: 20 },
  );
  await chat.locator('.ac-ta').fill('Обнови слайд');
  await chat.locator('.ac-ta').press('Enter');
  await expect(chat.locator('.ac-u .ac-bub')).toHaveText('Обнови слайд');
  // Слайд меняется по ходу ответа; в конце — свёрнутые шаги, текст, карточка правок
  await expect(slide(page)).toContainText('Заголовок агента');
  await expect(slide(page)).toContainText('Число 48');
  await expect(chat.locator('.ac-a.live')).toHaveCount(0);
  await expect(chat.locator('.ac-sum')).toContainText('3 шага');
  await expect(chat.locator('.ac-txt b')).toHaveText('42 → 48');
  const card = chat.locator('.ac-card');
  await expect(card).toContainText('Слайд 1 · 2 правки');
  // Агенту ушёл открытый слайд с данными
  expect(JSON.stringify(mock.requests[0].messages[0].content)).toContain('Заголовок до агента');
  await expect.poll(() => readDeck('chat')).toContain('Число 48');

  // Ctrl+Z — весь ответ одним шагом; Ctrl+Y — обратно
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(slide(page)).toContainText('Заголовок до агента');
  await expect(slide(page)).toContainText('Число 42');
  await page.keyboard.press('Control+y');
  await expect(slide(page)).toContainText('Число 48');

  // Своя правка после агента остаётся, «Вернуть» откатывает только ответ агента
  await page.goto('/?deck=chat&studio#2');
  await expect(slide(page)).toContainText('Второй слайд');
  await page.locator('#st-notes-text').fill('Моя заметка');
  await page.locator('#st-notes-text').blur();
  await expect.poll(() => readDeck('chat')).toContain('Моя заметка');
  await expect(chat.locator('.ac-card')).toBeVisible();
  await chat.locator('[data-a="show"]').click();
  await expect(slide(page)).toContainText('Число 48');
  await chat.locator('[data-a="revert"]').click();
  await expect(slide(page)).toContainText('Заголовок до агента');
  await expect(chat.locator('.ac-card')).toContainText('Возвращено');
  await expect.poll(() => readDeck('chat')).toContain('Число 42');
  expect(readDeck('chat')).toContain('Моя заметка');
  expect(errors).toEqual([]);
});

test('«Стоп» (Esc), ключ отозвали — «Подключить заново», картинка из Ctrl+V, прошлые разговоры', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.keyboard.press('Control+j');
  const chat = page.locator('#st-chat');
  await chat.locator('[data-a="new"]').click();
  // «Стоп»: ответ пишется медленно — Esc в поле
  mock.queue({ text: 'Очень длинный ответ, который пишется медленно и долго, слово за словом, без конца.', delay: 120 });
  await chat.locator('.ac-ta').fill('Расскажи длинно');
  await chat.locator('.ac-ta').press('Enter');
  await expect(chat.locator('.ac-send.stop')).toBeVisible();
  await expect(chat.locator('.ac-a.live .ac-txt')).toContainText('Очень');
  await chat.locator('.ac-ta').press('Escape');
  await expect(chat.locator('.ac-stopped')).toHaveText('Остановлено');
  await expect(chat.locator('.ac-send.stop')).toHaveCount(0);

  // Картинка из буфера обмена — плашкой над полем, уходит агенту картинкой
  await chat.locator('.ac-ta').focus();
  await page.evaluate((png) => {
    const bin = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], 'скрин.png', { type: 'image/png' }));
    document.querySelector('.ac-ta')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG);
  await expect(chat.locator('.ac-chip')).toContainText('скрин.png');
  mock.requests.length = 0;
  mock.queue({ error: { status: 401, type: 'authentication_error', message: 'invalid x-api-key' } });
  await chat.locator('.ac-ta').fill('Что на картинке?');
  await chat.locator('.ac-ta').press('Enter');
  await expect(chat.locator('.ac-att figcaption')).toContainText('скрин.png');
  await expect(chat.locator('.ac-err')).toContainText('Ключ Claude больше не подходит');
  expect(JSON.stringify(mock.requests[0].messages.at(-1))).toContain(PNG);
  await expect(chat.locator('[data-a="rekey"]')).toBeVisible();

  // Перезагрузка — разговор на месте (и картинка); «Прошлые разговоры» — список, новый — пусто
  await page.reload();
  await expect(slide(page)).toBeVisible();
  await expect(chat.locator('.ac-bub').last()).toHaveText('Что на картинке?');
  await expect.poll(() => chat.locator('.ac-att img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
  await chat.locator('[data-a="history"]').click();
  await expect(chat.locator('.ac-hi')).not.toHaveCount(0);
  await expect(chat.locator('.ac-hi.on')).toContainText('Расскажи длинно');
  const n = await chat.locator('.ac-hi').count();
  await chat.locator('.ac-hi.on [data-del]').click();
  await chat.locator('.ac-hi.on [data-del]').click();
  await expect(chat.locator('.ac-hi')).toHaveCount(n - 1);
  await chat.locator('[data-a="new"]').click();
  await expect(chat.locator('.ac-empty h3')).toHaveText('Что поменять в презентации?');
  expect(errors.filter((e) => !/401|chat-image/.test(e))).toEqual([]);
});
