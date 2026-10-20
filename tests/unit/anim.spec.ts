// Анимация объектов: очередь щелчков (появление, выделение, исчезновение) и маркер в тексте
import { expect, test } from '@playwright/test';
import { clickActs, timedOrder } from '../../src/engine/anim';
import { t } from '../../src/engine/html';
import type { Block } from '../../src/types';

const b = (o: Record<string, unknown>): Block => ({ type: 'shape', ...o }) as Block;

test('очередь щелчков: по месту; при равном — появление, выделение, исчезновение; объект может быть в очереди несколько раз', () => {
  const free = [
    b({ click: true, exit: 'fade', exitAt: 600 }),
    b({ click: true, delay: 300, emphasis: 'glow', emphAt: 900 }),
    b({ exit: 'left', exitAt: 1200 }),
    b({ enter: 'rise', delay: 500 }),
  ];
  expect(clickActs(free).map((a) => `${a.kind}${a.k}`)).toEqual(['in0', 'in1', 'out0', 'emph1', 'out2']);
  // Равные места: появление раньше выделения и исчезновения
  expect(clickActs([b({ exit: 'fade', exitAt: 0 }), b({ click: true })]).map((a) => `${a.kind}${a.k}`)).toEqual(['in1', 'out0']);
});

test('очередь щелчков: выделение без места — только для кнопки «Проиграть»; исчезновение без места — в конце; неизвестные эффекты не в счёт', () => {
  expect(clickActs([b({ emphasis: 'pulse' })])).toEqual([]);
  expect(clickActs([b({ emphasis: 'nope', emphAt: 0 }), b({ exit: 'nope' })])).toEqual([]);
  expect(clickActs([b({ exit: 'fade' }), b({ click: true, delay: 99999 })]).map((a) => `${a.kind}${a.k}`)).toEqual(['in1', 'out0']);
});

test('маркер в тексте: {mark|…} — полоса под словами, вместе с цветом в обе стороны, \\{mark|…} — как есть', () => {
  expect(t('Главное — {mark|вот это}')).toMatch(/^Главное\s— <mark class="md-m">вот это<\/mark>$/);
  expect(t('{accent|{mark|цвет снаружи}}')).toContain('<span class="md-c" data-c="accent" style="color:var(--ac)"><mark class="md-m">цвет снаружи</mark></span>');
  expect(t('{mark|{accent|цвет внутри}}')).toContain('<mark class="md-m"><span class="md-c" data-c="accent"');
  expect(t('\\{mark|не маркер}')).not.toContain('<mark');
});

test('номера появлений при открытии слайда: по задержке, при равной — по номеру объекта; по щелчку и без эффекта — не в счёт', () => {
  const free = [b({ enter: 'rise', delay: 600 }), b({ enter: 'fade' }), b({ enter: 'pop', click: true }), b({}), b({ enter: 'fade', delay: 600 }), b({ enter: 'blur', delay: 100 })];
  expect(timedOrder(free, (x) => typeof x.enter === 'string')).toEqual([1, 5, 0, 4]);
});
