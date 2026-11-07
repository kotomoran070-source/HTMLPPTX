// Раздел «Файл» студии (studio/file-panel.ts): открывается кнопкой «Файл» и щелчком по «Сохранено», закрывается
// Esc; клавиши студии до слайдов не доходят; сведения, экспорт, версии и параметры
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
