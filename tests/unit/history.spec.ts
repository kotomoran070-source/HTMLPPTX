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

/** Хранилище вкладки для теста: как sessionStorage, с пределом на общий размер */
function fakeStorage(limit = Infinity): Storage & { writes: string[] } {
  const m = new Map<string, string>();
  const size = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const st = {
    writes: [] as string[],
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem(k: string, v: string) {
      if (size() - (m.has(k) ? k.length + m.get(k)!.length : 0) + k.length + v.length > limit) throw new Error('QuotaExceededError');
      st.writes.push(k);
      m.set(k, v);
    },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
  return st as unknown as Storage & { writes: string[] };
}

test('история между перезагрузками: по частям — правка дописывает только новое; после загрузки шаги те же', () => {
  const st = fakeStorage();
  (globalThis as { sessionStorage?: Storage }).sessionStorage = st;
  try {
    const big = (k: number): Deck => ({ title: 'Доклад', slides: Array.from({ length: 30 }, (_, i) => ({ template: 'title', title: `Слайд ${i}${i === k % 30 ? ` правка ${k}` : ''}` })) });
    const h = new History('part');
    let cur = h.snap(big(0));
    for (let k = 1; k <= 40; k++) { h.push(cur); cur = h.snap(big(k)); }
    h.mark(cur, '12:00');
    h.write(cur);
    // Ещё одна правка: в хранилище — одна новая строка слайда и указатель, а не вся история заново
    h.push(cur);
    cur = h.snap(big(41));
    st.writes.length = 0;
    h.write(cur);
    expect(st.writes.length).toBe(2);
    // Перезагрузка вкладки: те же шаги и контрольная точка
    const again = new History('part');
    again.load(again.snap(big(41)));
    expect(again.past.length).toBe(41);
    expect(again.past.map((x) => History.restore(x))).toEqual(h.past.map((x) => History.restore(x)));
    expect([...again.marks.values()]).toEqual(['12:00']);
    // Отменили шаг (повтор — в future) и записали; загрузка это помнит
    h.future.push(cur);
    cur = h.past.pop()!;
    h.write(cur);
    const third = new History('part');
    third.load(third.snap(History.restore(cur)));
    expect([third.past.length, third.future.length]).toEqual([40, 1]);
    expect(History.restore(third.future[0])).toEqual(big(41));
    // Данные другие (файл поправили мимо вкладки) — история не подходит и убирается из хранилища
    const other = new History('part');
    other.load(other.snap(big(7)));
    expect(other.past.length).toBe(0);
    expect(st.length).toBe(0);
  } finally {
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  }
});

test('история не влезает в хранилище: уходят самые старые шаги, новые остаются и читаются', () => {
  const st = fakeStorage(60_000);
  (globalThis as { sessionStorage?: Storage }).sessionStorage = st;
  try {
    const heavy = (k: number): Deck => ({ title: 'Тяжёлая', slides: [{ template: 'canvas', html: `${k}:${'д'.repeat(4000)}` }, { template: 'title', title: 'Второй' }] });
    const h = new History('quota');
    let cur = h.snap(heavy(0));
    for (let k = 1; k <= 60; k++) { h.push(cur); cur = h.snap(heavy(k)); }
    h.write(cur);
    const again = new History('quota');
    again.load(again.snap(heavy(60)));
    expect(again.past.length).toBeGreaterThan(3);
    expect(again.past.length).toBeLessThan(60);
    // Уцелели последние шаги
    expect(History.restore(again.past.at(-1)!)).toEqual(heavy(59));
    // И запись после этого по-прежнему идёт
    h.push(cur);
    cur = h.snap(heavy(61));
    h.write(cur);
    const third = new History('quota');
    third.load(third.snap(heavy(61)));
    expect(History.restore(third.past.at(-1)!)).toEqual(heavy(60));
  } finally {
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  }
});
