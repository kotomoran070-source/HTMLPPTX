// Подставной сервис с API, совместимым с OpenAI (ChatGPT, DeepSeek, Qwen, OpenRouter, Ollama), для тестов чата
// «Агент» (server/agent-llm.ts): без сети и расходов. GET /models — список моделей; POST /chat/completions — ответ
// потоком (SSE), как у настоящего, по сценарию теста: текст, мысли (reasoning_content), вызов инструмента.
// Ключ «sk-test…» подходит, остальные — 401; open: true — без ключа (Ollama). Запросы записываются
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface OaTurn {
  /** Мысли перед ответом (reasoning_content, как у DeepSeek) */
  think?: boolean;
  text?: string;
  tool?: { name: string; input: unknown };
  delay?: number;
  /** Ответить ошибкой вместо потока */
  error?: { status: number; message: string };
  finish?: 'stop' | 'length' | 'content_filter';
}

export interface MockOpenAI {
  /** Адрес API — с /v1 на конце */
  url: string;
  queue(...turns: OaTurn[]): void;
  /** Тела запросов к /chat/completions */
  requests: { model: string; messages: { role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }[]; tools?: { type: string; function: { name: string } }[]; stream?: boolean; max_tokens?: number; max_completion_tokens?: number }[];
  lastAuth: () => string;
  close(): Promise<void>;
}

export async function startMockOpenAI(o: { port?: number; models?: { id: string; name?: string; images?: boolean; tools?: boolean }[]; open?: boolean } = {}): Promise<MockOpenAI> {
  const turns: OaTurn[] = [];
  const requests: MockOpenAI['requests'] = [];
  let auth = '';
  let n = 0;
  const fail = (res: http.ServerResponse, status: number, message: string) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message, type: 'invalid_request_error' } }));
  };
  const models = o.models ?? [{ id: 'mock-chat' }, { id: 'mock-embedding' }];

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!o.open && !/^sk-test/.test(auth)) return fail(res, 401, 'Incorrect API key provided');
    if (req.method === 'GET' && url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({
        object: 'list',
        data: models.map((m) => ({
          id: m.id, object: 'model', owned_by: 'mock',
          ...(m.name ? { name: m.name } : {}),
          ...(m.images !== undefined ? { architecture: { input_modalities: m.images ? ['text', 'image'] : ['text'] } } : {}),
          ...(m.tools !== undefined ? { supported_parameters: m.tools ? ['tools', 'max_tokens'] : ['max_tokens'] } : {}),
        })),
      }));
    }
    if (req.method !== 'POST' || url !== '/v1/chat/completions') return fail(res, 404, 'no such endpoint');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      const t = turns.shift() ?? { text: 'Готово.' };
      if (t.error) return fail(res, t.error.status, t.error.message);
      void stream(res, body.model, t, ++n);
    });
  });

  async function stream(res: http.ServerResponse, model: string, t: OaTurn, k: number): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    let closed = false;
    res.on('close', () => { closed = true; });
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) => {
      if (!closed) res.write(`data: ${JSON.stringify({ id: `chatcmpl-${k}`, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    chunk({ role: 'assistant', content: '' });
    if (t.think) chunk({ reasoning_content: 'Подумаю.' });
    for (const part of t.text?.match(/\S+\s*/g) ?? []) {
      if (closed) return;
      chunk({ content: part });
      if (t.delay) await wait(t.delay);
    }
    if (t.tool) {
      const json = JSON.stringify(t.tool.input);
      chunk({ tool_calls: [{ index: 0, id: `call_${k}`, type: 'function', function: { name: t.tool.name, arguments: '' } }] });
      for (let p = 0; p < json.length; p += 40) chunk({ tool_calls: [{ index: 0, function: { arguments: json.slice(p, p + 40) } }] });
    }
    chunk({}, t.finish ?? (t.tool ? 'tool_calls' : 'stop'));
    if (!closed) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }

  await new Promise<void>((r) => server.listen(o.port ?? 0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    queue: (...t) => { turns.push(...t); },
    requests,
    lastAuth: () => auth,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
