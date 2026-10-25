// Картинка с кадрами: правка списка кадров (первый — поля самой картинки, остальные — images)
import { expect, test } from '@playwright/test';
import { frameAt, frameList, insertFrames, joinFrames, moveFrame, removeFrame } from '../../src/components/layout/frame-list';

const pic = () => ({ type: 'image', src: 'a.jpg', caption: 'A', fit: 'contain', radius: 16, images: [{ src: 'b.jpg', caption: 'B' }, 'c.jpg', { caption: 'без адреса' }] });

test('кадры: первый — из полей картинки; без адреса — пропущены; вписывание картинки — у каждого', () => {
  expect(frameList(pic())).toEqual([{ src: 'a.jpg', caption: 'A', fit: 'contain' }, { src: 'b.jpg', caption: 'B', fit: 'contain' }, { src: 'c.jpg', fit: 'contain' }]);
});

test('кадры: переставить, добавить, убрать; оформление остаётся у картинки, один кадр — обычная картинка', () => {
  const b: Record<string, unknown> = pic();
  moveFrame(b, 0, 1);
  expect(b).toMatchObject({ src: 'b.jpg', caption: 'B', radius: 16, images: [{ src: 'a.jpg', caption: 'A' }, { src: 'c.jpg' }] });
  // Края — без изменений
  moveFrame(b, 0, -1);
  expect(b.src).toBe('b.jpg');
  insertFrames(b, 0, ['n1.jpg', 'n2.jpg']);
  expect(frameList(b).map((f) => f.src)).toEqual(['b.jpg', 'n1.jpg', 'n2.jpg', 'a.jpg', 'c.jpg']);
  for (let k = 0; k < 4; k++) removeFrame(b, 0);
  expect(b).toEqual({ type: 'image', src: 'c.jpg', fit: 'contain', radius: 16 });
  // Последний кадр не убирается
  removeFrame(b, 0);
  expect(b.src).toBe('c.jpg');
  // Пустое место под картинку получает файлы: первый — она сама
  const empty: Record<string, unknown> = { type: 'image', src: '', caption: 'Подпись' };
  insertFrames(empty, -1, ['x.jpg', 'y.jpg']);
  expect(empty).toEqual({ type: 'image', src: 'x.jpg', caption: 'Подпись', images: [{ src: 'y.jpg' }] });
});

test('кадр по адресу хозяина: кадр из images — его номер, сама картинка с кадрами — 0, без кадров — нет', () => {
  const deck = { slides: [{ free: [pic(), { type: 'image', src: 'x.jpg' }] }] };
  const get = (p: (string | number)[]) => p.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)?.[k], deck);
  expect(frameAt(['slides', 0, 'free', 0, 'images', 1], get)).toEqual({ block: ['slides', 0, 'free', 0], k: 2 });
  // Кадр без адреса не рисуется и не считается
  deck.slides[0].free[0].images.unshift({ caption: 'пустой' } as never);
  expect(frameAt(['slides', 0, 'free', 0, 'images', 2], get)).toEqual({ block: ['slides', 0, 'free', 0], k: 2 });
  expect(frameAt(['slides', 0, 'free', 0], get)).toEqual({ block: ['slides', 0, 'free', 0], k: 0 });
  expect(frameAt(['slides', 0, 'free', 1], get)).toBeNull();
});

test('собрать в галерею: картинки слайда — кадрами первой, со своими подписями и кадрами; оформление — у первой', () => {
  const a: Record<string, unknown> = { type: 'image', src: 'a.jpg', radius: 16, place: { x: 0, y: 0, w: 400 } };
  const b = { type: 'image', src: 'b.jpg', caption: 'B', position: '30% 50%', shadow: 'deep' };
  joinFrames(a, [b, pic()]);
  expect(a).toMatchObject({ src: 'a.jpg', radius: 16, place: { x: 0, y: 0, w: 400 } });
  expect(frameList(a).map((f) => f.src)).toEqual(['a.jpg', 'b.jpg', 'a.jpg', 'b.jpg', 'c.jpg']);
  expect((a.images as Record<string, unknown>[])[0]).toEqual({ src: 'b.jpg', caption: 'B', position: '30% 50%' });
});
