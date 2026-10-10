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

test('«Крупнее»: + — содержимое крупнее (шаг 2 %, до 110 %), но целиком в окне; при листании и после перезагрузки остаётся; − ниже 100 % — мельче; Ctrl+0 — как было', async ({ page }) => {
  await page.goto('/?deck=tpl#2');
  await expect(page.locator('#ct')).toHaveText(/^2 из/);
  const stage = page.locator('.stage');
  const width = async () => (await stage.boundingBox())!.width;
  const w0 = await width();
  for (let k = 0; k < 7; k++) await page.keyboard.press('+');
  await expect(page.locator('#zpill')).toContainText('Крупнее · 110 %');
  await expect.poll(width).toBeGreaterThan(w0 * 1.03);
  // Плавный переход масштаба закончился
  await expect(stage).not.toHaveClass(/zoom-anim/);
  expect(await width()).toBeLessThanOrEqual(w0 * 1.1 + 1);
  // Весь текст слайда — в окне
  const inside = () => page.locator('.slide.on').evaluate((s) => {
    const r = document.createRange();
    const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.nodeValue!.trim() || n.parentElement!.closest('.corner-logo')) continue;
      r.selectNodeContents(n);
      for (const b of r.getClientRects()) if (b.width && (b.left < -1 || b.right > innerWidth + 1 || b.top < -1)) return n.nodeValue;
    }
    return '';
  });
  expect(await inside()).toBe('');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#ct')).toHaveText(/^3 из/);
  await expect.poll(width).toBeGreaterThan(w0 * 1.01);
  await page.reload();
  await expect.poll(width).toBeGreaterThan(w0 * 1.01);
  await page.keyboard.press('Control+0');
  await expect.poll(width).toBeCloseTo(w0, 0);
  await page.keyboard.press('-');
  await expect(page.locator('#zpill')).toHaveText('Мельче · 98 %');
  await expect.poll(width).toBeCloseTo(w0 * 0.98, 0);
  await page.keyboard.press('0');
  await expect.poll(width).toBeCloseTo(w0, 0);
});

test('формула по шагам: «Далее» открывает строки и превращение, потом листает; назад — слайд целиком', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=math#2');
  await expect(page.locator('#ct')).toHaveText(/^2 из/);
  const lines = page.locator('.slide.on [data-steps="lines"]');
  const morph = page.locator('.slide.on [data-steps="morph"]');
  await expect(lines.locator('mtr.ms-off')).toHaveCount(2);
  await expect(morph.locator('.math-step.on')).toHaveText(/^\(a\+b\)2$/);
  await page.keyboard.press('ArrowRight');
  await expect(lines.locator('mtr.ms-off')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(lines.locator('mtr.ms-off')).toHaveCount(0);
  await expect(lines.locator('.hl')).toHaveText('2');
  await page.keyboard.press('ArrowRight');
  await expect(morph.locator('.math-step.on')).toContainText('=(a+b)(a+b)');
  await expect(page.locator('#ct')).toHaveText(/^2 из/);
  // Шаги кончились — следующий слайд; назад — этот целиком
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#ct')).toHaveText(/^3 из/);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#ct')).toHaveText(/^2 из/);
  await expect(lines.locator('mtr.ms-off')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(morph.locator('.math-step.on')).toHaveText(/^\(a\+b\)2$/);
  expect(errors).toEqual([]);
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

test('прожектор: щелчок по блоку — он в светлом окне (деталь — вся карточка); ещё раз или Esc — снять', async ({ page }) => {
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
  // Метка внутри карточки — выделяется вся карточка, а не одна метка
  await page.goto('/?deck=slideria#2');
  const chip = page.locator('.slide.on .chip').nth(3);
  await chip.click();
  const frame = page.locator('.slide.on > .spot-frame.on');
  await expect(frame).toHaveCount(1);
  expect((await frame.boundingBox())!.width).toBeGreaterThan((await chip.boundingBox())!.width * 4);
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
