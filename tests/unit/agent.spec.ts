// Чат «Агент» (server/agent.ts) на подставном Claude (tests/mock-claude.ts): ключ, ответ с правкой и журналом,
// поток событий, «Стоп», ошибки, картинки, переписка и корзина
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createDecksCore } from '../../server/core';
import { createAgentChat, devKeys, type AgentEvent } from '../../server/agent';
import { startMockClaude, type MockClaude } from '../mock-claude';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KEY = 'sk-ant-test-0123456789';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let mock: MockClaude;
test.beforeAll(async () => { mock = await startMockClaude(); });
test.afterAll(async () => { await mock.close(); });

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-agent-'));
  const dir = path.join(tmp, 'decks');
  fs.mkdirSync(path.join(dir, 'talk'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), 'title: Доклад\nslides:\n  - id: intro\n    title: Старый заголовок\n  - title: Второй\n');
  const core = createDecksCore({ dir, root: ROOT });
  const chat = createAgentChat({ core, keys: devKeys(), baseURL: mock.url, maxRetries: 0 });
  return { tmp, dir, core, chat, done: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

async function ask(chat: ReturnType<typeof setup>['chat'], body: Record<string, unknown>, stop?: (e: AgentEvent, ac: AbortController) => void): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const ac = new AbortController();
  await chat.send('talk', body, (e) => { events.push(e); stop?.(e, ac); }, ac.signal);
  return events;
}

test('ключ: проверка у Claude, не тот — понятный отказ; без ключа писать нельзя', async () => {
  const s = setup();
  try {
    expect(s.chat.status()).toMatchObject({ connected: false, store: 'memory' });
    await expect(s.chat.send('talk', { text: 'привет' }, () => {}, new AbortController().signal)).rejects.toThrow('Сначала подключите Claude');
    await expect(s.chat.connect('abc')).rejects.toThrow('начинается с «sk-ant-»');
    await expect(s.chat.connect('sk-ant-wrong-0123456789')).rejects.toThrow('Ключ не подошёл');
    expect(await s.chat.connect(KEY)).toMatchObject({ connected: true });
    expect(mock.lastAuth()).toBe(KEY);
    expect(s.chat.disconnect()).toMatchObject({ connected: false });
  } finally {
    s.done();
  }
});

test('ответ с правкой: шаги, текст по мере написания, правка в файле и журнале, переписка продолжается', async () => {
  const s = setup();
  try {
    await s.chat.connect(KEY);
    mock.requests.length = 0;
    mock.queue(
      { think: true, text: 'Сейчас поправлю.', tool: { name: 'edit_presentation', input: { ops: [{ op: 'slide.set', slide: 1, set: { title: 'Новый заголовок' } }] } } },
      { text: 'Поменял заголовок: «Старый заголовок» → «Новый заголовок».' },
    );
    const ev = await ask(s.chat, { text: 'Поменяй заголовок', slide: 1, model: 'claude-sonnet-5-5' });
    const types = ev.map((e) => e.type);
    expect(types[0]).toBe('chat');
    expect(types).toContain('think');
    expect(ev.filter((e) => e.type === 'step').map((e) => (e as { state: string }).state)).toEqual(['run', 'run', 'ok']);
    const edit = ev.find((e) => e.type === 'edit') as Extract<AgentEvent, { type: 'edit' }>;
    expect(edit.slides).toEqual([1]);
    expect(edit.entry).toMatchObject({ by: { name: 'Агент', id: 'studio-chat' }, checkpoint: expect.stringMatching(/^auto:/), after: expect.stringMatching(/^auto:/) });
    expect(ev.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('Сейчас поправлю.\n\nПоменял заголовок: «Старый заголовок» → «Новый заголовок».');
    expect(ev.at(-1)).toMatchObject({ type: 'done', stop: 'end' });
    expect(fs.readFileSync(path.join(s.dir, 'talk', 'deck.yaml'), 'utf8')).toContain('title: Новый заголовок');
    expect(s.core.journal('talk')[0].by.name).toBe('Агент');

    // Что ушло агенту: модель, инструменты, открытый слайд с данными; второй запрос — с результатом правки
    const [r1, r2] = mock.requests;
    expect(r1.model).toBe('claude-sonnet-5-5');
    expect(r1.tools!.map((t) => t.name)).toEqual(['read_presentation', 'edit_presentation', 'format_guide', 'use_attachment']);
    const first = JSON.stringify(r1.messages[0].content);
    expect(first).toContain('Открыт слайд 1 (id: intro)');
    expect(first).toContain('Старый заголовок');
    expect(JSON.stringify(r2.messages.at(-1))).toContain('tool_result');

    // Переписка: список, разговор; следующее сообщение — в тот же разговор, с историей
    const id = (ev[0] as { id: string }).id;
    expect(s.chat.list('talk')).toMatchObject([{ id, title: 'Поменяй заголовок', messages: 1, model: 'claude-sonnet-5-5' }]);
    const c = s.chat.read('talk', id);
    expect(c.view.map((x) => x.role)).toEqual(['user', 'assistant']);
    expect(c.view[1]).toMatchObject({ steps: [{ state: 'ok' }], edits: [{ by: { name: 'Агент' } }], stop: 'end' });
    mock.requests.length = 0;
    mock.queue({ text: 'Это второй слайд.' });
    await ask(s.chat, { chat: id, text: 'А что на втором?' });
    expect(mock.requests[0].messages.length).toBe(5);
    expect(s.chat.list('talk')[0].messages).toBe(2);
  } finally {
    s.done();
  }
});

test('«Стоп», ошибка правки уходит агенту, ошибки API — понятным текстом, второй ответ параллельно — нет', async () => {
  const s = setup();
  try {
    await s.chat.connect(KEY);
    // «Стоп» на первом куске текста
    mock.queue({ text: 'Очень длинный ответ, который пишется медленно и долго.', delay: 60 });
    const stopped = await ask(s.chat, { text: 'Расскажи' }, (e, ac) => { if (e.type === 'text') ac.abort(); });
    expect(stopped.at(-1)).toMatchObject({ type: 'done', stop: 'stopped' });
    const id = (stopped[0] as { id: string }).id;
    expect(s.chat.read('talk', id).view[1]).toMatchObject({ stop: 'stopped' });

    // Правка с неверной операцией — шаг с ошибкой, агенту — is_error, он отвечает дальше
    mock.requests.length = 0;
    mock.queue({ tool: { name: 'edit_presentation', input: { ops: [{ op: 'slide.fly', slide: 1 }] } } }, { text: 'Не вышло.' });
    const bad = await ask(s.chat, { chat: id, text: 'Сделай что-нибудь' });
    expect(bad.find((e) => e.type === 'step' && e.state === 'err')).toBeTruthy();
    expect(JSON.stringify(mock.requests[1].messages.at(-1))).toContain('"is_error":true');

    // Ключ отозвали, лимит, перегрузка
    for (const [status, type, code] of [[401, 'authentication_error', 'key'], [429, 'rate_limit_error', 'rate'], [529, 'overloaded_error', 'busy']] as const) {
      mock.queue({ error: { status, type, message: type } });
      const ev = await ask(s.chat, { text: 'привет' });
      expect(ev.find((e) => e.type === 'error')).toMatchObject({ code });
      expect(ev.at(-1)).toMatchObject({ type: 'done', stop: 'error' });
    }

    // Пока отвечает — второй ответ в этой презентации не начинается
    mock.queue({ text: 'медленно медленно медленно', delay: 80 });
    const ac = new AbortController();
    const one = s.chat.send('talk', { text: 'раз' }, () => {}, ac.signal);
    await expect(s.chat.send('talk', { text: 'два' }, () => {}, new AbortController().signal)).rejects.toThrow('уже отвечает');
    await one;
  } finally {
    s.done();
  }
});

test('картинка из сообщения: агенту — картинкой, на слайд — файлом презентации; переписка уходит в корзину с презентацией', async () => {
  const s = setup();
  try {
    await s.chat.connect(KEY);
    mock.requests.length = 0;
    mock.queue({ tool: { name: 'use_attachment', input: { image: 1 } } }, { text: 'Добавил.' });
    const ev = await ask(s.chat, { text: 'Поставь картинку', images: [{ name: 'схема.png', type: 'image/png', data: PNG }] });
    const img = (mock.requests[0].messages[0].content as { type: string; source?: { data: string } }[])[0];
    expect(img).toMatchObject({ type: 'image', source: { data: PNG } });
    const added = JSON.stringify(mock.requests[1].messages.at(-1));
    expect(added).toMatch(/\.\/assets\/[^"\\]+\.png/);
    expect(fs.readdirSync(path.join(s.dir, 'talk', 'assets')).some((f) => f.endsWith('.png'))).toBe(true);
    const id = (ev[0] as { id: string }).id;
    const c = s.chat.read('talk', id);
    expect(c.view[0]).toMatchObject({ images: [{ name: 'схема.png', type: 'image/png', file: '1.png' }] });
    expect(s.chat.image('talk', id, '1.png').data.length).toBeGreaterThan(10);
    await expect(ask(s.chat, { text: 'x', images: [{ name: 'a.bmp', type: 'image/bmp', data: PNG }] })).resolves.toContainEqual(expect.objectContaining({ type: 'error', message: expect.stringContaining('PNG, JPG') }));

    // В корзину — вместе с перепиской; вернули папку — разговоры на месте
    const { trashed } = await s.core.trash('talk');
    expect(fs.existsSync(path.join(s.tmp, trashed, '.history', 'chats', `${id}.json`))).toBe(true);
    fs.renameSync(path.join(s.tmp, trashed), path.join(s.dir, 'talk'));
    s.core.checkpoints('talk');
    expect(s.chat.list('talk').map((x) => x.id)).toContain(id);
    expect(s.chat.remove('talk', id)).toEqual({ ok: true });
    expect(() => s.chat.read('talk', id)).toThrow('Нет такого разговора');
  } finally {
    s.done();
  }
});
