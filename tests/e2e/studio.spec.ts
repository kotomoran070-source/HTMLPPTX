// Студия: открывается без ошибок, «Сохранить как шаблон…» → «Мои шаблоны», меню «Цвет» картинки, палитра команд, темы «Дизайна»
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';
import { api, DECKS, PNG, readDeck, waitFile, watchErrors } from './helpers';
import { kitWoff2, sfnt } from '../fonts';

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

test('«Эффект текста»: при наведении примеряется каждый эффект, а не только машинка и расшифровка', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#19');
  const tile = page.locator('#st-canvas .slide.on > .free').filter({ hasText: 'Неон' }).first();
  const b = (await tile.boundingBox())!;
  await page.mouse.click(b.x + 16, b.y + 16);
  await page.locator('[data-tab="anim"]').first().click();
  await page.locator('[data-cmd="anim.textfx"]').first().click();
  // Анимации эффекта на объекте: у текста, его букв и копий для глитча и блика
  const anims = () => tile.evaluate((o) => {
    const names = new Set<string>();
    for (const el of o.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const n = getComputedStyle(el, pseudo).animationName;
        if (n && n !== 'none') n.split(',').forEach((x) => names.add(x.trim()));
      }
    }
    return [...names].sort();
  });
  const want: [string, string[]][] = [['Неон', ['tfx-neon']], ['Глитч', ['tfx-gl1', 'tfx-gl2', 'tfx-glitch']], ['Блик', ['tfx-shine']], ['Волна', ['tfx-wave']]];
  for (const [name, keys] of want) {
    await page.locator('.st-menu button', { hasText: name }).hover();
    await expect.poll(anims).toEqual(keys);
  }
  await page.locator('.st-menu button', { hasText: 'Печатная машинка' }).hover();
  await expect.poll(() => tile.locator('.tfx-c').count()).toBeGreaterThan(0);
  // Жидкость — SVG-фильтр у текста
  const filter = () => tile.locator(':is(p[data-type="text"], .shape-t)').first().evaluate((e) => e.style.filter);
  await page.locator('.st-menu button', { hasText: 'Жидкость' }).hover();
  await expect.poll(filter).toBe('url("#sl-liquid")');
  // Ушли из меню — примерка снята, в правке объект снова без анимаций
  await page.keyboard.press('Escape');
  await expect(page.locator('.st-menu')).toHaveCount(0);
  await expect(tile).not.toHaveClass(/tfx-try/);
  await expect.poll(anims).toEqual([]);
  expect(await filter()).toBe('');
  expect(errors).toEqual([]);
});

test('панель свойств без дублей ленты; кадр картинки числами; шрифт из файла — из списка шрифтов, лишний — «убрать» в «Сводке»', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#20');
  const props = page.locator('#st-props');
  await expect(props.locator('h3', { hasText: 'Оформление' })).toHaveCount(1);
  await expect(props.locator('summary', { hasText: 'Презентация' })).toHaveCount(1);
  const pick = async (k: number) => {
    const b = (await page.locator('#st-canvas .slide.on > .free').nth(k).boundingBox())!;
    await page.mouse.click(b.x + 12, b.y + 12);
  };
  // Картинка: заменить и тёмный вариант — на панели над ней, кадр — и там, и числами здесь;
  // видео: воспроизведение — на вкладке «Видео»
  await pick(3);
  await expect(props.locator('.st-p-kind')).toHaveText('Свободный объект');
  await expect(props.getByText('Кадр картинки')).toHaveCount(1);
  await expect(props.getByText('Для тёмной темы')).toHaveCount(0);
  await expect(props.getByText('Высота, px')).toHaveCount(0);
  await pick(4);
  await expect(props.locator('h2')).toHaveText('Видео');
  await expect(props.getByText('Без звука')).toHaveCount(0);
  await expect(props.locator('[data-cmd="tab.video"]')).toHaveCount(1);
  // «По щелчку» свёрнут, а что задано — видно в его заголовке
  const click = props.locator('[data-sec="click"]');
  await expect(click).not.toHaveAttribute('open', '');
  await click.locator('summary').click();
  await click.locator('[data-f="action"]').selectOption('next');
  await expect(click.locator('[data-sum="click"]')).toHaveText('Следующий слайд');
  await page.keyboard.press('Escape');

  await page.locator('[data-tab="design"]').first().click();
  await page.locator('[data-cmd="design.font.body"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.fontpick [data-file]').click();
  await (await chooser).setFiles('src/fonts/Caveat.woff2');
  const fonts = () => /\nfonts:\n\s+- name: Caveat/.test(readDeck('tpl'));
  expect(await waitFile(fonts)).toBe(true);
  // Шрифт добавлен, но нигде не задан — в «Сводке» его можно убрать
  await page.locator('[data-tab="tools"]').first().click();
  await page.locator('[data-cmd="tools.summary"]').click();
  await page.locator('.st-sumpop [data-unfont="Caveat"]').click();
  expect(await waitFile(() => !fonts())).toBe(true);
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
  // Примерка: только стили открытого слайда (у самого слайда — миниатюры не пересчитываются), данные не меняются
  const bg = () => slide.evaluate((el) => getComputedStyle(el).backgroundColor);
  const was = await bg();
  const before = readDeck('design');
  await tile.hover();
  await expect.poll(bg).toBe('rgb(7, 11, 24)');
  expect(await page.locator('#st-slides .slide[style*="--bg"]').count()).toBe(0);
  await page.mouse.move(10, 600);
  await expect.poll(bg).toBe(was);
  expect(await slide.getAttribute('style') ?? '').not.toContain('--bg');
  expect(readDeck('design')).toBe(before);
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

/** Свои темы — файлами в библиотеке студии (SLIDERIA_LIBRARY тестов) */
const LIBRARY = path.resolve('.tmp/test-library');
const myThemes = (): { name: string; theme: Record<string, unknown> }[] => {
  const d = path.join(LIBRARY, 'themes');
  return (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')) : []).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')))
    .sort((a, b) => b.created - a.created);
};

test('файлы тем: несколько сразу и набор — перетаскиванием на студию, чужой JSON — понятной ошибкой', async ({ page }) => {
  const errors = watchErrors(page);
  fs.rmSync(path.join(LIBRARY, 'themes'), { recursive: true, force: true });
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
  const names = () => myThemes().map((t) => t.name).sort().join();
  await expect.poll(names).toBe('Закат,Лес,Море');
  await expect(page.getByText('чужой.json: это не файл темы Slideria')).toBeVisible();
  // Те же файлы второй раз — без двойников; другая тема с занятым именем — с номером
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const [n, txt] of files) dt.items.add(new File([txt], n, { type: 'application/json' }));
    document.querySelector('#st-canvas .slide.on')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [
    ['Закат.slideria-theme.json', JSON.stringify({ ...theme('Закат', '#E11D48'), version: 1, created: 1 })],
    ['Набор.slideria-themes.json', JSON.stringify({ slideria: 'themes', version: 1, themes: [{ theme: { bg: 'glow', accent: '#15803D' }, name: 'Лес' }, theme('Лес', '#65A30D')] })],
  ]);
  await expect.poll(names).toBe('Закат,Лес,Лес (2),Море');
  await expect(page.locator('#ed-toast')).toContainText('Уже есть в «Моих темах»: «Закат», «Лес»');
  // Несколько тем только добавляются: оформление презентации не меняется
  expect(readDeck('tpl')).not.toContain('preset: my:');
  expect(errors).toEqual([]);
});

test('«Дизайн»: своё у тёмных слайдов — фон и анимация, «Как у всех» возвращает общее; цвета темы в палитре — у светлых и у тёмных', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=design&studio#2');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  const slide = page.locator('#st-canvas .slide.on');
  const bg = () => slide.evaluate((s) => getComputedStyle(s).getPropertyValue('--slide-bg'));
  await page.locator('.st-tabs [data-tab="design"]').click();
  await page.locator('[data-cmd="design.bg"]').click();
  const pop = page.locator('.st-pop');
  await expect(pop.locator('[data-scope="all"]')).toHaveAttribute('aria-selected', 'true');
  // «Для тёмных» — студия тёмная: правится то, что видно
  await pop.locator('[data-scope="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(pop.locator('[data-scope="dark"]')).toHaveAttribute('aria-selected', 'true');
  await expect(pop.locator('.st-dz-scope')).toContainText('Сейчас как у всех');
  const was = await bg();
  const grid = pop.locator('.st-dz-opt').filter({ hasText: 'Сетка' });
  await grid.hover();
  await expect.poll(bg).not.toBe(was);
  await grid.click();
  await expect.poll(() => readDeck('design')).toMatch(/darkLook:\s*\n\s*bg: grid/);
  // Снова открыта — сразу «Для тёмных», с точкой: у них своё. «Для всех» меняет общее, своё у тёмных остаётся
  await page.locator('[data-cmd="design.bg"]').click();
  await expect(pop.locator('[data-scope="dark"]')).toHaveAttribute('aria-selected', 'true');
  await expect(pop.locator('[data-scope="dark"] .st-dz-dot')).toHaveCount(1);
  await pop.locator('[data-scope="all"]').click();
  await expect(pop.locator('.st-dz-scope')).toContainText('У тёмных — своё');
  await pop.locator('.st-dz-opt').filter({ hasText: 'Сияние' }).click();
  await expect.poll(() => readDeck('design')).toMatch(/\n {2}bg: glow/);
  expect(readDeck('design')).toMatch(/darkLook:\s*\n\s*bg: grid/);
  const darkBg = await bg();
  await page.locator('#st-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bg()).not.toBe(darkBg);
  // Анимация у тёмных — своя: два слоя, виден слой своего вида
  await page.locator('[data-cmd="design.backdrop"]').click();
  await pop.locator('[data-scope="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await pop.locator('[data-backdrop="waves"]').click();
  await expect.poll(() => readDeck('design')).toMatch(/darkLook:[\s\S]*backdrop: waves/);
  await page.locator('[data-cmd="design.backdrop"]').click();
  await pop.locator('[data-scope="all"]').click();
  await pop.locator('[data-backdrop="aurora"]').click();
  const layer = (m: string) => slide.locator(`:scope > .backdrop.bd-only-${m}`);
  await expect(layer('dark')).toBeVisible();
  await expect(layer('light')).toBeHidden();
  await expect(layer('dark')).toHaveClass(/bd-waves/);
  await page.locator('#st-theme').click();
  await expect(layer('light')).toBeVisible();
  await expect(layer('dark')).toBeHidden();
  // «Как у всех» — своё у тёмных убирается: один общий слой
  await page.locator('[data-cmd="design.backdrop"]').click();
  await expect(pop.locator('[data-scope="dark"] .st-dz-dot')).toHaveCount(1);
  await pop.locator('[data-scope="reset"]').click();
  await expect.poll(() => readDeck('design')).not.toMatch(/backdrop: waves/);
  await expect(slide.locator(':scope > .backdrop')).toHaveCount(1);
  await expect(slide.locator(':scope > .backdrop')).toHaveClass(/bd-aurora/);
  expect(readDeck('design')).toMatch(/darkLook:\s*\n\s*bg: grid/);
  // Ctrl+Z — снова своё у тёмных
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(() => readDeck('design')).toMatch(/backdrop: waves/);
  expect(errors).toEqual([]);
});

test('«Дизайн» → «Фон»: своя картинка (с заметностью) и свой цвет, в том числе только у тёмных; своя тема уносит картинку с собой', async ({ page }) => {
  const errors = watchErrors(page);
  fs.rmSync(path.join(LIBRARY, 'themes'), { recursive: true, force: true });
  await page.goto('/?deck=design&studio#2');
  const slide = page.locator('#st-canvas .slide.on');
  await expect(slide).toHaveCount(1);
  const bg = () => slide.evaluate((s) => getComputedStyle(s).getPropertyValue('--slide-bg'));
  await page.locator('.st-tabs [data-tab="design"]').click();
  await page.locator('[data-cmd="design.bg"]').click();
  const pop = page.locator('.st-pop');
  // Картинка — файлом в assets/, на всех слайдах
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), pop.locator('[data-own="image"]').click()]);
  await chooser.setFiles({ name: 'sky.png', mimeType: 'image/png', buffer: Buffer.from(PNG) });
  await expect.poll(() => readDeck('design')).toMatch(/\n {2}bg: \.\/assets\/sky[\w-]*\.png/);
  await expect.poll(bg).toContain('url(');
  // Снова открыта — плитка «Своя картинка» выбрана, под плитками — заметность
  await page.locator('[data-cmd="design.bg"]').click();
  await expect(pop.locator('[data-own="image"]')).toHaveClass(/active/);
  await expect(pop.locator('[data-own="image"]')).toContainText('Своя картинка');
  await pop.locator('input[data-tune="bgOpacity"]').evaluate((e: HTMLInputElement) => { e.value = '0.5'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await expect.poll(() => readDeck('design')).toMatch(/bgOpacity: 0.5/);
  await expect.poll(bg).toContain('color-mix');
  // Своя тема — с картинкой содержимым: работает и в другой презентации
  await page.locator('[data-cmd="design.themes"]').click();
  await page.locator('[data-my="save"]').click();
  await page.locator('.st-tpl-form input').fill('С картинкой');
  await page.locator('.st-tpl-form [data-a="save"]').click();
  await expect.poll(() => myThemes().length).toBe(1);
  expect(myThemes()[0].theme.bg).toMatch(/^data:image\/png;base64,/);
  // Свой цвет — только у тёмных
  await page.locator('[data-cmd="design.bg"]').click();
  await pop.locator('[data-scope="dark"]').click();
  await pop.locator('[data-own="color"]').click();
  await pop.locator('.st-dz-owncolor').evaluate((e: HTMLInputElement) => { e.value = '#112233'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await expect.poll(() => readDeck('design')).toMatch(/darkLook:\s*\n\s*bg: "?#112233/);
  await expect.poll(bg).toBe('#112233');
  await page.locator('#st-theme').click();
  await expect.poll(bg).toContain('url(');
  // Узор вместо картинки — заметность картинки больше не нужна
  await page.locator('[data-cmd="design.bg"]').click();
  await pop.locator('.st-dz-opt').filter({ hasText: 'Сетка' }).click();
  await expect.poll(() => readDeck('design')).toMatch(/\n {2}bg: grid/);
  expect(readDeck('design')).not.toContain('bgOpacity');
  // Своя тема с картинкой — картинка снова файлом в assets/, а не содержимым в deck.yaml
  await page.locator('#st-dz-strip .st-dz-mini[title="С картинкой"]').click();
  await expect.poll(() => readDeck('design')).toMatch(/\n {2}bg: \.\/assets\/[\w-]+\.png/);
  expect(readDeck('design')).not.toContain('data:image');
  fs.rmSync(path.join(LIBRARY, 'themes'), { recursive: true, force: true });
  expect(errors).toEqual([]);
});

test('градиент акцента — больше двух цветов: точка щелчком по полосе, тянется, красится, вниз — убрана; готовые сочетания; Ctrl+Z', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=design&studio#2');
  const slide = page.locator('#st-canvas .slide.on');
  await expect(slide).toHaveCount(1);
  const acg = () => slide.evaluate((s) => getComputedStyle(s).getPropertyValue('--ac-g'));
  await page.locator('.st-tabs [data-tab="design"]').click();
  // На ленте — акцент и одна кнопка «Градиент» с полоской его цветов
  await expect(page.locator('#st-dz-gsw')).toHaveCSS('background-image', /linear-gradient/);
  await page.locator('[data-cmd="design.gradient"]').click();
  const pop = page.locator('.st-pop');
  const strip = (await pop.locator('.st-gstrip').boundingBox())!;
  await page.mouse.click(strip.x + strip.width * 0.5, strip.y + strip.height / 2);
  await expect.poll(() => readDeck('design')).toMatch(/accentMid:\s*\n\s*- c: "#\w{6}"\s*\n\s*at: 50/);
  // Тянуть вбок — место точки
  const m = (await pop.locator('.st-gmark[data-gi="1"]').boundingBox())!;
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
  await page.mouse.down();
  await page.mouse.move(strip.x + strip.width * 0.3, m.y + m.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => readDeck('design')).toMatch(/at: 3\d/);
  // Цвет выбранной точки — образцом
  await pop.locator('[data-gcolor="#EA580C"]').click();
  await expect.poll(acg).toMatch(/^linear-gradient\(135deg, #4F46E5, #EA580C 3\d%, #0EA5E9\)$/);
  // Утянуть вниз — точки нет
  const m2 = (await pop.locator('.st-gmark[data-gi="1"]').boundingBox())!;
  await page.mouse.move(m2.x + m2.width / 2, m2.y + m2.height / 2);
  await page.mouse.down();
  await page.mouse.move(m2.x + m2.width / 2, m2.y + 90, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => readDeck('design')).not.toContain('accentMid');
  // Готовое сочетание с точками меняет и акцент
  await pop.locator('[data-gpre]').nth(14).click();
  await expect.poll(() => readDeck('design')).toMatch(/accent: "#2563EB"[\s\S]*accentMid:/);
  await expect.poll(acg).toBe('linear-gradient(135deg, #2563EB, #14B8A6 33%, #FACC15 66%, #F43F5E)');
  // Ctrl+Z — прежний градиент
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(() => readDeck('design')).toMatch(/accent: "#4F46E5"/);
  expect(readDeck('design')).not.toContain('accentMid');
  expect(errors).toEqual([]);
});

test('градиент со своими точками у слайда и у фигуры: цвета точек — и постоянные, и цвета темы', async ({ page }) => {
  const errors = watchErrors(page);
  const before = readDeck('tpl');
  await page.goto('/?deck=tpl&studio#4');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  // Свои цвета слайда — тем же окном градиента
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await page.locator('[data-sac="own"]').click();
  await page.locator('[data-a="sgrad"]').click();
  await page.locator('.st-pop [data-gpre]').nth(14).click();
  await expect(page.locator('#st-canvas .slide.on')).toHaveAttribute('data-accent', '#2563EB #F43F5E #14B8A6@33 #FACC15@66');
  // Фигура: точка цветом темы
  const sh = page.locator('#st-canvas .slide.on [data-type="shape"]').first();
  await sh.click({ position: { x: 10, y: 10 } });
  await page.locator('.st-tabs [data-tab="shape"]').click();
  await page.locator('.st-ribbon [data-cmd="shape.fill"]').click();
  await page.locator('.st-pop [data-v="grad-edit"]').click();
  const pop = page.locator('.st-pop');
  const strip = (await pop.locator('.st-gstrip').boundingBox())!;
  await page.mouse.click(strip.x + strip.width * 0.5, strip.y + strip.height / 2);
  await pop.locator('[data-gcolor="accent2"]').click();
  await expect.poll(() => readDeck('tpl')).toMatch(/mid: \[\{c: accent2, at: 50\}\]/);
  await expect.poll(() => sh.evaluate((e) => getComputedStyle(e.matches('.shape') ? e : e.querySelector('.shape')!).backgroundImage)).toContain('50%');
  // Delete на бегунке убирает точку — не саму фигуру
  const shapes = await page.locator('#st-canvas .slide.on [data-type="shape"]').count();
  await pop.locator('.st-gmark[data-gi="1"]').click();
  await page.keyboard.press('Delete');
  await expect.poll(() => readDeck('tpl')).not.toMatch(/mid: \[/);
  await expect(page.locator('#st-canvas .slide.on [data-type="shape"]')).toHaveCount(shapes);
  await page.keyboard.press('Escape');
  for (let k = 0; k < 6 && readDeck('tpl') !== before; k++) {
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
  }
  await expect.poll(() => readDeck('tpl')).toBe(before);
  expect(errors).toEqual([]);
});

test('свой градиент у текста: «Свой градиент…» в палитре текста — точки, цвета, направление; в данных — {g:…|…}', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=design&studio#2');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  const t = page.locator('#st-canvas .slide.on [data-edit]').first();
  await t.click();
  if (!(await page.locator('#ed-text').isVisible())) await t.click();
  await expect(page.locator('#ed-text')).toBeVisible();
  const words = ((await t.textContent()) ?? '').replace(/\u00a0/g, ' ').trim();
  await page.locator('#ed-text [data-t="color"]').click();
  await page.locator('#ed-colors [data-gown]').click();
  const box = page.locator('#ed-colors .edgrad-panel');
  // Щелчок по полосе — точка; правка текста при этом продолжается
  const r = (await box.locator('.st-gstrip').boundingBox())!;
  await page.mouse.click(r.x + r.width * 0.5, r.y + r.height / 2);
  await expect(t).toHaveClass(/ed-active/);
  await box.locator('[data-gcolor="#DC2626"]').click();
  await box.locator('[data-ang="180"]').click();
  // Пока правят — меняется сам кусок текста, без пересборки слайда
  await expect(t.locator('.md-g')).toHaveAttribute('data-c', 'g:180deg,accent,#DC2626@50,accent2');
  await page.keyboard.press('Escape');
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await expect.poll(() => readDeck('design')).toContain(`{g:180deg,accent,#DC2626@50,accent2|${words}}`);
  // После перезагрузки — тот же градиент
  await page.reload();
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  const g = page.locator('#st-canvas .slide.on .md-g').first();
  // Сверху вниз (180° браузер не пишет — так по умолчанию)
  await expect(g).toHaveCSS('background-image', /^linear-gradient\(rgb\(\d+, \d+, \d+\), rgb\(220, 38, 38\) 50%, rgb\(\d+, \d+, \d+\)\)$/);
  expect(errors).toEqual([]);
});

test('цвета темы в палитрах: наискось — у светлых и у тёмных слайдов; у постоянно тёмных — один цвет', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#4');
  const sh = page.locator('#st-canvas .slide.on [data-type="shape"]').first();
  await sh.click({ position: { x: 10, y: 10 } });
  await page.locator('.st-tabs [data-tab="shape"]').click();
  await page.locator('.st-ribbon [data-cmd="shape.fill"]').click();
  const text = page.locator('.st-pop .st-psw[data-v="text"]');
  await expect(text).toHaveAttribute('title', /меняется с темой/);
  expect(await text.evaluate((b) => getComputedStyle(b).backgroundImage)).toBe('linear-gradient(135deg, rgb(17, 24, 39) 50%, rgb(230, 235, 243) 50%)');
  // Постоянные цвета — как были
  expect(await page.locator('.st-pop .st-pgrid').nth(1).locator('.st-psw').first().evaluate((b) => getComputedStyle(b).backgroundImage)).toBe('none');
  await page.keyboard.press('Escape');
  // Слайды всегда тёмные — у образца один цвет, тёмного вида
  await page.locator('.st-tabs [data-tab="design"]').click();
  const before = readDeck('tpl');
  await page.locator('[data-cmd="design.mode.dark"]').click();
  await expect.poll(() => readDeck('tpl')).toContain('mode: dark');
  // Фигура так и выделена
  await page.locator('.st-tabs [data-tab="shape"]').click();
  await page.locator('.st-ribbon [data-cmd="shape.fill"]').click();
  await expect(text).toHaveAttribute('title', 'Цвет текста');
  expect(await text.evaluate((b) => getComputedStyle(b).backgroundColor)).toBe('rgb(230, 235, 243)');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await expect.poll(() => readDeck('tpl')).toBe(before);
  expect(errors).toEqual([]);
});

test('«Мои темы»: оформление сохраняется темой и появляется первым в ряду тем', async ({ page }) => {
  const errors = watchErrors(page);
  fs.rmSync(path.join(LIBRARY, 'themes'), { recursive: true, force: true });
  await page.goto('/?deck=design&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
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
  // Тема — файлом в библиотеке студии, не в браузере
  await expect.poll(() => myThemes().length).toBe(1);
  const saved = myThemes();
  expect(await page.evaluate(() => localStorage.getItem('slideria-themes'))).toBeNull();
  expect(saved[0].theme.head).toBe('Unbounded');
  expect(saved[0].theme.preset).toBeUndefined();
  // То же оформление под другим именем — второй темы нет
  await page.locator('[data-cmd="design.themes"]').click();
  await page.locator('[data-my="save"]').click();
  await page.locator('.st-tpl-form input').fill('Ещё ночная');
  await page.locator('.st-tpl-form [data-a="save"]').click();
  await expect(page.locator('#ed-toast')).toContainText('Такая тема уже есть в «Моих темах» — «Ночная»');
  expect(myThemes()).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('свои библиотеки переезжают из браузера на диск: темы, шаблоны, эффекты, образы', async ({ page }) => {
  const errors = watchErrors(page);
  for (const k of ['themes', 'templates', 'effects', 'looks']) fs.rmSync(path.join(LIBRARY, k), { recursive: true, force: true });
  // Как было раньше: всё в хранилище браузера
  await page.addInitScript(() => {
    if (sessionStorage.getItem('zz-seeded')) return;
    sessionStorage.setItem('zz-seeded', '1');
    localStorage.setItem('slideria-themes', JSON.stringify([{ id: 'old1', name: 'Старая', created: 5, theme: { accent: '#E11D48' } }]));
    localStorage.setItem('htmlpptx-templates', JSON.stringify([{ id: 'tpl1', name: 'Карточка', created: 5, w: 100, h: 50, items: [{ type: 'text', text: 'А', place: { x: 0, y: 0, w: 100 } }] }]));
    localStorage.setItem('htmlpptx-effects', JSON.stringify([{ id: 'ufx-old', name: 'Проявление', css: '@keyframes ufx-old { from { opacity: 0 } }', ms: 400, ease: 'ease', created: 5 }]));
    localStorage.setItem('slideria-looks', JSON.stringify([{ id: 'lk1', name: 'Тёплый', grade: { temp: 20 } }, { id: 'lk2', name: 'Холодный', grade: { temp: -20 } }]));
  });
  await page.goto('/?deck=design&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  const files = (k: string) => (fs.existsSync(path.join(LIBRARY, k)) ? fs.readdirSync(path.join(LIBRARY, k)).sort() : []);
  expect(files('themes')).toEqual(['old1.json']);
  expect(files('templates')).toEqual(['tpl1.json']);
  expect(files('effects')).toEqual(['ufx-old.json']);
  expect(files('looks')).toEqual(['lk1.json', 'lk2.json']);
  // В браузере больше ничего не держим; порядок образов (новые первыми) сохранён
  expect(await page.evaluate(() => ['slideria-themes', 'htmlpptx-templates', 'htmlpptx-effects', 'slideria-looks'].map((k) => localStorage.getItem(k)))).toEqual([null, null, null, null]);
  const looks = files('looks').map((f) => JSON.parse(fs.readFileSync(path.join(LIBRARY, 'looks', f), 'utf8')));
  expect(looks.find((l) => l.id === 'lk1').created).toBeGreaterThan(looks.find((l) => l.id === 'lk2').created);
  // Тема с диска — в ряду тем на ленте
  await page.locator('.st-tabs [data-tab="design"]').click();
  await expect(page.locator('#st-dz-strip .st-dz-mini[title="Старая"]')).toHaveCount(1);
  // Удалить — файл уходит
  await page.locator('[data-cmd="design.themes"]').click();
  await page.locator('[data-my="del"][data-id="my:old1"]').click();
  await expect.poll(() => files('themes')).toEqual([]);
  expect(errors).toEqual([]);
});

test('живой фон не перехватывает мышь: логотип разобранного титула выделяется и растёт целиком', async ({ page }) => {
  const errors = watchErrors(page);
  // Титул шаблоном cover с живым фоном — последний слайд (см. tests/prepare.mjs)
  await page.goto('/?deck=design&studio#30');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  const before = readDeck('design');
  // У темы свой фон («Сияние»): после разбора он остаётся фоном темы, а не своим фоном холста поверх живого фона
  await page.locator('.st-tabs [data-tab="design"]').click();
  await page.locator('[data-cmd="design.bg"]').click();
  await page.locator('.st-pop .st-dz-opt').filter({ hasText: 'Сияние' }).click();
  await expect.poll(() => readDeck('design')).toMatch(/\n {2}bg: glow/);
  await page.keyboard.press('Escape');
  await page.locator('.st-tabs [data-tab="home"]').click();
  await page.locator('[data-cmd="obj.ungroup"]').click();
  const logo = page.locator('#st-canvas .slide.on > .free').filter({ has: page.locator('.logo') });
  await expect(logo).toHaveCount(1);
  await expect(page.locator('#st-canvas .slide.on > .canvas-bg')).toHaveCount(0);
  await expect(page.locator('#st-canvas .slide.on > .backdrop')).toHaveCount(1);
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
  for (let k = 0; k < 6 && readDeck('design') !== before; k++) {
    await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
  }
  await expect.poll(() => readDeck('design')).toBe(before);
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

test('смена вида блока: панель не мигает, выделение остаётся на блоке, Ctrl+Z — как было', async ({ page }) => {
  const errors = watchErrors(page);
  const before = readDeck('tpl');
  await page.goto('/?deck=tpl&studio#10');
  const block = page.locator(`#st-canvas .slide.on [data-block='["slides",9,"free",3]']`);
  await block.click();
  await expect(page.locator('[data-view="cycle"]')).toHaveAttribute('aria-checked', 'true');
  // Кадры, в которых плиток «Вида» нет: раньше выделение снималось на кадр и панель мигала свойствами слайда
  await page.evaluate(() => {
    const w = window as unknown as { gone: number; watch: boolean };
    w.gone = 0; w.watch = true;
    const tick = () => { if (!document.querySelector('[data-view]')) w.gone++; if (w.watch) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  for (const v of ['list', 'numbers', 'icons']) {
    await page.locator(`[data-view="${v}"]`).click();
    await expect(page.locator(`[data-view="${v}"]`)).toHaveAttribute('aria-checked', 'true');
  }
  await expect(block).toHaveAttribute('data-type', 'icons');
  expect(await page.evaluate(() => { const w = window as unknown as { gone: number; watch: boolean }; w.watch = false; return w.gone; })).toBe(0);
  for (let k = 0; k < 3; k++) await page.keyboard.press('Control+z');
  await expect(block).toHaveAttribute('data-type', 'cycle');
  // После отмены файл снова такой, как был (сохраняется он не мгновенно)
  expect(await waitFile(() => readDeck('tpl') === before)).toBe(true);
  expect(errors).toEqual([]);
});

test('шрифт, который автор не разрешил встраивать, в презентацию не попадает: ни через студию, ни через сервер', async ({ page }) => {
  const errors = watchErrors(page);
  const kit = path.resolve('src/fonts/Manrope.woff2');
  // Сервер: WOFF2 («только просмотр и печать», запрет) — ни в презентацию, ни в общую библиотеку; свободный — можно
  for (const [fsType, why] of [[4, 'только для просмотра и печати'], [2, 'запретил его встраивать']] as const) {
    const bytes = [...kitWoff2(kit, fsType)];
    const a = await api(page, 'asset?deck=tpl&name=Restricted.woff2', bytes);
    expect(a.status).toBe(400);
    expect(a.json.error).toContain(why);
    const s = await api(page, 'font-save?file=Restricted.woff2', bytes);
    expect(s.status).toBe(400);
  }
  expect(fs.existsSync(path.join(DECKS, 'tpl', 'assets', 'Restricted.woff2'))).toBe(false);
  expect((await api(page, 'font-save?file=Manrope-ok.woff2', [...fs.readFileSync(kit)])).status).toBe(200);
  // Студия: файл с запретом — отказ с причиной, данные презентации не меняются
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  // Файл шрифта перетаскивают на страницу
  await page.locator('#st-canvas').evaluate((el, bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], 'Locked.ttf', { type: 'font/ttf' }));
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [...sfnt(2)]);
  await expect(page.locator('#ed-toast.err')).toContainText('запретил его встраивать');
  expect(readDeck('tpl')).not.toContain('Locked');
  expect(errors.filter((e) => !e.includes('http 400'))).toEqual([]);
});

test('без двойников: тот же файл под другим именем — в презентации и в библиотеке шрифтов один; шрифт второй раз не добавляется', async ({ page }) => {
  const errors = watchErrors(page);
  // Сервер: картинка и шрифт под другим именем — тот же файл
  const png = [...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')];
  const a = await api(page, 'asset?deck=tpl&name=Dup-a.png', png);
  const b = await api(page, 'asset?deck=tpl&name=Dup-b.png', png);
  expect(b.json.path).toBe(a.json.path);
  expect(fs.existsSync(path.join(DECKS, 'tpl', 'assets', 'Dup-b.png'))).toBe(false);
  const kit = [...fs.readFileSync(path.resolve('src/fonts/Manrope.woff2'))];
  const f1 = await api(page, 'font-save?file=Dup-a.woff2', kit);
  const f2 = await api(page, 'font-save?file=Dup-b.woff2', kit);
  expect(f2.json.file).toBe(f1.json.file);
  // Студия: тот же шрифт второй раз (под другим именем) — одна запись в fonts и подсказка
  const before = readDeck('tpl');
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  const drop = (name: string) => page.locator('#st-canvas').evaluate((el, [bytes, name]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes as number[])], name as string, { type: 'font/woff2' }));
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [kit, name] as const);
  await drop('Mine.woff2');
  await expect.poll(() => readDeck('tpl')).toMatch(/name: Mine/);
  await drop('Mine-copy.woff2');
  await expect(page.locator('#ed-toast')).toContainText('Шрифт «Mine» уже есть в презентации');
  expect(readDeck('tpl')).not.toContain('Mine-copy');
  expect(readDeck('tpl').match(/name: Mine/g)).toHaveLength(1);
  await page.keyboard.press('Control+z');
  expect(await waitFile(() => readDeck('tpl') === before)).toBe(true);
  expect(errors).toEqual([]);
});

test('«Привести в порядок»: копия поверх, ссылки в никуда, скрытое без кнопки — одним действием, Ctrl+Z — как было', async ({ page }) => {
  const errors = watchErrors(page);
  const before = readDeck('tidy');
  await page.goto('/?deck=tidy&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.locator('.st-tabs [data-tab="tools"]').click();
  await page.locator('[data-cmd="tools.tidy"]').click();
  const items = page.locator('.st-tidy li');
  await expect(items).toHaveCount(4);
  await expect(page.locator('.st-tidy')).toContainText('Копия поверх такого же объекта');
  await expect(page.locator('.st-tidy')).toContainText('Ссылка на удалённый слайд');
  await expect(page.locator('.st-tidy')).toContainText('Кнопка управляет удалённым объектом');
  await expect(page.locator('.st-tidy')).toContainText('Скрыт до щелчка, но кнопки нет');
  await page.locator('[data-tidy]').click();
  await expect.poll(() => (readDeck('tidy').match(/text: Карточка/g) ?? []).length).toBe(1);
  const after = readDeck('tidy');
  expect(after).not.toContain('slide:gone');
  expect(after).not.toContain('show:lost');
  expect(after).not.toContain('hidden: true');
  await expect(page.locator('#st-canvas .slide.on > .free')).toHaveCount(4);
  // Ctrl+Z — всё как было (файл записывается заново, поэтому сверяем содержимое, а не текст)
  await page.keyboard.press('Control+z');
  await expect.poll(() => (readDeck('tidy').match(/Карточка/g) ?? []).length).toBe(2);
  for (const v of ['slide:gone', 'show:lost', 'hidden: true']) expect(readDeck('tidy')).toContain(v);
  expect(before).toContain('slide:gone');
  expect(errors).toEqual([]);
});

test('«Цвет+» у GIF: все кадры перекрашены, анимация, задержки и повторы на месте; у снимка WebP формат остаётся', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=gif&studio#1');
  const imgs = page.locator('#st-canvas .slide.on [data-edit-img]');
  await expect(imgs).toHaveCount(2);
  await imgs.first().click();
  await page.locator('.st-tabs [data-tab="image"]').click();
  await page.locator('.st-ribbon [data-cmd="image.grade"]').click();
  await expect(page.locator('.cg-file')).toContainText('GIF, кадров: 3');
  await page.locator('.cg [data-look="mono"]').click();
  await page.locator('.cg [data-a="done"]').click();
  await expect.poll(() => readDeck('gif')).toMatch(/src: \.\/assets\/anim-cg-\w+\.gif/);
  expect(readDeck('gif')).toContain('src: ./assets/anim.gif'); // исходник — в grade.src
  // Новый файл: три кадра в сером, по 0,2 с, по кругу
  const info = await page.locator('#st-canvas .slide.on img').first().evaluate(async (img: HTMLImageElement) => {
    const D = (window as unknown as { ImageDecoder: new (o: object) => any }).ImageDecoder;
    const dec = new D({ data: await (await fetch(img.currentSrc)).arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready; await dec.completed;
    const t = dec.tracks.selectedTrack;
    const frames: { rgb: number[]; ms: number }[] = [];
    for (let i = 0; i < t.frameCount; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
      const g = c.getContext('2d')!;
      g.drawImage(image, 0, 0);
      const d = g.getImageData(20, 15, 1, 1).data;
      frames.push({ rgb: [d[0], d[1], d[2]], ms: Math.round(image.duration / 1000) });
      image.close();
    }
    return { n: t.frameCount, repeat: t.repetitionCount, frames };
  });
  expect(info.n).toBe(3);
  expect(info.repeat).toBe(Infinity);
  for (const f of info.frames) {
    expect(f.ms).toBe(200);
    expect(Math.max(...f.rgb) - Math.min(...f.rgb)).toBeLessThan(12);
  }
  // Кадры остались разными: зелёный в сером светлее красного
  expect(info.frames[1].rgb[0]).toBeGreaterThan(info.frames[0].rgb[0] + 20);
  // Снимок WebP: результат тоже WebP, а не JPEG
  await imgs.nth(1).click();
  await page.locator('.st-ribbon [data-cmd="image.grade"]').click();
  await page.locator('.cg [data-look="dark"]').click();
  await page.locator('.cg [data-a="done"]').click();
  await expect.poll(() => readDeck('gif')).toMatch(/src: \.\/assets\/shot-cg-\w+\.webp/);
  expect(errors).toEqual([]);
});

test('«Инструменты» → «Лицензии»: страница с лицензиями программы, шрифтов и библиотек', async ({ page, context }) => {
  await page.goto('/?deck=tpl&studio#1');
  await page.locator('[data-tab="tools"]').click();
  const [lic] = await Promise.all([context.waitForEvent('page'), page.locator('.st-ribbon [data-cmd="tools.licenses"]').click()]);
  await expect(lic).toHaveTitle('Slideria — лицензии');
  const text = (await lic.locator('body').textContent()) ?? '';
  for (const t of ['Slideria — MIT', 'SIL OPEN FONT LICENSE', 'qrcode-generator', 'Permission is hereby granted']) expect(text).toContain(t);
  // Electron нет — нет и его лицензии (страница из yarn dev)
  expect(text).not.toContain('Electron — MIT');
});

test('фигура: тень, скругление, поворот, прозрачность — плитками на образце, наведение примеряет на самой фигуре', async ({ page }) => {
  const errors = watchErrors(page);
  const before = readDeck('tpl');
  await page.goto('/?deck=tpl&studio#4');
  const sh = page.locator('#st-canvas .slide.on [data-type="shape"]').first();
  await sh.click({ position: { x: 10, y: 10 } });
  await page.locator('.st-tabs [data-tab="shape"]').click();
  const shadow = () => sh.evaluate((e) => getComputedStyle(e.matches('.shape') ? e : e.querySelector('.shape')!).boxShadow);
  const was = await shadow();
  await page.locator('.st-ribbon [data-cmd="shape.shadow"]').click();
  const pop = page.locator('.st-lkpop');
  // Без тени, лёгкая, заметная, глубокая — как у рисунка
  await expect(pop.locator('.st-smp-shape .shape')).toHaveCount(4);
  await pop.locator('[data-lk][title="Без тени"]').hover();
  await expect.poll(shadow).toBe('none');
  expect(readDeck('tpl')).toBe(before);
  await pop.locator('[data-lk][title="Заметная"]').click();
  await expect.poll(() => readDeck('tpl')).toMatch(/text: "\*\*Текст и цифры[^\n]*shadow: md|shadow: md[^\n]*Текст и цифры/);
  expect(await shadow()).not.toBe(was);
  // Поворот: плитки и свой угол ползунком
  await page.locator('.st-ribbon [data-cmd="shape.rotate"]').click();
  await expect(pop.locator('[data-lk]')).toHaveCount(7);
  await pop.locator('[data-lkr]').fill('30');
  await expect.poll(() => readDeck('tpl')).toMatch(/rotate: 30/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await waitFile(() => readDeck('tpl') === before)).toBe(true);
  expect(errors).toEqual([]);
});

test('картинка: галереи «Рисунка» на образце, наведение — на самом снимке; «Круг» — настоящий круг, «Овал» — во всю рамку; паспарту плитками', async ({ page }) => {
  const errors = watchErrors(page);
  const before = readDeck('tpl');
  await page.goto('/?deck=tpl&studio#3');
  await page.locator('#st-canvas .slide.on [data-edit-img]').first().click();
  const box = page.locator('#st-canvas .slide.on .imgbox').first();
  const size = () => box.evaluate((e) => { const r = e.getBoundingClientRect(), f = e.closest('.free')!.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), dx: Math.round(r.left + r.width / 2 - (f.left + f.width / 2)) }; });
  const frame = await size();
  expect(frame.w).toBeGreaterThan(frame.h);
  await page.locator('.st-ribbon [data-cmd="image.radius"]').click();
  const pop = page.locator('.st-lkpop');
  // Плитки — образец, а не сам снимок
  await expect(pop.locator('.st-smp-pic')).toHaveCount(7);
  await expect(pop.locator('img')).toHaveCount(0);
  await pop.locator('[data-lk][title="Круг"]').hover();
  await expect.poll(async () => { const s = await size(); return s.w === s.h && s.w === frame.h && Math.abs(s.dx) <= 1; }).toBe(true);
  expect(readDeck('tpl')).toBe(before);
  await pop.locator('[data-lk][title="Круг"]').click();
  await expect.poll(() => readDeck('tpl')).toMatch(/radius: circle/);
  await expect.poll(async () => { const s = await size(); return s.w === s.h; }).toBe(true);
  // Овал — во всю рамку
  await page.locator('.st-ribbon [data-cmd="image.radius"]').click();
  await pop.locator('[data-lk][title="Овал"]').click();
  await expect.poll(() => readDeck('tpl')).toMatch(/radius: oval/);
  await expect.poll(size).toEqual(frame);
  // Паспарту — плитками с ползунком
  await page.locator('.st-ribbon [data-cmd="image.mat"]').click();
  await expect(pop.locator('[data-lk]')).toHaveCount(5);
  await pop.locator('[data-lk][title="Среднее"]').click();
  await expect.poll(() => readDeck('tpl')).toMatch(/mat: 12/);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  expect(await waitFile(() => readDeck('tpl') === before)).toBe(true);
  expect(errors).toEqual([]);
});

test('картинка: все стили по стрелке галереи — примерка, растворение и сколько тает; недавние в последнем столбце; заливка ползунка масштаба', async ({ page }) => {
  const errors = watchErrors(page);
  const before = readDeck('tpl');
  await page.goto('/?deck=tpl&studio#3');
  const img = page.locator('#st-canvas .slide.on [data-edit-img]').first();
  await img.click();
  // Ползунок масштаба: заливка дорожки сразу на месте значения (100 % на дорожке 30–300 % — около 26 %)
  const zoom = page.locator('#ed-img [data-i="zoom"]');
  await expect(zoom).toBeVisible();
  expect(parseFloat(await zoom.evaluate((e) => e.style.getPropertyValue('--p')))).toBeCloseTo(((Number(await zoom.inputValue()) - 30) / 270) * 100, 0);
  // На ленте 8 стилей: 6 ходовых и столбец недавних (пока пусто — круг и «Тает снизу»)
  const gallery = page.locator('.st-ribbon .st-gallery.i');
  await expect(gallery.locator('.st-itile')).toHaveCount(8);
  const recent = gallery.locator('[data-recent]');
  await expect(recent).toHaveCount(2);
  await expect(recent.first()).toHaveAttribute('data-cmd', 'image.style.circle');
  await gallery.locator('[data-cmd="image.styles"]').click();
  const pop = page.locator('.st-stpop');
  await expect(pop.locator('[data-lk]')).toHaveCount(13);
  // Ползунок «Растворяется» — только когда снимок тает
  await expect(pop.locator('[data-lkr]')).toBeDisabled();
  // Наведение — примерка на слайде, файл не меняется
  const box = page.locator('#st-canvas .slide.on .imgbox').first();
  const left = pop.locator('[data-lk][title="Тает слева"]');
  await left.hover();
  await expect.poll(() => box.evaluate((e) => getComputedStyle(e).maskImage)).toContain('to left');
  expect(readDeck('tpl')).toBe(before);
  await left.click();
  await expect(pop).toHaveCount(0);
  await expect.poll(() => readDeck('tpl')).toMatch(/fade: left/);
  await expect(recent.first()).toHaveAttribute('data-cmd', 'image.style.fade-left');
  await expect(recent.first()).toHaveClass(/active/);
  // Сколько снимка тает
  await gallery.locator('[data-cmd="image.styles"]').click();
  await expect(pop.locator('[data-lk][title="Тает слева"]')).toHaveClass(/\bon\b/);
  await pop.locator('[data-lkr]').fill('70');
  await expect.poll(() => readDeck('tpl')).toMatch(/fadeSize: 70/);
  await expect.poll(() => box.evaluate((e) => getComputedStyle(e).maskImage)).toContain('30%');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect.poll(() => box.evaluate((e) => getComputedStyle(e).maskImage)).toBe('none');
  expect(await waitFile(() => readDeck('tpl') === before)).toBe(true);
  // Недавние помнятся на этом компьютере
  await page.reload();
  await expect(page.locator('.st-ribbon .st-gallery.i [data-recent]').first()).toHaveAttribute('data-cmd', 'image.style.fade-left');
  expect(errors).toEqual([]);
});

test('«Анимация»: исчезновение и выделение по щелчку — меню на ленте; по словам и прорисовка — только у подходящих объектов', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx&studio#2');
  const pick = async (k: number) => {
    const o = page.locator('#st-canvas .slide.on > .free').nth(k);
    const bb = (await o.boundingBox())!;
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.locator('[data-tab="anim"]').first().click();
  };
  const line = (s: string) => readDeck('fx').split('\n').find((l) => new RegExp(`text: "?${s}"?[,}]`).test(l)) ?? '';
  await pick(0);
  await page.locator('[data-cmd="fx.exit"]').click();
  // Наведение примеряет на объекте, уход — как было
  await page.locator('.st-menu button', { hasText: 'Сжатие' }).hover();
  await expect(page.locator('#st-canvas .slide.on > .free').nth(0)).toHaveClass(/st-fx-try-out/);
  await page.locator('.st-menu button', { hasText: 'Сжатие' }).click();
  expect(await waitFile(() => line('A').includes('exit: shrink') && line('A').includes('exitAt: 600'))).toBe(true);
  await page.locator('[data-cmd="fx.exit"]').click();
  await page.locator('.st-menu button', { hasText: 'Без исчезновения' }).click();
  expect(await waitFile(() => !line('A').includes('exit'))).toBe(true);
  // Выделение: новое — в конец очереди
  await pick(2);
  await page.locator('[data-cmd="fx.emph"]').click();
  await expect(page.locator('.st-menu button', { hasText: 'Маркер' })).toBeDisabled();
  await page.locator('.st-menu button', { hasText: 'Пульс' }).click();
  expect(await waitFile(() => line('C').includes('emphasis: pulse') && /emphAt: \d+/.test(line('C')))).toBe(true);
  // «Порядок»: выделение C — в очереди щелчков
  await page.locator('[data-cmd="anim.order"]').click();
  await expect(page.locator('.st-aorder-row').last()).toContainText('Выделение: Пульс');
  await page.keyboard.press('Escape');
  // Картинка: по словам и прорисовка недоступны, шторка — да
  await page.goto('/?deck=fx&studio#1');
  await pick(4);
  await expect(page.locator('[data-cmd="fx.set.words"]')).toBeDisabled();
  await expect(page.locator('[data-cmd="fx.set.draw"]')).toBeDisabled();
  await expect(page.locator('[data-cmd="fx.set.wipe"]')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('маркер в тексте: кнопка в правке текста пишет {mark|…}; «Просмотр» делит заголовок по словам, после него текст целый', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx&studio#1');
  // Оформление текста — на «Главной» (студия помнит последнюю вкладку)
  await page.locator('[data-tab="home"]').first().click();
  const text = page.locator('#st-canvas .slide.on > .free').nth(5).locator('p[data-type="text"]');
  // Не в середину: там у невысокой надписи ручки рамки выделения
  const tb = (await text.boundingBox())!;
  await text.dblclick({ position: { x: tb.width * 0.25, y: tb.height / 2 } });
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('#st-canvas .slide.on p[data-type="text"]')].find((x) => x.textContent!.includes('остальное'))!;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
      const i = n.data.indexOf('остальное');
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 'остальное'.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
      break;
    }
  });
  await page.locator('[data-t="mark"]').click();
  await expect(page.locator('[data-t="mark"]')).toHaveClass(/\bon\b/);
  await page.keyboard.press('Escape');
  expect(await waitFile(() => readDeck('fx').includes('{mark|маркером}, {mark|остальное} потом'))).toBe(true);
  // «Просмотр»: заголовок по словам, после — снова одним текстом
  await page.locator('[data-tab="anim"]').first().click();
  await page.locator('.st-ribbon [data-cmd="show.preview"]').first().click();
  await expect(page.locator('#st-canvas .slide.on .fx-w')).not.toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('body.st-previewing')).toHaveCount(0);
  await expect(page.locator('#st-canvas .slide.on .fx-w')).toHaveCount(0);
  await expect(page.locator('#st-canvas .slide.on .fx-ol')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('«Порядок»: строки перетаскиваются, выделенные — вместе; появление, перенесённое в другую группу, начинает или перестаёт ждать щелчка', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx&studio#3');
  await page.locator('[data-tab="anim"]').first().click();
  const line = (s: string) => readDeck('fx').split('\n').find((l) => new RegExp(`text: "?${s}"?[,}]`).test(l)) ?? '';
  await page.locator('[data-cmd="anim.order"]').click();
  const rows = page.locator('.st-aorder-row');
  const list = () => rows.evaluateAll((rs) => rs.map((r) => `${r.querySelector('span')!.textContent!.split(' · ')[1]}:${(r as HTMLElement).dataset.kind}`).join(' '));
  const drag = async (from: number, to: number, after = false) => {
    const bb = (await rows.nth(to).boundingBox())!;
    await rows.nth(from).dragTo(rows.nth(to), { targetPosition: { x: bb.width / 2, y: after ? bb.height - 4 : 4 } });
  };
  // Две группы со своей нумерацией
  await expect(page.locator('.st-aorder-head')).toHaveText(['При открытии слайда', 'По щелчку']);
  expect(await list()).toBe('D:in E:in F:in G:in G:out');
  await expect(rows.locator('b')).toHaveText(['1', '2', '3', '1', '2']);
  // F — наверх: задержки слайда остаются те же (0, 1, 2 с), меняется, у кого какая
  await drag(2, 0);
  await expect.poll(list).toBe('F:in D:in E:in G:in G:out');
  expect(await waitFile(() => !line('F').includes('delay') && line('D').includes('delay: 1000') && line('E').includes('delay: 2000'))).toBe(true);
  // Появление G — в «При открытии слайда»: больше не ждёт щелчка, исчезновение осталось шагом по щелчку
  await drag(3, 2, true);
  await expect.poll(list).toBe('F:in D:in E:in G:in G:out');
  expect(await waitFile(() => !line('G').includes('click') && line('G').includes('delay: 3000') && line('G').includes('exit: fade'))).toBe(true);
  await expect(rows.locator('b')).toHaveText(['1', '2', '3', '4', '1']);
  // Исчезновение в «При открытии слайда» не переносится
  await drag(4, 0);
  await expect.poll(list).toBe('F:in D:in E:in G:in G:out');
  // Несколько сразу: D и E (Ctrl) — в конец очереди щелчков, вместе и в том же порядке
  await rows.nth(1).locator('.st-aorder-pick').click();
  await rows.nth(2).locator('.st-aorder-pick').click({ modifiers: ['Control'] });
  await expect(page.locator('.st-aorder-row.sel')).toHaveCount(2);
  // Объекты выделены на слайде, а лента осталась на «Анимации»
  await expect(page.locator('#st-canvas .slide.on > .free.ed-block-sel')).toHaveCount(2);
  await expect(page.locator('[data-tab="anim"]').first()).toHaveAttribute('aria-selected', 'true');
  await drag(1, 4, true);
  await expect.poll(list).toBe('F:in G:in G:out D:in E:in');
  expect(await waitFile(() => line('D').includes('click: true') && line('D').includes('delay: 300') && line('E').includes('click: true') && line('E').includes('delay: 600') && line('G').includes('delay: 1000'))).toBe(true);
  await expect(page.locator('.st-aorder-row.sel')).toHaveCount(2);
  // Каждое перетаскивание — свой шаг отмены
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  expect(await waitFile(() => !line('D').includes('click') && line('D').includes('delay: 1000') && !line('G').includes('click'))).toBe(true);
  // Стрелки — на шаг в своей группе; исчезновение раньше своего появления не встаёт. Область анимации так и открыта
  await expect.poll(list).toBe('F:in D:in E:in G:in G:out');
  await rows.nth(0).locator('.st-aorder-mv[data-dir="1"]').click();
  await expect.poll(list).toBe('D:in F:in E:in G:in G:out');
  expect(await waitFile(() => !line('D').includes('delay') && line('F').includes('delay: 1000'))).toBe(true);
  await expect(rows.nth(4).locator('.st-aorder-mv')).toHaveCount(2);
  await expect(rows.nth(4).locator('.st-aorder-mv:disabled')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('номера анимаций на слайде — только на «Анимации» или с областью анимации; область сбоку тянется и переезжает; «Число набегает» — отсчёт или одометр', async ({ page }) => {
  const errors = watchErrors(page);
  // Слайд с одометром в правке — текст целый, без барабанов
  await page.goto('/?deck=fx&studio#5');
  const obj = (k: number) => page.locator('#st-canvas .slide.on > .free').nth(k);
  await expect(obj(0)).toContainText('42');
  await expect(page.locator('#st-canvas .odo')).toHaveCount(0);
  const badge = (k: number, pseudo: string) => obj(k).evaluate((e, p) => getComputedStyle(e, p).content, pseudo);
  // При правке (другая вкладка) номеров нет — ни появлений, ни шагов по щелчку
  await page.locator('[data-tab="home"]').first().click();
  expect([await badge(1, '::after'), await badge(3, '::before')]).toEqual(['none', 'none']);
  await page.locator('[data-tab="anim"]').first().click();
  expect(await badge(3, '::before')).toBe('"1 · 2✕"');
  expect([await badge(0, '::after'), await badge(1, '::after'), await badge(2, '::after'), await badge(3, '::after')]).toEqual(['none', '"1"', '"2"', 'none']);
  // Область анимации сбоку: строка под мышью — её объект обведён; открытая область показывает номера и на других вкладках
  await page.locator('[data-cmd="anim.order"]').click();
  await expect(page.locator('#st-apane')).toBeVisible();
  await page.locator('.st-aorder-row').nth(1).hover();
  await expect(obj(2)).toHaveClass(/st-aorder-hl/);
  await page.mouse.move(5, 400);
  await expect(page.locator('.st-aorder-hl')).toHaveCount(0);
  await page.locator('[data-tab="home"]').first().click();
  expect(await badge(1, '::after')).toBe('"1"');
  // Ширина тянется за край, панель переезжает влево; всё запоминается
  const w0 = (await page.locator('#st-apane').boundingBox())!.width;
  const sb = (await page.locator('#st-sa').boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 200);
  await page.mouse.down();
  await page.mouse.move(sb.x - 80, sb.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await page.locator('#st-apane').boundingBox())!.width - (w0 + 80))).toBeLessThan(8);
  await page.locator('#st-apane [data-a="side"]').click();
  await expect.poll(async () => (await page.locator('#st-apane').boundingBox())!.x < (await page.locator('#st-canvas').boundingBox())!.x).toBe(true);
  await page.reload();
  await expect(page.locator('#st-apane')).toBeVisible();
  await expect(page.locator('#st-apane')).toHaveClass(/left/);
  await page.locator('#st-apane [data-a="close"]').click();
  await expect(page.locator('#st-apane')).toBeHidden();
  await page.locator('[data-tab="anim"]').first().click();
  // Вид «Числа набегает» — стрелкой рядом с галочкой
  const line = () => readDeck('fx').split('\n').find((l) => l.includes('Итого')) ?? '';
  const tb = (await obj(0).boundingBox())!;
  await page.mouse.click(tb.x + 20, tb.y + 10);
  await page.locator('[data-tab="anim"]').first().click();
  await expect(page.locator('[data-cmd="anim.count"]')).toHaveClass(/\bactive\b/);
  await page.locator('[data-cmd="anim.count-menu"]').click();
  await page.locator('.st-menu button', { hasText: 'Отсчёт' }).click();
  expect(await waitFile(() => /count: true/.test(line()))).toBe(true);
  await page.keyboard.press('Escape');
  await page.locator('[data-cmd="anim.count-menu"]').click();
  await page.locator('.st-menu button', { hasText: 'Одометр' }).click();
  expect(await waitFile(() => /count: odometer/.test(line()))).toBe(true);
  // Галочка снимает, вид не спрашивает
  await page.keyboard.press('Escape');
  await page.locator('[data-cmd="anim.count"]').click();
  expect(await waitFile(() => !line().includes('count'))).toBe(true);
  expect(errors).toEqual([]);
});

test('«Вставка» → «Блоки»: бегущая строка и текст по кругу встают на слайд, свойства меняют вид', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx&studio#4');
  await expect(page.locator('#st-canvas .slide.on > .free')).toHaveCount(5);
  await page.locator('[data-tab="insert"]').first().click();
  await page.locator('.st-rpanel:not([hidden]) [data-cmd="insert.blocks"]').first().click();
  await page.locator('.st-lib-item', { hasText: 'Бегущая строка' }).click();
  await expect(page.locator('#st-canvas .slide.on > .free')).toHaveCount(6);
  await expect(page.locator('#st-canvas .slide.on > .free').last().locator('.marquee')).toHaveCount(1);
  // Свойства: вид «Плашки» и направление вправо
  await page.locator('#st-props select[data-p*="variant"]').selectOption('chips');
  await expect(page.locator('#st-canvas .slide.on > .free').last().locator('.marquee.mq-chips')).toHaveCount(1);
  expect(await waitFile(() => /type: marquee/.test(readDeck('fx')) && /variant: chips/.test(readDeck('fx')))).toBe(true);
  await page.locator('[data-tab="insert"]').first().click();
  await page.locator('.st-rpanel:not([hidden]) [data-cmd="insert.blocks"]').first().click();
  await page.locator('.st-lib-item', { hasText: 'Текст по кругу' }).click();
  await expect(page.locator('#st-canvas .slide.on > .free').last().locator('.circ-text .ct-text span')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

const ctxTab = (page: Page, t: string) => page.locator('.st-tabs [data-tab="' + t + '"]').click();
test('примерка при наведении: стиль таблицы на ленте и заливка ячеек — на слайде сразу, уход и Esc — как было', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=table&studio#7');
  const c = page.locator('#st-canvas .slide.on td', { hasText: '70' }).first();
  await c.click();
  if (await page.locator('#st-canvas [contenteditable="true"]').count()) await page.keyboard.press('Escape');
  await ctxTab(page, 'table');
  const tbl = page.locator('#st-canvas .slide.on .tbl').first();
  const cls0 = await tbl.getAttribute('class');
  await page.locator('[data-cmd="table.variant.accent"]').hover();
  await expect(tbl).toHaveClass(/tbl-accent/);
  await page.mouse.move(700, 800);
  await expect.poll(() => tbl.getAttribute('class')).toBe(cls0);
  // заливка ячейки
  await c.click();
  if (await page.locator('#st-canvas [contenteditable="true"]').count()) await page.keyboard.press('Escape');
  await page.locator('[data-cmd="table.fill"]').filter({ visible: true }).click();
  const bg = () => c.evaluate((e) => getComputedStyle(e).backgroundColor);
  const b0 = await bg();
  await page.locator('.st-pop .st-psw[data-v="#DC2626"]').hover();
  await expect.poll(bg).toBe('rgb(220, 38, 38)');
  await page.keyboard.press('Escape');
  await expect.poll(bg).toBe(b0);
  expect(errors).toEqual([]);
});

test('примерка при наведении: стиль, форма и заливка фигуры; щелчок записывает примеренное', async ({ page }) => {
  const errors = watchErrors(page);
  const before = readDeck('fx');
  await page.goto('/?deck=fx&studio#3');
  const o = page.locator('#st-canvas .slide.on > .free').nth(0);
  const b = (await o.boundingBox())!;
  await page.mouse.click(b.x + 10, b.y + 10);
  await ctxTab(page, 'shape');
  const sh = o.locator('.shape').first();
  const st0 = await sh.getAttribute('style'); const cl0 = await sh.getAttribute('class');
  const tiles = page.locator('.st-ribbon [data-cmd^="shape.style."]').filter({ visible: true });
  await tiles.nth(5).hover();
  await expect.poll(() => sh.getAttribute('style')).not.toBe(st0);
  await page.locator('[data-cmd="shape.kind.ellipse"]').hover();
  await expect(sh).toHaveClass(/shape-ellipse/);
  await page.mouse.move(700, 850);
  await expect.poll(() => sh.getAttribute('class')).toBe(cl0);
  expect(await sh.getAttribute('style')).toBe(st0);
  await page.locator('[data-cmd="shape.fill"]').filter({ visible: true }).click();
  await page.locator('.st-pop .st-psw[data-v="#16A34A"]').hover();
  await expect.poll(() => sh.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(22, 163, 74)');
  await page.locator('.st-pop .st-psw[data-v="#16A34A"]').click();
  await expect.poll(() => sh.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(22, 163, 74)');
  // щелчок по стилю: записан, уход мышью его не снимает
  await tiles.nth(2).hover();
  const tried = await o.locator('.shape').first().getAttribute('style');
  await tiles.nth(2).click();
  await page.mouse.move(700, 850);
  await page.waitForTimeout(300);
  expect(await o.locator('.shape').first().getAttribute('style')).toBe(tried);
  // Записанное — обратно: следующие тесты берут fx как в заготовке
  await page.keyboard.press('Escape');
  for (let k = 0; k < 2; k++) await page.keyboard.press('Control+z');
  expect(await waitFile(() => readDeck('fx') === before)).toBe(true);
  expect(errors).toEqual([]);
});

test('примерка при наведении: стиль рисунка на ленте', async ({ page }) => {
  await page.goto('/?deck=fx&studio#1');
  const img = page.locator('#st-canvas .slide.on > .free').nth(4);
  const b = (await img.boundingBox())!;
  await page.mouse.click(b.x + 30, b.y + 30);
  await ctxTab(page, 'image');
  const box = img.locator('.imgbox');
  const s0 = await box.getAttribute('style');
  await page.locator('.st-ribbon [data-cmd^="image.style."]').filter({ visible: true }).nth(3).hover();
  await expect.poll(() => box.getAttribute('style')).not.toBe(s0);
  await page.mouse.move(700, 850);
  await expect.poll(() => box.getAttribute('style')).toBe(s0);
});

test('примерка при наведении: цвет всего текста — стилем, части — подсветкой, текст не меняется', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=design&studio#2');
  const t = page.locator('#st-canvas .slide.on [data-edit]').first();
  await t.click();
  if (!(await page.locator('#ed-text').isVisible())) await t.click();
  const col = () => t.evaluate((e) => getComputedStyle(e).color);
  const c0 = await col();
  await page.locator('#ed-text [data-t="color"]').click();
  await page.locator('#ed-colors [data-c="#DC2626"]').hover();
  await expect.poll(col).toBe('rgb(220, 38, 38)');
  await page.mouse.move(700, 850);
  await expect.poll(col).toBe(c0);
  // часть текста: подсветка-примерка, текст не меняется
  await page.keyboard.press('Escape');
  await t.click();
  if (!(await page.locator('#ed-text').isVisible())) await t.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('Shift+ArrowRight');
  await page.locator('#ed-text [data-t="color"]').click();
  const html0 = await t.innerHTML();
  await page.locator('#ed-colors [data-c="#2563EB"]').hover();
  await expect.poll(() => page.evaluate(() => (CSS as any).highlights?.has('ed-try'))).toBe(true);
  expect(await t.innerHTML()).toBe(html0);
  await page.mouse.move(700, 850);
  await expect.poll(() => page.evaluate(() => (CSS as any).highlights?.has('ed-try'))).toBe(false);
  expect(errors).toEqual([]);
});

test('галерея блоков: каждая заготовка помещается на слайд (превью и вставка не режутся его краем)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx&studio#3');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  const res = await page.evaluate(async () => {
    const { LIBRARY } = await import('/src/studio/library.ts');
    const { Renderer } = await import('/src/engine/render.ts');
    const host = document.createElement('div');
    host.className = 'thumb-stage canvas static';
    Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '1280px', height: '720px', visibility: 'hidden' });
    document.body.append(host);
    const tall: string[] = [];
    let n = 0;
    for (const c of LIBRARY) for (const p of c.items) {
      if (!p.make) continue;
      const deck = { title: 't', slides: [{ template: 'canvas', free: [{ ...p.make(), place: { x: 0, y: 0, w: p.w, ...(p.h ? { h: p.h } : {}) } }] }] };
      host.innerHTML = new Renderer(deck as never).slide(deck.slides[0] as never, 0, 'on static');
      const f = host.querySelector<HTMLElement>('.free');
      n++;
      if (!f || f.scrollHeight > 720 || f.scrollWidth > 1280) tall.push(`${p.name}: ${f?.scrollWidth}×${f?.scrollHeight}`);
    }
    host.remove();
    return { n, tall };
  });
  expect(res.n).toBeGreaterThan(40);
  expect(res.tall).toEqual([]);
  expect(errors).toEqual([]);
});

test('«Порядок»: вместе с предыдущим — звеном; «По пунктам» и «Длительность» на ленте; новые эффекты в меню', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx&studio#7');
  const obj = (k: number) => page.locator('#st-canvas .slide.on > .free').nth(k);
  await expect(obj(1)).toHaveAttribute('data-click-n', '2');
  const line = (s: string) => readDeck('fx').split('\n').find((l) => new RegExp(`text: "?${s}"?[,}]`).test(l)) ?? '';
  await page.locator('[data-tab="anim"]').first().click();
  await page.locator('[data-cmd="anim.order"]').click();
  // У первого шага звена нет, у второго — есть: нажали — Q на том же щелчке, что P
  await expect(page.locator('.st-aorder-row').nth(0).locator('.st-aorder-with')).toHaveCount(0);
  await page.locator('.st-aorder-row').nth(1).locator('.st-aorder-with').click();
  expect(await waitFile(() => line('Q').includes('clickWith: true'))).toBe(true);
  await expect(page.locator('.st-aorder-row').nth(1).locator('b')).toHaveText('1');
  await expect(page.locator('.st-aorder-row').nth(1)).toContainText('вместе с предыдущим');
  await expect(obj(1)).toHaveAttribute('data-click-n', '1');
  await page.keyboard.press('Escape');
  // Список: «По пунктам» — появление с эффектом, Ждёт щелчка — по щелчку на пункт
  const lb = (await obj(2).boundingBox())!;
  await page.mouse.click(lb.x + 30, lb.y + 8);
  await page.locator('[data-tab="anim"]').first().click();
  await page.locator('[data-cmd="anim.byitem"]').click();
  const list = () => readDeck('fx').split('\n').find((l) => l.includes('Альфа')) ?? '';
  expect(await waitFile(() => list().includes('byItem: true') && list().includes('enter: rise'))).toBe(true);
  await page.locator('[data-cmd="anim.click"]').click();
  await expect(obj(2)).toHaveAttribute('data-click-n', '2–4');
  // Длительность — множитель у объекта
  await page.locator('[data-cmd="anim.tempo"]').click();
  await page.locator('.st-menu button', { hasText: 'Медленнее' }).click();
  expect(await waitFile(() => list().includes('tempo: slow'))).toBe(true);
  // Новые эффекты: появление в галерее, исчезновение и стойкое выделение в меню
  await expect(page.locator('[data-cmd="fx.set.wheel"]')).toBeEnabled();
  await page.locator('[data-cmd="fx.exit"]').click();
  await expect(page.locator('.st-menu button', { hasText: 'Часовая стрелка' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.locator('[data-cmd="fx.emph"]').click();
  await page.locator('.st-menu button', { hasText: 'Приглушить' }).hover();
  await expect(obj(2)).toHaveClass(/st-fx-try-emph/);
  await page.locator('.st-menu button', { hasText: 'Приглушить' }).click();
  expect(await waitFile(() => list().includes('emphasis: dim'))).toBe(true);
  expect(errors).toEqual([]);
});

test('переходы: галерея в два ряда со стрелками, «Направление» — у переходов с направлением, по умолчанию не пишется', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=trs&studio#3');
  await page.locator('[data-tab="anim"]').first().click();
  const slide = (n: number) => readDeck('trs').split('\n  - ')[n] ?? '';
  await expect(page.locator('#st-tr-label')).toContainText('Шторка сверху');
  // Выбранный переход — на виду в ленте
  await expect(page.locator('.st-trgal [data-cmd="tr.set.wipe"]')).toHaveClass(/active/);
  // Направление: снизу — пишется, слева (как по умолчанию у шторки) — убирается
  await page.locator('[data-cmd="tr.dir"]').click();
  await page.locator('.st-menu button', { hasText: 'Снизу' }).click();
  expect(await waitFile(() => slide(3).includes('transitionDir: bottom'))).toBe(true);
  await page.keyboard.press('Escape');
  await page.locator('[data-cmd="tr.dir"]').click();
  await page.locator('.st-menu button', { hasText: 'Слева' }).click();
  expect(await waitFile(() => slide(3).includes('transition: wipe') && !slide(3).includes('transitionDir'))).toBe(true);
  // Новый переход из ленты: «Часы» — без направления
  await page.keyboard.press('Escape');
  await page.locator('.st-trpick [data-nav="1"]').click();
  await page.locator('[data-cmd="tr.set.clock"]').click();
  expect(await waitFile(() => slide(3).includes('transition: clock'))).toBe(true);
  await expect(page.locator('[data-cmd="tr.dir"]')).toBeDisabled();
  // Стрелки ленты переходов — посередине по высоте, как у появлений
  const mid = async (sel: string) => {
    const g = (await page.locator(`${sel} .st-fxgal`).boundingBox())!;
    const n = (await page.locator(`${sel} [data-nav="1"]`).boundingBox())!;
    return Math.round(n.y + n.height / 2 - (g.y + g.height / 2));
  };
  expect(Math.abs(await mid('.st-trpick'))).toBeLessThan(3);
  expect(Math.abs(await mid('.st-fxpick'))).toBeLessThan(3);
  expect(errors).toEqual([]);
});

test('«Разобрать на объекты»: живой фон не закрыт копией, его заметность, скорость, ответ на мышь и переход с направлением — остаются', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=expl&studio#1');
  const look = () => page.locator('#st-canvas .slide.on .backdrop').evaluate((b) => `${b.className.match(/bd-\w+/)?.[0]} ${getComputedStyle(b).opacity}`);
  await expect.poll(look).toBe('bd-aurora 0.5');
  // Выделен блок раскладки — подпись «Анимации» подсказывает, что делать
  await page.locator('[data-tab="anim"]').first().click();
  await page.locator('#st-canvas .slide.on li').first().click();
  await expect(page.locator('#st-fx-label')).toContainText('Сделать свободным');
  await page.keyboard.press('Escape');
  await page.locator('#st-canvas .slide.on').click({ button: 'right', position: { x: 8, y: 8 } });
  await page.locator('.st-menu button', { hasText: 'Разобрать на объекты' }).click();
  const slide = () => readDeck('expl').split('\n  - ')[1] ?? '';
  expect(await waitFile(() => slide().includes('template: canvas'))).toBe(true);
  for (const f of ['backdrop: aurora', 'backdropOpacity: 0.5', 'backdropSpeed: 2', 'backdropTouch: false', 'transition: cube', 'transitionDir: top']) expect(slide()).toContain(f);
  await expect.poll(look).toBe('bd-aurora 0.5');
  // Фон рисует сам слайд: его копии в декоре нет (пустой холст закрыл бы живой фон)
  await expect(page.locator('#st-canvas .slide.on .backdrop')).toHaveCount(1);
  // Финал: живой фон один, кольца — в декоре и движутся
  await page.goto('/?deck=expl&studio#3');
  await page.locator('#st-canvas .slide.on').click({ button: 'right', position: { x: 8, y: 8 } });
  await page.locator('.st-menu button', { hasText: 'Разобрать на объекты' }).click();
  expect(await waitFile(() => (readDeck('expl').split('\n  - ')[3] ?? '').includes('template: canvas'))).toBe(true);
  await expect(page.locator('#st-canvas .slide.on .backdrop')).toHaveCount(1);
  await expect(page.locator('#st-canvas .slide.on .backdrop.bd-network')).toHaveCount(1);
  await expect.poll(() => page.locator('#st-canvas .slide.on .rg circle').first().evaluate((c) => c.getAnimations().length)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('«Собрать в галерею»: две картинки слайда — кадрами одной, левая остаётся на месте, разной формы — целиком на размытом фоне; Ctrl+Z — как было', async ({ page }) => {
  const errors = watchErrors(page);
  const before = readDeck('gal');
  await page.goto('/?deck=gal&studio#3');
  const pics = page.locator('#st-canvas .slide.on [data-type="image"]');
  await expect(pics).toHaveCount(2);
  await pics.nth(0).click({ position: { x: 40, y: 40 } });
  await pics.nth(1).click({ position: { x: 40, y: 40 }, modifiers: ['Shift'] });
  await page.locator('.st-tabs [data-tab="image"]').click();
  await page.locator('.st-ribbon [data-cmd="image.frames.join"]').click();
  await expect(page.locator('#st-canvas .slide.on [data-type="image"]')).toHaveCount(1);
  await expect(page.locator('#st-canvas .slide.on .image.gal .gal-f')).toHaveCount(2);
  // Первая — левая: её место и скругление, кадр правой — со своей подписью; снимки разной формы — целиком на размытом фоне
  await expect.poll(() => parse(readDeck('gal')).slides[2].free).toEqual([{
    type: 'image', src: './assets/photo.svg', radius: 24, place: { x: 120, y: 120, w: 440, h: 300 }, fit: 'contain', fitBlur: true,
    images: [{ src: './assets/cartoon.webp', caption: 'Справа', fit: 'contain' }],
  }]);
  await expect(page.locator('#st-canvas .slide.on .image.gal .gal-f.img-bf')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#st-canvas .slide.on [data-type="image"]')).toHaveCount(2);
  // Те же данные (картинку, которую правили, файл пишет уже блоком, а не строкой)
  expect(await waitFile(() => JSON.stringify(parse(readDeck('gal'))) === JSON.stringify(parse(before)))).toBe(true);
  expect(errors).toEqual([]);
});

test('картинка с кадрами: точки открывают кадр для правки, «Галерея» добавляет, переставляет и убирает кадры; несколько файлов — одна картинка', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=gal&studio#1');
  const fig = page.locator('#st-canvas .slide.on .image.gal');
  await expect(fig).toHaveCount(1);
  await fig.click({ position: { x: 200, y: 150 } });
  const cmd = (c: string) => page.locator(`.st-ribbon [data-cmd="${c}"]`);
  await expect(cmd('image.frame.prev')).toBeDisabled();
  // Точка — кадр открыт, выделен он: правка — его
  await fig.locator('.gal-dot[data-k="1"]').click();
  await expect(fig).toHaveAttribute('data-at', '1');
  await expect(page.locator('.ed-selected')).toHaveAttribute('data-edit-img', JSON.stringify(['slides', 0, 'free', 0, 'images', 0, 'src']));
  // Раньше: второй кадр становится первым и остаётся открытым
  await cmd('image.frame.prev').click();
  await expect(fig).toHaveAttribute('data-at', '0');
  await expect.poll(() => { const y = readDeck('gal'); return y.indexOf('cartoon.webp') < y.indexOf('photo.svg'); }).toBe(true);
  // Миниатюра — первый кадр, без кнопок
  await expect(page.locator('.st-thumb .image.gal .gal-f').first()).toBeVisible();
  // Ещё кадры: два файла сразу — после открытого
  const chooser = page.waitForEvent('filechooser');
  await cmd('image.frame.add').click();
  await (await chooser).setFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: Buffer.from(PNG) },
    { name: 'two.png', mimeType: 'image/png', buffer: Buffer.from(PNG) },
  ]);
  await expect(fig.locator('.gal-f')).toHaveCount(5);
  await expect(fig).toHaveAttribute('data-at', '1');
  await cmd('image.frame.del').click();
  await expect(fig.locator('.gal-f')).toHaveCount(4);
  await cmd('image.flip').click();
  await expect(fig).toHaveAttribute('data-flip', 'click');
  // Несколько картинок на пустое место — одна картинка с кадрами
  await page.locator('#st-canvas').evaluate((stage, bytes) => {
    const dt = new DataTransfer();
    for (const n of ['a.png', 'b.png', 'c.png']) dt.items.add(new File([new Uint8Array(bytes)], n, { type: 'image/png' }));
    const r = stage.querySelector('.slide.on')!.getBoundingClientRect();
    const at = { clientX: r.right - 40, clientY: r.bottom - 40, bubbles: true, cancelable: true, dataTransfer: dt };
    const t = document.elementFromPoint(at.clientX, at.clientY)!;
    t.dispatchEvent(new DragEvent('dragover', at));
    t.dispatchEvent(new DragEvent('drop', at));
  }, PNG);
  await expect(page.locator('#st-canvas .slide.on .image.gal')).toHaveCount(2);
  await expect(page.locator('#st-canvas .slide.on .image.gal').nth(1).locator('.gal-f')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('«Показ»: план доклада и время слайда — плашками и своим значением, вид прогресса — меню; на кнопках — текущее', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=prog&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await page.locator('.st-tabs [data-tab="show"]').click();
  const cmd = (c: string) => page.locator(`.st-ribbon [data-cmd="${c}"]`);
  await expect(cmd('show.plan')).toContainText('План 10 мин');
  // План: плашка, своё значение (Enter), «Без плана»
  await cmd('show.plan').click();
  await page.locator('.st-vpop .st-vchip', { hasText: '20 мин' }).click();
  await expect.poll(() => readDeck('prog')).toMatch(/^plan: 20$/m);
  await cmd('show.plan').click();
  await page.locator('.st-vpop input').fill('7');
  await page.locator('.st-vpop input').press('Enter');
  await expect.poll(() => readDeck('prog')).toMatch(/^plan: 7$/m);
  await expect(cmd('show.plan')).toContainText('План 7 мин');
  await cmd('show.plan').click();
  await page.locator('.st-vpop .st-vchip', { hasText: 'Нет' }).click();
  await expect.poll(() => readDeck('prog')).not.toMatch(/^plan:/m);
  // Время слайда при автопоказе
  await cmd('show.auto.after').click();
  await page.locator('.st-vpop .st-vchip', { hasText: '10 с' }).click();
  await expect.poll(() => readDeck('prog')).toMatch(/autoplay:\s+after: 10/);
  await expect(cmd('show.auto.after')).toContainText('Слайд 10 с');
  // Вид прогресса
  await cmd('show.progress').click();
  await page.locator('.st-menu button', { hasText: 'Номер' }).click();
  await expect.poll(() => readDeck('prog')).toMatch(/^progress: number$/m);
  await expect(cmd('show.progress')).toContainText('Прогресс: номер');
  expect(errors).toEqual([]);
});
