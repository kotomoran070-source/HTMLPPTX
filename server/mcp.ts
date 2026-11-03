/**
 * MCP (Model Context Protocol): Claude и другие агенты читают и правят презентации инструментами
 * ([docs/MCP.md](../docs/MCP.md)). Здесь — инструменты и протокол (JSON-RPC 2.0) без транспорта: на компьютере —
 * stdin/stdout (scripts/mcp.mjs, serveStdio), в облаке — тот же обработчик сообщений по HTTP.
 *
 * Чтение — из файлов (ядро, server/core.ts). Правка — операциями (src/engine/ops.ts): если студия открыта
 * (server/running.ts), через её сервер — она подхватывает правку, как правку другого окна; иначе — в файлы.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OPS } from '../src/engine/ops';
import type { DecksCore } from './core';
import { runningServer } from './running';

/** Версии протокола, с которыми работаем: первая — новейшая */
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Ошибка инструмента: текст уходит агенту (isError), а не сбоем протокола */
class ToolError extends Error {}

export interface McpOptions {
  core: DecksCore;
  /** Папка презентаций: в ней же запись о работающем сервере студии */
  dir: string;
  /** Корень программы: справка по формату (docs/skills/slideria-deck) */
  root: string;
  version: string;
  /** Куда класть экспорт без указанного пути; по умолчанию — «Загрузки» */
  downloads?: string;
  /** Адрес сервера студии (тесты); по умолчанию — из записи в папке */
  server?: () => string | null;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Rec;
  annotations?: Rec;
  run(a: Rec): Promise<unknown>;
}

const str = (a: Rec, k: string, what: string): string => {
  const v = a[k];
  if (typeof v !== 'string' || !v.trim()) throw new ToolError(`${k}: ${what}`);
  return v.trim();
};

/** Список операций для описания инструмента — из каталога, чтобы описание не расходилось с кодом */
const opsHelp = () => Object.entries(OPS)
  .map(([name, d]) => `- ${name} { ${Object.keys(d.params).join(', ')} }: ${d.summary}. ${Object.entries(d.params).map(([k, v]) => `${k} — ${v}`).join('; ')}`)
  .join('\n');

const INSTRUCTIONS = `Slideria: презентации — это данные (deck.yaml), а не вёрстка: тема даёт цвета, шрифты и фон.
Как править: list_presentations → read_presentation (номера слайдов и объектов, ревизии rev) → edit_presentation
пакетом операций с expect — ревизиями слайдов, которые правите. Слайд поменяли в студии — правка не применится:
перечитайте. Поля слайдов и блоков — format_guide. Открытая студия показывает правки сразу.`;

export function createMcp(o: McpOptions) {
  const { core } = o;
  const server = o.server ?? (() => runningServer(o.dir));

  /** Правка через открытую студию; её нет (или не отвечает) — null, и правим файлы сами */
  async function viaStudio(cmd: string, body?: unknown): Promise<unknown | null> {
    const url = server();
    if (!url) return null;
    let r: Response;
    try {
      r = await fetch(`${url}/__htmlpptx/${cmd}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    } catch {
      return null;
    }
    const data = await r.json().catch(() => ({})) as Rec;
    if (!r.ok) throw new ToolError(String(data.error ?? `ошибка ${r.status}`));
    return data;
  }

  const deckName = (a: Rec) => {
    const name = str(a, 'presentation', 'имя презентации из list_presentations');
    if (!core.has(name)) throw new ToolError(`Нет презентации «${name}». Есть: ${core.names().join(', ') || 'ни одной'}`);
    return name;
  };

  const tools: Tool[] = [
    {
      name: 'list_presentations',
      title: 'Презентации',
      description: 'Презентации на этом компьютере: имя (для остальных инструментов), название, число слайдов, когда правили.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async run() {
        return core.list().map((d) => {
          try {
            const ol = core.outline(d.name) as { title: string; slides: unknown[] };
            return { name: d.name, title: ol.title, slides: ol.slides.length, edited: new Date(d.mtime).toISOString() };
          } catch (e) {
            return { name: d.name, error: (e as Error).message };
          }
        });
      },
    },
    {
      name: 'read_presentation',
      title: 'Содержание презентации',
      description: 'Краткое содержание: слайды с номером (n), id и ревизией (rev), заголовком, заметками, блоками раскладки (body) и свободными объектами (objects: номер n, вид, имя, первый текст, место). '
        + 'С slide — один слайд целиком, данные как в deck.yaml.',
      inputSchema: {
        type: 'object',
        properties: {
          presentation: { type: 'string', description: 'имя презентации' },
          slide: { type: ['integer', 'string'], description: 'номер слайда с 1 или его id — данные слайда целиком' },
        },
        required: ['presentation'],
      },
      annotations: { readOnlyHint: true },
      async run(a) {
        const name = deckName(a);
        try {
          return core.outline(name, a.slide === undefined ? {} : { slide: a.slide as number | string });
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
      },
    },
    {
      name: 'edit_presentation',
      title: 'Правка презентации',
      description: 'Правка пакетом операций: все или ни одной. Адреса: слайд — номер с 1 или id; объект — номер с 1 из objects слайда или его имя (name). '
        + 'Номера — после предыдущих операций того же пакета. В expect — { slide, rev } каждого слайда, который правите, из read_presentation: '
        + 'если его с тех пор поменяли, правка не применится — перечитайте. Поля set — JSON Merge Patch: объекты сливаются по полям, null удаляет поле, '
        + 'списки заменяются целиком. Поля слайдов и объектов — format_guide. Ответ — подписи правок и новые ревизии слайдов.\nОперации:\n' + opsHelp(),
      inputSchema: {
        type: 'object',
        properties: {
          presentation: { type: 'string', description: 'имя презентации' },
          ops: {
            type: 'array', minItems: 1,
            items: { type: 'object', properties: { op: { type: 'string', enum: Object.keys(OPS) } }, required: ['op'], additionalProperties: true },
            description: 'операции по порядку, например [{ "op": "slide.set", "slide": 2, "set": { "title": "…" } }]',
          },
          expect: {
            type: 'array',
            items: { type: 'object', properties: { slide: { type: ['integer', 'string'] }, rev: { type: 'string' } }, required: ['slide', 'rev'] },
            description: 'ревизии слайдов, какими их прочитали',
          },
        },
        required: ['presentation', 'ops'],
      },
      annotations: { destructiveHint: true },
      async run(a) {
        const name = deckName(a);
        const body = { ops: a.ops, expect: a.expect };
        let r = await viaStudio(`apply?deck=${encodeURIComponent(name)}&from=mcp`, body) as Rec | null;
        const studio = !!r;
        try {
          r ??= core.apply(name, { ...body, from: 'mcp' }) as unknown as Rec;
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        // Содержание целиком агенту не нужно после каждой правки: подписи и новые ревизии — продолжать без
        // перечитывания; подробности слайда — read_presentation
        const slides = ((r.outline as { slides?: { n: number; id?: string; rev: string; title?: string }[] })?.slides ?? [])
          .map((s) => ({ n: s.n, ...(s.id ? { id: s.id } : {}), rev: s.rev, ...(s.title ? { title: s.title } : {}) }));
        return { changed: r.changed, changes: r.changes, slides, ...(studio ? { studio: 'правка уже видна в открытой студии' } : {}) };
      },
    },
    {
      name: 'create_presentation',
      title: 'Новая презентация',
      description: 'Новая презентация: пустая (титульный слайд) или с примерами (шаблон из 31 слайда: схемы, графики, анимация). Ответ — имя для остальных инструментов.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'название' },
          sample: { type: 'boolean', description: 'с примерами (по умолчанию — пустая)' },
        },
        required: ['title'],
      },
      async run(a) {
        const title = str(a, 'title', 'название презентации');
        const via = await viaStudio(`create?title=${encodeURIComponent(title)}${a.sample ? '&sample=1' : ''}`);
        if (via) return via;
        try {
          return core.create(title, !!a.sample);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
      },
    },
    {
      name: 'export_html',
      title: 'Экспорт в HTML',
      description: 'Один HTML-файл презентации: открывается в любом браузере без интернета. mode: "show" — только показ (по умолчанию), "edit" — с режимом правки. '
        + 'compact — картинки сжаты в WebP. Без path — в папку «Загрузки». Ответ — путь и размер.',
      inputSchema: {
        type: 'object',
        properties: {
          presentation: { type: 'string', description: 'имя презентации' },
          mode: { type: 'string', enum: ['show', 'edit'] },
          compact: { type: 'boolean' },
          path: { type: 'string', description: 'полный путь к файлу .html' },
        },
        required: ['presentation'],
      },
      async run(a) {
        const name = deckName(a);
        if (a.mode !== undefined && a.mode !== 'show' && a.mode !== 'edit') throw new ToolError('mode: "show" или "edit"');
        let out: string;
        if (a.path !== undefined) {
          out = str(a, 'path', 'полный путь к файлу .html');
          if (!path.isAbsolute(out) || !/\.html?$/i.test(out)) throw new ToolError('path — полный путь к файлу .html');
        } else {
          const dl = o.downloads ?? path.join(os.homedir(), 'Downloads');
          out = path.join(fs.existsSync(dl) ? dl : os.homedir(), `${name}${a.mode === 'edit' ? '' : '.show'}.html`);
        }
        let html: Buffer;
        try {
          html = await core.exportHtml(name, { clean: a.mode !== 'edit', compact: !!a.compact, motion: false });
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, html);
        return { path: out, size: html.length };
      },
    },
    {
      name: 'format_guide',
      title: 'Формат презентации',
      description: 'Справка по данным презентации: шаблоны слайдов, блоки (графики, схемы, таблицы, формулы, медиа), свободные объекты холста, анимация. Прочитайте перед первой правкой.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async run() {
        const file = path.join(o.root, 'docs', 'skills', 'slideria-deck', 'SKILL.md');
        if (!fs.existsSync(file)) throw new ToolError('Справка не найдена в папке программы');
        return fs.readFileSync(file, 'utf8').replace(/^---[\s\S]*?---\s*/, '');
      },
    },
  ];
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function callTool(p: Rec): Promise<Rec> {
    const t = typeof p.name === 'string' ? byName.get(p.name) : undefined;
    if (!t) throw new RpcError(-32602, `Нет инструмента «${String(p.name)}»`);
    try {
      const out = await t.run(isRec(p.arguments) ? p.arguments : {});
      return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }] };
    } catch (e) {
      // Ошибка правки или неверные поля — агенту, чтобы он поправил запрос
      if (e instanceof ToolError || !(e instanceof RpcError)) return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
      throw e;
    }
  }

  /** Одно сообщение JSON-RPC; ответ — для запроса, null — для уведомления */
  async function handle(msg: unknown): Promise<Rec | null> {
    if (!isRec(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return isRec(msg) && ('result' in msg || 'error' in msg) ? null : { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Неверный запрос JSON-RPC' } };
    }
    const id = msg.id;
    const notification = id === undefined;
    const p = isRec(msg.params) ? msg.params : {};
    try {
      let result: Rec;
      switch (msg.method) {
        case 'initialize': {
          const want = typeof p.protocolVersion === 'string' ? p.protocolVersion : '';
          result = {
            protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'slideria', title: 'Slideria', version: o.version },
            instructions: INSTRUCTIONS,
          };
          break;
        }
        case 'ping': result = {}; break;
        case 'tools/list': result = { tools: tools.map(({ run: _run, ...t }) => t) }; break;
        case 'tools/call': result = await callTool(p); break;
        default:
          if (notification) return null;
          throw new RpcError(-32601, `Нет метода «${msg.method}»`);
      }
      return notification ? null : { jsonrpc: '2.0', id, result };
    } catch (e) {
      if (notification) return null;
      const err = e instanceof RpcError ? e : new RpcError(-32603, (e as Error).message);
      return { jsonrpc: '2.0', id, error: { code: err.code, message: err.message } };
    }
  }

  return { handle, tools: tools.map((t) => t.name) };
}

class RpcError extends Error {
  constructor(public code: number, message: string) { super(message); }
}

export type Mcp = ReturnType<typeof createMcp>;

/**
 * Транспорт stdio: сообщение — строка JSON. Запросы обрабатываются по порядку прихода, ответы — по готовности.
 * Ответ — когда вход закрыт и все ответы отправлены
 */
export function serveStdio(mcp: Mcp, input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<void> {
  return new Promise((done) => {
    let buf = '';
    let pending = 0;
    let ended = false;
    const finish = () => { if (ended && !pending) done(); };
    const one = (line: string) => {
      if (!line.trim()) return;
      let msg: unknown;
      try { msg = JSON.parse(line); } catch {
        output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Не JSON' } }) + '\n');
        return;
      }
      pending++;
      void mcp.handle(msg).then((r) => { if (r) output.write(JSON.stringify(r) + '\n'); }).finally(() => { pending--; finish(); });
    };
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        one(buf.slice(0, i).replace(/\r$/, ''));
        buf = buf.slice(i + 1);
      }
    });
    input.on('end', () => { one(buf); ended = true; finish(); });
  });
}
