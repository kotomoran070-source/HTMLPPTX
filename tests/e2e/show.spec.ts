// Показ: все слайды открываются без ошибок, тема, интерактив, ссылки между слайдами, морф
import { expect, test } from '@playwright/test';
import { counter, nextTo, readDeck, watchErrors } from './helpers';

test.use({ colorScheme: 'light' });

for (const deck of ['tpl', 'slideria']) {
  test(`«${deck}»: все слайды листаются без ошибок`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/?deck=${deck}#1`);
    await expect(page.locator('#ct')).toHaveText(/^1 из \d+$/);
    const [, n] = await counter(page);
    expect(n).toBeGreaterThan(5);
    for (let i = 2; i <= n; i++) {
      await nextTo(page, i);
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

test('объекты «ждут щелчка»: появляются по одному в порядке очереди, назад — прячутся', async ({ page }) => {
  await page.goto('/?deck=math#5');
  await expect(page.locator('#ct')).toHaveText(/^5 из/);
  const first = page.locator('.slide.on > .free').filter({ hasText: 'Первый' });
  const second = page.locator('.slide.on > .free').filter({ hasText: 'Второй' });
  await expect(first).toHaveClass(/click-hid/);
  await expect(second).toHaveClass(/click-hid/);
  await expect(first).toHaveCSS('opacity', '0');
  // Очередь — по задержке, а не по порядку в списке
  await page.keyboard.press('ArrowRight');
  await expect(first).not.toHaveClass(/click-hid/);
  await expect(second).toHaveClass(/click-hid/);
  await page.keyboard.press('ArrowRight');
  await expect(second).not.toHaveClass(/click-hid/);
  await page.keyboard.press('ArrowLeft');
  await expect(second).toHaveClass(/click-hid/);
  await expect(first).not.toHaveClass(/click-hid/);
  await expect(page.locator('#ct')).toHaveText(/^5 из/);
});

test('морф: пары перелетают, после перехода — ровно новый слайд', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=morph#1');
  await expect(page.locator('#ct')).toHaveText('1 из 2');
  await page.keyboard.press('ArrowRight');
  // Во время перехода: снимок старого слайда и летящие копии двух пар; настоящие объекты ждут под ними
  await expect(page.locator('.morph-layer .morph-fly')).toHaveCount(4);
  await expect(page.locator('.morph-ghost')).toHaveCount(1);
  // Поворот фигуры не растворяется, а играет в полёте: у копий он в transform
  const turns = await page.locator('.morph-layer .morph-fly').evaluateAll((els) => els.map((el) => el.getAnimations()
    .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().map((k) => String(k.transform ?? ''))).join(' ')));
  expect(turns.filter((t) => t.includes('rotate(0deg)') && t.includes('rotate(30deg)'))).toHaveLength(2);
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

test('эффекты текста: при показе буквы по отдельности (волна, машинка, расшифровка), у глитча — копия текста; уйти со слайда — текст как был', async ({ page }) => {
  const errors = watchErrors(page);
  // 19 — «Текст, который оживает»: по объекту на каждый эффект
  await page.goto('/?deck=tpl#19');
  const slide = page.locator('.slide.on');
  await expect(slide.locator('.free[data-tfx]')).toHaveCount(7);
  const wave = slide.locator('.free[data-tfx="wave"]');
  await expect(wave.locator('.tfx-c')).toHaveCount('Волнапобуквам'.length);
  await expect(slide.locator('.free[data-tfx="glitch"] [data-text="ГЛИТЧ"]')).toHaveCount(1);
  // Машинка допечатала, расшифровка встала на место
  await expect(slide.locator('.free[data-tfx="type"] .tfx-off')).toHaveCount(0);
  await expect(slide.locator('.free[data-tfx="scramble"]')).toHaveText('ДОСТУП ОТКРЫТ');
  await page.keyboard.press('PageDown');
  await expect(page.locator('#ct')).toHaveText(/^20 из/);
  await expect(page.locator('.slide .tfx-c, .slide [data-text]')).toHaveCount(0);
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
  const types = ['cycle', 'funnel', 'pyramid', 'numbers', 'compare', 'matrix', 'icons', 'stats', 'roadmap', 'ladder', 'orbit', 'faq'];
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

test('видео: пауза, перемотка и запуск в окне докладчика — у зрителей то же', async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=slideria#9');
  const show = page.locator('.slide.on video');
  await expect(show).toHaveCount(1);
  const state = (v: typeof show) => v.evaluate((el: HTMLVideoElement) => ({ paused: el.paused, t: el.currentTime }));
  // Окно докладчика, открытое посреди ролика, не отматывает его зрителям в начало: считаем перемотки назад
  // из кода страницы (ролик по кругу начинается заново сам, а кадры фоновой вкладки редкие — по времени это не отличить)
  await page.evaluate(() => {
    const w = window as unknown as { back: number };
    w.back = 0;
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...d, set(this: HTMLMediaElement, v: number) { if (v < this.currentTime - .2) w.back++; d.set!.call(this, v); } });
  });
  await expect.poll(async () => (await state(show)).t).toBeGreaterThan(.5);
  const pres = await context.newPage();
  await pres.goto('/?deck=slideria&view=presenter');
  const own = pres.locator('#cur .slide.on video');
  await expect(own).toHaveCount(1);
  await expect.poll(async () => (await state(own)).paused).toBe(false);
  // Дольше одного круга ролика (около 4 с): его перезапуск по кругу у докладчика тоже не отматывает зрителей
  await pres.waitForTimeout(5000);
  expect(await page.evaluate(() => (window as unknown as { back: number }).back)).toBe(0);
  await own.evaluate((el: HTMLVideoElement) => el.pause());
  await expect.poll(async () => (await state(show)).paused).toBe(true);
  await own.evaluate((el: HTMLVideoElement) => { el.currentTime = 2.5; });
  await expect.poll(async () => Math.abs((await state(show)).t - 2.5)).toBeLessThan(.1);
  await own.evaluate((el: HTMLVideoElement) => el.play());
  await expect.poll(async () => (await state(show)).paused).toBe(false);
  await pres.close();
  expect(errors).toEqual([]);
});

test('пульт: часы показа общие с окном показа, наведение пальцем видно и на самом пульте, как у зрителей', async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=mirror#1');
  await expect(page.locator('.slide.on')).toHaveCount(1);
  // Пульт открывают позже окна показа: без общих часов его анимации отставали бы на это время
  await page.waitForTimeout(1500);
  const pres = await context.newPage();
  const presErrors = watchErrors(pres);
  await pres.goto('/?deck=mirror&view=presenter');
  await expect(pres.locator('#cur .slide.on')).toHaveCount(1);
  await expect(pres.locator('#link.ok')).toHaveCount(1);
  const clock = (p: typeof page) => p.evaluate(async () => { const u = '/src/engine/show-clock.ts'; return (await import(u)).showTime() as number; });
  const before = await clock(page);
  const own = await clock(pres);
  const after = await clock(page);
  expect(own).toBeGreaterThan(before - 100);
  expect(own).toBeLessThan(after + 100);

  // Палец на элементе с наведением: и у зрителей, и на самом пульте (у касания своего наведения нет)
  const obj = (p: typeof page, root: string) => p.locator(`${root} .slide.on > .free`).filter({ hasText: /^Коробка$/ }).first();
  const hovered = (p: typeof page, root: string) => obj(p, root).evaluate((e) => e.classList.contains('rhov') || !!e.querySelector('.rhov'));
  const b = (await obj(pres, '#cur').boundingBox())!;
  const touch = (type: string) => pres.evaluate(([t, x, y]) => {
    document.getElementById('cur')!.dispatchEvent(new PointerEvent(t as string, { pointerType: 'touch', pointerId: 7, isPrimary: true, bubbles: true, clientX: x as number, clientY: y as number, buttons: t === 'pointerup' ? 0 : 1 }));
  }, [type, b.x + b.width / 2, b.y + b.height / 2] as const);
  await touch('pointerdown');
  await expect.poll(() => hovered(pres, '#cur')).toBe(true);
  await expect.poll(() => hovered(page, '')).toBe(true);
  // Палец подняли — наведение уходит и там, и там
  await touch('pointerup');
  await expect.poll(() => hovered(pres, '#cur')).toBe(false);
  await expect.poll(() => hovered(page, '')).toBe(false);
  await pres.close();
  expect(errors).toEqual([]);
  expect(presErrors).toEqual([]);
});

test('небо «Космоса» и фон «Сеть» у зрителей и на пульте: рисуются, без ошибок', async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=space#1');
  await expect(page.locator('.slide.on canvas.sp-cv')).toHaveCount(1);
  const pres = await context.newPage();
  const presErrors = watchErrors(pres);
  await pres.goto('/?deck=space&view=presenter');
  await expect(pres.locator('#cur .slide.on canvas.sp-cv')).toHaveCount(1);
  // На небе что-то нарисовано (звёзды и узлы), и у пульта тоже
  const drawn = (p: typeof page, root: string) => p.locator(`${root} .slide.on canvas.sp-cv`).evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
    return n;
  });
  await expect.poll(() => drawn(page, '')).toBeGreaterThan(20);
  await expect.poll(() => drawn(pres, '#cur')).toBeGreaterThan(20);
  await page.keyboard.press('PageDown');
  await expect(page.locator('.slide.on .bd-live canvas, .slide.on canvas')).not.toHaveCount(0);
  await expect(pres.locator('#cur .slide.on canvas')).not.toHaveCount(0);
  await pres.close();
  expect(errors).toEqual([]);
  expect(presErrors).toEqual([]);
});

test('все анимированные фоны собираются: у каждого шейдер компилируется и сцена живая', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl#1');
  await expect(page.locator('.slide.on')).toHaveCount(1);
  const dead = await page.evaluate(async () => {
    const { BACKDROPS, previewBackdrop } = await import('/src/components/backdrop/backdrop.ts');
    const stage = document.querySelector<HTMLElement>('.stage')!;
    const out: string[] = [];
    for (const [kind] of BACKDROPS) {
      previewBackdrop(stage, kind);
      if (!stage.querySelector('.bd-trial.bd-live canvas')) out.push(kind);
    }
    previewBackdrop(stage, null);
    return out;
  });
  expect(dead).toEqual([]);
  expect(errors).toEqual([]);
});

test('фон «Сеть» отвечает на мышь: у курсора светится точка — у зрителей и от мыши докладчика; щелчок без ошибок', async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=space#2');
  await expect(page.locator('.slide.on .backdrop.bd-live canvas')).toHaveCount(1);
  // Слайд встал на место (переход закончился): иначе доли слайда — не там, где он будет
  const settled = async (p: typeof page, root: string) => {
    let was = '';
    await expect.poll(async () => { const b = JSON.stringify(await p.locator(`${root} .slide.on`).boundingBox()); const same = b === was; was = b; return same; }).toBe(true);
  };
  // Пиксель экрана в доле (fx, fy) слайда: точка курсора — цвета акцента, фон слайда почти белый
  const tinted = async (p: typeof page, root: string, fx: number, fy: number) => {
    const b = (await p.locator(`${root} .slide.on`).boundingBox())!;
    const x = Math.round(b.x + b.width * fx);
    const y = Math.round(b.y + b.height * fy);
    const png = await p.screenshot({ clip: { x: x - 1, y: y - 1, width: 3, height: 3 } });
    return { x, y, blue: await p.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = new OffscreenCanvas(3, 3).getContext('2d')!;
      c.drawImage(img, 0, 0);
      const [r, , b] = c.getImageData(1, 1, 1, 1).data;
      return b - r;
    }, `data:image/png;base64,${png.toString('base64')}`) };
  };
  await settled(page, '');
  const at = await tinted(page, '', 0.62, 0.55);
  await page.mouse.move(at.x, at.y);
  await expect.poll(async () => (await tinted(page, '', 0.62, 0.55)).blue).toBeGreaterThan(40);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(300);
  await expect(page.locator('.slide.on .backdrop.bd-live canvas')).toHaveCount(1);

  // Мышь докладчика на его слайде — точка у зрителей там же
  await page.mouse.move(2, 2);
  const pres = await context.newPage();
  await pres.goto('/?deck=space&view=presenter');
  await expect(pres.locator('#cur .slide.on')).toHaveCount(1);
  await expect(page.locator('#ct')).toHaveText(/^2 из/);
  await expect(pres.locator('#cur .slide.on .backdrop.bd-live canvas')).toHaveCount(1);
  // Стрелку докладчика у зрителей прячем (K): иначе она закроет точку
  await pres.keyboard.press('k');
  await settled(pres, '#cur');
  const pb = (await pres.locator('#cur .slide.on').boundingBox())!;
  await pres.mouse.move(pb.x + pb.width * 0.3, pb.y + pb.height * 0.7, { steps: 3 });
  await expect.poll(async () => (await tinted(page, '', 0.3, 0.7)).blue).toBeGreaterThan(40);
  await pres.close();
  expect(errors).toEqual([]);
});

test('галка «Отвечает на мышь и щелчки» у фона слайда: снял — backdropTouch: false, поставил — как у темы', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=space&studio#2');
  await expect(page.locator('#st-canvas .slide.on .backdrop.bd-network')).toHaveCount(1);
  const box = page.locator('input[data-tune="backdropTouch"]');
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect.poll(() => readDeck('space')).toMatch(/backdropTouch: false/);
  await expect(page.locator('input[data-tune="backdropTouch"]')).not.toBeChecked();
  await page.locator('input[data-tune="backdropTouch"]').check();
  await expect.poll(() => readDeck('space')).not.toMatch(/backdropTouch/);
  // У фонов, которые на мышь не отвечают, галки нет
  await page.goto('/?deck=space&studio#1');
  await expect(page.locator('#st-canvas .slide.on')).toHaveCount(1);
  await expect(page.locator('input[data-tune="backdropTouch"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('мышь докладчика у зрителей: стрелка, наведение, указка, прожектор, кнопки, вопросы, вставка — каждое ровно один раз', async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=mirror#1');
  await expect(page.locator('.slide.on')).toHaveCount(1);
  const pres = await context.newPage();
  const presErrors = watchErrors(pres);
  await pres.goto('/?deck=mirror&view=presenter');
  await expect(pres.locator('#cur .slide.on')).toHaveCount(1);
  const obj = (p: typeof page, root: string, t: string) => p.locator(`${root} .slide.on > .free`).filter({ hasText: new RegExp(`^${t}$`) }).first();
  const hoverAt = async (t: string) => { const b = (await obj(pres, '#cur', t).boundingBox())!; await pres.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 }); };
  const arrow = () => page.evaluate(() => !!document.querySelector('.ink-cur.on'));
  const hovered = (t: string) => obj(page, '', t).evaluate((e) => e.classList.contains('rhov') || !!e.querySelector('.rhov'));
  const spot = (p: typeof page, root = '') => p.evaluate((r) => !!document.querySelector(`${r} .slide.on > .spot-frame`), root);

  // Стрелка и наведение — там, где мышь докладчика; ушла со слайда (на «следующий») — нет ни того, ни другого
  await hoverAt('Коробка');
  await expect.poll(arrow).toBe(true);
  await expect.poll(() => hovered('Коробка')).toBe(true);
  const nb = (await pres.locator('#next').boundingBox())!;
  await pres.mouse.move(nb.x + 20, nb.y + 20, { steps: 3 });
  await expect.poll(arrow).toBe(false);
  await expect.poll(() => hovered('Коробка')).toBe(false);
  // K — стрелки не видно, наведение остаётся
  await pres.keyboard.press('k');
  await hoverAt('Коробка');
  await expect.poll(() => hovered('Коробка')).toBe(true);
  expect(await arrow()).toBe(false);
  await pres.keyboard.press('k');
  // Указка: точка вместо стрелки
  await pres.keyboard.press('l');
  await hoverAt('Карточка');
  await expect.poll(() => page.evaluate(() => !!document.querySelector('.ink-dot.on'))).toBe(true);
  expect(await arrow()).toBe(false);
  await pres.keyboard.press('l');
  await expect.poll(() => page.evaluate(() => !!document.querySelector('.ink-dot.on'))).toBe(false);

  // Прожектор: щелчок докладчика включает его в обоих окнах, второй — снимает (повтор щелчка у зрителей его не переключает)
  await obj(pres, '#cur', 'Карточка').click();
  await expect.poll(() => spot(page)).toBe(true);
  await pres.waitForTimeout(600);
  expect(await spot(page)).toBe(true);
  expect(await spot(pres, '#cur')).toBe(true);
  await obj(pres, '#cur', 'Карточка').click();
  await expect.poll(() => spot(page)).toBe(false);
  expect(await spot(pres, '#cur')).toBe(false);
  // Кнопки: переключатель — ровно один раз; «показать» — показывает
  await obj(pres, '#cur', 'Переключить').click();
  await expect(obj(page, '', 'Коробка')).toHaveClass(/trig-hid/);
  await pres.waitForTimeout(500);
  await expect(obj(page, '', 'Коробка')).toHaveClass(/trig-hid/);
  await expect(obj(pres, '#cur', 'Коробка')).toHaveClass(/trig-hid/);
  await obj(pres, '#cur', 'Показать').click();
  await expect(obj(page, '', 'Подсказка')).not.toHaveClass(/trig-hid/);
  // Ссылка открывается только у докладчика, не на проекторе
  const opened: string[] = [];
  context.on('page', (p) => opened.push(p.url()));
  await obj(pres, '#cur', 'Сайт').click();
  await pres.waitForTimeout(800);
  expect(opened).toHaveLength(1);
  // «Дальше» — на один слайд, не на два; мышь стоит — наведение на новом слайде сразу
  await hoverAt('Дальше');
  await obj(pres, '#cur', 'Дальше').click();
  await expect(page).toHaveURL(/#2$/);
  await pres.waitForTimeout(500);
  await expect(page).toHaveURL(/#2$/);
  await hoverAt('Второй');
  await pres.keyboard.press('ArrowLeft');
  await pres.keyboard.press('ArrowRight');
  await expect.poll(() => hovered('Второй')).toBe(true);
  // Вопрос раскрывается в обоих окнах
  await pres.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/#3$/);
  await pres.locator('#cur .slide.on .fq-q').first().click();
  await expect(page.locator('.slide.on .fq-item.open')).toHaveCount(1);
  await expect(pres.locator('#cur .slide.on .fq-item.open')).toHaveCount(1);
  // Вставка: движения доходят в обоих окнах, щелчок по её кнопке — ровно один раз
  await pres.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/#4$/);
  const frame = pres.locator('#cur .slide.on .embed.interactive > iframe.on');
  await expect(frame).toHaveCount(1);
  await expect(page.locator('.slide.on .embed.interactive > iframe.on')).toHaveCount(1);
  const fb = (await frame.boundingBox())!;
  for (let i = 0; i < 6; i++) await pres.mouse.move(fb.x + 50 + i * 10, fb.y + 40, { steps: 2 });
  const showFrame = page.frameLocator('.slide.on iframe').first();
  const presFrame = pres.frameLocator('#cur .slide.on iframe').first();
  await expect.poll(async () => Number(await showFrame.locator('#n').textContent())).toBeGreaterThan(0);
  await expect.poll(async () => Number(await presFrame.locator('#n').textContent())).toBeGreaterThan(0);
  await pres.mouse.click(fb.x + fb.width / 2, fb.y + fb.height * 0.75);
  await expect(showFrame.locator('#b')).toHaveText('1');
  await expect(presFrame.locator('#b')).toHaveText('1');
  // M — повтор выключен: зрители ничего не получают
  await pres.keyboard.press('m');
  await expect.poll(arrow).toBe(false);
  const was = await showFrame.locator('#n').textContent();
  for (let i = 0; i < 5; i++) await pres.mouse.move(fb.x + 300 + i * 10, fb.y + 60, { steps: 2 });
  await pres.waitForTimeout(400);
  expect(await showFrame.locator('#n').textContent()).toBe(was);
  expect(await arrow()).toBe(false);
  await pres.keyboard.press('m');
  expect(errors).toEqual([]);
  expect(presErrors).toEqual([]);
});

test('анимация объектов: по словам и прорисовка готовятся при показе, наплыв камеры идёт, маркер ждёт своего щелчка', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx#1');
  const objs = page.locator('.slide.on > .free');
  // По словам: четыре слова — четыре части, у каждой своя задержка
  await expect(objs.nth(0).locator('.fx-w')).toHaveCount(4);
  await expect(objs.nth(0)).toHaveClass(/fx-ready/);
  const delays = await objs.nth(0).locator('.fx-w').evaluateAll((ws) => ws.map((w) => w.getAnimations()[0]?.effect?.getComputedTiming().delay));
  expect(delays).toEqual([0, 85, 170, 255]);
  // Шторка: обрезка только на время анимации
  expect(await objs.nth(1).evaluate((o) => o.getAnimations()[0]?.animationName)).toBe('fx-wipe');
  // Прорисовка: стрелка растёт, у контура — обводка поверх
  await expect(objs.nth(2)).toHaveClass(/fx-ready/);
  expect(await objs.nth(2).locator('.shape-bar').evaluate((b) => b.getAnimations()[0]?.animationName)).toBe('fx-bar');
  await expect(objs.nth(3).locator('svg.fx-ol')).toHaveCount(1);
  // Наплыв камеры — у фото, пока слайд на экране
  expect(await objs.nth(4).locator('img').evaluate((i) => i.getAnimations()[0]?.animationName)).toBe('cam-in');
  // Маркер у объекта с выделением «Маркер»: ждёт; щелчок — проводится, слайд тот же
  const mark = objs.nth(5).locator('mark.md-m');
  expect(await mark.evaluate((m) => m.getAnimations()[0]?.animationName)).toBe('mk-hold');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#ct')).toHaveText(/^1 из/);
  await expect.poll(() => mark.evaluate((m) => m.getAnimations()[0]?.animationName)).toBe('mk-draw2');
  // Ушли со слайда — разметка как в данных
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#ct')).toHaveText(/^2 из/);
  await page.keyboard.press('Home');
  await expect(page.locator('#ct')).toHaveText(/^1 из/);
  expect(errors).toEqual([]);
});

test('очередь щелчков: появление, исчезновение и выделение одного объекта — на своих местах; назад — как было', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx#2');
  const [a, b, c] = [0, 1, 2].map((k) => page.locator('.slide.on > .free').nth(k));
  const seen = async () => (await Promise.all([a, b, c].map((o) => o.evaluate((e) => Number(getComputedStyle(e).opacity) > 0.5 && !e.classList.contains('click-hid'))))).map((v) => (v ? 1 : 0)).join('');
  // Сначала A и B ждут щелчка, C видна
  await expect.poll(seen).toBe('001');
  await page.keyboard.press('ArrowRight'); // 1: A появляется
  await expect.poll(seen).toBe('101');
  await page.keyboard.press('ArrowRight'); // 2: B появляется
  await expect.poll(seen).toBe('111');
  await page.keyboard.press('ArrowRight'); // 3: A исчезает своим эффектом
  await expect(a).toHaveClass(/click-out/);
  await expect.poll(seen).toBe('011');
  await page.keyboard.press('ArrowRight'); // 4: B светится
  await expect(b).toHaveClass(/trig-play/);
  expect(await b.evaluate((e) => e.getAnimations()[0]?.animationName)).toBe('emph-glow');
  await page.keyboard.press('ArrowRight'); // 5: C уходит влево
  await expect.poll(seen).toBe('010');
  // Назад: шаг за шагом обратно, без анимации
  await page.keyboard.press('ArrowLeft');
  await expect.poll(seen).toBe('011');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(seen).toBe('111');
  await expect(page.locator('#ct')).toHaveText(/^2 из/);
  expect(errors).toEqual([]);
});

test('бегущая строка, текст по кругу и одометр: строка едет без конца, круг вращается, цифры барабаном встают на число', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx#4');
  const mq = page.locator('.slide.on .marquee').first();
  // Две одинаковые половины дорожки, каждая шире строки; вторая — только для глаз
  expect(await mq.evaluate((m) => {
    const runs = [...m.querySelectorAll<HTMLElement>('.mq-run')];
    return { runs: runs.length, hidden: runs[1].getAttribute('aria-hidden'), same: runs[0].textContent === runs[1].textContent, wide: runs[0].offsetWidth > m.clientWidth };
  })).toEqual({ runs: 2, hidden: 'true', same: true, wide: true });
  // Пустой пункт пропущен, правка на месте — у пунктов первой копии, с их номерами в данных
  const edits = await mq.locator('[data-edit]').evaluateAll((els) => els.map((e) => JSON.parse(e.getAttribute('data-edit')!).at(-1)));
  expect(edits).toEqual([0, 1, 3]);
  // Едет: сдвиг дорожки меняется; вторая строка — в другую сторону
  const shift = (k: number) => page.locator('.slide.on .mq-track').nth(k).evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  const a = await shift(0);
  await page.waitForTimeout(400);
  expect(await shift(0)).toBeLessThan(a);
  expect(await page.locator('.slide.on .mq-track').nth(1).evaluate((e) => getComputedStyle(e).animationDirection)).toBe('reverse');
  // Текст по кругу: буква на каждый знак, разделитель на стыке добавлен; круг вращается
  const ring = page.locator('.slide.on .circ-text').first();
  expect(await ring.locator('.ct-text span').count()).toBe([...'Slideria • презентации • '].length);
  await expect(ring.locator('.ct-text')).toHaveAttribute('aria-label', 'Slideria • презентации');
  const turn = () => ring.locator('.ct-text').evaluate((e) => getComputedStyle(e).rotate);
  const r0 = await turn();
  await page.waitForTimeout(300);
  expect(await turn()).not.toBe(r0);
  // Одометр: барабан на каждую цифру, число не переносится; в конце — то же число
  const odo = page.locator('.slide.on .odo');
  await expect(odo).toHaveCount(5);
  expect(await odo.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.d).join(''))).toBe('17234');
  await page.waitForFunction(() => [...document.querySelectorAll('.slide.on .odo-col')].every((c) => c.getAnimations().every((x) => x.playState === 'finished')), null, { timeout: 6000 });
  const drums = await odo.evaluateAll((els) => els.map((e) => {
    const box = e.getBoundingClientRect();
    const col = e.firstElementChild!.getBoundingClientRect();
    // Видна последняя строка барабана — сама цифра
    return Math.abs(col.bottom - box.bottom) < 1.5 && e.firstElementChild!.textContent!.trim().endsWith((e as HTMLElement).dataset.d!);
  }));
  expect(drums).toEqual([true, true, true, true, true]);
  expect(await page.locator('.slide.on .odo-num').evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('nowrap');
  // Ушли со слайда — текст снова как в данных
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.odo')).toHaveCount(0);
  expect(await page.locator('.slide').nth(3).locator('p[data-type="text"]').textContent()).toMatch(/^Выручка\s17\s234\s₽$/);
  expect(errors).toEqual([]);
});

test('вместе с предыдущим, по пунктам, стойкое выделение: шаги на своих щелчках, назад — как было', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx#6');
  // Каждый объект: V/H — виден (или ушёл), пункты списка 1/0, * — стойкое выделение держится
  const state = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.slide.on > .free')].slice(0, 5).map((e) => {
    const items = [...e.querySelectorAll('li')].map((l) => (l.classList.contains('item-hid') ? 0 : 1)).join('');
    return `${e.classList.contains('click-hid') || e.classList.contains('click-out') ? 'H' : 'V'}${items}${e.classList.contains('emph-on') ? '*' : ''}`;
  }).join(' '));
  await expect.poll(state).toBe('H H H000 V V');
  const next = async (want: string) => { await page.keyboard.press('ArrowRight'); await expect.poll(state).toBe(want); };
  await next('V V H000 V V'); // K и L — одним щелчком
  await next('V V V100 V V'); // список: первый пункт вместе с ним
  await next('V V V110 V V');
  await next('V V V111 V V');
  await next('V V V111 V* H'); // N приглушается и O уходит одним щелчком
  await expect.poll(() => page.locator('.slide.on > .free').nth(3).evaluate((e) => Number(getComputedStyle(e).opacity))).toBeLessThan(0.5);
  await expect(page.locator('#ct')).toHaveText(/^6 из/);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(state).toBe('V V V111 V V');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(state).toBe('V V V110 V V');
  // Пункты текста без щелчка — по очереди; медленная часовая стрелка — в 1,6 раза дольше
  await page.goto('/?deck=fx#6');
  const delays = await page.locator('.slide.on > .free').nth(5).locator('.md-li').evaluateAll((els) => els.map((e) => getComputedStyle(e).animationDelay));
  expect(delays).toEqual(['0s', '0.28s', '0.56s']);
  expect(await page.locator('.slide.on > .free').nth(6).evaluate((e) => getComputedStyle(e).animationDuration)).toBe('1.44s');
  expect(errors).toEqual([]);
});

test('переходы: открывание, шторка сверху, панорама, круг, часы, вспышка, сдвиг снизу — в середине перехода; потом слайд целиком', async ({ page }) => {
  const errors = watchErrors(page);
  // Середина перехода к слайду i (с i-1): что у сцены, входящего и уходящего слайда
  const mid = async (i: number) => {
    await page.goto(`/?deck=trs#${i - 1}`);
    await expect(page.locator('#ct')).toHaveText(new RegExp(`^${i - 1} из`));
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    return page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('.stage')!;
      const on = stage.querySelector<HTMLElement>(':scope > .slide.on')!;
      const out = stage.querySelector<HTMLElement>(':scope > .slide.out');
      const cs = getComputedStyle(on);
      return {
        tr: stage.dataset.tr, trd: stage.dataset.trd ?? '', clip: cs.clipPath, mask: cs.maskImage || cs.webkitMaskImage,
        onT: new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform), outZ: out ? getComputedStyle(out).zIndex : '',
        outT: out ? new DOMMatrix(getComputedStyle(out).transform === 'none' ? undefined : getComputedStyle(out).transform) : null,
        flash: getComputedStyle(stage, '::after').animationName,
      };
    });
  };
  const uncover = await mid(2);
  expect(uncover.tr).toBe('uncover');
  expect(uncover.outZ).toBe('2');
  expect(uncover.outT!.m41).toBeLessThan(-50); // старый уезжает влево
  const wipe = await mid(3);
  expect([wipe.tr, wipe.trd]).toEqual(['wipe', 'top']);
  expect(wipe.clip).toMatch(/^inset\(0(px|%)? 0(px|%)? [1-9]/); // открыт верх, снизу ещё закрыто
  expect((await mid(4)).clip).toMatch(/^inset\(0(px|%)? [1-9]/);
  expect((await mid(5)).clip).toMatch(/^circle\(/);
  expect((await mid(6)).mask).toMatch(/conic-gradient/);
  expect((await mid(7)).flash).toBe('tr-flash');
  const push = await mid(8);
  expect(push.trd).toBe('bottom');
  expect(push.onT.m42).toBeGreaterThan(50); // новый идёт снизу
  expect(push.outT!.m42).toBeLessThan(-50);
  // Переход кончился — у сцены нет перехода и направления, слайд целиком
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.stage')!;
    return `${stage.dataset.tr ?? ''}|${stage.dataset.trd ?? ''}|${getComputedStyle(stage.querySelector(':scope > .slide.on')!).clipPath}`;
  })).toBe('||none');
  expect(errors).toEqual([]);
});

test('объёмные переходы: куб, отражение, галерея, взмах, двери, падение — в перспективе; створки дверей потом убраны', async ({ page }) => {
  const errors = watchErrors(page);
  const mid = async (i: number) => {
    await page.goto(`/?deck=trs#${i - 1}`);
    await expect(page.locator('#ct')).toHaveText(new RegExp(`^${i - 1} из`));
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    return page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('.stage')!;
      const on = stage.querySelector<HTMLElement>(':scope > .slide.on')!;
      const out = stage.querySelector<HTMLElement>(':scope > .slide.out');
      return {
        tr: stage.dataset.tr, trd: stage.dataset.trd ?? '', persp: getComputedStyle(stage).perspective,
        on: getComputedStyle(on).transform, out: out ? getComputedStyle(out).transform : '', outZ: out ? getComputedStyle(out).zIndex : '',
        doors: stage.querySelectorAll(':scope > .slide.door').length,
      };
    });
  };
  const cube = await mid(9);
  expect([cube.tr, cube.trd, cube.persp]).toEqual(['cube', 'right', '1800px']);
  expect(cube.on).toMatch(/^matrix3d/);
  expect(cube.out).toMatch(/^matrix3d/);
  expect((await mid(10)).trd).toBe('top');
  expect((await mid(11)).out).toMatch(/^matrix3d/);
  expect((await mid(12)).on).toMatch(/^matrix3d/);
  expect((await mid(13)).doors).toBe(2);
  const fall = await mid(14);
  expect([fall.outZ, fall.on]).toEqual(['2', 'none']);
  await page.waitForTimeout(800);
  expect(await page.locator('.stage > .slide.door').count()).toBe(0);
  expect(errors).toEqual([]);
});
