/**
 * Песочница скрипта пользователя (docs/SCRIPTS.md): отдельный поток — без страницы студии, без файлов; сеть и код
 * со стороны закрыты политикой безопасности (Content-Security-Policy, plugins/decks.ts). Скрипт правит черновик
 * данных теми же операциями, что и агенты (src/engine/ops.ts): каждая проверяется. Итог — одним сообщением,
 * студия применяет его одним шагом отмены.
 */
import { applyOps, outline, type Change } from '../engine/ops';
import type { Deck } from '../types';

interface Job { code: string; deck: Deck; params: Record<string, unknown>; slide: number; selection: number[] }

/** Поток скрипта (типы воркера не подключаем: они спорят с типами страницы во всём проекте) */
const worker = self as unknown as { onmessage: ((e: MessageEvent<Job>) => void) | null; postMessage(m: unknown): void };

// Хранилища страницы студии скрипту ни к чему (политика их не закрывает)
for (const k of ['indexedDB', 'caches']) {
  try { Object.defineProperty(self, k, { value: undefined, configurable: false }); } catch { /* нет такого */ }
}

worker.onmessage = async (e: MessageEvent<Job>) => {
  const { code, params, slide, selection } = e.data;
  let draft = e.data.deck;
  const details: Change[] = [];
  const logs: string[] = [];
  const api = Object.freeze({
    /** Данные презентации сейчас (копия: менять — через apply) */
    get deck(): Deck { return structuredClone(draft); },
    /** Краткое содержание: слайды с номерами, объекты с номерами и текстом */
    outline: () => outline(draft),
    /** Номер текущего слайда, с 1 */
    slide,
    /** Номера выделенных объектов на текущем слайде, с 1 */
    selection: Object.freeze([...selection]),
    params: Object.freeze({ ...params }),
    /** Операции (одна или список) — те же, что у агентов; ответ — подписи правок */
    apply(ops: unknown, o: { expect?: unknown } = {}): string[] {
      const r = applyOps(draft, Array.isArray(ops) ? ops : [ops], o);
      draft = r.deck;
      details.push(...r.details);
      return r.changes;
    },
    /** Строка в итог запуска */
    log: (...a: unknown[]) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ').slice(0, 500)); },
  });
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    const m = await import(/* @vite-ignore */ url) as { default?: unknown };
    if (typeof m.default !== 'function') throw new Error('В скрипте нет export default — главной функции (docs/SCRIPTS.md)');
    await (m.default as (a: typeof api) => unknown)(api);
    worker.postMessage({ ok: true, deck: draft, details, logs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    worker.postMessage({ ok: false, error: /Content Security Policy|Failed to fetch|NetworkError/i.test(msg) ? `Скрипту закрыты сеть и загрузка кода со стороны: ${msg}` : msg, logs });
  } finally {
    URL.revokeObjectURL(url);
  }
};
