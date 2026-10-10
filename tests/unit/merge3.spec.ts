// Слияние версий при записи: правки другого окна (заметки докладчика, вторая вкладка) не затираются
import { expect, test } from '@playwright/test';
import { merge3 } from '../../src/engine/merge3';

const deck = (slides: object[], extra: object = {}) => ({ title: 'Доклад', ...extra, slides });

test('заметки из другого окна остаются, когда здесь поменяли название', () => {
  const base = deck([{ title: 'А' }, { title: 'Б' }]);
  const mine = deck([{ title: 'А' }, { title: 'Б' }], { title: 'Новое' });
  const theirs = deck([{ title: 'А', notes: 'Долго писал' }, { title: 'Б' }]);
  const { result, changed } = merge3(base, mine, theirs);
  expect(result).toEqual({ title: 'Новое', slides: [{ title: 'А', notes: 'Долго писал' }, { title: 'Б' }] });
  expect(changed).toBe(true);
});

test('один слайд правили оба окна — по полям; одно и то же поле — своё', () => {
  const base = deck([{ title: 'А', notes: 'старое' }]);
  const mine = deck([{ title: 'А2', notes: 'моё' }]);
  const theirs = deck([{ title: 'А', notes: 'чужое', hidden: true }]);
  expect(merge3(base, mine, theirs).result).toEqual(deck([{ title: 'А2', notes: 'моё', hidden: true }]));
});

test('свои перестановка и новый слайд остаются, чужие заметки едут вместе со слайдом', () => {
  const base = deck([{ title: 'А' }, { title: 'Б' }]);
  const mine = deck([{ title: 'Б' }, { title: 'Новый' }, { title: 'А' }]);
  const theirs = deck([{ title: 'А' }, { title: 'Б', notes: 'про Б' }]);
  expect(merge3(base, mine, theirs).result).toEqual(deck([{ title: 'Б', notes: 'про Б' }, { title: 'Новый' }, { title: 'А' }]));
});

test('чужое удаление поля и чужой новый слайд; без чужих правок — ровно своё', () => {
  const base = deck([{ title: 'А', notes: 'x' }]);
  expect(merge3(base, base, deck([{ title: 'А' }, { title: 'Б' }])).result).toEqual(deck([{ title: 'А' }, { title: 'Б' }]));
  const mine = deck([{ title: 'А2', notes: 'x' }]);
  const same = merge3(base, mine, base);
  expect(same.result).toEqual(mine);
  expect(same.changed).toBe(false);
  // Порядок полей не важен
  expect(merge3({ slides: [], title: 'Доклад' }, mine, base).changed).toBe(false);
});
