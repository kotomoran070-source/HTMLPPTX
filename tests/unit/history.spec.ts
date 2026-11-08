// История правок студии и правки другого окна или агента: Ctrl+Z откатывает свои правки, а не подтянутые чужие —
// и когда оба правили объекты одного слайда
import { expect, test } from '@playwright/test';
import { History, edits } from '../../src/engine/editor/history';
import type { Deck } from '../../src/types';

const deck = (text: string, x: number): Deck => ({
  title: 'Агент',
  slides: [{ template: 'canvas', free: [{ type: 'text', text, place: { x: 80, y: 80, w: 600 } }, { type: 'shape', kind: 'round', place: { x, y: 300, w: 200 } }] }],
});

test('сдвинули фигуру, потом агент поправил текст на том же слайде: шаг отмены получает его текст', () => {
  const h = new History('t');
  const before = deck('Текст', 640);
  const mine = deck('Текст', 650);
  h.push(h.snap(before));
  // Окно записало своё, сервер вернул итог с правкой агента
  const list = edits(mine, deck('Правка агента', 650));
  expect(list).toEqual([{ slide: 0, key: 'text', obj: 0, kind: 'text|', was: 'Текст', now: 'Правка агента' }]);
  h.rebase(list!, 1);
  // Ctrl+Z вернёт фигуру на 640, а текст агента останется
  expect(History.restore(h.past[0])).toEqual(deck('Правка агента', 640));
});

test('на месте объекта в шаге истории другой объект — правка на него не ложится; состав поменялся — списком, как раньше', () => {
  const h = new History('t');
  const other: Deck = { title: 'Агент', slides: [{ template: 'canvas', free: [{ type: 'image', src: './a.png' }, { type: 'shape', place: { x: 640, y: 300, w: 200 } }] }] };
  h.push(h.snap(other));
  h.rebase(edits(deck('Текст', 650), deck('Правка агента', 650))!, 1);
  expect(History.restore(h.past[0])).toEqual(other);
  // Агент добавил объект: правка — всем списком free
  const added = deck('Текст', 650);
  added.slides[0].free!.push({ type: 'text', text: 'Новый' });
  expect(edits(deck('Текст', 650), added)).toEqual([{ slide: 0, key: 'free', was: deck('Текст', 650).slides[0].free, now: added.slides[0].free }]);
});

test('что поменялось с открытия — для «Сохранить изменения?»: слайды по id, без id — по содержимому', () => {
  const h = new History('t');
  const s = (title: string, id?: string) => ({ template: 'title', title, ...(id ? { id } : {}) });
  const base: Deck = { title: 'Доклад', slides: [s('Один'), s('Два'), s('Три')] };
  const cmp = (d: Deck) => History.compare(h.snap(base), h.snap(d));
  expect(cmp(base)).toBeNull();
  // Вставили слайд в середину — остальные не «изменены»
  expect(cmp({ ...base, slides: [s('Один'), s('Новый'), s('Два'), s('Три')] })).toEqual({ changed: [], added: [2], removed: 0, deck: false, order: false });
  // Поправили второй и удалили третий, поменяли название презентации
  expect(cmp({ title: 'Другой', slides: [s('Один'), s('Два!')] })).toEqual({ changed: [2], added: [], removed: 1, deck: true, order: false });
  // Только переставили
  expect(cmp({ ...base, slides: [s('Три'), s('Один'), s('Два')] })).toEqual({ changed: [], added: [], removed: 0, deck: false, order: true });
  // По id: слайд с id переехал и поменялся — правка, а не «удалён и добавлен»
  const ids: Deck = { title: 'Доклад', slides: [s('А', 'a'), s('Б', 'b')] };
  expect(History.compare(h.snap(ids), h.snap({ ...ids, slides: [s('Б!', 'b'), s('А', 'a'), s('В', 'c')] }))).toEqual({ changed: [1], added: [3], removed: 0, deck: false, order: false });
});
