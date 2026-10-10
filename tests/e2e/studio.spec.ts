// Студия: открывается без ошибок, «Сохранить как шаблон…» → «Мои шаблоны», меню «Цвет» картинки, палитра команд, темы «Дизайна»
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DECKS, readDeck, watchErrors } from './helpers';

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

test('палитра команд: Ctrl+K находит команду ленты (и в другой раскладке) и выполняет её', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  await page.keyboard.press('Control+k');
  const q = page.locator('.st-pal-q');
  await expect(q).toBeFocused();
  // «Ctnrf» — «Сетка», набранная в английской раскладке
  await q.fill('Ctnrf');
  await expect(page.locator('.st-pal-o').first()).toContainText('Сетка');
  await expect(page.locator('.st-pal-o').first()).toContainText('Вид · Показать');
  await page.keyboard.press('Enter');
  await expect(page.locator('.st-pal-list')).toBeHidden();
  await page.keyboard.press('Control+k');
  await q.fill('сетка');
  await expect(page.locator('.st-pal-o').first()).toContainText('вкл.');
  expect(errors).toEqual([]);
});

test('«Дизайн»: наведение примеряет тему, щелчок применяет её со шрифтами, Ctrl+Z возвращает', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=design&studio#2');
  const slide = page.locator('#st-canvas .slide.on');
  await expect(slide).toHaveCount(1);
  await page.locator('.st-tabs [data-tab="design"]').click();
  const tile = page.locator('.st-dz-mini[data-theme-id="midnight"]');
  // Примерка: только стили открытого слайда, данные не меняются
  await tile.hover();
  await expect(page.locator('#st-canvas .stage[data-th-preview]')).toHaveCount(1);
  await page.mouse.move(10, 600);
  await expect(page.locator('[data-th-preview]')).toHaveCount(0);
  await tile.click();
  // «Полночь» — всегда тёмные слайды: тёмный фон при светлом интерфейсе
  await expect(slide).toHaveAttribute('data-mode', 'dark');
  await expect.poll(() => slide.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(7, 11, 24)');
  await expect.poll(() => readDeck('design')).toContain('preset: midnight');
  const yaml = readDeck('design');
  expect(yaml).toContain('head: Unbounded');
  // Шрифты темы — копией в презентацию
  expect(yaml).toMatch(/name: Unbounded\n\s+src: \.\/assets\/Unbounded\.woff2/);
  expect(fs.existsSync(path.join(DECKS, 'design', 'assets', 'Unbounded.woff2'))).toBe(true);
  await page.keyboard.press('Control+z');
  await expect(slide).not.toHaveAttribute('data-th', /./);
  await expect.poll(() => readDeck('design')).not.toContain('preset:');
  expect(errors).toEqual([]);
});

test('«Мои темы»: оформление сохраняется темой и появляется первым в ряду тем', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=design&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.evaluate(() => localStorage.removeItem('slideria-themes'));
  await page.locator('.st-tabs [data-tab="design"]').click();
  await page.locator('.st-dz-mini[data-theme-id="midnight"]').click();
  await expect.poll(() => readDeck('design')).toContain('preset: midnight');
  await page.locator('[data-cmd="design.themes"]').click();
  await page.locator('[data-my="save"]').click();
  await page.locator('.st-tpl-form input').fill('Ночная');
  await page.locator('.st-tpl-form [data-a="save"]').click();
  // Своя тема — первой плиткой; презентация отмечена ею
  await expect(page.locator('#st-dz-strip .st-dz-mini').first()).toHaveAttribute('title', 'Ночная');
  await expect.poll(() => readDeck('design')).toMatch(/preset: my:\w+/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('slideria-themes') ?? '[]'));
  expect(saved[0].theme.head).toBe('Unbounded');
  expect(saved[0].theme.preset).toBeUndefined();
  expect(errors).toEqual([]);
});

test('живой фон не перехватывает мышь: логотип разобранного титула выделяется и растёт целиком', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=design&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.locator('[data-cmd="obj.ungroup"]').click();
  const logo = page.locator('#st-canvas .slide.on > .free').filter({ has: page.locator('.logo') });
  await expect(logo).toHaveCount(1);
  const b = (await logo.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator('#ed-frame.on')).toHaveCount(1);
  const h = (await page.locator('#ed-frame .h-se').boundingBox())!;
  await page.mouse.move(h.x + 4, h.y + 4);
  await page.mouse.down();
  await page.mouse.move(h.x + 104, h.y + 60, { steps: 6 });
  await page.mouse.up();
  // Пропорции сохраняются, плашка заполняет объект
  await expect.poll(async () => { const r = (await logo.locator('.logo').boundingBox())!; return Math.round(r.width) === Math.round(r.height) && r.width > b.width * 1.5; }).toBe(true);
  expect(errors).toEqual([]);
});

test('«Настроить ленту»: простая лента прячет вкладки, запоминается, скрытое находит Ctrl+K', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  await page.locator('.st-top-r [data-cmd="ui.ribbon"]').click();
  await page.locator('[data-preset="simple"]').click();
  await expect(page.locator('.st-tabs [data-tab="tools"]')).toBeHidden();
  await expect(page.locator('.st-rpanel[data-panel="home"] .st-rgroup[aria-label="Выровнять"]')).toBeHidden();
  // Своя: вернуть группу — набор становится «своим» (открытая вкладка ленты уже раскрыта в списке)
  await page.locator('[data-group="home/Выровнять"]').check();
  await expect(page.locator('.rs-h i')).toHaveText('своя');
  await page.reload();
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  await expect(page.locator('.st-tabs [data-tab="tools"]')).toBeHidden();
  await expect(page.locator('.st-rpanel[data-panel="home"] .st-rgroup[aria-label="Выровнять"]')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.locator('.st-pal-q').fill('Сводка');
  await expect(page.locator('.st-pal-o').first()).toContainText('Инструменты');
  expect(errors).toEqual([]);
});

test('формулы: «Вставка → Уравнение», правка на слайде, живые числа пересчитываются при показе', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=math&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.locator('.st-tabs [data-tab="insert"]').click();
  const gallery = () => page.locator('.st-ribbon [data-cmd="ins.gal.math"]').filter({ visible: true }).click();
  await gallery();
  await page.locator('.st-lib-item').filter({ hasText: 'Квадратное уравнение' }).click();
  // Сразу правка: поле с простой записью, слайд перерисовывается на лету
  const src = page.locator('.st-mathed textarea');
  await expect(src).toHaveValue('x = (-b +- sqrt(b^2 - 4ac))/(2a)');
  await src.press('End');
  await src.pressSequentially(' + 1');
  await expect.poll(() => readDeck('math')).toContain('sqrt(b^2 - 4ac))/(2a) + 1');
  const math = page.locator('#st-canvas .slide.on [data-type="math"] math');
  await expect(math).toHaveCount(1);
  await expect(math.locator('msqrt')).toHaveCount(1);
  await expect(math.locator('mfrac')).toHaveCount(1);
  await src.press('Escape');
  await expect(page.locator('.st-mathed')).toHaveCount(0);
  // Двойной щелчок — снова правка
  await page.locator('#st-canvas .slide.on [data-type="math"]').dblclick();
  await expect(src).toBeVisible();
  await src.press('Escape');
  // Живая формула: ползунки и числа в формуле
  await gallery();
  await page.locator('.st-lib-item').filter({ hasText: 'Живая формула' }).click();
  await expect(page.locator('#st-canvas .slide.on [data-type="math"]').nth(1)).toContainText('117,6');
  await expect.poll(() => readDeck('math')).toContain('{{=m*a}}');
  expect(errors).toEqual([]);

  // При показе: ползунок двигают — формула пересчитывается
  await page.goto('/?deck=math#1');
  const live = page.locator('.slide.on [data-type="math"]').nth(1);
  await expect(live).toContainText('117,6');
  await page.locator('.slide.on [data-type="control"] input[type=range]').first().evaluate((el: HTMLInputElement) => {
    el.value = '20';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(live).toContainText('196');
  await expect(live.locator('math')).toHaveCount(1);
});
