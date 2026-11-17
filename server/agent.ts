/**
 * Чат «Агент» студии ([docs/AGENT.md](../docs/AGENT.md)): модель по ключу пользователя правит открытую презентацию
 * теми же операциями, что агенты по MCP (src/engine/ops.ts) — с журналом, точками до и после и «Вернуть».
 * Сервисы — Claude (своим SDK) и любые с API, совместимым с OpenAI: ChatGPT, DeepSeek, Qwen, OpenRouter, Ollama,
 * свой адрес (server/agent-llm.ts).
 *
 * Ключи — только здесь, на сервере, у каждого сервиса свой: в программе они зашифрованы (safeStorage,
 * desktop/main.mjs), при разработке — в памяти до перезапуска (Claude — ещё из ANTHROPIC_API_KEY). Страница студии
 * ключей не видит.
 * Переписка — для каждой презентации в .slideria/chats/<имя>/: <id>.json и картинки рядом, в папке <id>/. В файл
 * презентации и в экспорт не попадает; уходит в корзину вместе с презентацией (server/core.ts).
 *
 * Ответ — поток событий (NDJSON): шаги, текст по мере написания, правки (запись журнала), конец или ошибка.
 */
import fs from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { DeckOutline } from '../src/engine/ops';
import type { DecksCore } from './core';
import { chatsDir, type JournalEntry } from './integrations';
import { formatGuide, opsHelp } from './mcp';
import { createShots, type Shooter } from './shot';
import { LlmError, PRESETS, apiBase, listModels, openaiTurn, pickModel, presetOf, type Model, type Preset, type ProviderId } from './agent-llm';

/** Модели Claude в шапке чата: первая — по умолчанию (у остальных сервисов список — у самого сервиса) */
export const AGENT_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'Лучше всех понимает оформление' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'Быстрее и дешевле' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'Самый быстрый — для простых правок' },
] as const;

/** Кто правит — в журнале и «Версиях» */
export const CHAT_AGENT = { kind: 'agent' as const, id: 'studio-chat', name: 'Агент' };

/**
 * Где хранятся ключи: app — зашифрованы программой; env — ключ Claude из ANTHROPIC_API_KEY; memory — до перезапуска
 * сервера. Значение — одной строкой: настройки сервисов (AgentConf) в JSON; старая строка-ключ — ключ Claude
 */
export interface KeyStore {
  readonly kind: 'app' | 'env' | 'memory';
  /** false — система хранит ключ без надёжного шифрования (Linux без хранилища паролей) */
  readonly secure?: boolean;
  get(): string | null;
  set(key: string): void;
  clear(): void;
}

/** Ключ при разработке: введённый в студии (в памяти) или ANTHROPIC_API_KEY */
export function devKeys(): KeyStore {
  let memory: string | null = null;
  const env = () => process.env.ANTHROPIC_API_KEY?.trim() || null;
  return {
    get kind() { return memory || !env() ? 'memory' as const : 'env' as const; },
    get: () => memory ?? env(),
    set: (k) => { memory = k; },
    clear: () => { memory = null; },
  };
}

/** Настройки сервиса: ключ, адрес (Ollama, свой), модель по умолчанию, список моделей, кто из них не видит картинки */
export interface ProviderConf { key?: string; url?: string; model?: string; models?: Model[]; noImages?: string[] }
export interface AgentConf { active?: ProviderId; providers: Partial<Record<ProviderId, ProviderConf>> }

/** Настройки из хранилища; строка не JSON — ключ Claude из прошлых версий (и ANTHROPIC_API_KEY) */
export function parseConf(raw: string | null): AgentConf {
  const t = raw?.trim();
  if (!t) return { providers: {} };
  if (!t.startsWith('{')) return { active: 'claude', providers: { claude: { key: t } } };
  try {
    const j = JSON.parse(t) as Partial<AgentConf>;
    return { active: presetOf(j.active)?.id, providers: j.providers && typeof j.providers === 'object' ? j.providers : {} };
  } catch {
    return { providers: {} };
  }
}

/** Картинка в сообщении: из студии — base64; в переписке — файлом рядом */
export interface ImageIn { name: string; type: string; data: string }
interface ImageRef { file: string; name: string; type: string; size: number }
interface Step { text: string; state: 'ok' | 'err' }
export type ChatItem =
  | { role: 'user'; t: string; text: string; images?: ImageRef[]; slide?: number }
  | { role: 'assistant'; t: string; model: string; text: string; steps: Step[]; edits: JournalEntry[]; ms: number; stop: Stop; error?: string };
type Stop = 'end' | 'stopped' | 'refusal' | 'max' | 'error';
interface ChatFile {
  id: string;
  deck: string;
  title: string;
  created: string;
  updated: string;
  model: string;
  /** Для панели */
  view: ChatItem[];
  /** Для Claude: картинки — ссылками на файлы рядом (data: «file:<имя>») */
  api: Anthropic.MessageParam[];
}

/** Событие ответа для страницы */
export type AgentEvent =
  | { type: 'chat'; id: string; title: string }
  | { type: 'think' }
  | { type: 'step'; key: string; text: string; state: 'run' | 'ok' | 'err' }
  | { type: 'text'; delta: string }
  | { type: 'edit'; entry: JournalEntry; slides: number[] }
  | { type: 'done'; stop: Stop; ms: number }
  | { type: 'error'; code: 'key' | 'rate' | 'busy' | 'net' | 'images' | 'other'; message: string };

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES = 6;
/** Шагов «модель → инструменты» в одном ответе — с запасом на большую задачу, но не бесконечно */
const MAX_ROUNDS = 40;
/** Данные открытого слайда в сообщении — до такого размера; больше — агент читает сам */
const SLIDE_CONTEXT = 24_000;
/** Картинки слайдов за один вызов view_slides и их ширина по умолчанию: 960 — читается мелкий текст, а картинка
 * стоит модели втрое меньше, чем 1280 */
const VIEW_MAX = 4;
const VIEW_WIDTH = 960;

const SYSTEM = `Ты — агент в студии Slideria: правишь презентацию, которая открыта у пользователя, по его просьбе. Пиши по-русски, коротко и по делу.

Как устроено: презентация — данные (deck.yaml), а не вёрстка: тема даёт цвета, шрифты и фон. Читай — read_presentation (номера слайдов и объектов, ревизии rev), правь — edit_presentation пакетом операций с expect — ревизиями слайдов, которые правишь. Поля слайдов, блоков и объектов — format_guide: загляни туда перед первой правкой, если не уверен в полях.

Правила:
- В каждом сообщении пользователя есть <studio>: какой слайд открыт и его данные. «Этот слайд», «здесь» — он.
- Делай то, о чём просят, и не трогай остального: оформление и тексты, о которых не просили, остаются как есть.
- Не выдумывай цифры и факты. Нужны данные со скриншота — бери со скриншота; не разобрать — спроси.
- Картинку из сообщения на слайд — сначала use_attachment, потом её путь в данных слайда.
- Каждую правку пользователь сразу видит на слайде; перед ней ставится контрольная точка, вернуть можно одной кнопкой.
- Правка не прошла (слайд поменяли) — перечитай слайд и повтори.
- После правок — одна-две фразы: что поменял (для чисел и коротких текстов — было → стало). Без заголовков и длинных списков.
- Вопрос без просьбы что-то поменять — просто ответь, ничего не правя.`;

/** Модель видит картинки и есть браузер для снимков — она ещё и смотрит, как вышло */
const SEE = `
- После правки, которая меняет вид слайда (тексты, размеры, расположение, новые объекты, оформление), посмотри на результат — view_slides — и поправь, если текст вылезает или обрезан, объекты наложились или что-то не читается. Заметки и правку пары слов можно не смотреть.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_presentation',
    description: 'Краткое содержание открытой презентации: слайды с номером (n), id и ревизией (rev), заголовком, заметками, блоками раскладки (body) и свободными объектами (objects: номер n, вид, имя, первый текст, место). '
      + 'С slide — один слайд целиком, данные как в deck.yaml.',
    input_schema: {
      type: 'object',
      properties: { slide: { type: ['integer', 'string'], description: 'номер слайда с 1 или его id — данные слайда целиком' } },
      additionalProperties: false,
    },
  },
  {
    name: 'edit_presentation',
    description: 'Правка открытой презентации пакетом операций: все или ни одной. Адреса: слайд — номер с 1 или id; объект — номер с 1 из objects слайда или его имя (name). '
      + 'Номера — после предыдущих операций того же пакета. В expect — { slide, rev } каждого слайда, который правишь, из read_presentation или <studio>: '
      + 'если его с тех пор поменяли, правка не применится — перечитай. Поля set — JSON Merge Patch: объекты сливаются по полям, null удаляет поле, '
      + 'списки заменяются целиком. Поля слайдов и объектов — format_guide. Ответ — подписи правок и новые ревизии слайдов.\nОперации:\n' + opsHelp(),
    input_schema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array', minItems: 1,
          items: { type: 'object', properties: { op: { type: 'string' } }, required: ['op'], additionalProperties: true },
          description: 'операции по порядку, например [{ "op": "slide.set", "slide": 2, "set": { "title": "…" } }]',
        },
        expect: {
          type: 'array',
          items: { type: 'object', properties: { slide: { type: ['integer', 'string'] }, rev: { type: 'string' } }, required: ['slide', 'rev'] },
          description: 'ревизии слайдов, какими их прочитали',
        },
      },
      required: ['ops'],
    },
    eager_input_streaming: true,
  },
  {
    name: 'format_guide',
    description: 'Справка по данным презентации: шаблоны слайдов, блоки (графики, схемы, таблицы, формулы, медиа), свободные объекты холста, анимация.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'use_attachment',
    description: 'Картинку, которую пользователь приложил к сообщению, — в файлы презентации. Ответ — путь (./assets/…) для данных слайда: src картинки-объекта или блока.',
    input_schema: {
      type: 'object',
      properties: { image: { type: 'integer', description: 'номер вложения в этом разговоре (с 1, по порядку — как в <studio>)' } },
      required: ['image'],
      additionalProperties: false,
    },
  },
];

const VIEW_TOOL: Anthropic.Tool = {
  name: 'view_slides',
  description: 'Как слайды выглядят на самом деле: картинки в конечном виде (все шаги показа открыты, анимации доиграны). '
    + 'Смотри после правки, которая меняет вид: текст не вылезает и не обрезан, объекты не наложились, всё читается и выровнено. '
    + `Нашёл огрех — поправь и посмотри снова. slides — номер с 1 или id, или список (до ${VIEW_MAX}). Перед каждой картинкой — подпись: номер, id, rev и заголовок.`,
  input_schema: {
    type: 'object',
    properties: {
      slides: { type: ['integer', 'string', 'array'], items: { type: ['integer', 'string'] }, maxItems: VIEW_MAX, description: 'слайд (номер с 1 или id) или список слайдов' },
      width: { type: 'integer', minimum: 480, maximum: 1280, description: `ширина картинки, по умолчанию ${VIEW_WIDTH}` },
    },
    required: ['slides'],
    additionalProperties: false,
  },
};

/** Ошибка инструмента: текст уходит агенту (is_error), разговор продолжается */
class ToolError extends Error {}

const now = () => new Date().toISOString();
const newId = () => `${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
const ID_RE = /^\d{14}-[a-z0-9]{1,8}$/;
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

export interface AgentOptions {
  core: DecksCore;
  keys: KeyStore;
  /** Адрес Claude API (тесты — подставной сервер); по умолчанию — api.anthropic.com */
  baseURL?: string;
  /** Адрес сервисов OpenAI вместо их своих (тесты — подставной сервер); Ollama и свой адрес — как задали */
  openaiURL?: string;
  /** Невидимый браузер для картинок слайдов (server/shot.ts): агент смотрит, как вышло. Нет — не смотрит */
  shoot?: Shooter;
  /** Повторы запроса при сбое сети или перегрузке (SDK) — тесты без них */
  maxRetries?: number;
  log?: (m: string) => void;
}

/**
 * SDK Claude грузится при первом обращении к Claude, а не при запуске сервера: его загрузка — 80–100 мс из
 * 170–250 мс запуска кода сервера (docs/PERF.md), а чат «Агент» нужен не всем и не сразу
 */
let sdk: typeof Anthropic | null = null;
const loadSdk = async (): Promise<typeof Anthropic> => (sdk ??= (await import('@anthropic-ai/sdk')).default);
type SdkError = 'AuthenticationError' | 'PermissionDeniedError' | 'APIConnectionError' | 'APIUserAbortError' | 'APIError' | 'RateLimitError' | 'InternalServerError';
/** Ошибка — такого вида из SDK (до первого обращения к Claude SDK не загружен, и таких ошибок ещё не было) */
const isSdk = (e: unknown, name: SdkError): boolean => !!sdk && e instanceof sdk[name];

export function createAgentChat(o: AgentOptions) {
  const { core, keys } = o;
  const baseURL = o.baseURL || 'https://api.anthropic.com';
  /** Презентации, где агент сейчас отвечает: второй ответ параллельно — нет */
  const running = new Set<string>();
  const client = async (apiKey: string) => new (await loadSdk())({ apiKey, authToken: null, baseURL, maxRetries: o.maxRetries ?? 2, timeout: 10 * 60_000 });
  const shots = o.shoot ? createShots(core, o.shoot) : null;

  // ---------------- сервисы и ключи ----------------

  const conf = () => parseConf(keys.get());
  /** Записать настройки; ни одного сервиса — хранилище пустое */
  function save(c: AgentConf): void {
    if (!Object.keys(c.providers).length) keys.clear();
    else keys.set(JSON.stringify(c));
  }
  /** Сервис настроен: есть ключ (если он нужен), адрес и модель (свой адрес) */
  function ready(c: AgentConf, p: Preset): boolean {
    const v = c.providers[p.id];
    if (!v) return false;
    if (p.key === 'required' && !v.key) return false;
    return !p.userModel || !!(v.url && v.model);
  }
  /** Адрес API сервиса: в тестах — подставной (кроме тех, где адрес задают сами) */
  const baseOf = (p: Preset, url?: string) => (o.openaiURL && !p.userUrl ? o.openaiURL : apiBase(p, url));
  /** Модели сервиса для шапки: Claude — свои; остальные — как ответил сервис, с тем, что узнали о картинках */
  function modelsOf(c: AgentConf, p: Preset): Model[] {
    if (p.id === 'claude') return AGENT_MODELS.map((m) => ({ ...m, images: true }));
    const v = c.providers[p.id] ?? {};
    const list = v.models?.length ? v.models : v.model ? [{ id: v.model, name: v.model }] : [];
    const no = new Set(v.noImages ?? []);
    return list.map((m) => (no.has(m.id) ? { ...m, images: false } : { ...m }));
  }

  function status() {
    const c = conf();
    const p = presetOf(c.active);
    const active = p && ready(c, p) ? p : null;
    return {
      connected: !!active,
      provider: active?.id ?? null,
      store: keys.kind,
      secure: keys.secure !== false,
      models: active ? modelsOf(c, active) : [],
      model: active ? (active.id === 'claude' ? AGENT_MODELS[0].id : c.providers[active.id]?.model) : undefined,
      providers: PRESETS.map((x) => ({
        id: x.id, name: x.name, badge: x.badge, vendor: x.vendor, key: x.key, keyHint: x.keyHint, keysUrl: x.keysUrl, help: x.help,
        ok: x.ok, no: x.no, about: x.about, userUrl: !!x.userUrl, userModel: !!x.userModel,
        url: c.providers[x.id]?.url ?? x.url, model: c.providers[x.id]?.model,
        saved: ready(c, x),
      })),
    };
  }

  /** Проверить ключ у Claude (список моделей — бесплатно) */
  async function checkClaude(key: string): Promise<void> {
    if (!/^sk-ant-[\w-]{8,}$/.test(key)) throw new Error('Это не ключ Claude API: ключ начинается с «sk-ant-»');
    try {
      await (await client(key)).models.list({ limit: 1 });
    } catch (e) {
      if (isSdk(e, 'AuthenticationError') || isSdk(e, 'PermissionDeniedError')) throw new Error('Ключ не принят: проверьте, что ключ скопирован целиком и не отозван');
      if (isSdk(e, 'APIConnectionError')) throw new Error('Нет связи с Claude — проверьте интернет и попробуйте ещё раз');
      throw new Error(`Claude не принял ключ: ${(e as Error).message}`);
    }
  }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  /**
   * Подключить сервис: проверить ключ (список моделей — бесплатно), запомнить его настройки и сделать текущим.
   * Ключ не передан — сохранённый раньше: так переключаются между сервисами, не вводя ключ заново.
   * Старый вид запроса — { key } — ключ Claude
   */
  async function connect(body: unknown): Promise<ReturnType<typeof status>> {
    const b = (typeof body === 'string' ? { key: body } : body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const p = presetOf(b.provider ?? 'claude');
    if (!p) throw new Error('Нет такого сервиса');
    const c = conf();
    const prev = c.providers[p.id] ?? {};
    const key = str(b.key) || prev.key || '';
    const url = p.userUrl ? str(b.url) || prev.url || p.url : undefined;
    if (p.key === 'required' && !key) throw new Error(p.id === 'claude' ? 'Это не ключ Claude API: ключ начинается с «sk-ant-»' : 'Вставьте ключ');
    if (key && /\s/.test(key)) throw new Error('В ключе не должно быть пробелов — скопируйте его заново');
    let models: Model[] | undefined;
    let model: string | undefined;
    if (p.id === 'claude') await checkClaude(key);
    else {
      if (p.userUrl && !url) throw new Error('Укажите адрес API');
      try {
        models = await listModels(p, baseOf(p, url), key || undefined);
      } catch (e) {
        // Свой сервис может не отдавать список моделей — тогда хватит названной
        if (!(p.userModel && e instanceof LlmError && e.code === 'other')) throw new Error((e as Error).message);
        models = [];
      }
      if (p.userModel) {
        model = str(b.model) || prev.model;
        if (!model) throw new Error('Укажите модель');
        if (!models.some((m) => m.id === model)) models.unshift({ id: model, name: model });
      } else {
        if (!models.length) throw new Error(p.id === 'ollama' ? 'В Ollama нет моделей: скачайте, например, «ollama pull qwen3»' : `${p.name}: нет моделей, которые умеют вызывать инструменты`);
        model = str(b.model) && models.some((m) => m.id === str(b.model)) ? str(b.model) : pickModel(p, models);
      }
    }
    c.providers[p.id] = { ...(key ? { key } : {}), ...(url ? { url } : {}), ...(model ? { model } : {}), ...(models ? { models } : {}), ...(prev.noImages?.length ? { noImages: prev.noImages } : {}) };
    c.active = p.id;
    save(c);
    return status();
  }

  /** Модели по адресу, ещё не подключая: Ollama — что установлено на этом компьютере */
  async function probe(body: unknown): Promise<{ models: Model[]; model?: string }> {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const p = presetOf(b.provider);
    if (!p || p.proto !== 'openai') throw new Error('Нет такого сервиса');
    const key = str(b.key) || conf().providers[p.id]?.key || undefined;
    const models = await listModels(p, baseOf(p, p.userUrl ? str(b.url) || p.url : undefined), key);
    return { models, model: pickModel(p, models) };
  }

  /** Отключить сервис (по умолчанию — текущий): его ключ и настройки удаляются */
  function disconnect(body?: unknown): ReturnType<typeof status> {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const c = conf();
    const id = presetOf(b.provider)?.id ?? c.active;
    if (id) delete c.providers[id];
    if (!id || c.active === id) delete c.active;
    save(c);
    return status();
  }

  /** Модель не приняла картинки — запомнить: скрепка у неё больше не предлагается */
  function noImages(id: ProviderId, model: string): void {
    const c = conf();
    const v = c.providers[id];
    if (!v) return;
    v.noImages = [...new Set([...(v.noImages ?? []), model])];
    try { save(c); } catch { /* не записалось — узнаем снова в следующий раз */ }
  }

  // ---------------- переписка ----------------

  const folder = (deck: string) => chatsDir(core.dir, deck);
  const chatFile = (deck: string, id: string) => {
    if (!ID_RE.test(id)) throw new Error('Нет такого разговора');
    return path.join(folder(deck), `${id}.json`);
  };

  function load(deck: string, id: string): ChatFile {
    const f = chatFile(deck, id);
    if (!fs.existsSync(f)) throw new Error('Нет такого разговора');
    return JSON.parse(fs.readFileSync(f, 'utf8')) as ChatFile;
  }

  function store(c: ChatFile): void {
    fs.mkdirSync(folder(c.deck), { recursive: true });
    const f = chatFile(c.deck, c.id);
    fs.writeFileSync(f + '.tmp', JSON.stringify(c));
    fs.renameSync(f + '.tmp', f);
  }

  /** Разговоры презентации — новые первыми */
  function list(deck: string): { id: string; title: string; updated: string; model: string; messages: number }[] {
    const dir = folder(deck);
    if (!fs.existsSync(dir)) return [];
    const out: ReturnType<typeof list> = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as ChatFile;
        out.push({ id: c.id, title: c.title, updated: c.updated, model: c.model, messages: c.view.filter((x) => x.role === 'user').length });
      } catch { /* недописанный файл */ }
    }
    return out.sort((a, b) => b.updated.localeCompare(a.updated));
  }

  /** Разговор для панели: без истории для Claude */
  function read(deck: string, id: string): { id: string; title: string; model: string; view: ChatItem[] } {
    const c = load(deck, id);
    return { id: c.id, title: c.title, model: c.model, view: c.view };
  }

  function remove(deck: string, id: string): { ok: true } {
    const f = chatFile(deck, id);
    fs.rmSync(f, { force: true });
    fs.rmSync(path.join(folder(deck), id), { recursive: true, force: true });
    return { ok: true };
  }

  /** Картинка из разговора — для панели */
  function image(deck: string, id: string, file: string): { type: string; data: Buffer } {
    load(deck, id);
    if (!/^[\w.-]+$/.test(file)) throw new Error('Нет такой картинки');
    const p = path.join(folder(deck), id, file);
    if (!fs.existsSync(p)) throw new Error('Нет такой картинки');
    const ext = path.extname(file).slice(1).toLowerCase();
    return { type: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, data: fs.readFileSync(p) };
  }

  /**
   * История для модели: картинки — из файлов рядом с разговором. Снимки слайдов (view_slides) — только текущего
   * ответа (сообщения с номера from): прошлые уже устарели, а платить за них в каждом запросе незачем
   */
  function apiMessages(c: ChatFile, from = c.api.length): Anthropic.MessageParam[] {
    const dir = path.join(folder(c.deck), c.id);
    type Img = Anthropic.ImageBlockParam;
    const load = (b: Img, k: number): Anthropic.TextBlockParam | Img | null => {
      if (b.source.type !== 'base64') return b;
      const ref = b.source.data;
      const view = ref.startsWith('view:');
      if (!view && !ref.startsWith('file:')) return b;
      if (view && k < from) return { type: 'text', text: '[картинка слайда — была раньше; нужна снова — view_slides]' };
      const p = path.join(dir, ref.slice(5));
      return fs.existsSync(p) ? { ...b, source: { ...b.source, data: fs.readFileSync(p).toString('base64') } } : null;
    };
    return c.api.map((m, k) => (typeof m.content === 'string' ? m : {
      ...m,
      content: m.content.map((b) => {
        if (b.type === 'image') return load(b, k);
        if (b.type === 'tool_result' && Array.isArray(b.content)) {
          return { ...b, content: b.content.map((x) => (x.type === 'image' ? load(x, k) : x)).filter((x): x is NonNullable<typeof x> => !!x) as typeof b.content };
        }
        return b;
      }).filter((b): b is NonNullable<typeof b> => !!b),
    } as Anthropic.MessageParam));
  }

  /** Снимки слайдов → файлы рядом с разговором; в истории — ссылкой «view:<файл>» */
  async function viewSlides(c: ChatFile, a: Record<string, unknown>): Promise<{ step: string; blocks: Anthropic.ToolResultBlockParam['content'] }> {
    if (!shots) throw new ToolError('Картинки слайдов здесь недоступны');
    const refs = Array.isArray(a.slides) ? a.slides : [a.slides];
    if (!refs.length || refs.length > VIEW_MAX) throw new ToolError(`slides — от 1 до ${VIEW_MAX} слайдов`);
    const width = a.width === undefined ? VIEW_WIDTH : Number(a.width);
    if (!Number.isInteger(width) || width < 480 || width > 1280) throw new ToolError('width — целое число от 480 до 1280');
    let ol: DeckOutline;
    try { ol = core.outline(c.deck) as DeckOutline; } catch (e) { throw new ToolError((e as Error).message); }
    const list = refs.map((ref) => {
      const sl = typeof ref === 'number' ? ol.slides[ref - 1] : ol.slides.find((x) => x.id === ref);
      if (!sl) throw new ToolError(typeof ref === 'number' ? `Нет слайда ${ref}: слайды — с 1 по ${ol.slides.length}` : `Нет слайда с id «${String(ref)}»`);
      return sl;
    });
    let png: Buffer[];
    try { png = await shots.shoot(c.deck, { slides: list.map((x) => x.n), width }); } catch (e) { throw new ToolError((e as Error).message); }
    const dir = path.join(folder(c.deck), c.id);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Date.now().toString(36);
    const blocks: Anthropic.ToolResultBlockParam['content'] = list.flatMap((sl, k) => {
      const file = `v${stamp}-${k + 1}.png`;
      fs.writeFileSync(path.join(dir, file), png[k]);
      return [
        { type: 'text' as const, text: `Слайд ${sl.n}${sl.id ? ` (id ${sl.id})` : ''} · rev ${sl.rev}${sl.title ? ` · ${sl.title}` : ''}${sl.hidden ? ' · скрыт в показе' : ''}` },
        { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: `view:${file}` } },
      ];
    });
    const nums = list.map((x) => x.n);
    return { step: nums.length === 1 ? `Посмотрел слайд ${nums[0]}` : `Посмотрел слайды ${nums.join(', ')}`, blocks };
  }

  // ---------------- ответ ----------------

  /** Что открыто в студии — к сообщению пользователя */
  function context(deck: string, slide: number | undefined, attached: { n: number; ref: ImageRef }[]): string {
    const ol = core.outline(deck) as { title: string; slides: { n: number; id?: string; rev: string; title?: string }[] };
    const lines = [`Презентация «${ol.title}», ${ol.slides.length} ${plural(ol.slides.length, 'слайд', 'слайда', 'слайдов')}.`];
    const s = slide ? ol.slides[slide - 1] : undefined;
    if (s) {
      lines.push(`Открыт слайд ${s.n}${s.id ? ` (id: ${s.id})` : ''}, rev: ${s.rev}.`);
      const data = JSON.stringify((core.outline(deck, { slide: s.n }) as { data: unknown }).data);
      lines.push(data.length <= SLIDE_CONTEXT ? `Данные слайда ${s.n}: ${data}` : `Данные слайда ${s.n} большие — прочитай их read_presentation.`);
    } else lines.push('Слайд не указан: пользователь говорит о презентации в целом.');
    if (attached.length) lines.push(`Вложения в этом сообщении: ${attached.map((a) => `${a.n} — ${a.ref.name}`).join(', ')}.`);
    return `<studio>\n${lines.join('\n')}\n</studio>`;
  }

  /** Картинки сообщения → файлы рядом с разговором */
  function saveImages(c: ChatFile, images: unknown): ImageRef[] {
    if (images === undefined) return [];
    if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new Error(`Картинок в сообщении — не больше ${MAX_IMAGES}`);
    const dir = path.join(folder(c.deck), c.id);
    const before = c.view.reduce((n, x) => n + (x.role === 'user' ? x.images?.length ?? 0 : 0), 0);
    return images.map((im: Partial<ImageIn>, i) => {
      const type = String(im?.type ?? '');
      if (!IMAGE_TYPES.has(type)) throw new Error('Картинки — PNG, JPG, WebP или GIF');
      const data = Buffer.from(String(im?.data ?? ''), 'base64');
      if (!data.length) throw new Error('Пустая картинка');
      if (data.length > MAX_IMAGE) throw new Error(`Картинка «${im?.name}» больше 5 МБ`);
      const ext = type === 'image/jpeg' ? 'jpg' : type.slice(6);
      const file = `${before + i + 1}.${ext}`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), data);
      const name = String(im?.name ?? '').replace(/[\\/\0]/g, '').slice(0, 80) || `картинка.${ext}`;
      return { file, name, type, size: data.length };
    });
  }

  /** Вложение номер n разговора → файл презентации; ответ — путь для данных слайда */
  async function useAttachment(c: ChatFile, n: unknown): Promise<string> {
    const all = c.view.flatMap((x) => (x.role === 'user' ? x.images ?? [] : []));
    const ref = Number.isInteger(n) ? all[(n as number) - 1] : undefined;
    if (!ref) throw new ToolError(`Нет вложения ${String(n)}: в разговоре ${all.length} ${plural(all.length, 'картинка', 'картинки', 'картинок')}`);
    const data = fs.readFileSync(path.join(folder(c.deck), c.id, ref.file));
    const added = await core.addAsset(c.deck, ref.name.includes('.') ? ref.name : `${ref.name}.${ref.file.split('.').pop()}`, data);
    return added.path;
  }

  /**
   * Ответ агента на сообщение. emit — события странице по мере работы; signal — «Стоп».
   * Разговор записывается после ответа (и после ошибки — с тем, что успели)
   */
  async function send(deck: string, req: { chat?: unknown; text?: unknown; images?: unknown; slide?: unknown; model?: unknown }, emit: (e: AgentEvent) => void, signal: AbortSignal): Promise<void> {
    if (!core.has(deck)) throw new Error(`Презентация «${deck}» не найдена`);
    const cf = conf();
    const p = presetOf(cf.active);
    if (!p || !ready(cf, p)) throw new Error('Сначала подключите модель');
    const text = typeof req.text === 'string' ? req.text.trim() : '';
    if (!text && !Array.isArray(req.images)) throw new Error('Пустое сообщение');
    if (text.length > 20_000) throw new Error('Сообщение слишком длинное');
    const models = modelsOf(cf, p);
    const model = models.find((m) => m.id === req.model)?.id ?? (p.id === 'claude' ? AGENT_MODELS[0].id : cf.providers[p.id]?.model ?? models[0]?.id);
    if (!model) throw new Error('Выберите модель');
    const svc: Svc = { p, key: cf.providers[p.id]?.key ?? '', url: cf.providers[p.id]?.url, images: models.find((m) => m.id === model)?.images !== false };
    if (running.has(deck)) throw new Error('Агент уже отвечает в этой презентации');
    running.add(deck);
    const t0 = Date.now();
    let c: ChatFile;
    try {
      c = typeof req.chat === 'string' && req.chat
        ? load(deck, req.chat)
        : { id: newId(), deck, title: (text || 'Картинка').replace(/\s+/g, ' ').slice(0, 70), created: now(), updated: now(), model, view: [], api: [] };
    } catch (e) {
      running.delete(deck);
      throw e;
    }
    emit({ type: 'chat', id: c.id, title: c.title });
    const answer: Extract<ChatItem, { role: 'assistant' }> = { role: 'assistant', t: now(), model, text: '', steps: [], edits: [], ms: 0, stop: 'end' };
    try {
      const images = saveImages(c, req.images);
      const slide = Number.isInteger(req.slide) && (req.slide as number) > 0 ? req.slide as number : undefined;
      const numbered = images.map((ref, i) => ({ n: c.view.reduce((k, x) => k + (x.role === 'user' ? x.images?.length ?? 0 : 0), 0) + i + 1, ref }));
      c.view.push({ role: 'user', t: now(), text, ...(images.length ? { images } : {}), ...(slide ? { slide } : {}) });
      c.api.push({
        role: 'user',
        content: [
          ...images.map((im) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: im.type as 'image/png', data: `file:${im.file}` } })),
          { type: 'text', text: context(deck, slide, numbered) },
          { type: 'text', text: text || 'Посмотри картинку.' },
        ],
      });
      c.model = model;
      await loop(c, answer, svc, model, emit, signal);
    } catch (e) {
      answer.stop = 'error';
      if (e instanceof LlmError && e.code === 'images') noImages(p.id, model);
      const err = errorOf(e);
      answer.error = err.message;
      emit({ type: 'error', ...err });
    } finally {
      answer.ms = Date.now() - t0;
      if (c.view.length) {
        c.view.push(answer);
        c.updated = now();
        try { store(c); } catch (e) { o.log?.(`Чат «Агент»: переписка не записалась: ${(e as Error).message}`); }
      }
      running.delete(deck);
      emit({ type: 'done', stop: answer.stop, ms: answer.ms });
    }
  }

  /**
   * Один ход модели: ответ в формате Claude (текст, мысли, вызовы инструментов) и почему остановилась. Текст —
   * странице по мере написания; начало правки — шагом «Готовлю правку…»
   */
  async function turn(svc: Svc, model: string, c: ChatFile, from: number, answer: Extract<ChatItem, { role: 'assistant' }>, emit: (e: AgentEvent) => void, signal: AbortSignal): Promise<{ content: Anthropic.ContentBlockParam[]; stop: string }> {
    // Перед ответом текстом — абзац между кусками ответа на разных шагах
    let first = true;
    const onText = (delta: string) => {
      const d = first && answer.text && !answer.text.endsWith('\n') ? `\n\n${delta}` : delta;
      first = false;
      answer.text += d;
      emit({ type: 'text', delta: d });
    };
    const onTool = (id: string, name: string) => { if (name === 'edit_presentation') emit({ type: 'step', key: id, text: 'Готовлю правку…', state: 'run' }); };
    // Смотреть на слайды — если модель видит картинки и есть чем снимать
    const see = !!shots && svc.images;
    const system = see ? SYSTEM + SEE : SYSTEM;
    const tools = see ? [...TOOLS, VIEW_TOOL] : TOOLS;
    if (svc.p.proto === 'openai') {
      return openaiTurn({
        p: svc.p, base: baseOf(svc.p, svc.url), key: svc.key || undefined, model, system, tools, messages: apiMessages(c, from),
        images: svc.images, signal, retries: o.maxRetries, onText, onThink: () => emit({ type: 'think' }), onTool,
      });
    }
    const stream = (await client(svc.key)).messages.stream({
      model,
      max_tokens: 32_000,
      system,
      tools,
      messages: apiMessages(c, from),
      cache_control: { type: 'ephemeral' },
    }, { signal });
    stream.on('text', onText);
    stream.on('streamEvent', (ev) => {
      if (ev.type !== 'content_block_start') return;
      if (ev.content_block.type === 'thinking' || ev.content_block.type === 'redacted_thinking') emit({ type: 'think' });
      else if (ev.content_block.type === 'tool_use') onTool(ev.content_block.id, ev.content_block.name);
    });
    const msg = await stream.finalMessage();
    return { content: msg.content, stop: msg.stop_reason ?? 'end_turn' };
  }

  const userImages = (m: Anthropic.MessageParam | undefined) => !!m && typeof m.content !== 'string' && m.content.some((b) => b.type === 'image');
  const viewed = (m: Anthropic.MessageParam) => typeof m.content !== 'string' && m.content.some((b) => b.type === 'tool_result' && Array.isArray(b.content) && b.content.some((x) => x.type === 'image'));

  /** Модель ↔ инструменты, пока модель не ответит текстом (или «Стоп», отказ, предел шагов) */
  async function loop(c: ChatFile, answer: Extract<ChatItem, { role: 'assistant' }>, svc: Svc, model: string, emit: (e: AgentEvent) => void, signal: AbortSignal): Promise<void> {
    let jsonRetries = 0;
    // Сообщение пользователя этого ответа: снимки слайдов с него — в силе, прежние — пометкой
    const from = c.api.length - 1;
    let stepNo = 0;
    for (let round = 0; ; round++) {
      if (round >= MAX_ROUNDS) {
        answer.stop = 'max';
        const note = '\n\nОстановился: задача вышла слишком длинной. Напишите «продолжай», если нужно дальше.';
        answer.text += note;
        emit({ type: 'text', delta: note });
        return;
      }
      let msg: { content: Anthropic.ContentBlockParam[]; stop: string };
      try {
        msg = await turn(svc, model, c, from, answer, emit, signal);
        jsonRetries = 0;
      } catch (e) {
        if (signal.aborted || isSdk(e, 'APIUserAbortError')) {
          answer.stop = 'stopped';
          return;
        }
        // Модель посмотрела на слайд, а картинки, оказывается, не видит (заранее сервис не сказал): запомнить и
        // повторить шаг без картинок — пользователь их не присылал, обрывать ответ ошибкой о картинках незачем
        if (e instanceof LlmError && e.code === 'images' && svc.images && !userImages(c.api[from]) && c.api.slice(from + 1).some(viewed)) {
          noImages(svc.p.id, model);
          svc.images = false;
          continue;
        }
        // Ввод инструмента не разобрался как JSON — тот же шаг ещё раз (не больше двух раз подряд)
        const json = e instanceof LlmError ? e.code === 'json' : !isSdk(e, 'APIError') && !(e instanceof LlmError);
        if (!json || jsonRetries++ >= 2) throw e;
        continue;
      }
      if (msg.stop === 'refusal') {
        answer.stop = 'refusal';
        const note = (answer.text ? '\n\n' : '') + 'Модель отказалась выполнять эту просьбу.';
        answer.text += note;
        emit({ type: 'text', delta: note });
        return;
      }
      const uses = msg.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use');
      if (msg.stop === 'pause_turn') {
        c.api.push({ role: 'assistant', content: msg.content });
        continue;
      }
      if (!uses.length) {
        c.api.push({ role: 'assistant', content: msg.content });
        if (msg.stop === 'max_tokens') answer.stop = 'max';
        return;
      }
      // Ввод инструмента оборвался на пределе длины — не выполнять его
      if (msg.stop === 'max_tokens') throw new Error('Правка слишком велика для одного ответа — разбейте запрос на части');
      c.api.push({ role: 'assistant', content: msg.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        const stepKey = u.id || `s${++stepNo}`;
        try {
          const out = await runTool(c, u, (text) => emit({ type: 'step', key: stepKey, text, state: 'run' }), (entry, slides) => {
            answer.edits.push(entry);
            emit({ type: 'edit', entry, slides });
          });
          answer.steps.push({ text: out.step, state: 'ok' });
          emit({ type: 'step', key: stepKey, text: out.step, state: 'ok' });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: out.blocks ?? (typeof out.result === 'string' ? out.result : JSON.stringify(out.result)) });
        } catch (e) {
          const m = (e as Error).message;
          const step = u.name === 'edit_presentation' ? `Правка не прошла: ${m}` : m;
          answer.steps.push({ text: step, state: 'err' });
          emit({ type: 'step', key: stepKey, text: step, state: 'err' });
          results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: m });
        }
      }
      c.api.push({ role: 'user', content: results });
      if (signal.aborted) {
        answer.stop = 'stopped';
        return;
      }
    }
  }

  /** Инструмент → { step: подпись шага, result: ответ агенту } */
  async function runTool(c: ChatFile, u: Anthropic.ToolUseBlockParam, progress: (t: string) => void, edited: (entry: JournalEntry, slides: number[]) => void): Promise<{ step: string; result?: unknown; blocks?: Anthropic.ToolResultBlockParam['content'] }> {
    const a = (u.input && typeof u.input === 'object' ? u.input : {}) as Record<string, unknown>;
    switch (u.name) {
      case 'read_presentation': {
        const slide = a.slide;
        if (slide !== undefined && typeof slide !== 'number' && typeof slide !== 'string') throw new ToolError('slide — номер с 1 или id');
        progress(slide === undefined ? 'Читаю презентацию' : `Читаю слайд ${slide}`);
        let r: unknown;
        try { r = core.outline(c.deck, slide === undefined ? {} : { slide }); } catch (e) { throw new ToolError((e as Error).message); }
        const n = (r as { n?: number }).n;
        return { step: slide === undefined ? 'Прочитал презентацию' : `Прочитал слайд ${n ?? slide}`, result: r };
      }
      case 'edit_presentation': {
        progress('Правлю…');
        let r: ReturnType<DecksCore['apply']>;
        try {
          r = core.apply(c.deck, { ops: a.ops, expect: a.expect, from: 'agent-chat', by: CHAT_AGENT, own: true });
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        const slides = [...new Set((r.entry?.changes ?? []).map((ch) => ch.slide).filter((n): n is number => Number.isInteger(n)))];
        if (r.entry) edited(r.entry, slides);
        const brief = r.outline.slides.map((s) => ({ n: s.n, ...(s.id ? { id: s.id } : {}), rev: s.rev, ...(s.title ? { title: s.title } : {}) }));
        const step = !r.changed ? 'Правка ничего не поменяла'
          : r.changes.length === 1 ? r.changes[0]
            : `${r.changes.length} ${plural(r.changes.length, 'правка', 'правки', 'правок')}${slides.length ? ` · ${slides.length === 1 ? `слайд ${slides[0]}` : `слайды ${slides.join(', ')}`}` : ''}`;
        return { step, result: { changed: r.changed, changes: r.changes, slides: brief } };
      }
      case 'format_guide': {
        progress('Смотрю справку по формату');
        const g = formatGuide(core.root);
        if (!g) throw new ToolError('Справка не найдена в папке программы');
        return { step: 'Посмотрел справку по формату', result: g };
      }
      case 'view_slides': {
        const refs = Array.isArray(a.slides) ? a.slides : [a.slides];
        progress(refs.length === 1 ? `Смотрю слайд ${String(refs[0])}` : `Смотрю слайды ${refs.map(String).join(', ')}`);
        return viewSlides(c, a);
      }
      case 'use_attachment': {
        progress('Добавляю картинку в файлы презентации');
        const p = await useAttachment(c, a.image);
        return { step: 'Добавил картинку в файлы презентации', result: { path: p } };
      }
      default:
        throw new ToolError(`Нет инструмента «${u.name}»`);
    }
  }

  return { status, connect, probe, disconnect, list, read, remove, image, send, running: (deck: string) => running.has(deck) };
}

/** Текущий сервис ответа: пресет, ключ, адрес, видит ли модель картинки */
interface Svc { p: Preset; key: string; url?: string; images: boolean }

export type AgentChat = ReturnType<typeof createAgentChat>;

/** Ошибка сервиса → понятный текст и вид (страница по нему предлагает, что делать) */
function errorOf(e: unknown): { code: 'key' | 'rate' | 'busy' | 'net' | 'images' | 'other'; message: string } {
  if (e instanceof LlmError) return { code: e.code === 'tools' || e.code === 'json' ? 'other' : e.code, message: e.message };
  if (isSdk(e, 'AuthenticationError')) return { code: 'key', message: 'Ключ Claude недействителен — укажите новый ключ' };
  if (isSdk(e, 'PermissionDeniedError')) return { code: 'key', message: 'У ключа нет доступа к этой модели — выберите другую или другой ключ' };
  if (isSdk(e, 'RateLimitError')) return { code: 'rate', message: 'Слишком много запросов подряд — подождите минуту и повторите' };
  if (isSdk(e, 'InternalServerError')) return { code: 'busy', message: 'Claude сейчас перегружен — повторите чуть позже' };
  if (isSdk(e, 'APIConnectionError')) return { code: 'net', message: 'Нет связи с Claude — проверьте интернет' };
  if (isSdk(e, 'APIError')) return { code: 'other', message: `Claude: ${(e as Error).message}` };
  return { code: 'other', message: (e as Error)?.message ?? String(e) };
}
