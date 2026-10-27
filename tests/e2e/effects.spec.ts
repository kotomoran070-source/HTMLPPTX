// Эффекты фигур и рисунков: готовые — на ленте, ручки выбранного — в «Свойствах»
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
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
