/**
 * HTTP-обработчик сервера Slideria — обычный обработчик node:http (req, res, next), без Vite. Его подключает
 * сервер разработки (plugins/decks.ts), а может и любой другой сервер: http.createServer, программа, облако.
 *
 * По порядку:
 *   1. защита от подмены адреса (DNS rebinding) — чужое имя сервера не доходит ни до одного обработчика;
 *   2. пульт с телефона — пересылка сообщений показа; из сети пускает только телефон с пропуском;
 *   3. страница «Лицензии» — только этому компьютеру;
 *   4. данные для страниц /__slideria/decks и /__slideria/deck/<имя> — только чтение (GET); список — только
 *      этому компьютеру, одну презентацию — и телефону с пропуском (вход для телефона пропускает только ту,
 *      что в показе: desktop/lan.mjs);
 *   5. команды проекта /__htmlpptx/* — только POST, только этому компьютеру и только со страниц этого же сервера.
 * Уведомления страницам (WebSocket) — server/events.ts: их подключает сам сервер, к событию upgrade.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostGuard } from './host-guard';
import { deckRev } from './deck-files';
import { ExportError, type DecksCore } from './core';
import { denyPage, isLocal, lanPass, remoteRelay } from '../plugins/remote-relay.mjs';
import { electronFiles, licensesData } from '../plugins/licenses.mjs';

/** Адрес страницы «Лицензии» */
export const LICENSES = '/__slideria/licenses';
/**
 * Песочница скриптов пользователя (src/studio/script-worker.ts): код — только свой и из blob: (сам скрипт),
 * сеть закрыта — скрипт не отправит данные презентации наружу и не загрузит чужой код
 */
export const WORKER_CSP = "default-src 'none'; script-src 'self' blob:; connect-src 'none'";
/** Данные для страниц: список презентаций и одна презентация (src/engine/deck-source.ts) */
export const DECKS_URL = '/__slideria/decks';
export const DECK_URL = '/__slideria/deck/';
/** Команды проекта */
export const API = '/__htmlpptx/';
const MAX_BODY = 60 * 1024 * 1024;
/** Презентации PowerPoint с видео бывают большими */
const MAX_PPTX = 400 * 1024 * 1024;

export type Next = () => void;
export type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

export interface HttpOptions {
  /** Свои имена сервера, кроме localhost и IP-адресов (у Vite — server.allowedHosts) */
  allowedHosts?: () => readonly string[] | true | undefined;
  /** Где слушает сервер — для пульта: порт и виден ли он только этому компьютеру */
  address?: () => AddressInfo | string | null | undefined;
  /** Программа: открыть для телефона вход в сети к этой презентации — порт входа или null */
  lan?: (deck: string) => Promise<number | null>;
  /** Программа под Windows: разрешить пульт в брандмауэре — состояние для страницы */
  firewall?: () => Promise<string>;
  /** Куда сообщать об ошибках команд */
  log?: (message: string) => void;
  /**
   * Библиотеки, собранные внутрь студии (список пишет сборка студии, scripts/build.mjs --app): у программы
   * их нет в node_modules, но на странице «Лицензии» они нужны
   */
  bundled?: () => { name: string; version: string; license: string; text: string }[];
}

export function readBody(req: IncomingMessage, max = MAX_BODY): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

const json = async (req: IncomingMessage) => JSON.parse((await readBody(req)).toString('utf8') || 'null') as unknown;

/** Все обработчики сервера одной цепочкой: что не своё — дальше (next) */
export function createHandler(core: DecksCore, o: HttpOptions = {}): Handler {
  const chain = [hostGuard(o.allowedHosts ?? (() => [])), relay(core, o), licenses(core, o), data(core), api(core, o)];
  return (req, res, next) => {
    const step = (k: number): void => (k < chain.length ? chain[k](req, res, () => step(k + 1)) : next());
    step(0);
  };
}

/** Пульт с телефона: пересылка сообщений показа; из сети — только телефону с пропуском (одноразовая ссылка из QR) */
function relay(core: DecksCore, o: HttpOptions): Handler {
  // yarn dev --host: телефон идёт прямо на этот сервер
  const net = async () => {
    const a = o.address?.();
    const info = a && typeof a === 'object' ? a : null;
    return { port: info?.port ?? 5173, localOnly: !info || info.address === '127.0.0.1' || info.address === '::1' };
  };
  return (req, res, next) => {
    // Программа: сервер виден только этому компьютеру, а для телефона по запросу открывается отдельный
    // вход в сети — только для показа и только к той презентации, которую показывают
    const info = o.lan
      ? async () => {
        const deck = new URL(req.url ?? '/', 'http://local').searchParams.get('deck') ?? '';
        const port = isLocal(req) && core.has(deck) ? await o.lan!(deck) : null;
        return { port: port ?? 0, localOnly: !port, app: true, firewall: !!o.firewall };
      }
      : net;
    if (remoteRelay(req, res, info)) return;
    if (!lanPass(req)) {
      if (req.method === 'GET' && /text\/html/.test(req.headers.accept ?? '')) return denyPage(res);
      res.statusCode = 403;
      res.end();
      return;
    }
    next();
  };
}

/**
 * «Лицензии» — раздел «Файл → Лицензии» студии и страница `/?licenses` (src/engine/licenses-view.ts): данные для
 * них — /data, лицензии Chromium — /chromium. Старый адрес страницы ведёт на новую. Только этому компьютеру
 */
function licenses(core: DecksCore, o: HttpOptions): Handler {
  return (req, res, next) => {
    const u = req.url?.split('?')[0];
    if (u !== LICENSES && !u?.startsWith(LICENSES + '/')) return next();
    if (!isLocal(req)) return send(res, 403, { error: 'Только с этого компьютера' });
    if (u === LICENSES) {
      res.statusCode = 302;
      res.setHeader('Location', '/?licenses');
      return void res.end();
    }
    if (u === LICENSES + '/data') {
      res.setHeader('Cache-Control', 'no-store');
      return send(res, 200, licensesData(core.root, electronFiles().chromium ? LICENSES + '/chromium' : '', o.bundled?.() ?? null));
    }
    if (u !== LICENSES + '/chromium') return send(res, 404, { error: 'Нет такого адреса' });
    const chromium = electronFiles().chromium;
    if (!chromium) return send(res, 404, { error: 'Нет файла' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    fs.createReadStream(chromium).pipe(res);
  };
}

/**
 * Данные для страниц (только чтение). Пути к файлам в данных — адресами этого сервера (как их видит студия);
 * ошибка в deck.yaml — 422 с текстом ошибки: страница покажет её вместо слайдов
 */
function data(core: DecksCore): Handler {
  return (req, res, next) => {
    const u = (req.url ?? '').split('?')[0];
    if (u !== DECKS_URL && !u.startsWith(DECK_URL)) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Только чтение' });
    res.setHeader('Cache-Control', 'no-store');
    if (u === DECKS_URL) {
      if (!isLocal(req)) return send(res, 403, { error: 'Только с этого компьютера' });
      return send(res, 200, core.list());
    }
    let name = '';
    try { name = decodeURIComponent(u.slice(DECK_URL.length)); } catch { return send(res, 400, { error: 'Неверное имя' }); }
    if (!core.has(name)) return send(res, 404, { error: `Презентация «${name}» не найдена` });
    let deck: unknown;
    // Версия файла: страница сверит с ней уведомление «файл поправили со стороны» (server/watch.ts)
    try { res.setHeader('X-Slideria-Rev', deckRev(fs.readFileSync(core.deckFile(name), 'utf8'))); } catch { /* файл только что убрали */ }
    try { deck = core.read(name, { urls: true }); } catch (e) { return send(res, 422, { error: (e as Error).message }); }
    send(res, 200, deck);
  };
}

/** Команды проекта: /__htmlpptx/<команда>?deck=<имя>&… */
function api(core: DecksCore, o: HttpOptions): Handler {
  return (req, res, next) => {
    if (!req.url?.startsWith(API)) return next();
    void route(core, o, req, res).catch((e: Error) => {
      o.log?.(`[htmlpptx] ${e.message}`);
      if (!res.headersSent) send(res, e instanceof ExportError ? 500 : 400, { error: e.message });
      else res.end();
    });
  };
}

async function route(core: DecksCore, o: HttpOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // С других устройств сети (пульт) проект только смотрят — не правят
  if (!isLocal(req)) return send(res, 403, { error: 'Правка проекта — только с этого компьютера' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Только POST' });
  // Запросы только со страниц этого же сервера
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Чужой источник запроса' });
  const url = new URL(req.url!, 'http://localhost');
  const q = url.searchParams;
  const cmd = url.pathname.slice(API.length);

  // Команды без презентации
  switch (cmd) {
    case 'import': {
      // Текст файла или JSON { html, raw }: снимок после скриптов и исходный файл (для живых слайдов)
      const body = (await readBody(req)).toString('utf8');
      let html = body;
      let raw: string | undefined;
      if (String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        const j = JSON.parse(body) as { html?: string; raw?: string };
        html = String(j.html ?? '');
        raw = typeof j.raw === 'string' ? j.raw : undefined;
      }
      return send(res, 200, await core.importPage(html, {
        raw, live: q.get('live') === '1', name: q.get('deck') || undefined, fileName: q.get('file') || undefined,
        dryRun: q.get('dry') === '1', theme: q.get('theme') !== '0',
      }));
    }
    case 'import-pptx':
      return send(res, 200, await core.importPowerPoint(await readBody(req, MAX_PPTX), {
        name: q.get('deck') || undefined, fileName: q.get('file') || undefined, dryRun: q.get('dry') === '1', adapt: q.get('adapt') === '1',
      }));
    // Для страницы выбора: когда каждую презентацию меняли в последний раз
    case 'list': return send(res, 200, core.list());
    // С агентом (MCP) в теле — { by }: проверка, можно ли ему создавать
    case 'create': {
      const body = (await json(req)) as { by?: unknown } | null;
      return send(res, 200, core.create(q.get('title') ?? '', q.get('sample') === '1', { by: body?.by }));
    }
    // Интеграции (server/integrations.ts): агенты, что им можно, журнал, скрипты
    case 'integrations':
      return send(res, 200, { access: core.access(), agents: core.agents(), mcp: core.mcpCommand(), scripts: core.scriptsDir });
    case 'integrations-set': {
      const body = (await json(req)) as { agents?: unknown } | null;
      return send(res, 200, { access: core.setAccess(body?.agents) });
    }
    // Агент MCP подключился, напоминает о себе (раз в 15 с) или ушёл
    case 'agent': {
      const body = (await json(req)) as { id?: string; name?: string; version?: string } | null;
      if (q.get('op') === 'bye') core.agentBye(String(body?.id ?? ''));
      else core.agentHello({ id: String(body?.id ?? ''), name: String(body?.name ?? ''), version: body?.version });
      return send(res, 200, { ok: true, access: core.access() });
    }
    case 'journal': {
      const d = q.get('deck');
      return send(res, 200, core.journal(d || undefined, Math.min(500, Number(q.get('limit')) || 200)));
    }
    case 'scripts': return send(res, 200, core.scripts());
    case 'script-read': return send(res, 200, core.scriptCode(q.get('id') ?? ''));
    case 'script-save': {
      const body = (await json(req)) as { file?: string; code?: string; replace?: boolean; by?: unknown } | null;
      return send(res, 200, core.saveScript(String(body?.file ?? ''), String(body?.code ?? ''), { by: body?.by, replace: !!body?.replace }));
    }
    // Общая библиотека шрифтов — видна во всех презентациях
    case 'font-list': return send(res, 200, core.fonts());
    case 'font-save': return send(res, 200, await core.addFont(q.get('file') ?? '', await readBody(req)));
    // Программа под Windows: разрешить пульт в брандмауэре (desktop/firewall.mjs)
    case 'firewall': return send(res, 200, { state: o.firewall ? await o.firewall() : 'skip' });
    case 'library': return send(res, 200, core.library());
    case 'library-put': return send(res, 200, core.putLibrary(q.get('kind') ?? '', q.get('id') ?? '', await json(req)));
    case 'library-delete': return send(res, 200, core.deleteLibrary(q.get('kind') ?? '', q.get('id') ?? ''));
    default: break;
  }

  // Команды над презентацией
  const name = q.get('deck') ?? '';
  if (!core.has(name)) throw new Error(`Презентация «${q.get('deck')}» не найдена`);
  switch (cmd) {
    // Данные презентации, как их видит студия: пути к файлам — адресами этого сервера
    case 'read': return send(res, 200, core.read(name, { urls: true }));
    // Операции правки для агента (src/engine/ops.ts): краткое содержание и пакет операций
    case 'outline': {
      const sl = q.get('slide');
      return send(res, 200, core.outline(name, sl === null ? {} : { slide: /^\d+$/.test(sl) ? Number(sl) : sl }));
    }
    case 'apply': {
      const body = (await json(req)) as { ops?: unknown; expect?: unknown; by?: unknown } | null;
      return send(res, 200, core.apply(name, { ops: body?.ops, expect: body?.expect, from: q.get('from') || 'agent', by: body?.by as never }));
    }
    // Правка скрипта студии — в журнал (сама правка — в окне студии, запишется его сохранением)
    case 'journal-add': return send(res, 200, core.recordScript(name, ((await json(req)) ?? {}) as never));
    case 'save': {
      const body = (await json(req) ?? {}) as { deck?: unknown; base?: unknown };
      const r = core.save(name, { deck: body.deck, base: body.base, from: q.get('from') ?? '' });
      // Последняя запись перед закрытием студии — и точка «когда закрыли» (одним запросом: точка — после записи)
      if (q.get('close') === '1') core.checkpoint(name, { kind: 'close' });
      return send(res, 200, r);
    }
    case 'delete': return send(res, 200, await core.trash(name));
    case 'assets-list': return send(res, 200, core.assets(name));
    case 'assets-trash': return send(res, 200, core.trashAssets(name, (await json(req)) ?? []));
    // Точка: своя (Ctrl+S); kind=auto — до и после скрипта, open и close — когда студию открыли и закрыли
    case 'checkpoint': {
      const kind = q.get('kind') || undefined;
      if (kind !== undefined && kind !== 'auto' && kind !== 'open' && kind !== 'close') throw new Error('Вид точки: auto, open или close');
      return send(res, 200, core.checkpoint(name, { kind }));
    }
    case 'checkpoints': return send(res, 200, core.checkpoints(name));
    case 'checkpoint-read': return send(res, 200, core.readCheckpoint(name, q.get('id') ?? ''));
    case 'font-use': return send(res, 200, await core.useFont(name, q.get('file') ?? ''));
    case 'bind-theme': return send(res, 200, core.bindTheme(name, q.get('dry') === '1'));
    case 'asset': return send(res, 200, await core.addAsset(name, q.get('name') ?? 'image.png', await readBody(req)));
    case 'asset-text': return send(res, 200, core.writeAssetText(name, q.get('url') ?? '', (await readBody(req)).toString('utf8')));
    case 'export': {
      const look = q.get('look');
      const body = await core.exportHtml(name, {
        clean: q.get('mode') === 'clean',
        compact: q.get('quality') === 'compact',
        look: look === 'light' || look === 'dark' ? look : undefined,
        motion: q.get('motion') === '1',
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    default: return send(res, 404, { error: 'Неизвестная команда' });
  }
}
