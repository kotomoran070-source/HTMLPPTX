// Правки агента (команды сервера outline и apply, src/engine/ops.ts) при открытой студии: студия подхватывает их
// сама, а Ctrl+Z в ней откатывает только свои правки — и когда оба правили один слайд
import { expect, test } from '@playwright/test';
import { readDeck, watchErrors } from './helpers';

test.use({ colorScheme: 'light' });

const call = async (cmd: string, body?: unknown) => {
  const r = await fetch(`http://localhost:5190/__htmlpptx/${cmd}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};

test('агент правит текст при открытой студии: студия подхватывает, Ctrl+Z откатывает свой сдвиг, но не правку агента', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=agent&studio#1');
  const slide = page.locator('#st-canvas .slide.on');
  await expect(slide).toContainText('Текст для агента');
  // Своя правка в студии: фигуру — на 10 px вправо
  await slide.locator('.free').nth(1).click();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => readDeck('agent')).toContain('x: 650');

  // Агент читает краткое содержание и правит текст с ревизией слайда
  const o = await call('outline?deck=agent');
  expect(o.data.slides[0].objects.map((x: { type: string }) => x.type)).toEqual(['text', 'shape']);
  const r = await call('apply?deck=agent', {
    ops: [{ op: 'object.set', slide: 'one', object: 1, set: { text: 'Правка агента' } }],
    expect: [{ slide: 1, rev: o.data.slides[0].rev }],
  });
  expect(r.status).toBe(200);
  expect(r.data.changes).toEqual(['Правка объекта · слайд 1']);
  // Студия подхватывает правку сама
  await expect(slide).toContainText('Правка агента');

  // Ctrl+Z: фигура возвращается, правка агента остаётся — и на холсте, и в файле
  await slide.locator('.free').nth(1).click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => readDeck('agent')).toContain('x: 640');
  expect(readDeck('agent')).toContain('Правка агента');
  await expect(slide).toContainText('Правка агента');

  // Ревизия устарела (слайд с тех пор менялся) — отказ, файл не тронут
  const stale = await call('apply?deck=agent', { ops: [{ op: 'object.remove', slide: 1, object: 1 }], expect: [{ slide: 1, rev: o.data.slides[0].rev }] });
  expect(stale.status).toBe(400);
  expect(stale.data.error).toContain('изменился');
  expect(readDeck('agent')).toContain('Правка агента');
  expect(errors).toEqual([]);
});
