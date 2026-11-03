// «Инструменты → Интеграции»: плашка «кто на связи», правка агента с подсказкой и «Вернуть» (только его правка),
// что можно агентам, скрипты из панели (одним шагом отмены), песочница без сети, скрипты в Ctrl+K, журнал
import { expect, test, type Page } from '@playwright/test';
import { readDeck, watchErrors } from './helpers';

test.use({ colorScheme: 'light' });

const post = async (cmd: string, body?: unknown) => {
  const r = await fetch(`http://localhost:5190/__htmlpptx/${cmd}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};
const AGENT = { kind: 'agent', id: 'e2e-agent', name: 'Claude Code' };

async function openTools(page: Page): Promise<void> {
  await page.goto('/?deck=integ&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Текст для агента');
  await page.locator('[data-tab="tools"]').click();
}

test('агент на связи и его правка: плашка на ленте, подсказка на холсте, «Вернуть» — только его правка', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  await openTools(page);
  const mini = page.locator('#st-int-mini');
  await expect(mini).toContainText('Агентов пока нет');
  await post('agent', { id: AGENT.id, name: AGENT.name, version: '2.1' });
  await expect(mini).toContainText('Claude Code на связи');

  // Своя правка в студии — фигуру на 10 px вправо
  await page.locator('#st-canvas .slide.on .free').nth(1).click();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => readDeck('integ')).toContain('x: 650');

  const r = await post('apply?deck=integ&from=mcp', { ops: [{ op: 'object.set', slide: 1, object: 1, set: { text: 'Правка агента' } }], by: AGENT });
  expect(r.status).toBe(200);
  const toast = page.locator('#st-int-toast.on');
  await expect(toast).toContainText('Claude Code:');
  await expect(toast).toContainText('Правка объекта · слайд 1');
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Правка агента');
  await expect(mini).toContainText('1 правка');
  await expect(page.locator('.st-ribbon [data-cmd="int.log"] .st-int-cnt')).toHaveText('1');

  // «Вернуть»: текст агента уходит, свой сдвиг фигуры остаётся
  await toast.getByRole('button', { name: 'Вернуть' }).click();
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Текст для агента');
  await expect.poll(() => readDeck('integ')).toContain('Текст для агента');
  expect(readDeck('integ')).toContain('x: 650');
  expect(errors).toEqual([]);
});

test('панель: что можно агентам, журнал с «было → стало», скрипт одним шагом отмены, без сети', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await openTools(page);
  await page.locator('.st-ribbon [data-cmd="int.agents"]').first().click();
  const panel = page.locator('.si');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.si-h h3')).toHaveText('Агенты');
  // Строка подключения — с путём к MCP этой папки
  await expect(panel.locator('.si-code pre')).toContainText('claude mcp add slideria --');
  await expect(panel.locator('.si-code pre')).toContainText('scripts/mcp.mjs');
  await panel.locator('[data-client="vscode"]').click();
  await expect(panel.locator('.si-code pre')).toContainText('"servers"');

  // «Смотреть» — правка агента отклоняется; снова «Править»
  await panel.locator('[data-access="view"]').click();
  await expect(panel.locator('[data-access="view"]')).toHaveAttribute('aria-checked', 'true');
  const no = await post('apply?deck=integ', { ops: [{ op: 'slide.set', slide: 1, set: { notes: 'нельзя' } }], by: AGENT });
  expect(no.status).toBe(400);
  expect(no.data.error).toContain('только смотреть');
  await panel.locator('[data-access="edit"]').click();
  await expect(panel.locator('[data-access="edit"]')).toHaveAttribute('aria-checked', 'true');

  // Журнал: правки агента из прошлого теста — было → стало
  await panel.locator('.si-ni[data-sec="log"]').click();
  await expect(panel.locator('.si-entry').first()).toContainText('Claude Code');
  await expect(panel.locator('.si-diff ins').first()).toHaveText('Правка агента');

  // Скрипт с полем: «Один переход для всех слайдов» → Сдвиг
  await panel.locator('.si-ni[data-sec="scripts"]').click();
  const card = panel.locator('[data-script="builtin:переходы.js"]');
  await card.locator('[data-run]').click();
  await card.locator('select').selectOption('push');
  await card.locator('[data-run]').click();
  await expect(card.locator('.si-res')).toContainText('Готово: 1 правка');
  await expect.poll(() => readDeck('integ')).toContain('transition: push');
  await panel.locator('.si-ni[data-sec="log"]').click();
  await expect(panel.locator('.si-entry').first()).toContainText('Один переход для всех слайдов');
  await expect(panel.locator('.si-entry').first().locator('.si-diff ins')).toHaveText('Сдвиг');

  // Скрипт, который лезет в сеть, — понятный отказ, данные не тронуты
  await post('script-save', { file: 'сеть.js', code: "// @name Сеть\nexport default async () => { await fetch('https://example.com'); }\n" });
  await panel.locator('.si-ni[data-sec="scripts"]').click();
  await panel.locator('[data-script="user:сеть.js"] [data-run]').click();
  await expect(panel.locator('[data-script="user:сеть.js"] .si-res.err')).toContainText('Скрипту закрыты сеть');

  // Esc закрывает панель; Ctrl+Z отменяет запуск скрипта целиком
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(() => readDeck('integ')).not.toContain('transition: push');
  expect(errors).toEqual([]);
});

test('скрипты — в меню ленты и в Ctrl+K', async ({ page }) => {
  const errors = watchErrors(page);
  await openTools(page);
  await page.locator('.st-ribbon [data-cmd="int.scripts"]').first().click();
  await expect(page.locator('.st-menu')).toContainText('Оглавление');
  await expect(page.locator('.st-menu')).toContainText('Все скрипты…');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('скрипт оглав');
  await expect(page.locator('#st-pal')).toContainText('Скрипт: Оглавление');
  expect(errors).toEqual([]);
});
