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
