// Показ: все слайды открываются без ошибок, тема, интерактив, ссылки между слайдами, морф
import { expect, test } from '@playwright/test';
import { counter, watchErrors } from './helpers';

test.use({ colorScheme: 'light' });

for (const deck of ['tpl', 'slideria']) {
  test(`«${deck}»: все слайды листаются без ошибок`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/?deck=${deck}#1`);
    await expect(page.locator('#ct')).toHaveText(/^1 из \d+$/);
    const [, n] = await counter(page);
    expect(n).toBeGreaterThan(5);
    for (let i = 2; i <= n; i++) {
      await page.keyboard.press('PageDown');
      await expect(page.locator('#ct')).toHaveText(`${i} из ${n}`);
      // На каждом слайде что-то видно: пустой слайд — признак сломанного компонента
      await expect(page.locator('.slide.on')).toBeVisible();
      expect(await page.locator('.slide.on').evaluate((el) => el.textContent!.trim().length + el.querySelectorAll('img, svg, canvas, iframe').length)).toBeGreaterThan(0);
    }
    await page.keyboard.press('Home');
    await expect(page.locator('#ct')).toHaveText(`1 из ${n}`);
    expect(errors).toEqual([]);
  });
}

test('номер слайда в адресе: после перезагрузки показ на том же месте', async ({ page }) => {
  await page.goto('/?deck=tpl#5');
  await expect(page.locator('#ct')).toHaveText(/^5 из/);
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/#6$/);
  await page.reload();
  await expect(page.locator('#ct')).toHaveText(/^6 из/);
});

test('тёмная тема: клавиша T, картинки для тёмной темы подменяются', async ({ page }) => {
  await page.goto('/?deck=tpl#3');
  const shot = page.locator('.slide.on img[src*="ui-studio"]');
  await expect(shot).toHaveAttribute('src', /ui-studio\.webp/);
  await page.keyboard.press('t');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(shot).toHaveAttribute('src', /ui-studio-dark\.webp/);
  await page.keyboard.press('t');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(shot).toHaveAttribute('src', /ui-studio\.webp/);
});

test('оглавление: щелчок по плитке ведёт в раздел', async ({ page }) => {
  await page.goto('/?deck=tpl#4');
  await page.locator('.slide.on').getByText('Интерактив', { exact: true }).click();
  await expect(page.locator('.slide.on')).toContainText('Слайд, который считает');
});

test('ползунок пересчитывает числа, кнопка открывает скрытый объект', async ({ page }) => {
  await page.goto('/?deck=tpl#4');
  await page.locator('.slide.on').getByText('Интерактив', { exact: true }).click();
  const slide = page.locator('.slide.on');
  await expect(slide).toContainText('1 440');
  await slide.locator('input[type=range]').evaluate((el: HTMLInputElement) => {
    el.value = '200';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(slide).toContainText('2 400');
  await expect(slide).toContainText('11,8 млн');
  await expect(slide.getByText('Ползунок задаёт переменную')).toBeHidden();
  await slide.getByText('Как это сделано?').click();
  await expect(slide.getByText('Ползунок задаёт переменную')).toBeVisible();
});

test('обзор всех слайдов (O) открывает слайд по щелчку', async ({ page }) => {
  await page.goto('/?deck=tpl#1');
  await expect(page.locator('#ct')).toHaveText(/^1 из/);
  await page.keyboard.press('o');
  await expect(page.locator('#ovbd')).toHaveClass(/\bon\b/);
  await page.locator('#ovgrid .ovcard').nth(6).click();
  await expect(page.locator('#ct')).toHaveText(/^7 из/);
});

test('морф: пары перелетают, после перехода — ровно новый слайд', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=morph#1');
  await expect(page.locator('#ct')).toHaveText('1 из 2');
  await page.keyboard.press('ArrowRight');
  // Во время перехода: снимок старого слайда и летящие копии двух пар; настоящие объекты ждут под ними
  await expect(page.locator('.morph-layer .morph-fly')).toHaveCount(4);
  await expect(page.locator('.morph-ghost')).toHaveCount(1);
  // Переход закончился: слоёв нет, объекты на местах и видны
  await expect(page.locator('.morph-layer, .morph-ghost')).toHaveCount(0);
  const box = page.locator('.slide.on [data-obj="box"]');
  await expect(box).toBeVisible();
  expect(await box.evaluate((el) => el.style.visibility)).toBe('');
  // Назад — тоже морф
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.morph-layer .morph-fly')).toHaveCount(4);
  await expect(page.locator('.morph-layer, .morph-ghost')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('прожектор: щелчок по блоку — он в светлом окне; ещё раз или Esc — снять', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=slideria#5');
  const chart = page.locator('.slide.on [data-type="line-chart"]');
  await expect(chart).toBeVisible();
  await chart.click();
  await expect(page.locator('.slide.on > .spot-frame.on')).toHaveCount(1);
  await chart.click();
  await expect(page.locator('.spot-frame')).toHaveCount(0);
  await chart.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.spot-frame')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('блоки-схемы: все рисуются без ошибок, вопрос раскрывается по щелчку', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=schemes#1');
  const types = ['cycle', 'funnel', 'pyramid', 'numbers', 'compare', 'matrix', 'icons', 'stats', 'faq'];
  for (const [k, type] of types.entries()) {
    await expect(page.locator('#ct')).toHaveText(`${k + 1} из ${types.length}`);
    const block = page.locator(`.slide.on [data-type="${type}"]`);
    await expect(block).toBeVisible();
    expect(await block.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(60);
    if (k < types.length - 1) await page.keyboard.press('PageDown');
  }
  const q = page.locator('.slide.on .fq-q').first();
  await q.click();
  await expect(page.locator('.slide.on .fq-item.open')).toHaveCount(1);
  await expect(page.locator('.spot-frame')).toHaveCount(0);
  expect(errors).toEqual([]);
});
