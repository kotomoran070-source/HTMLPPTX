// Размер слайда (src/engine/slide-resize.ts, deck.size): высота та же, ширина своя; свободные объекты встают
// по краям, центру и группами, на всю ширину — тянутся; «Уместить» уменьшает композицию тесного слайда целиком.
// Операции агентов deck.size и deck.set { size }, размер в кратком содержании
import { expect, test } from '@playwright/test';
import { applyOps, outline } from '../../src/engine/ops';
import { resizeDeck, roomySlides, tightSlides } from '../../src/engine/slide-resize';
import { widthOf } from '../../src/engine/slide-size';
import type { Block, Deck } from '../../src/types';

type Obj = Block & { place: { x: number; y: number; w?: number; h?: number }; styles?: Record<string, { size?: number }> };
const obj = (id: string, x: number, w: number, extra: Partial<Obj> = {}): Obj => ({ type: 'shape', id, place: { x, y: 100, w, h: 100 }, ...extra }) as Obj;
const deckOf = (...free: Obj[][]): Deck => ({ title: 'Размеры', slides: free.map((f) => ({ template: 'canvas', free: f })) }) as unknown as Deck;
const at = (d: Deck, s: number, id: string) => (d.slides[s].free as Obj[]).find((b) => b.id === id)!.place;

test('ширина по пропорции: 16:9 — 1280, 4:3 — 960, 21:9 — 1680; 16:9 в данных не пишется', () => {
  expect([widthOf({}), widthOf({ size: '4:3' }), widthOf({ size: '21:9' }), widthOf({ size: 'нет' })]).toEqual([1280, 960, 1680, 1280]);
  const d = deckOf([]);
  resizeDeck(d, '4:3');
  expect(d.size).toBe('4:3');
  resizeDeck(d, '16:9');
  expect('size' in d).toBe(false);
});

test('шире (21:9): у края — у края, по центру — по центру, на всю ширину с полями — тянется, середина — в долях', () => {
  const d = deckOf([
    obj('left', 80, 300), obj('right', 900, 300), obj('mid', 540, 200), obj('title', 80, 1120), obj('bg', 0, 1280),
    obj('third', 380, 100, { place: { x: 380, y: 400, w: 100, h: 100 } }), obj('away', 1400, 200),
  ]);
  const r = resizeDeck(d, '21:9');
  expect(at(d, 0, 'left')).toMatchObject({ x: 80, w: 300 });
  expect(at(d, 0, 'right')).toMatchObject({ x: 1680 - 80 - 300, w: 300 });
  expect(at(d, 0, 'mid')).toMatchObject({ x: 740, w: 200 });
  expect(at(d, 0, 'title')).toMatchObject({ x: 80, w: 1520 });
  expect(at(d, 0, 'bg')).toMatchObject({ x: 0, w: 1680 });
  // Треть слайда — треть: центр 430 из 1280 → 564 из 1680
  expect(at(d, 0, 'third').x).toBe(Math.round((430 * 1680) / 1280 - 50));
  // За краем про запас — не трогается
  expect(at(d, 0, 'away')).toMatchObject({ x: 1400, w: 200 });
  expect(r.outside).toBe(0);
});

test('значок поверх картинки едет вместе с ней; свободный конец соединителя — тоже на место', () => {
  const d = deckOf([
    obj('photo', 80, 700, { type: 'image', place: { x: 80, y: 120, w: 700, h: 400 } }),
    obj('badge', 740, 48, { place: { x: 740, y: 140, w: 48, h: 48 } }),
    { type: 'connector', id: 'line', start: [1200, 300], end: [1000, 300] } as unknown as Obj,
  ]);
  resizeDeck(d, '21:9');
  // Картинка у левого края — на месте, значок на её краю — тоже (а не в долях ширины)
  expect(at(d, 0, 'photo').x).toBe(80);
  expect(at(d, 0, 'badge').x).toBe(740);
  const line = (d.slides[0].free as unknown as { start: number[]; end: number[] }[])[2];
  expect(line.start).toEqual([1600, 300]);
});

test('уже (4:3): тесный слайд — вопрос; «Уместить» уменьшает композицию целиком, «Сохранить размер» — к краям', () => {
  const tight = () => deckOf(
    [obj('photo', 80, 700, { place: { x: 80, y: 120, w: 700, h: 400 } }), obj('notes', 860, 380, { type: 'text', place: { x: 860, y: 120, w: 380 }, styles: { text: { size: 20 } } })],
    [obj('card', 440, 400)],
  );
  expect(tightSlides(tight(), '4:3')).toEqual([1]);
  expect(tightSlides(tight(), '21:9')).toEqual([]);

  const fit = tight();
  const r = resizeDeck(fit, '4:3', { fit: true });
  expect(r.scaled).toEqual([1]);
  expect(at(fit, 0, 'photo')).toEqual({ x: 60, y: Math.round(360 + (120 - 360) * 0.75), w: 525, h: 300 });
  expect(at(fit, 0, 'notes')).toMatchObject({ x: 645, w: 285 });
  expect((fit.slides[0].free as Obj[])[1].styles!.text.size).toBe(15);
  // Просторный слайд — просто по центру
  expect(at(fit, 1, 'card')).toMatchObject({ x: 280, w: 400 });

  const keep = tight();
  const k = resizeDeck(keep, '4:3');
  expect(k.scaled).toEqual([]);
  expect(at(keep, 0, 'photo')).toMatchObject({ x: 80, w: 700 });
  expect(at(keep, 0, 'notes')).toMatchObject({ x: 960 - 40 - 380, w: 380 });
});

test('туда и обратно: «Уместить» в 4:3, «Увеличить» в 16:9 — как было; фон на весь слайд тянется, а не растёт', () => {
  const d = deckOf([
    obj('bg', 0, 1280, { type: 'embed', place: { x: 0, y: 0, w: 1280, h: 720 } }),
    obj('photo', 80, 700, { place: { x: 80, y: 120, w: 700, h: 400 } }),
    obj('notes', 860, 380, { type: 'text', text: 'Подписи', place: { x: 860, y: 120, w: 380 }, styles: { text: { size: 20 } } }),
  ]);
  resizeDeck(d, '4:3', { fit: true });
  expect(at(d, 0, 'bg')).toEqual({ x: 0, y: 0, w: 960, h: 720 });
  expect(at(d, 0, 'photo')).toEqual({ x: 60, y: 180, w: 525, h: 300 });
  expect(roomySlides(d, '16:9')).toEqual([1]);
  const r = resizeDeck(d, '16:9', { fit: true });
  expect(r.scaled).toEqual([1]);
  expect(at(d, 0, 'bg')).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  expect(at(d, 0, 'photo')).toEqual({ x: 80, y: 120, w: 700, h: 400 });
  expect(at(d, 0, 'notes')).toMatchObject({ x: 860, y: 120, w: 380 });
  expect((d.slides[0].free as Obj[])[2].styles!.text.size).toBe(20);
  expect(d.size).toBeUndefined();
});

test('«Увеличить» при расширении: не больше, чем растёт ширина, и в высоте слайда; только растянутое и слайд с раскладкой — без вопроса', () => {
  const d = deckOf([obj('card', 100, 1000, { place: { x: 100, y: 100, w: 1000, h: 400 } })], [obj('hug', 40, 1200, { place: { x: 40, y: 20, w: 1200, h: 680 } })]);
  (d.slides as unknown as Record<string, unknown>[]).push({ template: 'content', title: 'Раскладка', body: [{ type: 'text', text: 'Абзац' }], free: [obj('mark', 600, 80)] });
  // Слайд 2 — только растянутое на всю ширину (тянется), у слайда 3 — раскладка
  expect(roomySlides(d, '21:9')).toEqual([1]);
  expect(roomySlides(d, '4:3')).toEqual([]);
  resizeDeck(d, '21:9', { fit: true });
  // Ширина растёт в 1680 / 1280 = 1,3125 раза, высота позволяет больше — 1,3125, от центра к центру
  const k = 1680 / 1280;
  expect(at(d, 0, 'card')).toEqual({ x: Math.round(840 + (100 - 640) * k), y: Math.round(360 + (100 - 360) * k), w: Math.round(1000 * k), h: Math.round(400 * k) });
  // Не вписанные — расставлены по ширине: слайд 2 тянется с полями, отметка над раскладкой — по центру
  expect(at(d, 1, 'hug')).toMatchObject({ x: 40, w: 1600 });
  expect(at(d, 2, 'mark').x).toBe(800);
  // Во всю высоту — увеличивать некуда; небольшое содержимое по центру — места и так хватает: просто по ширине
  expect(roomySlides(deckOf([obj('tall', 100, 1000, { place: { x: 100, y: 10, w: 1000, h: 700 } })]), '21:9')).toEqual([]);
  expect(roomySlides(deckOf([obj('small', 340, 600, { place: { x: 340, y: 100, w: 600, h: 400 } })]), '21:9')).toEqual([]);
});

test('операции агентов: deck.size с fit и deck.set { size } переставляют объекты; размер — в кратком содержании', () => {
  const d = deckOf([obj('title', 80, 1120), obj('right', 900, 300)]);
  expect(outline(d).canvas).toEqual({ size: '16:9', w: 1280, h: 720 });
  const r = applyOps(d, [{ op: 'deck.size', size: '21:9' }]);
  expect(r.changes[0]).toMatch(/^Размер слайда: 21:9/);
  expect(outline(r.deck).canvas).toEqual({ size: '21:9', w: 1680, h: 720 });
  expect(at(r.deck, 0, 'title').w).toBe(1520);
  const back = applyOps(r.deck, [{ op: 'deck.set', set: { size: null, title: 'Обратно' } }]);
  expect(back.deck.size).toBeUndefined();
  expect(back.deck.title).toBe('Обратно');
  expect(at(back.deck, 0, 'title').w).toBe(1120);
  expect(at(back.deck, 0, 'right').x).toBe(900);
  expect(() => applyOps(d, [{ op: 'deck.size', size: '1:1' }])).toThrow('size — "16:9", "4:3" или "21:9"');
});
