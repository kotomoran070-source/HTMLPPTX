// Вход MCP программы (desktop/mcp-input.mjs): на Windows Electron подменяет process.stdin пустым, уже закрытым
// потоком — программа читает трубу агента (fd 0) сама. Та же ветка проверяется здесь, на трубе этой системы.
// И serveStdio: оборванный вход (только close, без end) — тоже конец, ответы дописаны
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { serveStdio } from '../../server/mcp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = pathToFileURL(path.join(ROOT, 'desktop', 'mcp-input.mjs')).href;

test('ветка Windows: труба агента читается с fd 0 целиком, конец входа виден', () => {
  const lines = Array.from({ length: 2000 }, (_, i) => JSON.stringify({ jsonrpc: '2.0', id: i, method: 'ping', params: { t: 'Привет '.repeat(20) } })).join('\n') + '\n';
  const code = `import(${JSON.stringify(MODULE)}).then(({ mcpInput }) => {
    const s = mcpInput('win32'); let n = 0; let text = '';
    s.setEncoding('utf8'); s.on('data', (d) => { text += d; });
    s.on('end', () => process.stdout.write(JSON.stringify({ kind: s.constructor.name, bytes: Buffer.byteLength(text), last: text.trimEnd().split('\\n').pop() })));
  });`;
  const r = spawnSync(process.execPath, ['-e', code], { input: lines, encoding: 'utf8', timeout: 20_000 });
  expect(r.stderr).toBe('');
  const out = JSON.parse(r.stdout) as { kind: string; bytes: number; last: string };
  expect(out.kind).toBe('Socket');
  expect(out.bytes).toBe(Buffer.byteLength(lines));
  expect(JSON.parse(out.last).id).toBe(1999);
});

test('serveStdio: вход оборвался без end — ответы на прочитанное дописаны, сервер закончил', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let out = '';
  output.setEncoding('utf8').on('data', (d: string) => { out += d; });
  let closed = 0;
  const mcp = {
    handle: async (m: { id: number }) => { await new Promise((r) => setTimeout(r, 30)); return { jsonrpc: '2.0', id: m.id, result: {} }; },
    close: async () => { closed++; },
  };
  const done = serveStdio(mcp as never, input, output);
  input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
  await new Promise((r) => setTimeout(r, 5));
  input.destroy();
  await done;
  expect(out.trim().split('\n').map((l) => JSON.parse(l).id)).toEqual([1, 2]);
  expect(closed).toBe(1);
});
