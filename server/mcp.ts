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
import { imageSize } from '../plugins/optimize';
import { OPS, type DeckOutline } from '../src/engine/ops';
import type { DecksCore } from './core';
import { clientTitle } from './integrations';
import { runningServer } from './running';
import { createShots, type Shooter } from './shot';

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
  /** Невидимый браузер для картинок слайдов (view_slides, server/shot.ts); нет — инструмент объясняет, как быть */
  shoot?: Shooter;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Rec;
  annotations?: Rec;
  run(a: Rec): Promise<unknown>;
}

/** Ответ инструмента готовыми частями (текст и картинки), а не JSON одной строкой */
class Content {
  constructor(public items: Rec[]) {}
}

/** Сколько слайдов снимать за раз: картинки дороги для агента */
const SHOT_MAX = 10;
/** Файл с диска или по ссылке — не больше (видео тоже) */
const MEDIA_MAX = 200 << 20;
/** Тип файла по ответу сервера, если в ссылке нет расширения */
const MEDIA_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'model/gltf-binary': 'glb', 'model/stl': 'stl', 'model/step': 'step',
};
const MEDIA_KIND: Record<string, string> = { mp4: 'video', webm: 'video', glb: 'model', stl: 'model', step: 'model', stp: 'model' };

const str = (a: Rec, k: string, what: string): string => {
  const v = a[k];
  if (typeof v !== 'string' || !v.trim()) throw new ToolError(`${k}: ${what}`);
  return v.trim();
};

/** Список операций для описания инструмента — из каталога, чтобы описание не расходилось с кодом */
export const opsHelp = () => Object.entries(OPS)
  .map(([name, d]) => `- ${name} { ${Object.keys(d.params).join(', ')} }: ${d.summary}. ${Object.entries(d.params).map(([k, v]) => `${k} — ${v}`).join('; ')}`)
  .join('\n');

/** Справка по формату презентации для агентов (docs/skills/slideria-deck); нет файла — null */
export function formatGuide(root: string): string | null {
  const file = path.join(root, 'docs', 'skills', 'slideria-deck', 'SKILL.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^---[\s\S]*?---\s*/, '') : null;
}

const INSTRUCTIONS = `Slideria: презентации — это данные (deck.yaml), а не вёрстка: тема даёт цвета, шрифты и фон.
Как править: list_presentations → read_presentation (номера слайдов и объектов, ревизии rev) → edit_presentation
пакетом операций с expect — ревизиями слайдов, которые правите. Слайд поменяли в студии — правка не применится:
перечитайте. Поля слайдов и блоков — format_guide. Где встречается текст — find_text.
После правки посмотрите на результат — view_slides (картинки слайдов): текст не вылезает, ничего не наложилось.
Не то — undo_edit отменит вашу правку, не трогая того, что поправили после. Картинки и видео — add_media
(файл с диска или ссылка), а не data: в данных. Открытая студия показывает правки сразу, перед каждой правкой
делается контрольная точка. Что можно агентам (смотреть; править и создавать; всё — и сохранять скрипты), решает
пользователь в студии.
Повторяющееся действие пользователь может запускать сам — save_script сохранит скрипт в его папку скриптов.`;

/** Как часто агент напоминает студии о себе: «на связи» — 40 с без напоминаний */
const HEARTBEAT_MS = 15_000;

export function createMcp(o: McpOptions) {
  const { core } = o;
  const server = o.server ?? (() => runningServer(o.dir));
  /** Кто мы для студии: имя клиента из рукопожатия (Claude Code, Cursor…); до него — просто «Агент» */
  const agent = { id: Math.random().toString(36).slice(2, 12), name: 'Агент', version: undefined as string | undefined };
  const by = () => ({ kind: 'agent' as const, id: agent.id, name: agent.name });
  let beat: ReturnType<typeof setInterval> | null = null;
  const shots = o.shoot ? createShots(core, o.shoot) : null;

  /** Сказать открытой студии, что мы на связи (студии нет — не страшно: правки пойдут в файлы) */
  async function hello(op: 'hello' | 'bye' = 'hello'): Promise<void> {
    const url = server();
    if (!url) return;
    try {
      await fetch(`${url}/__htmlpptx/agent${op === 'bye' ? '?op=bye' : ''}`, { method: 'POST', body: JSON.stringify(agent), signal: AbortSignal.timeout(3000) });
    } catch { /* студия закрылась */ }
  }

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

  /** Слайды из ответа apply и revert: номер, id, новая ревизия, заголовок — продолжать без перечитывания */
  const revs = (r: Rec) => ((r.outline as { slides?: { n: number; id?: string; rev: string; title?: string }[] })?.slides ?? [])
    .map((s) => ({ n: s.n, ...(s.id ? { id: s.id } : {}), rev: s.rev, ...(s.title ? { title: s.title } : {}) }));
  const editOf = (r: Rec) => (r.entry as { t?: string } | undefined)?.t;

  const deckName = (a: Rec) => {
    const name = str(a, 'presentation', 'имя презентации из list_presentations');
    if (!core.has(name)) throw new ToolError(`Нет презентации «${name}». Есть: ${core.names().join(', ') || 'ни одной'}`);
    return name;
  };

  /** Файл по ссылке: имя — из адреса (нет расширения — по типу из ответа), не больше MEDIA_MAX */
  async function download(url: string): Promise<{ data: Buffer; name: string }> {
    let u: URL;
    try { u = new URL(url); } catch { throw new ToolError('url — ссылка вида https://…'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ToolError('url — ссылка http или https');
    let r: Response;
    try {
      r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'Slideria' } });
    } catch (e) {
      throw new ToolError(`Не удалось скачать ${u.href}: ${(e as Error).message}`);
    }
    if (!r.ok) throw new ToolError(`Не удалось скачать ${u.href}: ответ ${r.status}`);
    if (Number(r.headers.get('content-length')) > MEDIA_MAX) throw new ToolError(`Файл больше ${MEDIA_MAX >> 20} МБ`);
    const data = Buffer.from(await r.arrayBuffer());
    if (data.length > MEDIA_MAX) throw new ToolError(`Файл больше ${MEDIA_MAX >> 20} МБ`);
    let base = decodeURIComponent(path.posix.basename(u.pathname)) || 'file';
    const mime = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (mime.startsWith('text/html')) throw new ToolError(`По ссылке — страница, а не файл: ${u.href}`);
    const ext = MEDIA_TYPES[mime];
    if (ext && path.extname(base).slice(1).toLowerCase() !== ext && !(ext === 'jpg' && /\.jpe?g$/i.test(base))) base = `${base.replace(/\.[^.]*$/, '')}.${ext}`;
    return { data, name: base };
  }

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
      name: 'find_text',
      title: 'Поиск по тексту',
      description: 'Где в презентации встречается текст: заголовки, тексты, пункты, ячейки таблиц, заметки — без учёта регистра (ё = е). '
        + 'Ответ — места с адресами для правки: слайд (slide — номер, id, rev), свободный объект (object — номер, name — имя) или блок '
        + 'раскладки (block), поле (field: title, items[2].text…) и кусок текста; total — сколько всего. Заменить везде — операция text.replace.',
      inputSchema: {
        type: 'object',
        properties: {
          presentation: { type: 'string', description: 'имя презентации' },
          query: { type: 'string', description: 'что найти' },
          slide: { type: ['integer', 'string'], description: 'только на этом слайде: номер с 1 или id' },
        },
        required: ['presentation', 'query'],
      },
      annotations: { readOnlyHint: true },
      async run(a) {
        const name = deckName(a);
        try {
          const r = core.find(name, a.query, a.slide === undefined ? {} : { slide: a.slide as number | string });
          return { total: r.total, hits: r.hits, ...(r.total > r.hits.length ? { note: `показаны первые ${r.hits.length}: уточните запрос или slide` } : {}) };
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
      },
    },
    {
      name: 'view_slides',
      title: 'Картинки слайдов',
      description: 'Как слайды выглядят на самом деле: картинки PNG в конечном виде (все шаги показа открыты, анимации доиграны). '
        + 'Смотрите после правки: текст не вылезает и не обрезан, объекты не наложились, всё читается и выровнено. '
        + `slides — номер с 1 или id, или список (до ${SHOT_MAX}). width — ширина картинки: по умолчанию — ширина слайда (один к одному: 1280×720, у 4:3 — 960×720, у 21:9 — 1680×720); `
        + 'для обзора многих слайдов хватит 480–640. Перед каждой картинкой — подпись: номер, id, rev и заголовок.',
      inputSchema: {
        type: 'object',
        properties: {
          presentation: { type: 'string', description: 'имя презентации' },
          slides: {
            type: ['integer', 'string', 'array'], items: { type: ['integer', 'string'] }, maxItems: SHOT_MAX,
            description: 'слайд (номер с 1 или id) или список слайдов',
          },
          width: { type: 'integer', minimum: 320, maximum: 1920, description: 'ширина картинки в пикселях' },
          look: { type: 'string', enum: ['light', 'dark'], description: 'вид слайдов, если тема презентации следует теме интерфейса (по умолчанию — светлый)' },
        },
        required: ['presentation', 'slides'],
      },
      annotations: { readOnlyHint: true },
      async run(a) {
        const name = deckName(a);
        const refs = Array.isArray(a.slides) ? a.slides : [a.slides];
        if (!refs.length || refs.length > SHOT_MAX) throw new ToolError(`slides — от 1 до ${SHOT_MAX} слайдов`);
        const width = a.width === undefined ? undefined : Number(a.width);
        if (width !== undefined && (!Number.isInteger(width) || width < 320 || width > 1920)) throw new ToolError('width — целое число от 320 до 1920');
        if (a.look !== undefined && a.look !== 'light' && a.look !== 'dark') throw new ToolError('look: "light" или "dark"');
        let ol: DeckOutline;
        try { ol = core.outline(name) as DeckOutline; } catch (e) { throw new ToolError((e as Error).message); }
        const list = refs.map((ref) => {
          const s = typeof ref === 'number' ? ol.slides[ref - 1] : ol.slides.find((x) => x.id === ref);
          if (!s) throw new ToolError(typeof ref === 'number' ? `Нет слайда ${ref}: слайды — с 1 по ${ol.slides.length}` : `Нет слайда с id «${String(ref)}»`);
          return s;
        });
        if (!shots) throw new ToolError('Картинки слайдов в этом запуске недоступны: нет браузера. Подключите агента к программе Slideria («Файл → Интеграции → Агенты»)');
        let png: Buffer[];
        try {
          png = await shots.shoot(name, { slides: list.map((s) => s.n), ...(width ? { width } : {}), ...(a.look ? { look: a.look as 'light' | 'dark' } : {}) });
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        return new Content(list.flatMap((s, k) => [
          { type: 'text', text: `Слайд ${s.n}${s.id ? ` (id ${s.id})` : ''} · rev ${s.rev}${s.title ? ` · ${s.title}` : ''}${s.hidden ? ' · скрыт в показе' : ''}` },
          { type: 'image', data: png[k].toString('base64'), mimeType: 'image/png' },
        ]));
      },
    },
    {
      name: 'edit_presentation',
      title: 'Правка презентации',
      description: 'Правка пакетом операций: все или ни одной. Адреса: слайд — номер с 1 или id; объект — номер с 1 из objects слайда или его имя (name). '
        + 'Номера — после предыдущих операций того же пакета. В expect — { slide, rev } каждого слайда, который правите, из read_presentation: '
        + 'если его с тех пор поменяли, правка не применится — перечитайте. Поля set — JSON Merge Patch: объекты сливаются по полям, null удаляет поле, '
        + 'списки заменяются целиком. Поля слайдов и объектов — format_guide. Ответ — подписи правок, edit (для undo_edit) и новые ревизии слайдов. '
        + 'После правки проверьте вид — view_slides.\nОперации:\n' + opsHelp(),
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
        const body = { ops: a.ops, expect: a.expect, by: by() };
        let r = await viaStudio(`apply?deck=${encodeURIComponent(name)}&from=mcp`, body) as Rec | null;
        const studio = !!r;
        try {
          r ??= core.apply(name, { ...body, from: 'mcp' }) as unknown as Rec;
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        // Содержание целиком агенту не нужно после каждой правки: подписи и новые ревизии — продолжать без
        // перечитывания; подробности слайда — read_presentation. edit — чем отменить эту правку (undo_edit)
        const edit = editOf(r);
        return { changed: r.changed, changes: r.changes, ...(edit ? { edit } : {}), slides: revs(r), ...(studio ? { studio: 'правка уже видна в открытой студии' } : {}) };
      },
    },
    {
      name: 'undo_edit',
      title: 'Отменить правку',
      description: 'Отменить свою правку. Без edit — последнюю ещё не отменённую правку этого подключения (вызвать ещё раз — предыдущую); '
        + 'с edit — ту, что указана (edit из ответа edit_presentation). Отменяется только эта правка: то, что пользователь или '
        + 'другие поправили позже, остаётся. Отмена — тоже правка: у неё свой edit. Ответ — что отменено и новые ревизии слайдов.',
      inputSchema: {
        type: 'object',
        properties: {
          presentation: { type: 'string', description: 'имя презентации' },
          edit: { type: 'string', description: 'какую правку отменить: edit из ответа edit_presentation' },
        },
        required: ['presentation'],
      },
      annotations: { destructiveHint: true },
      async run(a) {
        const name = deckName(a);
        const body = { edits: a.edit === undefined ? undefined : [str(a, 'edit', 'edit из ответа edit_presentation')], by: by() };
        let r = await viaStudio(`revert?deck=${encodeURIComponent(name)}&from=mcp`, body) as Rec | null;
        const studio = !!r;
        try {
          r ??= core.revert(name, { ...body, from: 'mcp' }) as unknown as Rec;
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        if (!r.changed) return { changed: false, note: 'Уже как было до этой правки: менять нечего', slides: revs(r) };
        const edit = editOf(r);
        return { changed: true, undone: r.changes, ...(edit ? { edit } : {}), slides: revs(r), ...(studio ? { studio: 'отмена уже видна в открытой студии' } : {}) };
      },
    },
    {
      name: 'add_media',
      title: 'Добавить картинку или видео',
      description: 'Картинка, видео или 3D-модель — в папку презентации (assets/): с диска этого компьютера (file — полный путь) или по ссылке '
        + '(url, http или https). Ответ — src для объекта и размеры картинки; дальше edit_presentation: '
        + '{ "op": "object.add", "slide": 2, "object": { "type": "image", "src": "./assets/фото.jpg", "place": { "x": 80, "y": 120, "w": 560, "h": 420 } } } '
        + '(видео — type: video, модель — type: model). Так дешевле, чем передавать картинку текстом data:. Тот же файл второй раз не копируется. '
        + 'PNG, JPG, GIF, WebP, AVIF, SVG, MP4, WebM, GLB; STL и STEP становятся GLB.',
      inputSchema: {
        type: 'object',
        properties: {
          presentation: { type: 'string', description: 'имя презентации' },
          file: { type: 'string', description: 'полный путь к файлу на этом компьютере' },
          url: { type: 'string', description: 'ссылка на файл (http или https)' },
          name: { type: 'string', description: 'имя файла в презентации (по умолчанию — как у исходного)' },
        },
        required: ['presentation'],
      },
      annotations: { destructiveHint: false, openWorldHint: true },
      async run(a) {
        const name = deckName(a);
        if ((a.file === undefined) === (a.url === undefined)) throw new ToolError('Нужно одно из двух: file (путь на диске) или url (ссылка)');
        try { core.allow(by(), 'edit'); } catch (e) { throw new ToolError((e as Error).message); }
        let data: Buffer;
        let fileName: string;
        if (a.file !== undefined) {
          const file = str(a, 'file', 'полный путь к файлу');
          if (!path.isAbsolute(file)) throw new ToolError('file — полный путь к файлу');
          let st: fs.Stats;
          try { st = fs.statSync(file); } catch { throw new ToolError(`Файла нет: ${file}`); }
          if (!st.isFile()) throw new ToolError(`Это не файл: ${file}`);
          if (st.size > MEDIA_MAX) throw new ToolError(`Файл больше ${MEDIA_MAX >> 20} МБ`);
          data = fs.readFileSync(file);
          fileName = path.basename(file);
        } else {
          const got = await download(str(a, 'url', 'ссылка на файл'));
          data = got.data;
          fileName = got.name;
        }
        if (a.name !== undefined) {
          const want = str(a, 'name', 'имя файла');
          // Без расширения — то же, что у исходного
          fileName = path.extname(want) ? want : `${want}${path.extname(fileName)}`;
        }
        let ref: { path: string };
        try {
          ref = await core.addAsset(name, fileName, data);
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
        const ext = path.extname(ref.path).slice(1).toLowerCase();
        const type = MEDIA_KIND[ext] ?? (/^(png|jpe?g|gif|webp|avif|svg)$/.test(ext) ? 'image' : 'file');
        const size = type === 'image' ? await imageSize(data) : null;
        return { src: ref.path, type, ...(size ? { width: size.width, height: size.height } : {}), bytes: data.length };
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
        const via = await viaStudio(`create?title=${encodeURIComponent(title)}${a.sample ? '&sample=1' : ''}`, { by: by() });
        if (via) return via;
        try {
          return core.create(title, !!a.sample, { by: by() });
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
      name: 'save_script',
      title: 'Сохранить скрипт',
      description: 'Скрипт для пользователя: повторяющееся действие, которое он сам запускает в студии («Скрипты» на вкладке «Инструменты», «Файл → Интеграции → Скрипты» или Ctrl+K). '
        + 'Один файл JavaScript: в начале комментарии // @name Название, // @description Что делает, // @param ключ: text|lines|number|bool|choice(a=Подпись, b=Подпись) = значение — Подпись поля; '
        + 'дальше export default async function ({ deck, outline, apply, slide, selection, params, log }) { … }. '
        + 'deck — данные презентации, outline() — краткое содержание, apply(ops) — те же операции, что у edit_presentation (без expect), '
        + 'slide — номер текущего слайда, selection — номера выделенных объектов, params — значения полей. Сеть, файлы и страница студии скрипту недоступны. '
        + 'Справка — docs/SCRIPTS.md. Нужно разрешение агентам «Всё».',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'имя файла, например «оглавление.js»' },
          code: { type: 'string', description: 'текст скрипта' },
          replace: { type: 'boolean', description: 'заменить, если такой уже есть' },
        },
        required: ['file', 'code'],
      },
      async run(a) {
        try {
          const s = core.saveScript(str(a, 'file', 'имя файла скрипта'), str(a, 'code', 'текст скрипта'), { by: by(), replace: !!a.replace });
          return { saved: s.file, name: s.name, params: s.params.map((p) => p.key), where: 'студия: «Инструменты → Скрипты», «Файл → Интеграции → Скрипты», Ctrl+K' };
        } catch (e) {
          throw new ToolError((e as Error).message);
        }
      },
    },
    {
      name: 'format_guide',
      title: 'Формат презентации',
      description: 'Справка по данным презентации: шаблоны слайдов, блоки (графики, схемы, таблицы, формулы, медиа), свободные объекты холста, анимация. Прочитайте перед первой правкой.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      async run() {
        const text = formatGuide(o.root);
        if (!text) throw new ToolError('Справка не найдена в папке программы');
        return text;
      },
    },
  ];
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function callTool(p: Rec): Promise<Rec> {
    const t = typeof p.name === 'string' ? byName.get(p.name) : undefined;
    if (!t) throw new RpcError(-32602, `Нет инструмента «${String(p.name)}»`);
    try {
      const out = await t.run(isRec(p.arguments) ? p.arguments : {});
      if (out instanceof Content) return { content: out.items };
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
          const ci = isRec(p.clientInfo) ? p.clientInfo : {};
          if (typeof ci.name === 'string' && ci.name) agent.name = clientTitle(ci.name, typeof ci.title === 'string' ? ci.title : undefined).slice(0, 60);
          if (typeof ci.version === 'string') agent.version = ci.version.slice(0, 30);
          void hello();
          beat ??= setInterval(() => void hello(), HEARTBEAT_MS);
          beat.unref?.();
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

  /** Клиент отключился: студии — «ушёл» */
  async function close(): Promise<void> {
    if (beat) clearInterval(beat);
    beat = null;
    await hello('bye');
  }

  return { handle, close, tools: tools.map((t) => t.name) };
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
    // Вход закрыт: студии — «ушёл», потом — ответ, когда все ответы отправлены. Оборванная труба (агента
    // закрыли посреди сообщения) — только close, без end
    let closed = false;
    const end = () => {
      if (closed) return;
      closed = true;
      one(buf);
      void mcp.close().finally(() => { ended = true; finish(); });
    };
    input.on('end', end);
    input.on('close', end);
  });
}
