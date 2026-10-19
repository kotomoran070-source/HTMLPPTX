// Одна и та же анимация у зрителей и на пульте: общие часы показа и небо «Космоса» от общего времени
import { expect, test } from '@playwright/test';
import { nodeAt, pulseAt, skyModel, waveAt } from '../../src/components/templates/cosmos';
import { alignShowTime, showTime } from '../../src/engine/show-clock';

test('небо «Космоса»: одни и те же узлы в любом окне, положение — от времени показа, а не от кадров', () => {
  const a = skyModel();
  const b = skyModel();
  expect(a).toEqual(b);
  const n = a.nodes[3];
  // Окно, открытое позже, или экран 120 Гц — в момент t узел там же
  expect(nodeAt(n, 12.5)).toEqual(nodeAt(b.nodes[3], 12.5));
  // Скорость — как раньше при 60 кадрах в секунду: 1 с = 60 шагов по vx
  const p = nodeAt(n, 1);
  expect(p.x).toBeCloseTo(((n.x + n.vx * 60 + 10) % 1300 + 1300) % 1300 - 10, 6);
  // Через края слайда — по кругу, без выхода за границы
  for (const t of [0, 100, 1000, 54321]) {
    const q = nodeAt(n, t);
    expect(q.x).toBeGreaterThanOrEqual(-10);
    expect(q.x).toBeLessThan(1290);
    expect(q.y).toBeGreaterThanOrEqual(-10);
    expect(q.y).toBeLessThan(730);
  }
});

test('импульс от логотипа: в одни и те же моменты у всех окон, волна гаснет до следующего', () => {
  expect(pulseAt(1)).toBeNull();
  expect(pulseAt(3.8 + 0.5)).toEqual(pulseAt(7.6 + 0.5));
  expect(pulseAt(3.8 + 0.5)!.rad).toBeGreaterThan(20);
  expect(pulseAt(3.8 + 3.5)).toBeNull();
  // Волна от щелчка: 2,8 точки и 2,8 % яркости за кадр при 60 кадрах
  const w = waveAt(1, 10, 1);
  expect(w.rad).toBeCloseTo(10 + 2.8 * 60, 6);
  expect(w.a).toBeCloseTo(0.972 ** 60, 6);
});

test('часы показа: пульт берёт время окна показа; запоздавший ответ не отводит назад, перезапуск показа — принимается', () => {
  alignShowTime(1_000_000);
  expect(Math.abs(showTime() - 1_000_000)).toBeLessThan(50);
  // Ответ шёл по сети 300 мс — он «моложе» и часы не трогает
  alignShowTime(showTime() - 300);
  expect(Math.abs(showTime() - 1_000_000)).toBeLessThan(80);
  // Окно показа перезагрузили: его отсчёт с нуля
  alignShowTime(500);
  expect(Math.abs(showTime() - 500)).toBeLessThan(50);
});
