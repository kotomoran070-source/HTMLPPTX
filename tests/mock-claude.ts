// Подставной Claude API для тестов чата «Агент» (server/agent.ts): без сети и расходов. Отвечает потоком событий,
// как настоящий /v1/messages (stream: true), по сценарию теста — очереди ходов: текст, мысли, вызов инструмента.
// Ключ «sk-ant-test…» подходит, остальные — 401. Запросы записываются: тест сверяет, что ушло агенту
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Turn {
  /** Блок мыслей перед ответом */
  think?: boolean;
  /** Текст ответа — частями по словам */
  text?: string;
  /** Вызов инструмента (после текста) */
  tool?: { name: string; input: unknown };
  /** Пауза между частями текста, мс — чтобы успеть нажать «Стоп» */
  delay?: number;
  /** Ответить ошибкой API вместо потока */
  error?: { status: number; type: string; message: string };
  stop?: 'end_turn' | 'refusal' | 'max_tokens';
}

export interface MockClaude {
  url: string;
  /** Следующие ответы по порядку; кончились — «Готово.» */
  queue(...turns: Turn[]): void;
  /** Тела запросов к /v1/messages */
  requests: { model: string; messages: { role: string; content: unknown }[]; tools?: { name: string }[]; system?: unknown }[];
  /** Заголовок авторизации последнего запроса */
  lastAuth: () => string;
  close(): Promise<void>;
}

const OK_KEY = /^sk-ant-test/;

export async function startMockClaude(port = 0): Promise<MockClaude> {
  const turns: Turn[] = [];
  const requests: MockClaude['requests'] = [];
  let auth = '';
  let n = 0;
  const keyOf = (req: http.IncomingMessage) => {
    const a = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || String(req.headers['x-api-key'] ?? '');
    auth = a;
    return a;
  };
  const fail = (res: http.ServerResponse, status: number, type: string, message: string) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type, message } }));
  };

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    if (!OK_KEY.test(keyOf(req))) return fail(res, 401, 'authentication_error', 'invalid x-api-key');
    if (req.method === 'GET' && url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return void res.end(JSON.stringify({ data: [{ id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' }));
    }
    if (req.method !== 'POST' || url !== '/v1/messages') return fail(res, 404, 'not_found_error', 'no such endpoint');
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      const t = turns.shift() ?? { text: 'Готово.' };
      if (t.error) return fail(res, t.error.status, t.error.type, t.error.message);
      void stream(res, body.model, t, ++n);
    });
  });

  async function stream(res: http.ServerResponse, model: string, t: Turn, k: number): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    let closed = false;
    res.on('close', () => { closed = true; });
    const ev = (type: string, data: Record<string, unknown>) => { if (!closed) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`); };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    ev('message_start', { message: { id: `msg_${k}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } });
    let i = 0;
    if (t.think) {
      ev('content_block_start', { index: i, content_block: { type: 'thinking', thinking: '', signature: '' } });
      ev('content_block_delta', { index: i, delta: { type: 'thinking_delta', thinking: 'Подумаю.' } });
      ev('content_block_delta', { index: i, delta: { type: 'signature_delta', signature: 'sig' } });
      ev('content_block_stop', { index: i++ });
    }
    if (t.text) {
      ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      for (const part of t.text.match(/\S+\s*/g) ?? []) {
        if (closed) return;
        ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: part } });
        if (t.delay) await wait(t.delay);
      }
      ev('content_block_stop', { index: i++ });
    }
    if (t.tool) {
      const json = JSON.stringify(t.tool.input);
      ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: `toolu_${k}`, name: t.tool.name, input: {} } });
      for (let p = 0; p < json.length; p += 40) ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: json.slice(p, p + 40) } });
      ev('content_block_stop', { index: i++ });
    }
    ev('message_delta', { delta: { stop_reason: t.stop ?? (t.tool ? 'tool_use' : 'end_turn'), stop_sequence: null }, usage: { output_tokens: 20 } });
    ev('message_stop', {});
    if (!closed) res.end();
  }

  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const { port: p } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${p}`,
    queue: (...t) => { turns.push(...t); },
    requests,
    lastAuth: () => auth,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
