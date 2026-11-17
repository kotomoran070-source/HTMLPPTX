// Чат «Агент»: сервисы на выбор (src/studio/agent-chat.ts, server/agent-llm.ts) на подставных сервисах — облачный
// (tests/mock-openai.ts, порт 5194 — адрес у сервера тестов в playwright.config.ts) и «Ollama» без ключа (5198):
// пресеты и особенности, ключ у каждого свой, «Сменить сервис…» без повторного ввода ключа, Ollama — модели по
// адресу, модель без картинок — без скрепки, меню моделей
import { expect, test, type Page } from '@playwright/test';
import { watchErrors } from './helpers';
import { startMockOpenAI, type MockOpenAI } from '../mock-openai';

test.use({ colorScheme: 'light' });
let cloud: MockOpenAI;
let local: MockOpenAI;
test.beforeAll(async () => {
  cloud = await startMockOpenAI({ port: 5194, models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] });
  local = await startMockOpenAI({ port: 5198, open: true, models: [{ id: 'llama3.2:3b' }, { id: 'qwen3:14b' }] });
});
test.afterAll(async () => { await cloud.close(); await local.close(); });

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function open(page: Page): Promise<void> {
  // Все сервисы — отключены
  for (const p of ['claude', 'openai', 'deepseek', 'qwen', 'openrouter', 'ollama', 'custom']) {
    await fetch('http://localhost:5190/__htmlpptx/chat-disconnect', { method: 'POST', body: JSON.stringify({ provider: p }) });
  }
  await page.goto('/?deck=chat&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Заголовок до агента');
  await page.keyboard.press('Control+j');
}

test('пресеты: особенности сервиса, DeepSeek по ключу, Ollama по адресу, «Сменить сервис…» без повторного ключа', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  const chat = page.locator('#st-chat');
  const key = chat.locator('.ac-key');
  await expect(key).toContainText('Подключите модель');
  await expect(chat.locator('.ac-pv')).toHaveText(['Claude', 'ChatGPT', 'DeepSeek', 'Qwen', 'OpenRouter', 'Ollamaбесплатно', 'Другая…']);
  await expect(chat.locator('.ac-pv.on')).toHaveText('Claude');
  await expect(key).toContainText('лучше всех понимает оформление');
  await expect(key).toContainText('уходит в Anthropic');
  // DeepSeek: что умеет, куда уходит, где взять ключ
  await chat.locator('.ac-pv[data-prov="deepseek"]').click();
  await expect(key).toContainText('в разы дешевле');
  await expect(key).toContainText('уходит в DeepSeek');
  await expect(key.locator('a', { hasText: 'Где взять ключ' })).toHaveAttribute('href', 'https://platform.deepseek.com/api_keys');
  await chat.locator('#ac-key-in').fill('wrong-key-1234');
  await key.locator('button[type=submit]').click();
  await expect(chat.locator('.ac-kerr')).toContainText('Ключ DeepSeek не принят');
  await chat.locator('#ac-key-in').fill('sk-test-deepseek');
  await key.locator('button[type=submit]').click();
  await expect(chat.locator('.ac-ta')).toBeEnabled();
  await expect(chat.locator('.ac-model')).toHaveText('deepseek-chat');
  // Ответ модели
  cloud.queue({ text: 'Готово.' });
  await chat.locator('.ac-ta').fill('Привет');
  await chat.locator('.ac-ta').press('Enter');
  await expect(chat.locator('.ac-txt')).toHaveText('Готово.');
  expect(cloud.lastAuth()).toBe('sk-test-deepseek');
  // Меню: модели сервиса, «Сменить сервис…», «Отключить ключ DeepSeek»
  await chat.locator('.ac-model').click();
  await expect(chat.locator('.ac-menu [data-model]')).toHaveCount(2);
  await expect(chat.locator('.ac-menu [data-a="disconnect"]')).toContainText('Отключить ключ DeepSeek');
  await chat.locator('.ac-menu [data-model="deepseek-reasoner"]').click();
  await expect(chat.locator('.ac-model')).toHaveText('deepseek-reasoner');

  // Ollama: модели — что установлено по адресу; ключа нет, содержимое не уходит с компьютера
  await chat.locator('.ac-model').click();
  await chat.locator('.ac-menu [data-a="switch"]').click();
  await chat.locator('.ac-pv[data-prov="ollama"]').click();
  await expect(key).toContainText('не уходит с компьютера');
  await expect(key.locator('#ac-key-in')).toHaveCount(0);
  await chat.locator('#ac-url-in').fill('http://127.0.0.1:9');
  await expect(chat.locator('.ac-probe')).toContainText('Ollama не отвечает по этому адресу');
  await chat.locator('#ac-url-in').fill('http://127.0.0.1:5198');
  await expect(chat.locator('.ac-probe')).toHaveText('Установлено моделей: 2');
  await expect(chat.locator('#ac-model-in')).toHaveValue('qwen3:14b');
  await key.locator('button[type=submit]').click();
  await expect(chat.locator('.ac-model')).toHaveText('qwen3:14b');
  // Обратно на DeepSeek — ключ уже сохранён, вводить не нужно; выбранная модель — та же
  await chat.locator('.ac-model').click();
  await chat.locator('.ac-menu [data-a="switch"]').click();
  await expect(chat.locator('.ac-pv[data-prov="deepseek"] .sv')).toBeAttached();
  await chat.locator('.ac-pv[data-prov="deepseek"]').click();
  await expect(chat.locator('#ac-key-in')).toHaveAttribute('placeholder', 'Ключ сохранён — можно не вводить');
  await key.locator('button[type=submit]').click();
  await expect(chat.locator('.ac-model')).toHaveText('deepseek-reasoner');
  // «Вернуться к разговору» — без смены сервиса
  await chat.locator('.ac-model').click();
  await chat.locator('.ac-menu [data-a="switch"]').click();
  await chat.locator('[data-a="back"]').click();
  await expect(chat.locator('.ac-model')).toHaveText('deepseek-reasoner');
  // Неверный ключ — ответ 400 (и строка о нём в консоли), Ollama по неверному адресу — тоже
  expect(errors.filter((e) => !/chat-connect|chat-probe|status of 400/.test(e))).toEqual([]);
});

test('модель не видит картинки: отказ сервиса — понятным текстом, дальше скрепки у неё нет', async ({ page }) => {
  await open(page);
  const chat = page.locator('#st-chat');
  await chat.locator('.ac-pv[data-prov="deepseek"]').click();
  await chat.locator('#ac-key-in').fill('sk-test-deepseek');
  await chat.locator('.ac-key button[type=submit]').click();
  await expect(chat.locator('[data-a="attach"]')).toBeEnabled();
  cloud.queue({ error: { status: 400, message: 'unknown variant `image_url`, expected `text`' } });
  await chat.locator('.ac-ta').focus();
  await page.evaluate((b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], 'shot.png', { type: 'image/png' }));
    document.querySelector('.ac-ta')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG);
  await expect(chat.locator('.ac-chip')).toHaveCount(1);
  await chat.locator('.ac-ta').fill('Что на картинке?');
  await chat.locator('.ac-ta').press('Enter');
  await expect(chat.locator('.ac-err')).toContainText('не видит картинки');
  await expect(chat.locator('[data-a="attach"]')).toBeDisabled();
  await expect(chat.locator('[data-a="attach"]')).toHaveAttribute('title', /«deepseek-chat» не видит картинки/);
  // В меню — пометка у модели
  await chat.locator('.ac-model').click();
  await expect(chat.locator('.ac-menu [data-model="deepseek-chat"]')).toContainText('не видит картинки');
});
