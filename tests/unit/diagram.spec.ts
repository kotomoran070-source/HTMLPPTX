// Диаграммы из текста: разбор последовательности и схем, раскладка по слоям без наложений
import { expect, test } from '@playwright/test';
import { layoutFlow } from '../../src/components/diagram/layout';
import { nodeOf, parseFlow, parseSequence } from '../../src/components/diagram/parse';

test('последовательность: участники по первому упоминанию, ответы пунктиром, обратная стрелка, заметки, разделы, нумерация', () => {
  const sq = parseSequence(`
    # комментарий
    нумерация
    актёр Пользователь
    Пользователь -> Веб-сервер: вход
    Веб-сервер -> База: SELECT * FROM users
    База --> Веб-сервер: строки
    Веб-сервер <- Пользователь: ещё запрос
    Веб-сервер -> Веб-сервер: проверка
    заметка База, Веб-сервер: кэш на 5 минут
    == Ответ ==
    Веб-сервер --> Пользователь: 200 OK
  `);
  expect(sq.numbered).toBe(true);
  expect(sq.participants).toEqual([{ name: 'Пользователь', actor: true }, { name: 'Веб-сервер', actor: false }, { name: 'База', actor: false }]);
  const msgs = sq.steps.filter((s) => s.kind === 'msg');
  expect(msgs.map((m) => m.kind === 'msg' && [m.from, m.to, m.dashed, m.n])).toEqual([[0, 1, false, 1], [1, 2, false, 2], [2, 1, true, 3], [0, 1, false, 4], [1, 1, false, 5], [1, 0, true, 6]]);
  expect(msgs[1].kind === 'msg' && msgs[1].text).toBe('SELECT * FROM users');
  expect(sq.steps.find((s) => s.kind === 'note')).toEqual({ kind: 'note', over: [2, 1], text: 'кэш на 5 минут' });
  expect(sq.steps.find((s) => s.kind === 'div')).toEqual({ kind: 'div', text: 'Ответ' });
});

test('схема: форма — по скобкам, без скобок — тот же узел по имени, цепочки, подпись у последней стрелки; [*] — начало и конец', () => {
  expect([nodeOf('[Шаг]'), nodeOf('{Да?}'), nodeOf('((Круг))'), nodeOf('[/Данные/]'), nodeOf('(Старт)'), nodeOf('Шаг')]).toEqual([
    { text: 'Шаг', shape: 'rect' }, { text: 'Да?', shape: 'diamond' }, { text: 'Круг', shape: 'circle' }, { text: 'Данные', shape: 'data' }, { text: 'Старт', shape: 'round' }, { text: 'Шаг', shape: null },
  ]);
  const f = parseFlow('(Код) -> [Сборка] -> {Тесты прошли?}\nТесты прошли? -> [Выкладка]: да\nТесты прошли? --> Сборка: нет\nнаправление: вправо');
  expect(f.dir).toBe('right');
  expect(f.nodes.map((n) => [n.text, n.shape])).toEqual([['Код', 'round'], ['Сборка', 'rect'], ['Тесты прошли?', 'diamond'], ['Выкладка', 'rect']]);
  expect(f.edges.map((e) => [e.from, e.to, e.text, e.dashed])).toEqual([
    ['код', 'сборка', '', false], ['сборка', 'тесты прошли?', '', false], ['тесты прошли?', 'выкладка', 'да', false], ['тесты прошли?', 'сборка', 'нет', true],
  ]);
  const st = parseFlow('[*] -> Новый\nНовый -> [*]', 'state');
  expect(st.nodes.map((n) => [n.id, n.shape])).toEqual([['*start', 'dot'], ['новый', 'round'], ['*end', 'dot']]);
  expect(st.dir).toBe('right');
});

test('раскладка: слои по ходу стрелок, цикл не ломает порядок, узлы одного слоя не налезают друг на друга', () => {
  const lay = layoutFlow(parseFlow('[А] -> {Б?}\nБ? -> [В]: да\nБ? -> [Г]: нет\nГ --> А\nВ -> [Д]\nГ -> [Д]'));
  const at = (t: string) => lay.nodes.find((n) => n.text === t)!;
  // Сверху вниз: А выше Б, Б выше В и Г, Д ниже всех; обратная стрелка Г → А не поднимает Г над А
  expect(at('А').y).toBeLessThan(at('Б?').y);
  expect(at('Б?').y).toBeLessThan(at('В').y);
  expect(at('В').y).toBe(at('Г').y);
  expect(at('Д').y).toBeGreaterThan(at('Г').y);
  const [v, g] = [at('В'), at('Г')].sort((p, q) => p.x - q.x);
  expect(v.x + v.w / 2).toBeLessThanOrEqual(g.x - g.w / 2);
  // Стрелка начинается и кончается на краях узлов, у подписанных — место подписи
  const e = lay.edges.find((x) => x.text === 'да')!;
  expect(e.points[0][1]).toBeGreaterThan(at('Б?').y);
  expect(e.points.at(-1)![1]).toBeLessThan(at('В').y);
  expect(e.label).not.toBeNull();
  expect(lay.edges.find((x) => x.dashed)!.back).toBe(true);
  // Вправо — та же схема по горизонтали
  const r = layoutFlow({ ...parseFlow('[А] -> [Б]'), dir: 'right' });
  expect(r.nodes[1].x).toBeGreaterThan(r.nodes[0].x);
  expect(r.nodes[1].y).toBe(r.nodes[0].y);
});
