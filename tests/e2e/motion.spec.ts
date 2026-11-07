// Движение интерфейса (вариант «Мягко», engine/motion.ts): меню появляется и гаснет призраком, которого не
// видно поиску элементов и мыши; полоска под вкладкой переезжает; тема меняется растворением;
// «Уменьшить движение» — всё сразу
import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

/** Призраки уходящих меню и окон: элементы в body с закрытым теневым деревом */
const ghosts = (page: import('@playwright/test').Page) => page.evaluate(() => [...document.body.children].filter((e) => e.matches('div[aria-hidden="true"][inert]') && !e.shadowRoot).length);

test('меню появляется от кнопки и гаснет призраком: сразу после закрытия его нет ни для поиска, ни для мыши', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx&studio');
  const menu = page.locator('.st-menu');
  await page.locator('[data-cmd="file.export"]').first().click();
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((m) => getComputedStyle(m).animationName)).toBe('ui-in');
  await page.keyboard.press('Escape');
  // Меню уже убрано, а его призрак ещё гаснет — и ничего не перекрывает
  await expect(menu).toHaveCount(0, { timeout: 50 });
  expect(await ghosts(page)).toBe(1);
  await expect.poll(() => ghosts(page), { timeout: 1000 }).toBe(0);
  // Открыть снова сразу после закрытия — одно меню
  await page.locator('[data-cmd="file.export"]').first().click();
  await page.keyboard.press('Escape');
  await page.locator('[data-cmd="file.export"]').first().click();
  await expect(menu).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('полоска под вкладкой переезжает к выбранной; тема — растворением; «Уменьшить движение» — сразу', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=fx&studio');
  const ink = page.locator('.st-tabs .st-ink');
  const under = (tab: string) => page.evaluate((t) => {
    const b = document.querySelector<HTMLElement>(`.st-tabs [data-tab="${t}"]`)!;
    const i = document.querySelector<HTMLElement>('.st-tabs .st-ink')!;
    const a = b.getBoundingClientRect();
    const r = i.getBoundingClientRect();
    return Math.abs(a.left - r.left) < 1 && Math.abs(a.width - r.width) < 1;
  }, tab);
  await expect(ink).toHaveCount(1);
  await expect.poll(() => under('home')).toBe(true);
  await page.locator('.st-tabs [data-tab="insert"]').click();
  // В пути — ещё не под «Вставкой», потом — точно под ней
  expect(await under('insert')).toBe(false);
  await expect.poll(() => under('insert')).toBe(true);
  await expect(ink).not.toHaveClass(/off/);

  // Тема интерфейса: растворение через переход страницы, на время перехода — класс ui-vt
  const was = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const seen = page.evaluate(() => new Promise<boolean>((done) => {
    const mo = new MutationObserver(() => { if (document.documentElement.classList.contains('ui-vt')) { mo.disconnect(); done(true); } });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    setTimeout(() => done(false), 2000);
  }));
  await page.locator('#st-theme').click();
  expect(await seen).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).not.toBe(was);
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('ui-vt'))).toBe(false);

  // «Уменьшить движение»: меню закрывается без призрака, полоска встаёт сразу
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-cmd="file.export"]').first().click();
  await page.keyboard.press('Escape');
  expect(await ghosts(page)).toBe(0);
  await page.locator('.st-tabs [data-tab="view"]').click();
  await expect.poll(() => under('view'), { timeout: 100 }).toBe(true);
  expect(errors).toEqual([]);
});
