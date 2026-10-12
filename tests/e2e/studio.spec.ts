// Студия: открывается без ошибок, «Сохранить как шаблон…» → «Мои шаблоны», меню «Цвет» картинки, палитра команд, темы «Дизайна»
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DECKS, readDeck, waitFile, watchErrors } from './helpers';

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
  await page.goto('/?deck=tpl&studio#22');
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

test('логотип: у холста включается галочкой, знак — в цветах темы', async ({ page }) => {
  const errors = watchErrors(page);
  // 5 — холст «Коротко о главном», логотипа в углу у него нет
  await page.goto('/?deck=tpl&studio#5');
  const slide = page.locator('#st-canvas .slide.on');
  await expect(slide).toHaveCount(1);
  await expect(slide.locator('.corner-logo')).toHaveCount(0);
  await page.locator('#st-props label', { hasText: 'Логотип в углу' }).click();
  await expect(slide.locator('.corner-logo img.logo-tint')).toHaveCount(1);
  const summary = () => { const y = readDeck('tpl'); return y.slice(y.indexOf('id: summary'), y.indexOf('id: points')); };
  expect(await waitFile(() => summary().includes('\n    logo: true'))).toBe(true);
  expect(errors).toEqual([]);
});

test('«Эффект текста»: выбор пишет textFx, «Просмотр» играет буквами, после него текст в правке целый', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#19');
  const tile = page.locator('#st-canvas .slide.on > .free').filter({ hasText: 'Неон' }).first();
  const b = (await tile.boundingBox())!;
  await page.mouse.click(b.x + 16, b.y + 16);
  await page.locator('[data-tab="anim"]').first().click();
  await page.locator('[data-cmd="anim.textfx"]').first().click();
  await page.locator('.st-menu button', { hasText: 'Волна' }).click();
  const neon = () => { const y = readDeck('tpl'); return y.split('\n').find((l) => l.includes('text: Неон')) ?? ''; };
  expect(await waitFile(() => neon().includes('textFx: wave'))).toBe(true);
  // «Просмотр» запущен сам; когда закончится, буквы снова одним текстом
  await expect(page.locator('body.st-previewing')).toHaveCount(1);
  await expect(page.locator('body.st-previewing')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('#st-canvas .slide.on .tfx-c')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('логотип: размер знака в плашке — отдельно от плашки', async ({ page }) => {
  await page.goto('/?deck=tpl&studio#7');
  const img = page.locator('#st-canvas .slide.on .corner-logo img');
  await expect(img).toHaveCount(1);
  const share = () => img.evaluate((el) => (el as HTMLElement).offsetWidth / el.parentElement!.clientWidth);
  expect(await share()).toBeCloseTo(0.7, 1);
  await page.locator('[data-tab="design"]').first().click();
  await page.locator('[data-cmd="design.logo"]').first().click();
  await page.locator('.st-dz-mark[data-mark="0.45"]').click();
  expect(await waitFile(() => /\n  mark: 0\.45\n/.test(readDeck('tpl')))).toBe(true);
  await expect.poll(share).toBeLessThan(0.5);
});

test('меню «Цвет» картинки заканчивается над «Настройкой»', async ({ page }) => {
  await page.goto('/?deck=tpl&studio#21');
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

test('импорт из PowerPoint: другая тема перекрашивает цвета файла, «Как в файле» возвращает их', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=origin&studio#1');
  const title = page.locator('#st-canvas .slide.on [data-type="text"]').first();
  const bar = page.locator('#st-canvas .slide.on [data-obj="bar"] .shape, #st-canvas .slide.on [data-obj="bar"] [data-type="shape"]').first();
  await expect(title).toHaveCSS('color', 'rgb(60, 56, 141)');
  await page.locator('.st-tabs [data-tab="design"]').click();
  // Тема файла — первой плиткой и отмечена
  const file = page.locator('#st-dz-strip .st-dz-mini').first();
  await expect(file).toHaveAttribute('data-theme-id', 'file');
  await expect(file).toHaveClass(/active/);
  // Примерка «Зимы» уже перекрашивает: синий оттенок вместо фиолетового
  await page.locator('.st-dz-mini[data-theme-id="winter"]').hover();
  await expect.poll(() => title.evaluate((el) => getComputedStyle(el).color)).not.toBe('rgb(60, 56, 141)');
  await page.locator('.st-dz-mini[data-theme-id="winter"]').click();
  await expect.poll(() => readDeck('origin')).toContain('preset: winter');
  const blue = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, , b] = blue.match(/\d+/g)!.map(Number);
  expect(b).toBeGreaterThan(r * 1.5);
  // Палитра файла остаётся в данных: к ней можно вернуться
  expect(readDeck('origin')).toContain('origin:');
  await file.click();
  await expect.poll(() => readDeck('origin')).toContain('preset: file');
  await expect(title).toHaveCSS('color', 'rgb(60, 56, 141)');
  expect(errors).toEqual([]);
});

test('файлы тем: несколько сразу и набор — перетаскиванием на студию, чужой JSON — понятной ошибкой', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#7');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  const theme = (name: string, accent: string) => ({ slideria: 'theme', version: 1, name, theme: { accent, bg: 'glow' } });
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const [n, txt] of files) dt.items.add(new File([txt], n, { type: 'application/json' }));
    document.querySelector('#st-canvas .slide.on')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [
    ['Закат.slideria-theme.json', JSON.stringify(theme('Закат', '#E11D48'))],
    ['Набор.slideria-themes.json', JSON.stringify({ slideria: 'themes', version: 1, themes: [theme('Лес', '#15803D'), theme('Море', '#0369A1')] })],
    ['чужой.json', '{"a":1}'],
  ]);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('slideria-themes') ?? '[]').map((t: { name: string }) => t.name).sort().join())).toBe('Закат,Лес,Море');
  await expect(page.getByText('чужой.json: это не файл темы Slideria')).toBeVisible();
  // Несколько тем только добавляются: оформление презентации не меняется
  expect(readDeck('tpl')).not.toContain('preset: my:');
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
  // Титул шаблоном cover с живым фоном — последний слайд (см. tests/prepare.mjs)
  await page.goto('/?deck=design&studio#30');
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
  // Ctrl+Z прямо в поле — общая отмена студии: поле и слайд возвращаются вместе
  await page.waitForTimeout(1400);
  await src.pressSequentially(' + 2');
  await expect.poll(() => readDeck('math')).toContain('(2a) + 1 + 2');
  await src.press('Control+z');
  await expect(src).toHaveValue('x = (-b +- sqrt(b^2 - 4ac))/(2a) + 1');
  await expect.poll(() => readDeck('math')).not.toContain('+ 1 + 2');
  await src.press('Control+Shift+z');
  await expect(src).toHaveValue('x = (-b +- sqrt(b^2 - 4ac))/(2a) + 1 + 2');
  await expect(page.locator('.st-mathed button[title^="Дробь"]')).toHaveCount(1);
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

test('«График» из формулы: только у y = f(x), рядом с формулой, кривая следует за ползунком при показе', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=math&studio#4');
  const math = page.locator('#st-canvas .slide.on [data-type="math"]');
  await math.nth(1).dblclick();
  await expect(page.locator('.st-mathed')).toBeVisible();
  await expect(page.locator('.st-mathed [data-plot]')).toBeHidden();
  await page.keyboard.press('Escape');
  await math.nth(0).dblclick();
  await page.locator('.st-mathed [data-plot]').click();
  await expect(page.locator('#st-canvas .slide.on [data-type="plot"] .pc')).not.toHaveCount(0);
  await expect.poll(() => readDeck('math')).toContain('fn: a*sin(x)');
  // Диапазон по y — с запасом на крайнее положение ползунка (a до 3)
  expect(readDeck('math')).toMatch(/type: plot[\s\S]*?y:\s*\n\s*- -3\.6\n\s*- 3\.6/);
  expect(errors).toEqual([]);

  await page.goto('/?deck=math#4');
  const curve = page.locator('.slide.on [data-type="plot"] .pc').first();
  const before = await curve.getAttribute('d');
  await page.locator('.slide.on [data-type="control"] input[type=range]').evaluate((el: HTMLInputElement) => {
    el.value = '3';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => curve.getAttribute('d')).not.toBe(before);
});

test('код слайда: Ctrl+Z не стирает загруженный код, после «Анимаций» в код снова пишется, поиск и замена по-русски', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=math&studio#3');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.keyboard.press('Control+Backquote');
  const code = page.locator('.st-code-ed .cm-content');
  await expect(code).toContainText('text: Конец');
  await code.click();
  // Отменять нечего: загрузка кода — не правка
  for (let k = 0; k < 4; k++) await page.keyboard.press('Control+z');
  await expect(code).toContainText('text: Конец');
  // Другие вкладки и обратно: отмена не возвращает их текст; «только чтение» «Анимаций» не остаётся
  const tab = (m: string) => page.locator(`.st-code-bar [data-mode="${m}"]`).click();
  await tab('css');
  await expect(code).not.toContainText('Конец');
  await tab('anim');
  await expect(page.locator('.st-code-status')).toContainText('нет анимаций');
  await expect(code).toHaveAttribute('aria-readonly', 'true');
  await tab('slide');
  await expect(code).not.toHaveAttribute('aria-readonly', 'true');
  await code.click();
  for (let k = 0; k < 4; k++) await page.keyboard.press('Control+z');
  await expect(code).toContainText('text: Конец');
  // Ctrl+F: сколько найдено
  await page.keyboard.press('Control+f');
  const q = page.locator('.st-cs-q');
  const n = page.locator('.st-cs-n');
  await expect(q).toBeFocused();
  await q.pressSequentially('canvas');
  await expect(n).toHaveText('1 из 1');
  await q.fill('нет такого');
  await expect(n).toHaveText('нет');
  // Ctrl+H: замена — сразу на слайде и в файле
  await q.fill('Конец');
  await page.keyboard.press('Control+h');
  const r = page.locator('.st-cs-r');
  await expect(r).toBeFocused();
  await r.fill('Финиш');
  await page.keyboard.press('Enter');
  await expect(code).toContainText('text: Финиш');
  await expect(page.locator('#st-canvas .slide.on')).toContainText('Финиш');
  await expect.poll(() => readDeck('math')).toContain('text: Финиш');
  await page.keyboard.press('Escape');
  await expect(page.locator('.st-cs')).toHaveCount(0);
  await expect(code).toBeFocused();
  // Ctrl+Z в коде отменяет свою правку
  await page.keyboard.press('Control+z');
  await expect(code).toContainText('text: Конец');
  await expect.poll(() => readDeck('math')).not.toContain('Финиш');
  expect(errors).toEqual([]);
});

test('стили · CSS: правка @keyframes доходит до слайда, Ctrl+Z возвращает прежнюю; на обычном слайде — подсказка', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=math&studio#3');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.keyboard.press('Control+Backquote');
  await page.locator('.st-code-bar [data-mode="css"]').click();
  const code = page.locator('.st-code-ed .cm-content');
  const status = page.locator('.st-code-status');
  await expect(status).toHaveText('Стили всех слайдов-холстов');
  // Действует последнее на странице правило @keyframes с этим именем
  const frame = () => page.evaluate(() => {
    let last = '';
    for (const s of document.styleSheets) for (const rule of s.cssRules) if (rule instanceof CSSKeyframesRule && rule.name === 'zzpulse') last = rule.cssText;
    return last;
  });
  await code.fill('@keyframes zzpulse { to { opacity: 0.5 } }');
  await expect.poll(frame).toMatch(/opacity: 0\.5;/);
  await expect(status).toHaveText('Применено');
  await code.fill('@keyframes zzpulse { to { opacity: 0.25 } }');
  await expect.poll(frame).toMatch(/opacity: 0\.25;/);
  await page.keyboard.press('Control+z');
  await expect(code).toContainText('opacity: 0.5 }');
  await expect.poll(frame).toMatch(/opacity: 0\.5;/);
  await expect.poll(() => readDeck('math')).toContain('opacity: 0.5 }');
  expect(errors).toEqual([]);

  // Обычный слайд — не холст: стили презентации на нём не видны, и это сказано
  await page.goto('/?deck=tpl&studio#2');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.keyboard.press('Control+Backquote');
  await page.locator('.st-code-bar [data-mode="css"]').click();
  await expect(status).toContainText('только на слайдах-холстах');
});

test('код: ошибка — чертой на строке и по-русски, опечатка в типе — «может, …?», подсказки при наборе', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=math&studio#3');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.keyboard.press('Control+Backquote');
  const code = page.locator('.st-code-ed .cm-content');
  const status = page.locator('.st-code-status');
  await expect(code).toContainText('text: Конец');
  const yaml = 'template: canvas\nfree:\n  - type: text\n    text: Конец\n    place:\n      x: 80\n      y: 80\n      w: 400\n';
  // Двоеточие внутри значения — частая ошибка в русском тексте
  await code.fill(yaml.replace('text: Конец', 'text: Время: 10:00'));
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(1);
  await expect(status).toHaveText(/^Строка 4: Второе «:» в строке/);
  await page.locator('.cm-lintRange-error').hover();
  await expect(page.locator('.cm-tooltip-lint')).toContainText('возьмите значение в кавычки');
  // Исправили — отметки нет, слайд применён
  await code.fill(yaml);
  await expect(page.locator('.cm-lintRange')).toHaveCount(0);
  await expect(status).not.toHaveClass(/err/);
  // Опечатка в типе блока — предупреждение с подсказкой
  await code.fill(yaml.replace('type: text', 'type: txet'));
  await expect(page.locator('.cm-lintRange-warning')).toHaveCount(1);
  await expect(status).toContainText('Нет блока «txet» — может, «text»?');
  await code.fill(yaml);
  await expect(page.locator('.cm-lintRange')).toHaveCount(0);

  // Подсказки: поля объекта (уже заданные не предлагаются) и значения
  await code.fill(`${yaml}    ent`);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+Space');
  const popup = page.locator('.cm-tooltip-autocomplete');
  await expect(popup).toContainText('enter');
  await expect(popup).toContainText('Появление');
  // Enter в списке подсказок CodeMirror принимает не раньше 75 мс после его обновления
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  // Пауза после «enter: » — текст не переписывается в «enter: null»
  await page.waitForTimeout(1200);
  await expect(code).not.toContainText('null');
  await page.keyboard.type('ris');
  await expect(popup.locator('li').first()).toContainText('rise');
  await expect(popup.locator('li').first()).toContainText('Всплытие снизу');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await expect(code).toContainText('enter: rise');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Space');
  await expect(popup).toContainText('click');
  await expect(popup).not.toContainText('enter');
  await expect(popup).not.toContainText('place');
  await page.keyboard.press('Escape');
  await expect.poll(() => readDeck('math')).toContain('enter: rise');

  // CSS: классы со слайда, своя анимация, переменные темы
  await page.locator('.st-code-bar [data-mode="css"]').click();
  await code.fill('@keyframes zzglow { to { opacity: 1 } }\n');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('.fre');
  await expect(popup).toContainText('free');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.keyboard.type(' { animation: zzg');
  await expect(popup).toContainText('zzglow');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await page.keyboard.type(' 1s; color: var(--a');
  await expect(popup).toContainText('Акцент');
  await page.keyboard.press('Escape');
  // Пропущенная «;» — предупреждение на строке
  await code.fill('.free {\n  color: red\n  opacity: .5;\n}');
  await expect(page.locator('.cm-lintRange-warning')).toHaveCount(1);
  await expect(status).toContainText('похоже на ошибку');
  expect(errors).toEqual([]);
});

test('поиск по презентации: список совпадений ведёт к месту — в тексте на слайд, в коде (Ctrl+Shift+F) в строку кода', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=find&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.keyboard.press('Control+f');
  const q = page.locator('.st-find-q');
  const items = page.locator('.st-find-it');
  await q.fill('бета');
  // Текст: три слайда и заметки; список открыт, пока поиск в фокусе
  await expect(items).toHaveCount(4);
  await expect(items.nth(3)).toContainText('С.3');
  await items.nth(3).click();
  await expect(page.locator('#st-canvas .slide.on')).toContainText('бета-версия');
  await expect(page.locator('.st-find-n')).toHaveText('4 из 4');
  await expect(q).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.st-find-n')).toHaveText('3 из 4');
  // Цвета в тексте не ищутся — в коде находятся: YAML слайда и стили
  await q.fill('2563EB');
  await expect(page.locator('.st-find-n')).toHaveText('Нет');
  await page.locator('[data-fa="code"]').click();
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('С.2');
  await expect(items.nth(1)).toContainText('CSS');
  await items.nth(1).click();
  await expect(page.locator('#st-code')).toBeVisible();
  await expect(page.locator('.st-code-bar [data-mode="css"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.st-code-ed .cm-st-hl')).toContainText('#2563EB');
  await expect(q).toBeFocused();
  await items.nth(0).click();
  await expect(page.locator('.st-code-bar [data-mode="slide"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.st-code-status')).toHaveText('Слайд 2');
  await expect(page.locator('.st-code-ed .cm-st-hl')).toContainText('fill: "#2563EB"');
  // Ctrl+Shift+F из редактора кода — сразу поиск в коде (Ctrl+F там ищет в открытом коде)
  await page.keyboard.press('Escape');
  await expect(page.locator('.st-find')).toBeHidden();
  await page.locator('.st-code-ed .cm-content').click();
  await page.keyboard.press('Control+Shift+f');
  await expect(page.locator('.st-find.code')).toBeVisible();
  await expect(q).toBeFocused();
  expect(errors).toEqual([]);
});

test('разметка текста ↔ правка: пустые строки (промежутки), список, размер фрагмента — без потерь', async ({ page }) => {
  await page.goto('/?all');
  const res = await page.evaluate(async () => {
    const { t } = await import('/src/engine/html.ts');
    const { toMarkup } = await import('/src/engine/editor/serialize.ts');
    const cases = ['Первая\n\nВторая', 'Список:\n\n- раз\n- два\n\nИтог', 'a\n\n\nb', '- раз\n\n- два', 'Большой {s:50|мелкий} и {#DC2626 s:80|красный}', 'строка\nвторая'];
    return cases.map((c) => { const el = document.createElement('div'); el.innerHTML = t(c); return [c, toMarkup(el)]; });
  });
  for (const [a, b] of res) expect(b).toBe(a);
});

test('Delete: выделен объект — удаляется он, а не слайд (и после щелчка по миниатюре); ничего не выделено — слайд', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=math&studio#3');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  const thumbs = page.locator('.st-slides-list > *');
  const n = await thumbs.count();
  // Фокус на миниатюре, затем щелчок по объекту: клавиши — объекту
  await thumbs.nth(2).click();
  const obj = page.locator('#st-canvas .slide.on .free').filter({ hasText: 'Конец' });
  await obj.click();
  await page.keyboard.press('Delete');
  await expect(obj).toHaveCount(0);
  await expect(thumbs).toHaveCount(n);
  await page.keyboard.press('Control+z');
  await expect(obj).toHaveCount(1);
  await expect.poll(() => readDeck('math')).toContain('text: Конец');
  // Пустое место слайда — выделения нет: Delete удаляет слайд, Ctrl+Z возвращает
  const s = (await page.locator('#st-canvas .slide.on').boundingBox())!;
  await page.mouse.click(s.x + s.width - 20, s.y + s.height - 20);
  await page.keyboard.press('Delete');
  await expect(thumbs).toHaveCount(n - 1);
  await page.keyboard.press('Control+z');
  await expect(thumbs).toHaveCount(n);
  expect(errors).toEqual([]);
});
