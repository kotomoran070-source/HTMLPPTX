// Чат «Агент» на сервисах, совместимых с OpenAI (server/agent-llm.ts, server/agent.ts), — на подставном сервисе
// (tests/mock-openai.ts): пресеты и ключи у каждого свои, переключение без повторного ввода, ответ с правкой через
// инструменты, перевод истории, картинки и модели без инструментов — понятным текстом; взгляд на слайд картинкой;
// ключ Claude прошлых версий
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createDecksCore } from '../../server/core';
import { createAgentChat, devKeys, parseConf, type AgentEvent, type KeyStore } from '../../server/agent';
import { pickModel, PRESETS, toOpenAI } from '../../server/agent-llm';
import { startMockOpenAI, type MockOpenAI } from '../mock-openai';
import { startMockClaude, type MockClaude } from '../mock-claude';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let oa: MockOpenAI;
let claude: MockClaude;
test.beforeAll(async () => {
  oa = await startMockOpenAI({ models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }, { id: 'text-embedding-3' }] });
  claude = await startMockClaude();
});
test.afterAll(async () => { await oa.close(); await claude.close(); });

/** Хранилище как у программы: строка, которую сервер пишет и читает */
function memoryKeys(): KeyStore & { raw: () => string | null } {
  let v: string | null = null;
  return { kind: 'app', get: () => v, set: (x) => { v = x; }, clear: () => { v = null; }, raw: () => v };
}

/** Снимок без браузера: вместо слайдов — одна и та же картинка */
const shoot = async (r: { count: number }) => Array.from({ length: r.count }, () => Buffer.from(PNG, 'base64'));

function setup(keys: KeyStore = memoryKeys(), o: { shoot?: typeof shoot } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-llm-'));
  const dir = path.join(tmp, 'decks');
  fs.mkdirSync(path.join(dir, 'talk'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'talk', 'deck.yaml'), 'title: Доклад\nslides:\n  - id: intro\n    title: Старый заголовок\n');
  const core = createDecksCore({ dir, root: ROOT });
  const chat = createAgentChat({ core, keys, baseURL: claude.url, openaiURL: oa.url, maxRetries: 0, shoot: o.shoot });
  return { dir, core, chat, keys, done: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

async function ask(chat: ReturnType<typeof setup>['chat'], body: Record<string, unknown>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  await chat.send('talk', body, (e) => events.push(e), new AbortController().signal);
  return events;
}

test('пресеты: ключ у каждого сервиса свой, список моделей — у сервиса, переключение без повторного ввода', async () => {
  const s = setup();
  try {
    const st = s.chat.status();
    expect(st.connected).toBe(false);
    expect(st.providers.map((p) => p.id)).toEqual(['claude', 'openai', 'deepseek', 'qwen', 'openrouter', 'ollama', 'custom']);
    expect(st.providers.find((p) => p.id === 'ollama')).toMatchObject({ badge: 'бесплатно', key: 'none', url: 'http://localhost:11434' });
    await expect(s.chat.connect({ provider: 'deepseek', key: 'wrong-key-123' })).rejects.toThrow('Ключ DeepSeek не принят');
    await expect(s.chat.connect({ provider: 'deepseek' })).rejects.toThrow('Вставьте ключ');
    // Подключили DeepSeek: модели — от сервиса (без векторных), по умолчанию — deepseek-chat
    const ds = await s.chat.connect({ provider: 'deepseek', key: 'sk-test-deepseek' });
    expect(ds).toMatchObject({ connected: true, provider: 'deepseek', model: 'deepseek-chat' });
    expect(ds.models.map((m) => m.id)).toEqual(['deepseek-chat', 'deepseek-reasoner']);
    expect(oa.lastAuth()).toBe('sk-test-deepseek');
    // Claude — свой ключ; DeepSeek остаётся сохранённым
    await s.chat.connect({ provider: 'claude', key: 'sk-ant-test-0123456789' });
    const both = s.chat.status();
    expect(both.provider).toBe('claude');
    expect(both.providers.filter((p) => p.saved).map((p) => p.id)).toEqual(['claude', 'deepseek']);
    // Обратно на DeepSeek — ключ не вводят заново
    expect(await s.chat.connect({ provider: 'deepseek' })).toMatchObject({ provider: 'deepseek' });
    expect(oa.lastAuth()).toBe('sk-test-deepseek');
    // Ключи — в хранилище одной строкой; страница их не видит
    expect(JSON.parse((s.keys as ReturnType<typeof memoryKeys>).raw()!).providers.claude.key).toBe('sk-ant-test-0123456789');
    expect(JSON.stringify(s.chat.status())).not.toContain('sk-test');
    // «Отключить» — только этот сервис
    expect(s.chat.disconnect({ provider: 'deepseek' })).toMatchObject({ connected: false });
    expect(s.chat.status().providers.filter((p) => p.saved).map((p) => p.id)).toEqual(['claude']);
    expect(s.chat.disconnect({ provider: 'claude' }).connected).toBe(false);
    expect((s.keys as ReturnType<typeof memoryKeys>).raw()).toBeNull();
  } finally {
    s.done();
  }
});

test('ответ с правкой через инструменты OpenAI: мысли, шаги, текст, правка в файле; история с результатом', async () => {
  const s = setup();
  try {
    await s.chat.connect({ provider: 'deepseek', key: 'sk-test-deepseek' });
    oa.requests.length = 0;
    oa.queue(
      { think: true, text: 'Сейчас поправлю.', tool: { name: 'edit_presentation', input: { ops: [{ op: 'slide.set', slide: 1, set: { title: 'Новый заголовок' } }] } } },
      { text: 'Поменял заголовок.' },
    );
    const ev = await ask(s.chat, { text: 'Поменяй заголовок', slide: 1, model: 'deepseek-reasoner' });
    expect(ev.map((e) => e.type)).toContain('think');
    expect(ev.filter((e) => e.type === 'step').map((e) => (e as { state: string }).state)).toEqual(['run', 'run', 'ok']);
    expect((ev.find((e) => e.type === 'edit') as Extract<AgentEvent, { type: 'edit' }>).slides).toEqual([1]);
    expect(ev.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('Сейчас поправлю.\n\nПоменял заголовок.');
    expect(ev.at(-1)).toMatchObject({ type: 'done', stop: 'end' });
    expect(fs.readFileSync(path.join(s.dir, 'talk', 'deck.yaml'), 'utf8')).toContain('title: Новый заголовок');
    const [r1, r2] = oa.requests;
    expect(r1.model).toBe('deepseek-reasoner');
    expect(r1.stream).toBe(true);
    expect(r1.max_tokens).toBe(8000);
    expect(r1.tools!.map((t) => t.function.name)).toEqual(['read_presentation', 'edit_presentation', 'format_guide', 'use_attachment']);
    expect(r1.messages[0]).toMatchObject({ role: 'system' });
    // Без картинок — сообщение строкой: DeepSeek не принимает список частей
    expect(typeof r1.messages[1].content).toBe('string');
    expect(String(r1.messages[1].content)).toContain('Открыт слайд 1 (id: intro)');
    // Второй ход: вызов инструмента и его результат (role: tool)
    expect(r2.messages.at(-2)).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_1', function: { name: 'edit_presentation' } }] });
    expect(r2.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
  } finally {
    s.done();
  }
});

test('ошибки сервиса — понятным текстом: модель не видит картинки (скрепка у неё больше не предлагается), без инструментов, ключ отозван', async () => {
  const s = setup();
  try {
    await s.chat.connect({ provider: 'deepseek', key: 'sk-test-deepseek' });
    oa.queue({ error: { status: 400, message: 'unknown variant `image_url`, expected `text`' } });
    const ev = await ask(s.chat, { text: 'Что на картинке?', images: [{ name: 'a.png', type: 'image/png', data: PNG }] });
    expect(ev.find((e) => e.type === 'error')).toMatchObject({ code: 'images', message: 'Модель «deepseek-chat» не видит картинки — отправьте сообщение без них или выберите другую модель' });
    expect(s.chat.status().models.find((m) => m.id === 'deepseek-chat')).toMatchObject({ images: false });
    // Дальше картинки этой модели не уходят — вместо них пометка
    oa.requests.length = 0;
    oa.queue({ text: 'Ок.' });
    await ask(s.chat, { text: 'Ещё раз', images: [{ name: 'b.png', type: 'image/png', data: PNG }] });
    expect(JSON.stringify(oa.requests[0].messages)).not.toContain('image_url');
    expect(JSON.stringify(oa.requests[0].messages)).toContain('модель не видит картинки');
    oa.queue({ error: { status: 400, message: 'registry.ollama.ai/library/gemma does not support tools' } });
    expect((await ask(s.chat, { text: 'Привет' })).find((e) => e.type === 'error')).toMatchObject({ message: 'Модель «deepseek-chat» не умеет вызывать инструменты — выберите другую' });
    oa.queue({ error: { status: 401, message: 'Authentication Fails' } });
    expect((await ask(s.chat, { text: 'Привет' })).find((e) => e.type === 'error')).toMatchObject({ code: 'key' });
  } finally {
    s.done();
  }
});

test('Ollama и свой адрес: без ключа, модели по адресу; ChatGPT — max_completion_tokens', async () => {
  const local = await startMockOpenAI({ open: true, models: [{ id: 'llama3.2:3b' }, { id: 'qwen3:14b' }, { id: 'qwen3:8b' }] });
  const s = setup();
  try {
    const host = local.url.replace(/\/v1$/, '');
    // Ollama не запущена — понятный отказ; запущена — список установленных моделей, по умолчанию qwen3
    await expect(s.chat.probe({ provider: 'ollama', url: 'http://127.0.0.1:9' })).rejects.toThrow('Ollama не отвечает по этому адресу');
    expect(await s.chat.probe({ provider: 'ollama', url: host })).toMatchObject({ model: 'qwen3:8b', models: [{ id: 'llama3.2:3b' }, { id: 'qwen3:14b' }, { id: 'qwen3:8b' }] });
    const ol = await s.chat.connect({ provider: 'ollama', url: host, model: 'qwen3:14b' });
    expect(ol).toMatchObject({ connected: true, provider: 'ollama', model: 'qwen3:14b' });
    local.queue({ text: 'Привет с компьютера.' });
    await ask(s.chat, { text: 'Привет', model: 'qwen3:14b' });
    expect(local.lastAuth()).toBe('');
    // Свой адрес: модель — какую назвали, ключ необязателен
    await expect(s.chat.connect({ provider: 'custom', url: local.url })).rejects.toThrow('Укажите модель');
    expect(await s.chat.connect({ provider: 'custom', url: local.url, model: 'my-model' })).toMatchObject({ provider: 'custom', model: 'my-model' });
    // ChatGPT: только модели для разговора; у новых моделей — max_completion_tokens
    const gpt = await startMockOpenAI({ models: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }, { id: 'tts-1' }, { id: 'dall-e-3' }, { id: 'gpt-4o-realtime' }] });
    const s2 = createAgentChat({ core: s.core, keys: memoryKeys(), openaiURL: gpt.url, maxRetries: 0 });
    const st = await s2.connect({ provider: 'openai', key: 'sk-test-openai' });
    expect(st.models.map((m) => m.id)).toEqual(['gpt-5', 'gpt-5-mini']);
    expect(st.model).toBe('gpt-5');
    gpt.queue({ text: 'Ок.' });
    await s2.send('talk', { text: 'Привет' }, () => {}, new AbortController().signal);
    expect(gpt.requests[0]).toMatchObject({ max_completion_tokens: 16000 });
    expect(gpt.requests[0].max_tokens).toBeUndefined();
    await gpt.close();
  } finally {
    await local.close();
    s.done();
  }
});

test('OpenRouter: только модели с инструментами, картинки — по описанию модели; модель по умолчанию из предпочтений', async () => {
  const or = await startMockOpenAI({ models: [
    { id: 'meta/llama-guard', tools: false },
    { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini', tools: true, images: true },
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek: V3', tools: true, images: false },
  ] });
  const s = setup();
  try {
    const chat = createAgentChat({ core: s.core, keys: memoryKeys(), openaiURL: or.url, maxRetries: 0 });
    const st = await chat.connect({ provider: 'openrouter', key: 'sk-test-or' });
    expect(st.models).toEqual([
      { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini', images: true },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek: V3', images: false },
    ]);
    expect(st.model).toBe('openai/gpt-5-mini');
  } finally {
    await or.close();
    s.done();
  }
});

test('ключ Claude прошлых версий и ANTHROPIC_API_KEY — как ключ Claude; перевод истории и выбор модели', () => {
  expect(parseConf('sk-ant-old-key')).toEqual({ active: 'claude', providers: { claude: { key: 'sk-ant-old-key' } } });
  expect(parseConf(null)).toEqual({ providers: {} });
  expect(parseConf('{oops')).toEqual({ providers: {} });
  const env = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-env-0123456789';
  try {
    const s = setup(devKeys());
    expect(s.chat.status()).toMatchObject({ connected: true, provider: 'claude', store: 'env' });
    s.done();
  } finally {
    if (env === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = env;
  }
  // История Claude → OpenAI: мысли не уходят, вызовы инструментов и их результаты — по местам
  const msgs = toOpenAI('сис', [
    { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }, { type: 'text', text: 'Что это?' }] },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'хм', signature: 's' }, { type: 'text', text: 'Читаю.' }, { type: 'tool_use', id: 't1', name: 'read_presentation', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'нет такого', is_error: true }] },
  ], true);
  expect(msgs).toEqual([
    { role: 'system', content: 'сис' },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }, { type: 'text', text: 'Что это?' }] },
    { role: 'assistant', content: 'Читаю.', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_presentation', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 't1', content: 'Ошибка: нет такого' },
  ]);
  const p = PRESETS.find((x) => x.id === 'openai')!;
  expect(pickModel(p, [{ id: 'gpt-4o', name: '' }, { id: 'gpt-5.1-codex', name: '' }, { id: 'gpt-5', name: '' }])).toBe('gpt-5');
  expect(pickModel(p, [{ id: 'gpt-5.1-mini', name: '' }, { id: 'gpt-5.1', name: '' }])).toBe('gpt-5.1');
});

test('взгляд на слайд через OpenAI: картинки — сообщением после ответа инструмента; модель их не видит — шаг ещё раз без них', async () => {
  const s = setup(memoryKeys(), { shoot });
  try {
    await s.chat.connect({ provider: 'deepseek', key: 'sk-test-deepseek' });
    oa.requests.length = 0;
    oa.queue({ tool: { name: 'view_slides', input: { slides: 1 } } }, { text: 'Вижу заголовок.' });
    await ask(s.chat, { text: 'Как выглядит слайд?', model: 'deepseek-chat' });
    expect(oa.requests[0].tools!.map((t) => t.function.name)).toContain('view_slides');
    const msgs = oa.requests[1].messages;
    const tool = msgs.find((m) => m.role === 'tool')!;
    expect(tool.content).toMatch(/^Слайд 1 \(id intro\) · rev \w{8} · Старый заголовок\n\[картинки — в следующем сообщении/);
    const after = msgs[msgs.indexOf(tool) + 1];
    expect(after.role).toBe('user');
    expect(after.content).toEqual([
      { type: 'text', text: expect.stringMatching(/^Слайд 1 \(id intro\)/) },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
    ]);

    // Сервис отказал в картинке, а пользователь их не присылал: модель запоминается как «не видит картинки»,
    // шаг повторяется с пометкой вместо картинки и без инструмента — ответ не обрывается ошибкой
    oa.requests.length = 0;
    oa.queue(
      { tool: { name: 'view_slides', input: { slides: 1 } } },
      { error: { status: 400, message: 'unknown variant `image_url`, expected `text`' } },
      { text: 'Картинки этой модели недоступны, слайд прочитан по данным.' },
    );
    const ev = await ask(s.chat, { text: 'Посмотри ещё раз', model: 'deepseek-chat' });
    expect(ev.find((e) => e.type === 'error')).toBeUndefined();
    expect(ev.at(-1)).toMatchObject({ type: 'done', stop: 'end' });
    expect(oa.requests).toHaveLength(3);
    const retry = oa.requests[2];
    expect(JSON.stringify(retry.messages)).not.toContain('image_url');
    expect(JSON.stringify(retry.messages)).toContain('модель не видит картинки');
    expect(retry.tools!.map((t) => t.function.name)).not.toContain('view_slides');
    expect(s.chat.status().models.find((m) => m.id === 'deepseek-chat')).toMatchObject({ images: false });
  } finally {
    s.done();
  }
});
