/**
 * Сервисы для чата «Агент» (server/agent.ts, docs/AGENT.md → «Сервисы»): пресеты и ход модели по протоколу,
 * совместимому с OpenAI. Claude — своим SDK в agent.ts; остальные (ChatGPT, DeepSeek, Qwen, OpenRouter, Ollama, свой
 * адрес) — здесь, одним кодом: история разговора хранится в формате Claude и переводится на ходу.
 * Особенности сервиса — в пресете: адрес, вид ключа, где его взять, что умеет; список моделей — у самого сервиса.
 */
import type Anthropic from '@anthropic-ai/sdk';

export type ProviderId = 'claude' | 'openai' | 'deepseek' | 'qwen' | 'openrouter' | 'ollama' | 'custom';

export interface Preset {
  id: ProviderId;
  /** На кнопке выбора */
  name: string;
  /** Пометка на кнопке */
  badge?: string;
  /** Куда уходит содержимое презентации; пусто — на этом компьютере или на указанный адрес */
  vendor: string;
  proto: 'anthropic' | 'openai';
  /** Адрес API по умолчанию */
  url: string;
  key: 'required' | 'optional' | 'none';
  keyHint: string;
  keysUrl?: string;
  help?: { text: string; url: string };
  /** Особенности строкой под пресетами: что хорошо и чего нет */
  ok: string[];
  no: string[];
  about?: string;
  /** Адрес задаёт человек (Ollama, свой сервис); модель — тоже (свой сервис) */
  userUrl?: boolean;
  userModel?: boolean;
  maxTokens: number;
  /** OpenAI у новых моделей принимает только max_completion_tokens, остальные — max_tokens */
  maxParam: 'max_tokens' | 'max_completion_tokens';
  /** Модель по умолчанию: первая из списка, которая есть у сервиса (точное имя или самое короткое с таким началом) */
  prefer: string[];
}

export interface Model {
  id: string;
  name: string;
  note?: string;
  /** Видит картинки: true — да, false — нет (сервис сказал или модель отказалась), нет поля — неизвестно */
  images?: boolean;
}

export const PRESETS: Preset[] = [
  {
    id: 'claude', name: 'Claude', vendor: 'Anthropic', proto: 'anthropic', url: 'https://api.anthropic.com',
    key: 'required', keyHint: 'sk-ant-…', keysUrl: 'https://platform.claude.com/settings/keys',
    ok: ['видит картинки', 'лучше всех понимает оформление'], no: [], maxTokens: 32_000, maxParam: 'max_tokens', prefer: ['claude-opus-5-5'],
  },
  {
    id: 'openai', name: 'ChatGPT', vendor: 'OpenAI', proto: 'openai', url: 'https://api.openai.com/v1',
    key: 'required', keyHint: 'sk-…', keysUrl: 'https://platform.openai.com/api-keys',
    ok: ['видит картинки'], no: [], maxTokens: 16_000, maxParam: 'max_completion_tokens', prefer: ['gpt-5', 'gpt-4.1', 'gpt-4o'],
  },
  {
    id: 'deepseek', name: 'DeepSeek', vendor: 'DeepSeek', proto: 'openai', url: 'https://api.deepseek.com',
    key: 'required', keyHint: 'sk-…', keysUrl: 'https://platform.deepseek.com/api_keys',
    ok: ['в разы дешевле'], no: ['картинки видят не все модели'], maxTokens: 8000, maxParam: 'max_tokens', prefer: ['deepseek-chat'],
  },
  {
    id: 'qwen', name: 'Qwen', vendor: 'Alibaba Cloud', proto: 'openai', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    key: 'required', keyHint: 'sk-…', keysUrl: 'https://www.alibabacloud.com/help/en/model-studio/get-api-key',
    ok: ['недорого'], no: ['картинки видят не все модели'], maxTokens: 8192, maxParam: 'max_tokens', prefer: ['qwen3-max', 'qwen-max', 'qwen-plus'],
  },
  {
    id: 'openrouter', name: 'OpenRouter', vendor: 'OpenRouter', proto: 'openai', url: 'https://openrouter.ai/api/v1',
    key: 'required', keyHint: 'sk-or-…', keysUrl: 'https://openrouter.ai/settings/keys',
    ok: ['сотни моделей по одному ключу'], no: [], maxTokens: 16_000, maxParam: 'max_tokens', prefer: ['anthropic/claude-sonnet', 'openai/gpt-5', 'deepseek/deepseek-chat'],
  },
  {
    id: 'ollama', name: 'Ollama', badge: 'бесплатно', vendor: '', proto: 'openai', url: 'http://localhost:11434',
    key: 'none', keyHint: '', help: { text: 'Как установить Ollama', url: 'https://ollama.com/download' },
    ok: ['без ключа и оплаты', 'без интернета'], no: ['маленькие модели правят хуже'], userUrl: true, maxTokens: 16_000, maxParam: 'max_tokens', prefer: ['qwen3'],
  },
  {
    id: 'custom', name: 'Другая', vendor: '', proto: 'openai', url: '',
    key: 'optional', keyHint: 'необязательно', ok: [], no: [], about: 'Любой сервис с API, совместимым с OpenAI: свой сервер, LM Studio, другие облака',
    userUrl: true, userModel: true, maxTokens: 8192, maxParam: 'max_tokens', prefer: [],
  },
];

export const presetOf = (id: unknown): Preset | undefined => PRESETS.find((p) => p.id === id);

/** Ошибка сервиса — понятным текстом; код подсказывает странице, что предложить */
export class LlmError extends Error {
  constructor(public code: 'key' | 'rate' | 'busy' | 'net' | 'other' | 'images' | 'tools' | 'json', message: string) {
    super(message);
  }
}

/** Адрес API: у Ollama — его часть, совместимая с OpenAI (/v1) */
export function apiBase(p: Preset, url: string | undefined): string {
  const u = (url || p.url).trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/i.test(u)) throw new LlmError('other', 'Адрес API — вида https://…');
  return p.id === 'ollama' && !/\/v1$/.test(u) ? `${u}/v1` : u;
}

/** Где спросить: имя в тексте ошибок */
const where = (p: Preset) => (p.id === 'custom' ? 'сервисом по этому адресу' : p.name);

async function call(p: Preset, url: string, key: string | undefined, init: RequestInit & { body?: string }, model?: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(p.id === 'openrouter' ? { 'X-Title': 'Slideria' } : {}) } });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new LlmError('net', p.id === 'ollama' ? 'Ollama не отвечает по этому адресу — запущена ли Ollama?' : `Нет связи с ${where(p)} — проверьте интернет и адрес`);
  }
  if (res.ok) return res;
  const raw = await res.text().catch(() => '');
  let msg = raw.slice(0, 300);
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    msg = (typeof j.error === 'string' ? j.error : j.error?.message) ?? j.message ?? msg;
  } catch { /* не JSON */ }
  const s = res.status;
  if (s === 401 || s === 403) throw new LlmError('key', `Ключ ${p.name} не принят: проверьте, что ключ скопирован целиком и не отозван`);
  if (s === 402) throw new LlmError('key', `${p.name}: на счёте не хватает средств`);
  if (s === 429) throw new LlmError('rate', 'Слишком много запросов подряд — подождите минуту и повторите');
  if (s >= 500) throw new LlmError('busy', `${p.name} сейчас перегружен — повторите чуть позже`);
  if (/does not support tools|tools? (are |is )?not supported|function calling is not|tool use is not/i.test(msg)) {
    throw new LlmError('tools', `Модель «${model}» не умеет вызывать инструменты — выберите другую${p.id === 'ollama' ? ', например qwen3' : ''}`);
  }
  if (/image|vision|multimodal|multi-modal|image_url|unknown variant/i.test(msg) && init.body?.includes('"image_url"')) {
    throw new LlmError('images', `Модель «${model}» не видит картинки — отправьте сообщение без них или выберите другую модель`);
  }
  if (s === 404) throw new LlmError('other', `${p.name}: ${msg || 'нет такого адреса или модели'}`);
  throw new LlmError('other', `${p.name}: ${msg || `ошибка ${s}`}`);
}

interface RawModel {
  id: string;
  name?: string;
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
}

/** Модели, которые не годятся для чата с инструментами (картинки, звук, векторы…) */
const NOT_CHAT = /(embed|rerank|tts|transcribe|whisper|audio|realtime|image|dall-e|moderation|search|asr|ocr|wanx|^wan|babbage|davinci|instruct)/i;

/** Список моделей у сервиса: он же проверяет ключ */
export async function listModels(p: Preset, base: string, key: string | undefined, signal?: AbortSignal): Promise<Model[]> {
  const res = await call(p, `${base}/models`, key, { method: 'GET', signal });
  const j = await res.json().catch(() => ({})) as { data?: RawModel[] };
  const raw = Array.isArray(j.data) ? j.data.filter((m) => typeof m?.id === 'string') : [];
  const out: Model[] = [];
  for (const m of raw) {
    if (NOT_CHAT.test(m.id)) continue;
    // ChatGPT — только модели для разговора; OpenRouter — только те, что вызывают инструменты
    if (p.id === 'openai' && !/^(gpt-|o\d|chatgpt)/.test(m.id)) continue;
    if (p.id === 'openrouter' && Array.isArray(m.supported_parameters) && !m.supported_parameters.includes('tools')) continue;
    const mods = m.architecture?.input_modalities;
    out.push({
      id: m.id,
      name: m.name || m.id,
      ...(Array.isArray(mods) ? { images: mods.includes('image') } : p.id === 'openai' ? { images: true } : {}),
    });
  }
  return p.id === 'openrouter' ? out : out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Модель по умолчанию: из предпочтений пресета, иначе первая */
export function pickModel(p: Preset, models: Model[]): string | undefined {
  for (const want of p.prefer) {
    const exact = models.find((m) => m.id === want);
    if (exact) return exact.id;
    const like = models.filter((m) => m.id.startsWith(want)).sort((a, b) => a.id.length - b.id.length)[0];
    if (like) return like.id;
  }
  return models[0]?.id;
}

// ---------------- перевод истории: формат Claude → OpenAI ----------------

type OaPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type OaMessage =
  | { role: 'system' | 'user'; content: string | OaPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const resultText = (c: Anthropic.ToolResultBlockParam['content']): string =>
  typeof c === 'string' ? c : (c ?? []).flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');

/** История разговора для сервиса OpenAI; images = false — картинки не отправляются (модель их не видит) */
export function toOpenAI(system: string, messages: Anthropic.MessageParam[], images: boolean): OaMessage[] {
  const out: OaMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push(m.role === 'user' ? { role: 'user', content: m.content } : { role: 'assistant', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      const calls = m.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }] : []));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    const image = (b: Anthropic.ImageBlockParam): OaPart | null => (b.source.type !== 'base64' ? null
      : images ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
        : { type: 'text', text: '[картинка не отправлена: модель не видит картинки]' });
    // Ответы инструментов — отдельными сообщениями role: tool, потом остальное от пользователя. Картинки в ответе
    // инструмента (view_slides) role: tool не принимает — они уходят в сообщение пользователя, с подписями
    const parts: OaPart[] = [];
    for (const b of m.content) {
      if (b.type !== 'tool_result') continue;
      const list = typeof b.content === 'string' ? [] : b.content ?? [];
      const pics = list.some((x) => x.type === 'image');
      out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: (b.is_error ? 'Ошибка: ' : '') + resultText(b.content) + (pics ? '\n[картинки — в следующем сообщении, с теми же подписями]' : '') });
      if (!pics) continue;
      for (const x of list) {
        const p = x.type === 'text' ? { type: 'text' as const, text: x.text } : x.type === 'image' ? image(x) : null;
        if (p) parts.push(p);
      }
    }
    for (const b of m.content) {
      if (b.type === 'text') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') {
        const p = image(b);
        if (p) parts.push(p);
      }
    }
    if (!parts.length) continue;
    // Без картинок — строкой: часть сервисов (DeepSeek) не принимает список частей
    out.push({ role: 'user', content: parts.every((x) => x.type === 'text') ? parts.map((x) => (x as { text: string }).text).join('\n\n') : parts });
  }
  return out;
}

export function toOpenAITools(tools: Anthropic.Tool[]) {
  return tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description ?? '', parameters: t.input_schema } }));
}

// ---------------- ход модели ----------------

export interface TurnResult {
  /** Ответ в формате Claude: текст и вызовы инструментов */
  content: Anthropic.ContentBlockParam[];
  stop: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
}

/** id вызова инструмента — в истории Claude допустимы только буквы, цифры, _ и - */
const safeId = (id: string, i: number) => (id.replace(/[^\w-]/g, '_') || `call_${i}`).slice(0, 64);

/**
 * Один ход: запрос потоком, текст — по мере написания (onText), начало вызова инструмента — onTool.
 * Сбой связи, лимит или перегрузка до начала ответа — повтор (retries раз, с паузой)
 */
export async function openaiTurn(o: {
  p: Preset; base: string; key?: string; model: string; system: string; tools: Anthropic.Tool[]; messages: Anthropic.MessageParam[];
  images: boolean; signal: AbortSignal; retries?: number;
  onText(delta: string): void; onThink(): void; onTool(id: string, name: string): void;
}): Promise<TurnResult> {
  const body = JSON.stringify({
    model: o.model,
    messages: toOpenAI(o.system, o.messages, o.images),
    tools: toOpenAITools(o.tools),
    stream: true,
    [o.p.maxParam]: o.p.maxTokens,
  });
  let res: Response | null = null;
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await call(o.p, `${o.base}/chat/completions`, o.key, { method: 'POST', body, signal: o.signal }, o.model);
    } catch (e) {
      const again = e instanceof LlmError && (e.code === 'net' || e.code === 'rate' || e.code === 'busy') && attempt < (o.retries ?? 2) && !o.signal.aborted;
      if (!again) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 3 ** attempt));
    }
  }
  if (!res.body) throw new LlmError('other', `${o.p.name}: пустой ответ`);

  let text = '';
  let thinking = false;
  let finish = '';
  const calls: { id: string; name: string; args: string; told: boolean }[] = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const onLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let j: { choices?: { delta?: Record<string, unknown>; finish_reason?: string | null }[]; error?: { message?: string } };
    try { j = JSON.parse(data) as typeof j; } catch { return; }
    if (j.error) throw new LlmError('other', `${o.p.name}: ${j.error.message ?? 'ошибка в ответе'}`);
    const ch = j.choices?.[0];
    if (!ch) return;
    const d = (ch.delta ?? {}) as { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] };
    if ((d.reasoning_content || d.reasoning) && !thinking) {
      thinking = true;
      o.onThink();
    }
    if (d.content) {
      text += d.content;
      o.onText(d.content);
    }
    for (const tc of d.tool_calls ?? []) {
      const i = tc.index ?? calls.length;
      const c = calls[i] ??= { id: '', name: '', args: '', told: false };
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments) c.args += tc.function.arguments;
      if (c.name && !c.told) {
        c.told = true;
        o.onTool(safeId(c.id, i), c.name);
      }
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k: number;
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k).trim();
        buf = buf.slice(k + 1);
        onLine(line);
      }
    }
    if (buf.trim()) onLine(buf.trim());
  } catch (e) {
    void reader.cancel().catch(() => {});
    if (o.signal.aborted || e instanceof LlmError) throw e;
    throw new LlmError('net', `Связь с ${where(o.p)} оборвалась посреди ответа — повторите`);
  }

  const content: Anthropic.ContentBlockParam[] = text ? [{ type: 'text', text }] : [];
  const used = calls.filter(Boolean);
  // Оборвалось на пределе длины — вызов инструмента недописан: его не выполняют (agent.ts), разбирать нечего
  const cut = finish === 'length';
  used.forEach((c, i) => {
    let input: unknown = {};
    if (c.args.trim()) {
      try { input = JSON.parse(c.args); } catch { if (!cut) throw new LlmError('json', 'ввод инструмента не разобрался'); }
    }
    content.push({ type: 'tool_use', id: safeId(c.id, i), name: c.name, input: input as Record<string, unknown> });
  });
  const stop = cut ? 'max_tokens' : used.length ? 'tool_use' : finish === 'content_filter' ? 'refusal' : 'end_turn';
  return { content, stop };
}
