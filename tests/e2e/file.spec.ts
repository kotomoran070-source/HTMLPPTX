// Раздел «Файл» студии (studio/file-panel.ts): открывается кнопкой «Файл» и щелчком по «Сохранено», закрывается
// Esc; клавиши студии до слайдов не доходят; сведения, экспорт, версии, параметры и лицензии
import { expect, test } from '@playwright/test';
import { readDeck, waitFile, watchErrors } from './helpers';

test('«Файл»: разделы, клавиатура, Esc, сведения и название', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  const slides = await page.locator('.st-slides-list > *').count();
  const fp = page.locator('.fp');
  await page.locator('#st-file').click();
  await expect(fp).toBeVisible();
  await expect(page.locator('#st-file')).toHaveAttribute('aria-expanded', 'true');
  // Сведения: число слайдов — как в презентации, раздел выбран и в фокусе
  await expect(page.locator('.fp [data-fs="info"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.fp [data-fs="info"]')).toBeFocused();
  await expect(page.locator('.fp-tile b').first()).toHaveText(String(slides));
  await expect(page.locator('.fp-cover .thumb')).toHaveCount(1);
  // Стрелки — по разделам
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.fp [data-fs="export"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.fp-fmt')).toHaveCount(4);
  // Клавиши студии, пока раздел открыт, слайды не трогают
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+m');
  await expect(page.locator('.st-slides-list > *')).toHaveCount(slides);
  // Esc — обратно к слайдам, фокус — на «Файл»
  await page.keyboard.press('Escape');
  await expect(fp).toBeHidden();
  await expect(page.locator('#st-file')).toBeFocused();
  // …без рамки фокуса: раздел просто закрыли
  expect(await page.locator('#st-file').evaluate((b) => b.matches(':focus-visible'))).toBe(false);
  await expect(page.locator('#st-file')).toHaveAttribute('aria-expanded', 'false');

  // Открывается на разделе, где закрыли. Название в «Сведениях» — то же, что в шапке, и в файле
  await page.locator('#st-file').click();
  await expect(page.locator('.fp [data-fs="export"]')).toHaveAttribute('aria-selected', 'true');
  await page.locator('.fp [data-fs="info"]').click();
  await page.locator('#fp-name').fill('Отчёт для теста');
  await page.locator('#fp-name').press('Enter');
  expect(await waitFile(() => /^title: "?Отчёт для теста"?$/m.test(readDeck('tpl')))).toBe(true);
  await expect(page.locator('#st-title')).toHaveValue('Отчёт для теста');
  expect(errors).toEqual([]);
});

test('«Файл»: экспорт — настройки по формату; версии — точка и «Вернуть»; параметры — тема', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  // Экспорт: у HTML — «Как на этом компьютере», у PDF его нет; качество запоминается
  await page.locator('#st-file').click();
  await page.locator('.fp [data-fs="export"]').click();
  await page.locator('.fp [data-x="clean"]').click();
  await expect(page.locator('.fp-side [data-same]')).toHaveCount(1);
  await expect(page.locator('.fp-file')).toContainText('fx.html');
  await page.locator('.fp [data-x="pdf"]').click();
  await expect(page.locator('.fp-side h3')).toHaveText('PDF');
  await expect(page.locator('.fp-side [data-same]')).toHaveCount(0);
  await page.locator('.fp [data-q="compact"]').click();
  await expect(page.locator('.fp [data-q="compact"]')).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('htmlpptx-export-quality'))).toBe('compact');
  await page.keyboard.press('Escape');

  // Версии: щелчок по «Сохранено» — сюда; Ctrl+S — точка в списке; «Вернуть» — к ней (одной правкой)
  await page.locator('#st-status').click();
  await expect(page.locator('.fp [data-fs="versions"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.fp-ver')).not.toHaveCount(0);
  await expect(page.locator('.fp-ver-th .thumb').first()).toBeAttached();
  await page.keyboard.press('Escape');
  const slides = await page.locator('.st-slides-list > *').count();
  await page.locator('#st-canvas').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+m');
  await expect(page.locator('.st-slides-list > *')).toHaveCount(slides + 1);
  await page.locator('#st-status').click();
  await page.locator('.fp-ver').first().hover();
  await page.locator('.fp-ver [data-restore]').first().click();
  await expect(page.locator('.st-slides-list > *')).toHaveCount(slides);
  await expect(page.locator('#ed-toast')).toContainText('Возвращено к точке');

  // Параметры: тема интерфейса — сразу
  await page.locator('.fp [data-fs="prefs"]').click();
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const other = theme === 'dark' ? 'light' : 'dark';
  await page.locator(`.fp [data-uitheme="${other}"]`).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(other);
  await expect(page.locator(`.fp [data-uitheme="${other}"]`)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.fp .rs-presets button')).toHaveCount(3);
  // T — тема и в разделе, как в студии; выбор в «Теме» следует за ней
  await page.locator('.fp [data-fs="prefs"]').focus();
  await page.keyboard.press('t');
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme === 'dark' ? 'dark' : 'light');
  await expect(page.locator(`.fp [data-uitheme="${other}"]`)).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.fp')).toBeVisible();
  expect(errors).toEqual([]);
});

test('«Файл → Лицензии»: список и текст, фильтр, поиск, клавиатура, узкое место; страница выбора — своя страница', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  // «Инструменты» → «Лицензии» — раздел «Файла», не отдельное окно
  await page.locator('[data-tab="tools"]').click();
  await page.locator('.st-ribbon [data-cmd="tools.licenses"]').click();
  await expect(page.locator('.fp [data-fs="licenses"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.fp-lic-sum')).toContainText(/\d+ компонент/);
  // Сразу выбрана Slideria: её текст справа; Electron нет — нет и его лицензии (не программа)
  await expect(page.locator('.lc-row[aria-selected="true"]')).toContainText('Slideria');
  await expect(page.locator('.lc-name')).toHaveText('Slideria');
  await expect(page.locator('.lc-text')).toContainText('Permission is hereby granted');
  await expect(page.locator('.lc-row', { hasText: 'Electron' })).toHaveCount(0);
  const all = await page.locator('.lc-row').count();
  expect(all).toBeGreaterThan(40);
  // Фильтр по лицензии: только OFL — шрифты, их текст
  await page.locator('.lc-chip[data-f="ofl"]').click();
  await expect(page.locator('.lc-row')).toHaveCount(1);
  await page.locator('.lc-row').click();
  await expect(page.locator('.lc-text')).toContainText('SIL OPEN FONT LICENSE');
  await expect(page.locator('.lc-fonts span', { hasText: 'Unbounded' })).toHaveCount(1);
  await page.locator('.lc-chip[data-f="all"]').click();
  await expect(page.locator('.lc-row')).toHaveCount(all);
  // Ctrl+K — поиск по лицензиям (не поиск команд студии), стрелка вниз — в список, Enter — выбрать
  await page.keyboard.press('Control+k');
  await expect(page.locator('.lc-q')).toBeFocused();
  await page.keyboard.type('qrcode');
  await expect(page.locator('.lc-row')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.lc-name')).toHaveText('qrcode-generator');
  // Esc в поиске — очистить (раздел остаётся открытым), стрелки — по строкам, текст следует за выбором
  await page.locator('.lc-q').press('Escape');
  await expect(page.locator('.lc-row')).toHaveCount(all);
  await expect(page.locator('.fp')).toBeVisible();
  await page.locator('.lc-row[aria-selected="true"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.lc-name')).not.toHaveText('qrcode-generator');
  await expect(page.locator('.lc-row[aria-selected="true"]')).toBeFocused();
  // Узкое окно: один список, текст — вместо него, Esc — обратно к списку, ещё Esc — к слайдам
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(page.locator('.lc-pane')).toBeHidden();
  await page.locator('.lc-row[data-id^="yaml@"]').click();
  await expect(page.locator('.lc-side')).toBeHidden();
  await expect(page.locator('.lc-name')).toHaveText('yaml');
  await page.keyboard.press('Escape');
  await expect(page.locator('.lc-side')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.fp')).toBeHidden();
  // Открывается снова на той же записи
  await page.locator('#st-file').click();
  await page.locator('.fp [data-fs="licenses"]').click();
  await expect(page.locator('.lc-row[aria-selected="true"]')).toContainText('yaml');
  expect(errors).toEqual([]);

  // Страница выбора («Справка → Лицензии» в программе): своя страница в том же окне, «Все презентации» — обратно
  await page.goto('/?licenses');
  await expect(page).toHaveTitle('Лицензии · Slideria');
  await expect(page.locator('.lc-sum h1')).toContainText(/\d+ компонент/);
  await expect(page.locator('.lc-text')).toContainText('Permission is hereby granted');
  await page.locator('#lc-home').click();
  await expect(page).toHaveURL(/\?all/);
  expect(errors).toEqual([]);
});
