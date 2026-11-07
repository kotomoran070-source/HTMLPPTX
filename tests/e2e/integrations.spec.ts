// Интеграции: плашка «кто на связи» на ленте, правка агента с подсказкой и «Вернуть» (только его правка);
// «Файл → Интеграции» — клиенты MCP, что можно агентам, журнал, скрипты (одним шагом отмены), песочница без сети;
// скрипты в меню ленты и в Ctrl+K
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

test('«Файл → Интеграции»: клиенты (и ChatGPT), что можно агентам, журнал, скрипт одним шагом отмены, без сети', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await openTools(page);
  // Плашка «кто на связи» ведёт в «Файл → Интеграции → Агенты»
  await page.locator('#st-int-mini').click();
  const fp = page.locator('.fp');
  await expect(fp).toBeVisible();
  await expect(fp.locator('[data-fs="int"]')).toHaveAttribute('aria-selected', 'true');
  await expect(fp.locator('.ig-tab[data-sub="agents"]')).toHaveAttribute('aria-selected', 'true');
  // Агент из прошлого теста — в «Подключены»; на связи — точка у «Интеграций»
  await expect(fp.locator('.ig-who')).toContainText('Claude Code');
  await expect(fp.locator('[data-fs="int"]')).toHaveClass(/live/);

  // Строка подключения — с путём к MCP этой папки; у каждого клиента своя
  const code = fp.locator('.ig-code pre');
  await fp.locator('[data-client="claude-code"]').click();
  await expect(code).toContainText('claude mcp add slideria --');
  await expect(code).toContainText('scripts/mcp.mjs');
  await fp.locator('[data-client="vscode"]').click();
  await expect(code).toContainText('"servers"');
  // ChatGPT: Codex — командой или в config.toml; про окно самого ChatGPT — подсказка
  await fp.locator('[data-client="codex"]').click();
  await expect(code).toContainText('codex mcp add slideria --');
  await expect(fp.locator('.ig-callout')).toContainText('ChatGPT');
  await fp.locator('[data-variant="1"]').click();
  await expect(code).toContainText('[mcp_servers.slideria]');
  await expect(code).toContainText('args = [');

  // «Смотреть» — правка агента отклоняется; снова «Править»
  await fp.locator('[data-access="view"]').click();
  await expect(fp.locator('[data-access="view"]')).toHaveAttribute('aria-checked', 'true');
  const no = await post('apply?deck=integ', { ops: [{ op: 'slide.set', slide: 1, set: { notes: 'нельзя' } }], by: AGENT });
  expect(no.status).toBe(400);
  expect(no.data.error).toContain('только смотреть');
  await fp.locator('[data-access="edit"]').click();
  await expect(fp.locator('[data-access="edit"]')).toHaveAttribute('aria-checked', 'true');

  // Журнал: правки агента из прошлого теста — было → стало; подразделы — и стрелками
  await fp.locator('.ig-tab[data-sub="agents"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(fp.locator('.ig-tab[data-sub="log"]')).toHaveAttribute('aria-selected', 'true');
  await expect(fp.locator('.ig-entry').first()).toContainText('Claude Code');
  await expect(fp.locator('.ig-diff ins').first()).toHaveText('Правка агента');

  // Скрипт с полем: «Один переход для всех слайдов» → Сдвиг. «Файл» закрывается — результат на слайдах
  await fp.locator('.ig-tab[data-sub="scripts"]').click();
  await fp.locator('[data-script="builtin:переходы.js"]').click();
  await fp.locator('.ig-side select').selectOption('push');
  await fp.locator('[data-run]').click();
  await expect(fp).toBeHidden();
  await expect(page.locator('#ed-toast')).toContainText('1 правка');
  await expect.poll(() => readDeck('integ')).toContain('transition: push');
  // «Журнал правок» на ленте — туда же, в «Файл»: запись скрипта
  await page.locator('.st-ribbon [data-cmd="int.log"]').click();
  await expect(fp.locator('.ig-tab[data-sub="log"]')).toHaveAttribute('aria-selected', 'true');
  await expect(fp.locator('.ig-entry').first()).toContainText('Один переход для всех слайдов');
  await expect(fp.locator('.ig-entry').first().locator('.ig-diff ins')).toHaveText('Сдвиг');

  // Скрипт, который лезет в сеть, — понятный отказ прямо в разделе, данные не тронуты
  await post('script-save', { file: 'сеть.js', code: "// @name Сеть\nexport default async () => { await fetch('https://example.com'); }\n" });
  await fp.locator('.ig-tab[data-sub="scripts"]').click();
  await fp.locator('[data-script="user:сеть.js"]').click();
  await fp.locator('[data-run]').click();
  await expect(fp.locator('.ig-res.err')).toContainText('Скрипту закрыты сеть');
  await expect(fp).toBeVisible();

  // Esc закрывает «Файл»; Ctrl+Z отменяет запуск скрипта целиком
  await page.keyboard.press('Escape');
  await expect(fp).toBeHidden();
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(() => readDeck('integ')).not.toContain('transition: push');
  expect(errors).toEqual([]);
});

test('скрипты — в меню ленты и в Ctrl+K; «Все скрипты» — в «Файл → Интеграции»', async ({ page }) => {
  const errors = watchErrors(page);
  await openTools(page);
  await page.locator('.st-ribbon [data-cmd="int.scripts"]').first().click();
  await expect(page.locator('.st-menu')).toContainText('Оглавление');
  await page.locator('.st-menu').getByText('Все скрипты и новый…').click();
  await expect(page.locator('.fp .ig-tab[data-sub="scripts"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.fp .ig-sc[data-script="builtin:оглавление.js"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('скрипт оглав');
  await expect(page.locator('#st-pal')).toContainText('Скрипт: Оглавление');
  expect(errors).toEqual([]);
});
