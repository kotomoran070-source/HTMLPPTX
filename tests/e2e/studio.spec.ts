// Студия: открывается без ошибок, «Сохранить как шаблон…» → «Мои шаблоны», меню «Цвет» картинки
import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

test.use({ colorScheme: 'light' });

test('студия открывается, слайды и свойства на месте', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  await expect(page.locator('#st-slides')).toBeVisible();
  await expect(page.locator('[data-cmd="insert.blocks"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('свой блок: «Сохранить как шаблон…» → «Блоки» → «Мои шаблоны»', async ({ page }) => {
  await page.goto('/?deck=tpl&studio#16');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  // Первый свободный объект на видимом слайде
  const obj = page.locator('#st-canvas .free').filter({ hasText: 'Свои блоки', visible: true }).first();
  // Щелчки — левее середины: по центру рамки выделения стоят ручки размера
  const b = (await obj.boundingBox())!;
  await page.mouse.click(b.x + b.width * 0.2, b.y + b.height / 2);
  await page.mouse.click(b.x + b.width * 0.2, b.y + b.height / 2, { button: 'right' });
  await page.locator('.st-menu').getByText('Сохранить как шаблон…').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Подпись раздела');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('[data-cmd="insert.blocks"]').first().click();
  const mine = page.locator('.st-lib-mine');
  await expect(mine).toBeVisible();
  await expect(mine).toContainText('Мои шаблоны');
  await expect(mine).toContainText('Подпись раздела');
});

test('меню «Цвет» картинки заканчивается над «Настройкой»', async ({ page }) => {
  await page.goto('/?deck=tpl&studio#14');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  const img = page.locator('#st-canvas .slide img').filter({ visible: true }).nth(1);
  await img.click();
  await page.locator('[data-cmd="image.filter"]').click();
  const pop = page.locator('.st-fltpop');
  await expect(pop).toBeVisible();
  const m = await pop.evaluate((el) => {
    const heads = [...el.querySelectorAll('h4')];
    const set = heads.find((h) => h.textContent === 'Настройка')!;
    const theme = heads.find((h) => h.textContent === 'В цветах темы')!;
    const top = el.getBoundingClientRect().top;
    return { h: el.clientHeight, set: set.getBoundingClientRect().top - top, theme: theme.getBoundingClientRect().top - top };
  });
  expect(m.h).toBeLessThanOrEqual(m.set);       // «Настройка» не видна без прокрутки
  expect(m.h).toBeGreaterThan(m.theme + 80);    // фильтры «В цветах темы» видны
});

test('облегчённый режим: слайд замирает в конечном виде, «Просмотр» оживляет', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  const stage = page.locator('#st-canvas .stage').first();
  await page.locator('[data-tab="view"]').click();
  const lite = page.locator('.st-ribbon [data-cmd="view.lite"]');
  await lite.click();
  await expect(stage).toHaveClass(/\bstill\b/);
  // Галочка на ленте — сразу после щелчка
  await expect(lite).toHaveClass(/\bactive\b/);
  await expect(stage).toHaveClass(/\bpaused\b/);
  // Ни одной идущей анимации на слайде, а объекты видны (появление не застыло на старте)
  const state = await page.evaluate(() => {
    const s = document.querySelector('#st-canvas .slide.on')!;
    const running = s.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length;
    const hidden = [...s.querySelectorAll<HTMLElement>(':scope > .free')].filter((e) => Number(getComputedStyle(e).opacity) < 0.99).length;
    return { running, hidden };
  });
  expect(state).toEqual({ running: 0, hidden: 0 });
  // «Просмотр» проигрывает анимации как обычно, после него слайд снова замирает
  await page.locator('[data-tab="anim"]').click();
  await page.locator('.st-ribbon [data-cmd="show.preview"]').first().click();
  await expect(page.locator('body')).toHaveClass(/st-previewing/);
  await expect(stage).not.toHaveClass(/\bpaused\b/);
  await page.keyboard.press('Escape');
  await expect(stage).toHaveClass(/\bpaused\b/, { timeout: 12_000 });
  // Режим запоминается
  await page.reload();
  await expect(page.locator('#st-canvas .stage').first()).toHaveClass(/\bstill\b/);
  await page.locator('[data-tab="view"]').click();
  await page.locator('.st-ribbon [data-cmd="view.lite"]').click();
  await expect(page.locator('#st-canvas .stage').first()).not.toHaveClass(/\bpaused\b/);
  expect(errors).toEqual([]);
});
