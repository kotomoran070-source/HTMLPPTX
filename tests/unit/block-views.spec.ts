// Смена вида блока: пункты переходят между видами, свойства объекта сохраняются
import { expect, test } from '@playwright/test';
import { itemsOf, toView, viewOf } from '../../src/studio/block-views';

const timeline = { type: 'timeline', id: 'plan', enter: 'rise', place: { x: 80, y: 120, w: 1100, h: 300 },
  items: [{ date: 'Март', title: 'Запуск', text: 'Пилот', done: true }, { date: 'Июнь', title: 'Рост', text: '50 клиентов' }] };

test('таймлайн → шаги → карточки → таймлайн: даты сохраняются, место и имя — тоже', () => {
  const steps = toView(timeline, 'pipeline') as any;
  expect(steps).toMatchObject({ type: 'pipeline', id: 'plan', enter: 'rise', place: { x: 80, y: 120, w: 1100 } });
  expect(steps.place.h).toBeUndefined(); // высота — по новому содержимому
  expect(steps.steps[0]).toMatchObject({ title: 'Запуск', sub: 'Пилот', date: 'Март' });
  const cards = toView(steps, 'cards') as any;
  expect(viewOf(cards)).toBe('cards');
  expect(cards.items[1]).toMatchObject({ type: 'card', title: 'Рост', text: '50 клиентов', date: 'Июнь' });
  expect(toView(cards, 'timeline')).toMatchObject({ items: [{ date: 'Март', title: 'Запуск', text: 'Пилот', done: true }, { date: 'Июнь', title: 'Рост' }] });
});

test('список читается как «заголовок — текст», пары и метки — туда и обратно', () => {
  expect(itemsOf({ type: 'list', items: ['**Запуск** — пилот', 'Рост — 50 клиентов', 'Просто пункт'] })).toEqual([
    { title: 'Запуск', text: 'пилот' }, { title: 'Рост', text: '50 клиентов' }, { title: 'Просто пункт' },
  ]);
  const kv = toView({ type: 'list', items: ['**A** — 1', '**B** — 2'] }, 'kv') as any;
  expect(kv.rows).toEqual([['A', '1'], ['B', '2']]);
  expect(itemsOf({ type: 'kv', rows: { A: '1' } })).toEqual([{ title: 'A', text: '1' }]);
  expect((toView(kv, 'chips') as any).items).toEqual(['A', 'B']);
  // Сетка с другими блоками — не «карточки», вид не меняется
  expect(viewOf({ type: 'grid', items: [{ type: 'card', title: 'x', body: { type: 'bars', values: [1] } }] })).toBeNull();
});

test('новые виды: пункты и свои поля (иконка, выделенная колонка) переходят без потерь', () => {
  const icons = { type: 'icons', items: [{ title: 'Скорость', text: 'Быстро', icon: 'bolt' }, { title: 'Цена', text: 'Дёшево' }] };
  const compare = toView(icons, 'compare') as any;
  expect(compare.items[0]).toMatchObject({ title: 'Скорость', text: 'Быстро', icon: 'bolt' });
  const funnel = toView({ ...compare, items: [{ ...compare.items[0], accent: true }, compare.items[1]] }, 'funnel') as any;
  expect(toView(toView(funnel, 'cycle'), 'compare')).toMatchObject({ items: [{ title: 'Скорость', accent: true, icon: 'bolt' }, { title: 'Цена', text: 'Дёшево' }] });
  for (const v of ['cycle', 'funnel', 'pyramid', 'numbers', 'compare', 'matrix', 'icons', 'stats', 'faq']) expect(viewOf(toView(icons, v))).toBe(v);
});

test('дорожная карта, лестница и орбиты: те же пункты, пройденные вехи и места сохраняются', () => {
  const roadmap = { type: 'roadmap', id: 'road', place: { x: 40, y: 160, w: 1200, h: 320 },
    items: [{ title: 'Исследование', text: 'I квартал', done: true }, { title: 'Пилот', text: 'III квартал' }] };
  const steps = toView(roadmap, 'pipeline') as any;
  expect(steps.steps[0]).toMatchObject({ title: 'Исследование', sub: 'I квартал', done: true });
  const back = toView(toView(toView(steps, 'ladder'), 'orbit'), 'roadmap') as any;
  expect(back).toMatchObject({ type: 'roadmap', id: 'road', place: { x: 40, y: 160, w: 1200 }, items: [{ title: 'Исследование', text: 'I квартал', done: true }, { title: 'Пилот', text: 'III квартал' }] });
  // Даты таймлайна переживают дорожную карту
  expect(toView(toView(timeline, 'roadmap'), 'timeline')).toMatchObject({ items: [{ date: 'Март', title: 'Запуск', done: true }, { date: 'Июнь', title: 'Рост' }] });
  for (const v of ['roadmap', 'ladder', 'orbit']) expect(viewOf(toView(roadmap, v))).toBe(v);
});

test('Венн и вложенные круги: те же пункты туда и обратно, место и появление остаются', () => {
  const venn = { type: 'venn', enter: 'fade', place: { x: 100, y: 120, w: 780 },
    items: [{ title: 'Скорость', text: 'Минуты' }, { title: 'Качество', text: 'Без дизайнера' }, { title: 'Цена' }] };
  const nested = toView(venn, 'nested') as any;
  expect(nested).toMatchObject({ type: 'nested', enter: 'fade', place: { x: 100, y: 120, w: 780 }, items: [{ title: 'Скорость', text: 'Минуты' }, { title: 'Качество' }, { title: 'Цена' }] });
  expect(toView(toView(nested, 'pyramid'), 'venn')).toMatchObject({ type: 'venn', items: venn.items });
  expect(viewOf(venn)).toBe('venn');
  expect(viewOf(nested)).toBe('nested');
});

test('шестерёнки, колонны, слои, ромбы, дуга, карта идей: пункты и свои иконки переходят по кругу без потерь', () => {
  const start = { type: 'cycle', id: 'c', place: { x: 10, y: 20, w: 900 },
    items: [{ title: 'Идея', text: 'Что меняем', icon: 'bulb' }, { title: 'Запуск', text: 'Выход на рынок' }] };
  let b: any = start;
  for (const v of ['gears', 'pillars', 'layers', 'diamonds', 'arc', 'mindmap']) {
    b = toView(b, v);
    expect(viewOf(b)).toBe(v);
  }
  expect(toView(b, 'cycle')).toMatchObject({ type: 'cycle', id: 'c', place: { x: 10, y: 20, w: 900 }, items: start.items });
});
