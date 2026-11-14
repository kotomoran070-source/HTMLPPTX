// Операции правки (src/engine/ops.ts) и команды сервера outline / apply: адреса слайдов и объектов, ревизии,
// все или ни одной, понятные ошибки, проверка итога; запись с комментариями YAML и событием для окон студии
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createDecksCore, type DecksCore } from '../../server/core';
import { createHandler } from '../../server/http';
import { OPS, applyOps, mergePatch, outline, slideRev } from '../../src/engine/ops';
import type { Deck } from '../../src/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const sample = (): Deck => ({
  title: 'Итоги',
  slides: [
    { id: 'cover', template: 'cover', title: 'Итоги {g:duo|квартала}', notes: 'Привет, Компания' },
    {
      id: 'idea', template: 'canvas',
      free: [
        { type: 'text', text: 'Главная **мысль**', place: { x: 80, y: 80, w: 600 } },
        { type: 'shape', id: 'box', kind: 'round', text: 'Компания', place: { x: 700, y: 300, w: 200, h: 120 } },
      ],
    },
    { id: 'end', template: 'finale', title: 'Спасибо' },
  ],
});

test('слайды: добавить, копия, переставить, удалить; id без повторов; номера — после предыдущих операций', () => {
  const r = applyOps(sample(), [
    { op: 'slide.add', slide: { title: 'Цифры' }, at: 2 },
    { op: 'slide.duplicate', slide: 'idea' },
    { op: 'slide.move', slide: 'end', to: 1 },
    { op: 'slide.remove', slide: 2 },
  ]);
  expect(r.deck.slides.map((s) => s.id)).toEqual(['end', 'slide-2', 'idea', 'idea-2']);
  expect(r.deck.slides[1].title).toBe('Цифры');
  // Копия — с теми же именами объектов: морф между ними работает сразу
  expect(r.deck.slides[3].free).toEqual(r.deck.slides[2].free);
  expect(r.changes).toEqual(['Новый слайд 2', 'Копия слайда 3 → 4', 'Слайд 5 → 1', 'Удалён слайд 2']);
});

test('объекты: по номеру и по имени; поля — слиянием (place.x не трогает остальное место), null удаляет', () => {
  const r = applyOps(sample(), [
    { op: 'object.set', slide: 'idea', object: 'box', set: { place: { x: 100 }, text: null } },
    { op: 'object.add', slide: 2, object: { type: 'text', text: 'Новый', place: { x: 0, y: 0, w: 100 } }, at: 1 },
    { op: 'object.order', slide: 2, object: 1, to: 'front' },
    { op: 'object.set', slide: 2, object: 1, set: { enter: 'rise' } },
  ]);
  const free = r.deck.slides[1].free!;
  expect(free.map((b) => b.text ?? b.id)).toEqual(['Главная **мысль**', 'box', 'Новый']);
  expect(free[1].place).toEqual({ x: 100, y: 300, w: 200, h: 120 });
  expect(free[0].enter).toBe('rise');
  expect(r.changes[0]).toBe('Правка объекта · слайд 2');
  expect(applyOps(sample(), [{ op: 'object.set', slide: 2, object: 'box', set: { place: { y: 10 } } }]).changes).toEqual(['Место объекта · слайд 2']);
  // Последний объект удалён — пустого списка в данных нет, как у студии
  const empty = applyOps(sample(), [{ op: 'object.remove', slide: 2, object: 2 }, { op: 'object.remove', slide: 2, object: 1 }]);
  expect('free' in empty.deck.slides[1]).toBe(false);
});

test('поля слайда и презентации; замена текста — только в текстах, не в именах и путях', () => {
  const r = applyOps(sample(), [
    { op: 'slide.set', slide: 1, set: { lead: 'Подзаголовок', notes: null } },
    { op: 'deck.set', set: { theme: { preset: 'midnight' }, lang: 'ru' } },
    { op: 'text.replace', find: 'Компания', replace: 'Slideria' },
  ]);
  expect(r.deck.slides[0]).toEqual({ id: 'cover', template: 'cover', title: 'Итоги {g:duo|квартала}', lead: 'Подзаголовок' });
  expect(r.deck.theme).toEqual({ preset: 'midnight' });
  expect(r.deck.slides[1].free![1].text).toBe('Slideria');
  expect(r.changes[2]).toBe('Замена текста: 1');
  // Имя объекта, вид, путь — не текст
  const s = sample();
  s.slides[1].free![0].src = './assets/Компания.png';
  const r2 = applyOps(s, [{ op: 'text.replace', find: 'Компания', replace: 'X', slide: 1 }]);
  expect(r2.deck.slides[0].notes).toBe('Привет, X');
  expect(r2.deck.slides[1].free![0].src).toBe('./assets/Компания.png');
  expect(r2.deck.slides[1].free![1].text).toBe('Компания');
});

test('все или ни одной: ошибка в третьей операции — данные не тронуты, в тексте — номер и что не так', () => {
  const d = sample();
  const before = JSON.stringify(d);
  const fail = (ops: unknown[], msg: string | RegExp) => expect(() => applyOps(d, ops)).toThrow(msg);
  fail([{ op: 'slide.set', slide: 1, set: { title: 'x' } }, { op: 'slide.set', slide: 2, set: { title: 'y' } }, { op: 'object.set', slide: 2, object: 7, set: { text: 'z' } }],
    'Операция 3 (object.set): нет объекта 7 на слайде 2: объекты — с 1 по 2');
  expect(JSON.stringify(d)).toBe(before);
  fail([{ op: 'slide.zoom' }], /Операция 1: неизвестная «slide.zoom». Есть: deck.set, deck.size, slide.add/);
  fail([{ op: 'slide.set', slide: 9, set: { title: 'x' } }], 'нет слайда 9: слайды — с 1 по 3');
  fail([{ op: 'slide.set', slide: 'nope', set: { title: 'x' } }], 'нет слайда с id «nope»');
  fail([{ op: 'object.set', slide: 2, object: 'ghost', set: { text: 'x' } }], 'на слайде 2 нет объекта с именем «ghost»');
  fail([{ op: 'slide.set', slide: 2, set: { free: [] } }], 'свободные объекты правятся операциями object.*');
  fail([{ op: 'object.add', slide: 1, object: { text: 'без вида' } }], 'object — данные объекта с type');
  fail([{ op: 'slide.remove', slide: 1 }, { op: 'slide.remove', slide: 1 }, { op: 'slide.remove', slide: 1 }], 'единственный слайд удалить нельзя');
  fail([], 'ops — список операций');
  fail([{ op: 'slide.add', at: 9 }], 'Операция 1 (slide.add): at — число с 1 по 4');
  fail([{ op: 'slide.set', slide: 1 }], 'Операция 1 (slide.set): set — поля, которые поменять');
  // Итог проверяется: имя объекта на слайде одно, место — числа
  fail([{ op: 'object.add', slide: 2, object: { type: 'text', id: 'box' } }], 'После операций: слайд 2, объект 3: имя «box» уже есть на этом слайде');
  fail([{ op: 'object.set', slide: 2, object: 1, set: { place: { x: 'сто' } } }], 'place.x — число');
  fail([{ op: 'slide.set', slide: 3, set: { id: 'cover' } }], 'id «cover» уже есть у другого слайда');
  // Как приходит в JSON запроса: собственное поле «__proto__»
  fail([JSON.parse('{"op":"deck.set","set":{"__proto__":{"x":1}}}')], 'поле «__proto__» недопустимо');
  expect(JSON.stringify(d)).toBe(before);
});

test('ревизии: прочитанный слайд поменяли — пакет не применяется; чужой слайд — не помеха', () => {
  const d = sample();
  const o = outline(d);
  expect(o.slides.map((s) => s.rev)).toEqual(d.slides.map(slideRev));
  expect(o.slides[1].objects).toEqual([
    { n: 1, type: 'text', text: 'Главная мысль', place: { x: 80, y: 80, w: 600 } },
    { n: 2, type: 'shape', name: 'box', text: 'Компания', place: { x: 700, y: 300, w: 200, h: 120 } },
  ]);
  expect(o.slides[0]).toMatchObject({ n: 1, id: 'cover', template: 'cover', title: 'Итоги квартала', notes: 'Привет, Компания' });
  // Порядок полей не меняет ревизию, содержание — меняет
  expect(slideRev({ b: 1, a: [1, { y: 2, x: 1 }] })).toBe(slideRev({ a: [1, { x: 1, y: 2 }], b: 1 }));
  expect(slideRev({ a: 1 })).not.toBe(slideRev({ a: 2 }));

  const ops = [{ op: 'object.set', slide: 2, object: 'box', set: { text: 'Агент' } }];
  const expectRev = [{ slide: 2, rev: o.slides[1].rev }];
  // Тем временем в студии подвинули объект на слайде 2
  const moved = applyOps(d, [{ op: 'object.set', slide: 2, object: 1, set: { place: { x: 90 } } }]).deck;
  expect(() => applyOps(moved, ops, { expect: expectRev })).toThrow('Слайд 2 изменился с тех пор, как его прочитали. Перечитайте (outline) и повторите');
  // Поправили другой слайд — не помеха
  const other = applyOps(d, [{ op: 'slide.set', slide: 3, set: { title: 'Вопросы' } }]).deck;
  expect(applyOps(other, ops, { expect: expectRev }).deck.slides[1].free![1].text).toBe('Агент');
  // Слайд удалили — тоже «перечитайте»
  expect(() => applyOps(d, ops, { expect: [{ slide: 'gone', rev: 'x' }] })).toThrow(/Презентация изменилась: нет слайда с id «gone»/);
});

test('старые данные, поправленные руками, не мешают править другие слайды', () => {
  const d = sample();
  (d.slides[2] as Record<string, unknown>).free = [{ type: 'text', place: { x: '10' } }];
  expect(() => applyOps(d, [{ op: 'slide.set', slide: 1, set: { title: 'x' } }])).not.toThrow();
  expect(() => applyOps(d, [{ op: 'slide.set', slide: 3, set: { title: 'x' } }])).toThrow('слайд 3, объект 1: place.x — число');
});

test('каталог: у каждой операции описание и поля; Merge Patch по RFC 7386', () => {
  for (const [name, def] of Object.entries(OPS)) {
    expect(def.summary, name).toBeTruthy();
    expect(Object.keys(def.params).length, name).toBeGreaterThan(0);
  }
  expect(mergePatch({ a: 'b', c: { d: 'e', f: 'g' } }, { a: 'z', c: { f: null } })).toEqual({ a: 'z', c: { d: 'e' } });
  expect(mergePatch({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
});

// ---------------- сервер ----------------

let tmp = '';
let core: DecksCore;
let server: http.Server;
let base = '';
const events: string[] = [];

test.describe('сервер', () => {
  test.beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-ops-'));
    const deck = path.join(tmp, 'decks', 'talk');
    fs.mkdirSync(deck, { recursive: true });
    fs.writeFileSync(path.join(deck, 'deck.yaml'), `# Доклад для конференции
title: Итоги
slides:
  # Титул
  - id: cover
    template: cover
    title: Итоги
  - id: idea
    template: canvas
    free:
      - type: shape
        id: box
        text: Компания  # название поменяют
        place: { x: 700, y: 300, w: 200, h: 120 }
`);
    core = createDecksCore({ dir: path.join(tmp, 'decks'), root: ROOT });
    core.on('saved', (e) => events.push(`${e.name}:${e.from}`));
    const handle = createHandler(core);
    server = http.createServer((req, res) => handle(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(() => {
    server.closeAllConnections();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const call = async (cmd: string, body?: unknown) => {
    const r = await fetch(`${base}/__htmlpptx/${cmd}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() as Record<string, unknown> };
  };

  test('outline → apply с ревизией: записано с комментариями, окна получили событие; устаревшая ревизия — 400', async () => {
    const o = await call('outline?deck=talk');
    expect(o.status).toBe(200);
    const slides = o.data.slides as { n: number; rev: string; objects?: unknown[] }[];
    expect(slides[1].objects).toEqual([{ n: 1, type: 'shape', name: 'box', text: 'Компания', place: { x: 700, y: 300, w: 200, h: 120 } }]);
    const one = await call('outline?deck=talk&slide=idea');
    expect(one.data).toMatchObject({ n: 2, id: 'idea', rev: slides[1].rev });
    expect(await call('outline?deck=talk&slide=2')).toEqual(one);

    const r = await call('apply?deck=talk', {
      ops: [{ op: 'object.set', slide: 'idea', object: 'box', set: { text: 'Slideria', place: { x: 100 } } }, { op: 'slide.add', slide: { title: 'Цифры' } }],
      expect: [{ slide: 2, rev: slides[1].rev }],
    });
    expect(r.status).toBe(200);
    expect(r.data.changes).toEqual(['Правка объекта · слайд 2', 'Новый слайд 3']);
    const yaml = fs.readFileSync(path.join(tmp, 'decks', 'talk', 'deck.yaml'), 'utf8');
    expect(yaml).toContain('# Доклад для конференции');
    expect(yaml).toContain('# Титул');
    expect(yaml).toContain('text: Slideria');
    expect(yaml).toContain('id: slide-2');
    expect(events).toEqual(['talk:agent']);
    // Новое краткое содержание — в ответе: агент продолжает без перечитывания
    expect(((r.data.outline as { slides: unknown[] }).slides).length).toBe(3);

    const stale = await call('apply?deck=talk', { ops: [{ op: 'object.remove', slide: 2, object: 1 }], expect: [{ slide: 2, rev: slides[1].rev }] });
    expect(stale.status).toBe(400);
    expect(stale.data.error).toContain('Слайд 2 изменился');
    expect(events).toEqual(['talk:agent']);
    expect((await call('apply?deck=nope', { ops: [] })).status).toBe(400);
    expect((await call('outline?deck=talk&slide=9')).data.error).toBe('Нет слайда 9: слайды — с 1 по 3');
  });
});
