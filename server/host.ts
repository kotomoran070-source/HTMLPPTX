/**
 * Сервер программы — отдельным служебным процессом Electron (utilityProcess), а не в её главном процессе.
 * Главный процесс передаёт окну ввод: пока он занят записью файла, мышь и клавиши до страницы не доходят.
 * Запись на 31 слайде держала его 0,2 с после каждой правки, на 155 — 0,8 с (docs/PERF.md).
 *
 * Запуск — этим же файлом кода (server.mjs) с ключом HOST_FLAG: desktop/main.mjs → utilityProcess.fork.
 * Вход для телефона (desktop/lan.mjs) — здесь же: пропуска телефонов знает сервер (plugins/remote-relay.mjs).
 * Что умеет только главный процесс — брандмауэр, служебный процесс сборки, хранилище ключа, показ файла в папке, —
 * остаётся в нём;
 * сервер зовёт это сообщениями:
 *   главный → сервер: start { options, key }, reply { id, value | error }, close
 *   сервер → главный: ready { url, port }, failed { error }, call { id, name, args }, log { text }, key { value }
 */
import { lanGateway } from '../desktop/lan.mjs';
import type { KeyStore } from './agent';
import type { Runner } from './core';
import type { Served, ServeOptions } from './serve';

/** Ключ запуска: процесс — сервер программы */
export const HOST_FLAG = '--slideria-server';

/** Ключи сервисов чата «Агент» (одной строкой JSON): значение и можно ли их сохранить — шифрует и хранит главный процесс (safeStorage) */
export interface HostKey { value: string | null; secure: boolean; canStore: boolean }

/** Настройки сервера, как их можно переслать: вместо функций — признаки (lan — открывать вход для телефона, firewall — брандмауэр у главного процесса) */
export type HostOptions = Omit<ServeOptions, 'lan' | 'firewall' | 'run' | 'log' | 'agentKeys' | 'show' | 'shoot'> & { lan?: boolean; firewall?: boolean };

export type ToHost =
  | { type: 'start'; options: HostOptions; key: HostKey }
  | { type: 'reply'; id: number; value?: unknown; error?: string }
  | { type: 'close' };

export type FromHost =
  | { type: 'ready'; url: string; port: number }
  | { type: 'failed'; error: string }
  | { type: 'call'; id: number; name: 'firewall' | 'run' | 'show' | 'shoot'; args: unknown[] }
  | { type: 'log'; text: string }
  | { type: 'key'; value: string | null };

/** Связь служебного процесса Electron с главным (process.parentPort) */
interface ParentPort {
  on(event: 'message', fn: (e: { data: ToHost }) => void): void;
  postMessage(m: FromHost): void;
}

export function hostMain(start: (o: ServeOptions) => Promise<Served>): void {
  const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
  if (!port) throw new Error('Сервер программы запускается служебным процессом Electron');
  let served: Served | null = null;
  let gateway: ReturnType<typeof lanGateway> | null = null;
  let seq = 0;
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  /** Позвать главный процесс и дождаться ответа */
  const call = <T>(name: 'firewall' | 'run' | 'show' | 'shoot', ...args: unknown[]) => new Promise<T>((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    port.postMessage({ type: 'call', id, name, args });
  });

  /** Ключи — в памяти сервера (он и ходит с ними к сервисам); запись и удаление — сообщением главному процессу */
  const keys = (k: HostKey): KeyStore => {
    let value = k.value;
    return {
      kind: 'app',
      secure: k.secure,
      get: () => value,
      set(key) {
        if (!k.canStore) throw new Error('Не удалось зашифровать ключ средствами системы, поэтому ключ не сохранён');
        value = key;
        port.postMessage({ type: 'key', value: key });
      },
      clear() {
        value = null;
        port.postMessage({ type: 'key', value: null });
      },
    };
  };

  port.on('message', ({ data: m }) => {
    if (m.type === 'reply') {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error !== undefined) w?.reject(new Error(m.error));
      else w?.resolve(m.value);
      return;
    }
    if (m.type === 'close') {
      gateway?.close();
      void (served?.close() ?? Promise.resolve()).catch(() => {}).then(() => process.exit(0));
      return;
    }
    const { lan, firewall, ...rest } = m.options;
    const run: Runner = (script, args, o) => call('run', script, args, o);
    const log = (text: string) => port.postMessage({ type: 'log', text });
    // Вход для телефона открывается, когда в показе нажимают R; пересылает запросы этому же серверу
    if (lan) gateway = lanGateway(() => served?.port ?? 0, rest.dir, (...a) => log(a.map(String).join(' ')));
    const phone = gateway;
    start({
      ...rest,
      ...(phone ? { lan: (deck: string) => phone.open(deck) } : {}),
      ...(firewall ? { firewall: () => call<string>('firewall') } : {}),
      run,
      log,
      // Пакет расширения Claude Desktop — открыть или показать в папке средствами Electron (shell): окно
      // Проводника, запущенное отсюда, могло остаться скрытым
      show: (file: string, how: 'open' | 'reveal') => call<void>('show', file, how),
      // Картинки слайдов для чата «Агент» — скрытым окном Electron в главном процессе (desktop/shot.mjs)
      shoot: (r) => call<Uint8Array[]>('shoot', r).then((list) => list.map((b) => Buffer.from(b))),
      agentKeys: keys(m.key),
    }).then((s) => {
      served = s;
      port.postMessage({ type: 'ready', url: s.url, port: s.port });
    }, (e: Error) => port.postMessage({ type: 'failed', error: e?.stack ?? String(e) }));
  });
}
