// Эффекты фигур и рисунков: готовые — на ленте, ручки выбранного — в «Свойствах»
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import JSZip from 'jszip';
import { DECKS, deckFile, watchErrors } from './helpers';

test('фигура и рисунок: тень и свечение с ленты, подкрутка в «Свойствах», готовая тень сбрасывает подкрутку, «×» убирает', async ({ page }) => {
  const errors = watchErrors(page);
  const dir = path.join(DECKS, 'fxbox');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(DECKS, 'fx', 'assets', 'shot.webp'), path.join(dir, 'assets', 'shot.webp'));
  fs.writeFileSync(path.join(dir, 'deck.yaml'), `title: Эффекты
slides:
  - template: canvas
    free:
      - {type: shape, kind: round, fill: soft, text: "Фигура", place: {x: 80, y: 80, w: 300, h: 160}}
      - {type: image, src: ./assets/shot.webp, place: {x: 520, y: 80, w: 420, h: 300}}
`);
  const yaml = () => fs.readFileSync(deckFile('fxbox'), 'utf8');
  try {
    await page.goto('/?deck=fxbox&studio#1');
    const blocks = page.locator('#st-canvas .slide.on [data-block]');
    const shape = blocks.nth(0);
    await shape.click({ position: { x: 12, y: 12 } });
    // Эффектов нет — нет и раздела
    await expect(page.locator('.st-p-sec.st-fx')).toHaveCount(0);
    await page.locator('.st-tabs [data-tab="shape"]').click();
    await page.locator('.st-ribbon [data-cmd="shape.shadow"]').click();
    await page.locator('.st-lkpop [data-lk][title="Заметная"]').click();
    const card = page.locator('.st-fx-card[data-fxk="shadow"]');
    // Без подписи готового варианта: подкрутили — он уже не «Заметная»
    await expect(card.locator('header small')).toHaveCount(0);
    await expect(card.locator('[data-fx="shadowBlur"]')).toHaveValue('28');
    await expect(page.locator('.st-fx h3')).toHaveText('Эффекты фигуры');
    await card.locator('[data-fx="shadowDist"]').fill('30');
    await expect.poll(yaml).toMatch(/shadowDist: 30/);
    await card.locator('[data-fxc="shadowColor"][data-v="accent"]').click();
    await expect.poll(yaml).toMatch(/shadowColor: accent/);
    // Подкрученная тень на ленте не отмечается готовой; готовая с ленты — с чистого листа
    await page.locator('.st-ribbon [data-cmd="shape.shadow"]').click();
    await expect(page.locator('.st-lkpop [data-lk][title="Заметная"]')).not.toHaveClass(/\bon\b/);
    await page.locator('.st-lkpop [data-lk][title="Глубокая"]').click();
    await expect.poll(yaml).toMatch(/shadow: lg/);
    expect(yaml()).not.toMatch(/shadowDist|shadowColor/);
    await expect(card.locator('[data-fx="shadowBlur"]')).toHaveValue('50');
    await page.locator('.st-ribbon [data-cmd="shape.shadow"]').click();
    await expect(page.locator('.st-lkpop [data-lk][title="Глубокая"]')).toHaveClass(/\bon\b/);
    await page.keyboard.press('Escape');

    // «Прозрачность» — как в PowerPoint: 0 % — видна полностью; пишется непрозрачность
    await page.locator('.st-ribbon [data-cmd="shape.opacity"]').click();
    await expect(page.locator('.st-lkpop [data-lk][title="0 %"]')).toHaveClass(/\bon\b/);
    await page.locator('.st-lkpop [data-lk][title="40 %"]').click();
    await expect.poll(yaml).toMatch(/opacity: 0.6/);
    await page.locator('.st-ribbon [data-cmd="shape.opacity"]').click();
    await expect(page.locator('.st-lkpop [data-lkr]')).toHaveValue('40');
    await page.keyboard.press('Escape');

    // Свечение: наведение примеряет на фигуре, щелчок — пишет, ручки — в «Свойствах»
    const box = () => shape.evaluate((e) => getComputedStyle(e.matches('.shape') ? e : e.querySelector('.shape')!).boxShadow);
    await page.locator('.st-ribbon [data-cmd="shape.glow"]').click();
    await page.locator('.st-lkpop [data-lk][title="Розовое"]').hover();
    await expect.poll(box).toContain('rgba(244, 114, 182, 0.7)');
    expect(yaml()).not.toMatch(/glow/);
    await page.locator('.st-lkpop [data-lk][title="Розовое"]').click();
    await expect.poll(yaml).toMatch(/glow: "#F472B6"/);
    const glow = page.locator('.st-fx-card[data-fxk="glow"]');
    await glow.locator('[data-fx="glowSize"]').fill('30');
    await expect.poll(yaml).toMatch(/glowSize: 30/);
    await expect.poll(box).toContain('0px 0px 30px 9px');
    await glow.locator('[data-fxoff="glow"]').click();
    await expect.poll(yaml).not.toMatch(/glow/);
    await expect(glow).toHaveCount(0);

    // Рисунок: паспарту с ленты, цвет — в «Свойствах»; Ctrl+Z — шагом
    await blocks.nth(1).click({ position: { x: 20, y: 20 } });
    await page.locator('.st-tabs [data-tab="image"]').click();
    await page.locator('.st-ribbon [data-cmd="image.mat"]').click();
    await page.locator('.st-lkpop [data-lk][title="Среднее"]').click();
    const mat = page.locator('.st-fx-card[data-fxk="mat"]');
    await expect(page.locator('.st-fx h3')).toHaveText('Эффекты рисунка');
    await mat.locator('[data-fxc="matColor"][data-v="#F5F0E6"]').click();
    await expect.poll(yaml).toMatch(/matColor: "#F5F0E6"/);
    await expect(blocks.nth(1).locator('.imgbox')).toHaveCSS('background-color', 'rgb(245, 240, 230)');
    await page.keyboard.press('Control+z');
    await expect.poll(yaml).not.toMatch(/matColor/);
    expect(yaml()).toMatch(/mat: 12/);
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('фигуру PowerPoint тянут за угол: контур под новый размер уже на ходу, не толстеет и не уходит внутрь', async ({ page }) => {
  const errors = watchErrors(page);
  const dir = path.join(DECKS, 'fxdia');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'deck.yaml'), `title: Ромб
slides:
  - template: canvas
    free:
      - {type: shape, kind: diamond, fill: soft, stroke: accent, width: 6, place: {x: 200, y: 150, w: 100, h: 100}}
`);
  try {
    await page.goto('/?deck=fxdia&studio#1');
    const obj = page.locator('#st-canvas .slide.on .free').first();
    const b = (await obj.boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    const h = (await page.locator('#ed-frame .h-se').boundingBox())!;
    await page.mouse.move(h.x + 4, h.y + 4);
    await page.mouse.down();
    await page.mouse.move(h.x + 80, h.y + 160, { steps: 8 });
    // Маска контура — по текущей ширине объекта (запас под контур — 13 px с каждой стороны), а не по старой
    const fit = () => obj.evaluate((el) => {
      const o = el.querySelector<HTMLElement>('.shape-o')!;
      const vb = /viewBox%3D%22([^%]+)%20([^%]+)%20([^%]+)%20/.exec(o.style.getPropertyValue('--m'));
      return Math.abs(Number(vb?.[3]) - (el.offsetWidth + 26)) <= 1;
    });
    await expect.poll(fit).toBe(true);
    await page.mouse.up();
    await expect.poll(fit).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('сжатие за край: фигура и картинка — не меньше 20 px (картинка — в своих пропорциях), текст блока не обрезается', async ({ page }) => {
  const errors = watchErrors(page);
  const dir = path.join(DECKS, 'fxmin');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(DECKS, 'fx', 'assets', 'shot.webp'), path.join(dir, 'assets', 'shot.webp'));
  fs.writeFileSync(path.join(dir, 'deck.yaml'), `title: Минимум
slides:
  - template: canvas
    free:
      - {type: shape, kind: diamond, fill: accent, place: {x: 100, y: 100, w: 300, h: 160}}
      - {type: image, src: ./assets/shot.webp, place: {x: 600, y: 100, w: 400, h: 225}}
      - type: faq
        items: [{title: "Нужен ли интернет?", text: "Нет: презентация — один файл."}, {title: "Можно открыть в PowerPoint?", text: "Да, через экспорт в PPTX."}]
        place: {x: 100, y: 380, w: 700, h: 260}
`);
  const place = (k: number) => parse(fs.readFileSync(deckFile('fxmin'), 'utf8')).slides[0].free[k].place;
  try {
    await page.goto('/?deck=fxmin&studio#1');
    const drag = async (k: number, hd: string, dx: number, dy: number) => {
      const b = (await page.locator('#st-canvas .slide.on .free').nth(k).boundingBox())!;
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      const h = (await page.locator(`#ed-frame .h-${hd}`).boundingBox())!;
      await page.mouse.move(h.x + 4, h.y + 4);
      await page.mouse.down();
      await page.mouse.move(h.x + 4 + dx, h.y + 4 + dy, { steps: 10 });
      await page.mouse.up();
    };
    // Фигура — угол за противоположный край: 20 × 20, средние ручки у маленькой рамки спрятаны
    await drag(0, 'se', -800, -600);
    await expect.poll(() => place(0)).toMatchObject({ w: 20, h: 20 });
    await expect(page.locator('#ed-frame')).toHaveClass(/slim-w/);
    await expect(page.locator('#ed-frame .h-n')).toBeHidden();
    await expect(page.locator('#ed-frame .h-se')).toBeVisible();
    // Картинка: пропорции сохраняются и у минимума
    await drag(1, 'se', -800, -600);
    await expect.poll(() => place(1).h).toBe(20);
    expect(place(1).w).toBe(36);
    // Блок с текстом: снизу вверх — рамка останавливается там, где текст ещё виден целиком
    await drag(2, 's', 0, -500);
    await expect.poll(() => place(2).h).toBeLessThan(260);
    const clipped = await page.locator('#st-canvas .slide.on .free').nth(2).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return [...el.querySelectorAll('b, span, p, div')].filter((x) => x.childElementCount === 0 && x.textContent!.trim())
        .some((x) => x.getBoundingClientRect().bottom > r.bottom + 1.5);
    });
    expect(clipped).toBe(false);
    // Поле «Высота» в «Свойствах» — то же правило
    await page.locator('.st-props input[data-f="h"]').fill('20');
    await page.locator('.st-props input[data-f="h"]').press('Enter');
    await expect.poll(() => place(2).h).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('рисунок по фигуре: «Форма» обрезает снимок и сразу включает «Кадр» — снимок целиком, углы — масштаб; тень — снаружи формы; «Без формы» и «Сбросить» убирают', async ({ page }) => {
  const errors = watchErrors(page);
  const dir = path.join(DECKS, 'fxcrop');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(DECKS, 'fx', 'assets', 'shot.webp'), path.join(dir, 'assets', 'shot.webp'));
  fs.writeFileSync(path.join(dir, 'deck.yaml'), `title: Форма
slides:
  - template: canvas
    free:
      - {type: image, src: ./assets/shot.webp, shadow: md, place: {x: 200, y: 120, w: 400, h: 300}}
`);
  const yaml = () => fs.readFileSync(deckFile('fxcrop'), 'utf8');
  try {
    await page.goto('/?deck=fxcrop&studio#1');
    const obj = page.locator('#st-canvas .slide.on .free').first();
    const b = (await obj.boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.locator('.st-tabs [data-tab="image"]').click();
    await page.locator('.st-ribbon [data-cmd="image.shape"]').click();
    await page.locator('.st-lkpop [data-lk][title="Сердце"]').click();
    await expect.poll(yaml).toMatch(/crop: heart/);
    // Сразу «Кадр»: снимок целиком вокруг формы, контур формы; угол снимка — масштаб
    await expect(page.locator('#ed-ghost')).toBeVisible();
    await expect(page.locator('#ed-ghost-o')).toBeVisible();
    const c = (await page.locator('#ed-ghost [data-c="se"]').boundingBox())!;
    await page.mouse.move(c.x + 7, c.y + 7);
    await page.mouse.down();
    await page.mouse.move(c.x + 80, c.y + 60, { steps: 6 });
    await page.mouse.up();
    await expect.poll(yaml).toMatch(/zoom: 1\.\d+/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#ed-ghost')).toBeHidden();
    const box = obj.locator('.imgbox');
    await expect(box).toHaveClass(/img-crop/);
    expect(await box.evaluate((e) => getComputedStyle(e).webkitMaskImage || getComputedStyle(e).maskImage)).toContain('svg');
    // Тень — фильтром обёртки: маска её не срезает
    expect(await obj.locator('.imgfit').evaluate((e) => getComputedStyle(e).filter)).toContain('drop-shadow');
    await page.locator('.st-ribbon [data-cmd="image.shape"]').click();
    await page.locator('.st-lkpop [data-lk][title="Без формы"]').click();
    await expect.poll(yaml).not.toMatch(/crop:/);
    await expect(box).not.toHaveClass(/img-crop/);
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('жёлтые ручки формы: у звезды — глубина лучей, у снимка в форме стрелки — толщина и остриё; в PowerPoint — регулировки фигуры', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const dir = path.join(DECKS, 'fxadj');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(DECKS, 'fx', 'assets', 'shot.webp'), path.join(dir, 'assets', 'shot.webp'));
  fs.writeFileSync(path.join(dir, 'deck.yaml'), `title: Ручки
slides:
  - template: canvas
    free:
      - {type: shape, kind: star, fill: accent, place: {x: 80, y: 120, w: 360, h: 340}}
      - {type: image, src: ./assets/shot.webp, crop: block-arrow, place: {x: 560, y: 160, w: 600, h: 300}}
`);
  const free = () => parse(fs.readFileSync(deckFile('fxadj'), 'utf8')).slides[0].free;
  try {
    await page.goto('/?deck=fxadj&studio#1');
    const drag = async (k: number, dx: number, dy: number) => {
      const b = (await page.locator('#st-canvas .slide.on .free').nth(k).boundingBox())!;
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      const h = (await page.locator('#ed-frame .h-adj').last().boundingBox())!;
      await page.mouse.move(h.x + 6, h.y + 6);
      await page.mouse.down();
      await page.mouse.move(h.x + 6 + dx, h.y + 6 + dy, { steps: 6 });
      await page.mouse.up();
    };
    // Звезда: одна ручка; вверх — лучи толще
    const star = page.locator('#st-canvas .slide.on .free').first();
    await star.click({ position: { x: 180, y: 200 } });
    await expect(page.locator('#ed-frame .h-adj')).toHaveCount(1);
    const before = await star.locator('.shape-f').evaluate((e) => e.style.cssText);
    await drag(0, 0, -25);
    await expect.poll(() => free()[0].adj?.adj ?? 0).toBeGreaterThan(19098);
    expect(await star.locator('.shape-f').evaluate((e) => e.style.cssText)).not.toBe(before);
    // Снимок в форме стрелки: две ручки; остриё длиннее
    await drag(1, -100, 0);
    await expect(page.locator('#ed-frame .h-adj')).toHaveCount(2);
    await expect.poll(() => free()[1].adj?.adj2 ?? 0).toBeGreaterThan(60000);
    // Другая форма — регулировки сбрасываются
    await page.locator('.st-tabs [data-tab="image"]').click();
    await page.locator('.st-ribbon [data-cmd="image.shape"]').click();
    await page.locator('.st-lkpop [data-lk][title="Шеврон"]').click();
    await expect.poll(() => free()[1].adj).toBeUndefined();
    await page.keyboard.press('Escape');
    // PowerPoint: звезда — родной фигурой с регулировкой
    await page.locator('[data-cmd="file.export"]').first().click();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90_000 }), page.locator('[data-x="pptx"]').click()]);
    const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toMatch(/<a:prstGeom prst="star5"><a:avLst><a:gd name="adj" fmla="val \d+"\/><\/a:avLst>/);
    expect(xml).not.toContain('slideria-adj');
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
