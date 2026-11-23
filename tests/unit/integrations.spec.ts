// Интеграции на сервере (server/integrations.ts, server/core.ts): заголовок скрипта, что можно агентам,
// агенты на связи, журнал правок скриптов, автоматические точки отдельно от точек Ctrl+S
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createDecksCore } from '../../server/core';
import { clientTitle, parseScript } from '../../server/integrations';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('заголовок скрипта: имя, описание и поля всех видов', () => {
  const s = parseScript(`// @name Пример
// @description Что делает
// @param title: text = "Привет, мир" — Заголовок
// @param list: lines = "а = б\\nв = г" — Замены
// @param n: number = 3 — Сколько
// @param on: bool = true — Включить
// @param tr: choice(fade=Растворение, push=Сдвиг) = push — Переход
// @param bad: choice(a, b) = c
export default async () => {};
`, 'user:пример.js', false, 'пример.js');
  expect(s.name).toBe('Пример');
  expect(s.description).toBe('Что делает');
  expect(s.params).toEqual([
    { key: 'title', type: 'text', label: 'Заголовок', value: 'Привет, мир' },
    { key: 'list', type: 'lines', label: 'Замены', value: 'а = б\nв = г' },
    { key: 'n', type: 'number', label: 'Сколько', value: 3 },
    { key: 'on', type: 'bool', label: 'Включить', value: true },
    { key: 'tr', type: 'choice', label: 'Переход', value: 'push', options: [{ value: 'fade', label: 'Растворение' }, { value: 'push', label: 'Сдвиг' }] },
    // Значения нет среди вариантов — первый
    { key: 'bad', type: 'choice', label: 'bad', value: 'a', options: [{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }] },
  ]);
  // Без @name — имя файла
  expect(parseScript('export default () => {}', 'user:x.js', false, 'x.js').name).toBe('x');
  expect(clientTitle('claude-code')).toBe('Claude Code');
  expect(clientTitle('my-agent', 'Мой агент')).toBe('Мой агент');
  // Агентский режим настольного приложения: агент в нём может быть любой — общее имя
  expect(clientTitle('local-agent-mode-slideria')).toBe('Локальный агент');
});

test('правки считаются по имени агента, сеансы одного агента — одной строкой (и после ухода без «пока»)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-int-'));
  try {
    const dir = path.join(tmp, 'decks');
    fs.mkdirSync(path.join(dir, 'talk'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), 'title: Доклад\nslides:\n  - title: Первый\n');
    const core = createDecksCore({ dir, root: ROOT });
    const edit = (id: string, notes: string) => core.apply('talk', { ops: [{ op: 'slide.set', slide: 1, set: { notes } }], by: { kind: 'agent', id, name: 'Claude Code' } });
    // Два окна Claude Code (или дубль после переподключения) — два сеанса с одним именем
    core.agentHello({ id: 'a', name: 'Claude Code' });
    core.agentHello({ id: 'b', name: 'Claude Code' });
    edit('a', '1');
    edit('a', '2');
    edit('b', '3');
    edit('a', '4');
    // Одна строка на агента: два живых сеанса — «2 сеанса», а не две строки
    expect(core.agents()).toMatchObject([{ name: 'Claude Code', online: true, edits: 4, sessions: 2 }]);
    expect(core.agents()).toHaveLength(1);
    // Сеансы ушли и пришли снова — счёт тот же, новые правки к нему прибавляются
    core.agentBye('a');
    core.agentBye('b');
    expect(core.agents()).toMatchObject([{ name: 'Claude Code', online: false, edits: 4 }]);
    expect(core.agents()[0]).not.toHaveProperty('sessions');
    core.agentHello({ id: 'c', name: 'Claude Code' });
    edit('c', '5');
    expect(core.agents()).toMatchObject([{ id: 'c', online: true, edits: 5, sessions: 1 }]);
    // Сеанс ушёл без «пока» (приложение закрыли, компьютер уснул), через минуту — новый сеанс того же агента:
    // строка одна, на связи, без зависшего «не на связи» рядом
    const real = Date.now;
    try {
      Date.now = () => real() + 60_000;
      expect(core.agents()).toMatchObject([{ name: 'Claude Code', online: false, edits: 5 }]);
      core.agentHello({ id: 'd', name: 'Claude Code' });
      expect(core.agents()).toHaveLength(1);
      expect(core.agents()).toMatchObject([{ id: 'd', online: true, edits: 5, sessions: 1 }]);
    } finally {
      Date.now = real;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('агент под прежним именем клиента — под нынешним: в списке «был» с его правками и в журнале', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-int-'));
  try {
    const dir = path.join(tmp, 'decks');
    fs.mkdirSync(path.join(dir, 'talk'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), 'title: Доклад\nslides:\n  - title: Первый\n');
    const core = createDecksCore({ dir, root: ROOT });
    // Записано прежней версией: имя клиента как есть
    core.apply('talk', { ops: [{ op: 'slide.set', slide: 1, set: { notes: 'а' } }], by: { kind: 'agent', id: 'x', name: 'local-agent-mode-slideria' } });
    const file = path.join(dir, '.slideria', 'agents.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ 'local-agent-mode-slideria': { name: 'local-agent-mode-slideria', seen: 1000, edits: 112 }, 'Локальный агент': { name: 'Локальный агент', seen: 2000, edits: 3 } }));
    expect(core.agents()).toMatchObject([{ name: 'Локальный агент', online: false, edits: 115, seen: 2000 }]);
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')))).toEqual(['Локальный агент']);
    expect(core.journal('talk').find((e) => e.by.kind === 'agent')?.by.name).toBe('Локальный агент');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('агенты, доступ, журнал скрипта, точки агента — отдельно от своих и у каждой правки', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-int-'));
  try {
    const dir = path.join(tmp, 'decks');
    fs.mkdirSync(path.join(dir, 'talk'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), 'title: Доклад\nslides:\n  - title: Первый\n');
    const core = createDecksCore({ dir, root: ROOT });
    const seen: string[] = [];
    core.on('agents', (list) => seen.push(list.map((a) => `${a.name}:${a.online}`).join(',')));
    expect(core.access()).toBe('edit');
    expect(() => core.setAccess('god')).toThrow('view, edit или all');

    core.agentHello({ id: 'a', name: 'Cursor' });
    expect(core.agents()).toMatchObject([{ id: 'a', name: 'Cursor', online: true, edits: 0 }]);
    core.agentBye('a');
    // Ушёл — остался в списке «был» (по имени, для «Cursor — был вчера»)
    expect(core.agents()).toMatchObject([{ name: 'Cursor', online: false }]);
    expect(seen).toEqual(['Cursor:true', 'Cursor:false']);

    // Журнал скрипта: лишние поля и неверные значения отбрасываются
    const e = core.recordScript('talk', { name: 'Оглавление', changes: [{ label: 'Новый слайд 2', slide: 2, now: 'Содержание', evil: 1 }, { nolabel: true }, 'x'], checkpoint: 'auto:../../etc' });
    expect(e.changes).toEqual([{ label: 'Новый слайд 2', slide: 2, now: 'Содержание' }]);
    expect(e.checkpoint).toBeUndefined();
    expect(core.journal('talk')[0]).toMatchObject({ by: { kind: 'script', name: 'Оглавление' } });
    expect(() => core.recordScript('talk', { name: '', changes: [] })).toThrow('имя скрипта');

    // 45 правок агента подряд: точка «после» одной — она же «до» следующей (46 файлов, а не 90), «Вернуть» есть
    // у каждой — срок хранения по дням, а не 40 штук; точки Ctrl+S не тронуты
    core.checkpoint('talk');
    for (let i = 0; i < 45; i++) core.apply('talk', { ops: [{ op: 'slide.set', slide: 1, set: { notes: `n${i}` } }], by: { kind: 'agent', id: 'a', name: 'Cursor' } });
    expect(core.checkpoints('talk')).toHaveLength(1);
    expect(fs.readdirSync(path.join(dir, '.checkpoints', 'talk', 'auto'))).toHaveLength(46);
    const agentLog = core.journal('talk').filter((x) => x.by.kind === 'agent');
    expect(agentLog).toHaveLength(45);
    expect(agentLog.every((x) => x.checkpoint && x.after)).toBe(true);
    // Точки уже нет (срок вышел) — у записи нет точек: «Вернуть» прячется, а не падает
    const oldest = agentLog.at(-1)!;
    fs.rmSync(path.join(dir, '.checkpoints', 'talk', 'auto', `${oldest.checkpoint!.slice(5)}.yaml`));
    expect(core.journal('talk').filter((x) => x.by.kind === 'agent').at(-1)).not.toHaveProperty('checkpoint');
    // Старые точки агента (старше 30 дней) уходят, но последние 40 остаются всегда
    const auto = path.join(dir, '.checkpoints', 'talk', 'auto');
    for (const f of fs.readdirSync(auto)) fs.rmSync(path.join(auto, f));
    for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(auto, `20240101-0000${String(i).padStart(2, '0')}.yaml`), `old ${i}`);
    core.apply('talk', { ops: [{ op: 'slide.set', slide: 1, set: { notes: 'свежая' } }], by: { kind: 'agent', id: 'a', name: 'Cursor' } });
    const left = fs.readdirSync(auto).sort();
    expect(left).toHaveLength(40);
    expect(left.at(-1)).not.toMatch(/^2024/);
    expect(core.agents()[0]).toMatchObject({ name: 'Cursor', edits: 46 });
    // Чужие id точек не читаются
    expect(() => core.readCheckpoint('talk', 'auto:../x')).toThrow('не найдена');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/** Запуск скрипта, как в песочнице (src/studio/script-worker.ts), но в Node: тот же набор функций */
async function runLikeWorker(code: string, deck: import('../../src/types').Deck, params: Record<string, unknown>) {
  const { applyOps, outline } = await import('../../src/engine/ops');
  let draft = deck;
  const changes: string[] = [];
  const logs: string[] = [];
  const m = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`) as { default: (a: unknown) => Promise<void> };
  await m.default({
    get deck() { return structuredClone(draft); }, outline: () => outline(draft), slide: 1, selection: [], params,
    apply(ops: unknown) { const r = applyOps(draft, Array.isArray(ops) ? ops : [ops]); draft = r.deck; changes.push(...r.changes); return r.changes; },
    log: (...a: unknown[]) => logs.push(a.join(' ')),
  });
  return { deck: draft, changes, logs };
}

test('встроенные скрипты и пример из docs/SCRIPTS.md работают на шаблоне', async () => {
  const { parse } = await import('yaml');
  const tpl = () => parse(fs.readFileSync(path.join(ROOT, 'templates', 'basic', 'deck.yaml'), 'utf8').replaceAll('{{title}}', 'Т'));
  const dir = path.join(ROOT, 'templates', 'scripts');
  const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
  const def = (f: string) => Object.fromEntries(parseScript(read(f), f, true, f).params.map((p) => [p.key, p.value]));

  const toc = await runLikeWorker(read('оглавление.js'), tpl(), def('оглавление.js'));
  expect(toc.changes).toEqual(['Новый слайд 2']);
  expect(toc.deck.slides[1]).toMatchObject({ id: 'toc', title: 'Содержание', body: [{ type: 'grid', columns: 2 }] });

  const tr = await runLikeWorker(read('переходы.js'), tpl(), { transition: 'push', ms: 500 });
  expect(tr.deck.slides.every((s) => s.transition === 'push' && s.transitionMs === 500)).toBe(true);

  const rep = await runLikeWorker(read('замены.js'), tpl(), { pairs: '[Компания] = Slideria\nпустая строка без знака' });
  expect(rep.changes).toEqual(['Замена текста: 1']);
  await expect(runLikeWorker(read('замены.js'), tpl(), { pairs: '' })).rejects.toThrow('Нет замен');

  const example = /```js\n([\s\S]*?)```/.exec(fs.readFileSync(path.join(ROOT, 'docs', 'SCRIPTS.md'), 'utf8'))![1];
  const ex = await runLikeWorker(example, tpl(), Object.fromEntries(parseScript(example, 'x', false, 'x.js').params.map((p) => [p.key, p.value])));
  expect(ex.logs[0]).toMatch(/^Номера — на \d+ слайдах$/);
  expect(ex.changes.length).toBeGreaterThan(5);
});

test('точки «когда открыли» и «когда закрыли», скрипт с точками, слайд по id, история уходит в корзину с презентацией', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-hist-'));
  try {
    const dir = path.join(tmp, 'decks');
    fs.mkdirSync(path.join(dir, 'talk'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), 'title: Доклад\nslides:\n  - id: intro\n    title: Первый\n  - title: Второй\n');
    const core = createDecksCore({ dir, root: ROOT });
    // Открыли — точка; закрыли, ничего не поменяв, — новой нет
    const open = core.checkpoint('talk', { kind: 'open' });
    expect(open).toMatchObject({ same: false, id: expect.stringMatching(/^open:/) });
    expect(core.checkpoint('talk', { kind: 'close' })).toMatchObject({ same: true, id: open.id });
    // Поправили и закрыли — точка «когда закрыли»; список «Версий» — с видами, новые первыми
    fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), 'title: Доклад 2\nslides:\n  - id: intro\n    title: Первый\n  - title: Второй\n');
    const close = core.checkpoint('talk', { kind: 'close' });
    expect(close).toMatchObject({ same: false, id: expect.stringMatching(/^close:/) });
    expect(core.checkpoints('talk').map((p) => p.kind)).toEqual(['close', 'open']);
    expect((core.readCheckpoint('talk', close.id).deck as { title: string }).title).toBe('Доклад 2');
    // Такая же, как точка агента, — тоже не повторяется
    const a = core.checkpoint('talk', { kind: 'auto' });
    expect(a.same).toBe(false);
    expect(core.checkpoint('talk', { kind: 'open' })).toMatchObject({ same: true });

    // Правка агента по слайду с id — в журнале и id: слайд найдётся и после перестановок
    const r = core.apply('talk', { ops: [{ op: 'slide.set', slide: 'intro', set: { notes: 'заметка' } }], by: { kind: 'agent', id: 'x', name: 'Claude Code' } });
    expect(r.changed).toBe(true);
    expect(core.journal('talk')[0].changes[0]).toMatchObject({ slide: 1, id: 'intro' });

    // Скрипт с точками до и после — «Вернуть» у него есть; чужие точки не принимаются
    const before = core.checkpoint('talk', { kind: 'auto' });
    fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), 'title: Доклад 3\nslides:\n  - id: intro\n    title: Первый\n');
    const after = core.checkpoint('talk', { kind: 'auto' });
    const s = core.recordScript('talk', { name: 'Оглавление', changes: [{ label: 'Новый слайд 2', slide: 2, id: 'toc' }], checkpoint: before.id, after: after.id });
    expect(s).toMatchObject({ checkpoint: before.id, after: after.id, changes: [{ id: 'toc' }] });
    expect(core.recordScript('talk', { name: 'Чужой', changes: [{ label: 'x' }], checkpoint: open.id, after: after.id })).not.toHaveProperty('checkpoint');

    // В корзину — вместе с точками и журналом; новая презентация с тем же именем — с чистой историей
    const { trashed } = await core.trash('talk');
    const binned = path.join(tmp, trashed);
    expect(fs.existsSync(path.join(binned, '.history', 'checkpoints', 'session'))).toBe(true);
    expect(fs.existsSync(path.join(binned, '.history', 'journal.jsonl'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.checkpoints', 'talk'))).toBe(false);
    fs.mkdirSync(path.join(dir, 'talk'));
    fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), 'title: Другой\nslides:\n  - title: Один\n');
    expect(core.checkpoints('talk')).toEqual([]);
    expect(core.journal('talk')).toEqual([]);
    // Вернули ту из корзины (перенесли папку обратно) — история на месте
    fs.rmSync(path.join(dir, 'talk'), { recursive: true });
    fs.renameSync(binned, path.join(dir, 'talk'));
    expect(core.checkpoints('talk').map((p) => p.id)).toEqual([close.id, open.id]);
    expect(core.journal('talk').map((e) => e.by.name)).toEqual(['Чужой', 'Оглавление', 'Claude Code']);
    expect(fs.existsSync(path.join(dir, 'talk', '.history'))).toBe(false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('«Не сохранять» при выходе: файл — как в точке, отброшенное — точкой «Не сохранено при выходе»', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-drop-'));
  try {
    const dir = path.join(tmp, 'decks');
    const file = path.join(dir, 'talk', 'deck.yaml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Комментарий и порядок полей — как в файле: возврат пишет текст точки, а не пересобранные данные
    const text = '# мой доклад\ntitle: Доклад\nslides:\n  - { title: Первый }\n';
    fs.writeFileSync(file, text);
    const core = createDecksCore({ dir, root: ROOT });
    const open = core.checkpoint('talk', { kind: 'open' });
    fs.writeFileSync(file, 'title: Черновик\nslides:\n  - title: Первый\n  - title: Лишний\n');
    const d = core.discard('talk', open.id);
    expect(d).toMatchObject({ changed: true, dropped: expect.stringMatching(/^drop:/) });
    expect(fs.readFileSync(file, 'utf8')).toBe(text);
    // В «Версиях» — первой; передумали — её данные на месте
    expect(core.checkpoints('talk').map((p) => p.kind)).toEqual(['drop', 'open']);
    expect((core.readCheckpoint('talk', d.dropped!).deck as { title: string }).title).toBe('Черновик');
    // Уже как в точке — ничего не меняется; чужой или пропавшей точки нет — ошибка
    expect(core.discard('talk', open.id)).toEqual({ changed: false });
    expect(() => core.discard('talk', 'open:20200101-000000')).toThrow('Контрольная точка не найдена');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('«Версии»: точка и правки агента — из истории в корзину, «Отменить» — обратно; «Очистить историю» оставляет точку выхода', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-hdel-'));
  try {
    const dir = path.join(tmp, 'decks');
    const file = path.join(dir, 'talk', 'deck.yaml');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'title: Доклад\nslides:\n  - title: Первый\n');
    const core = createDecksCore({ dir, root: ROOT });
    const open = core.checkpoint('talk', { kind: 'open' });
    fs.writeFileSync(file, 'title: Доклад 2\nslides:\n  - title: Первый\n');
    const mine = core.checkpoint('talk');
    // Две правки агента: точка «после» первой — она же «до» второй (3 файла)
    const by = { kind: 'agent', id: 'a', name: 'Cursor' } as const;
    core.apply('talk', { ops: [{ op: 'slide.set', slide: 1, set: { notes: 'a' } }], by });
    core.apply('talk', { ops: [{ op: 'slide.set', slide: 1, set: { notes: 'b' } }], by });
    const [second, first] = core.journal('talk');
    expect(first.t).not.toBe(second.t);
    const auto = path.join(dir, '.checkpoints', 'talk', 'auto');
    expect(fs.readdirSync(auto)).toHaveLength(3);
    const info = core.historyInfo('talk');
    expect(info).toMatchObject({ points: 2, edits: 2 });
    expect(info.bytes).toBeGreaterThan(0);

    // Своя точка — в корзину (.trash/talk-history-…), «Отменить» — на место, папка корзины уходит
    const p = core.dropHistory('talk', { points: [mine.id] });
    expect(p).toMatchObject({ token: expect.stringMatching(/^talk-history-\d{8}-\d{6}$/), points: 1, edits: 0 });
    expect(core.checkpoints('talk').map((x) => x.id)).toEqual([open.id]);
    const binned = path.join(dir, '.trash', p.token);
    expect(fs.existsSync(path.join(binned, 'checkpoints', `${mine.id}.yaml`))).toBe(true);
    expect(core.restoreHistory('talk', p.token)).toEqual({ points: 1, edits: 0 });
    expect(core.checkpoints('talk').map((x) => x.id)).toEqual([mine.id, open.id]);
    expect(fs.existsSync(binned)).toBe(false);

    // Первая правка — из журнала; её точка «до» уходит, «после» остаётся: она «до» второй правки
    const e = core.dropHistory('talk', { edits: [first.t] });
    expect(e).toMatchObject({ points: 0, edits: 1 });
    expect(core.journal('talk').map((x) => x.t)).toEqual([second.t]);
    expect(core.journal('talk')[0]).toMatchObject({ checkpoint: second.checkpoint, after: second.after });
    expect(fs.readdirSync(auto)).toHaveLength(2);
    // Сама презентация не меняется
    expect(fs.readFileSync(file, 'utf8')).toContain('notes: b');
    expect(core.restoreHistory('talk', e.token)).toEqual({ points: 1, edits: 1 });
    expect(core.journal('talk').map((x) => x.t)).toEqual([second.t, first.t]);
    expect(core.journal('talk')[1]).toMatchObject({ checkpoint: first.checkpoint, after: first.after });

    // Точка выхода (keep) не уходит; уже убранное — ошибка; чужие папки корзины не трогаются
    expect(() => core.dropHistory('talk', { points: [open.id], keep: open.id })).toThrow('уже нет');
    expect(() => core.restoreHistory('talk', 'other-history-20260101-000000')).toThrow('Не та');
    expect(() => core.restoreHistory('talk', 'talk-history-../../x')).toThrow('Не та');
    expect(() => core.restoreHistory('talk', 'talk-history-20200101-000000')).toThrow('уже нет');

    // «Очистить историю»: всё — в корзину, кроме точки выхода
    const c = core.clearHistory('talk', { keep: open.id });
    expect(core.checkpoints('talk').map((x) => x.id)).toEqual([open.id]);
    expect(core.journal('talk')).toEqual([]);
    expect(core.historyInfo('talk')).toMatchObject({ points: 1, edits: 0 });
    const bin = path.join(dir, '.trash', c.token);
    expect(fs.readFileSync(path.join(bin, 'journal.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
    expect(fs.readdirSync(path.join(bin, 'checkpoints', 'auto'))).toHaveLength(3);
    expect(fs.existsSync(path.join(bin, 'checkpoints', `${mine.id}.yaml`))).toBe(true);
    // Вторая очистка в ту же секунду — своя папка; без точки выхода — пусто совсем
    expect(core.clearHistory('talk').token).not.toBe(c.token);
    expect(core.historyInfo('talk')).toEqual({ points: 0, edits: 0, bytes: 0 });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('журнал: старше 90 дней — прочь, когда файл разросся', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-jrn-'));
  try {
    const dir = path.join(tmp, 'decks');
    fs.mkdirSync(path.join(dir, 'talk'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), 'title: Доклад\nslides:\n  - title: Первый\n');
    const core = createDecksCore({ dir, root: ROOT });
    const file = path.join(dir, '.slideria', 'journal', 'talk.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const old = { t: '2024-01-01T00:00:00.000Z', deck: 'talk', by: { kind: 'script', name: 'Старый' }, changes: [{ label: 'x'.repeat(200) }] };
    fs.writeFileSync(file, Array.from({ length: 1500 }, () => JSON.stringify(old)).join('\n') + '\n');
    core.recordScript('talk', { name: 'Свежий', changes: [{ label: 'Правка' }] });
    expect(core.journal('talk').map((e) => e.by.name)).toEqual(['Свежий']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
