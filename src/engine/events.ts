/**
 * Уведомления от сервера Slideria (server/events.ts): записали презентацию, удалили, поменяли файл со стороны,
 * агенты на связи, правка агента в журнале. Одно соединение на страницу, открывается при первой подписке;
 * оборвалось — переподключается само, а подписчики события reconnected узнают, что могли что-то пропустить.
 *
 * Только страницам на этом компьютере: телефон-пульт уведомлений не получает (сервер ему отказывает).
 * В собранном файле презентации сервера нет — подписка ничего не делает.
 */

export interface ServerEvents {
  /** Презентацию записали (from — окно, которое записало) */
  'deck-saved': { name: string; from: string };
  /** Презентацию удалили в корзину */
  'deck-removed': { name: string };
  /** deck.yaml поменяли со стороны (текстовый редактор, git); rev — версия файла теперь */
  'deck-changed': { name: string; rev: string };
  /** Презентации появились или пропали (положили или удалили папку руками) */
  decks: { added: string[]; removed: string[] };
  /** Агенты на связи (server/integrations.ts) */
  agents: unknown[];
  /** Правка агента или скрипта записана в журнал */
  journal: unknown;
  /** Связь восстановлена после обрыва: события за это время могли пропасть */
  reconnected: Record<string, never>;
}

type Handler = (data: never) => void;

const handlers = new Map<keyof ServerEvents, Set<Handler>>();
let socket: WebSocket | null = null;
let attempt = 0;
let dropped = false;

/** Уведомления только этому компьютеру: с телефона по адресу в сети не подключаемся */
const local = () => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(location.hostname);

function connect(): void {
  if (socket || !__SERVED__ || !local()) return;
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/__slideria/events`);
  socket = ws;
  ws.onopen = () => {
    attempt = 0;
    if (dropped) {
      dropped = false;
      emit('reconnected', {});
    }
  };
  ws.onmessage = (e) => {
    let m: { type?: keyof ServerEvents; data?: unknown };
    try { m = JSON.parse(String(e.data)); } catch { return; }
    if (m?.type) emit(m.type, m.data as never);
  };
  ws.onclose = () => {
    socket = null;
    dropped = true;
    // Сервер перезапускается (yarn dev) или страницу закрывают: 0,5 с, 1 с, 2 с… не реже чем раз в 10 с
    setTimeout(connect, Math.min(10_000, 500 * 2 ** attempt++));
  };
}

function emit<K extends keyof ServerEvents>(type: K, data: ServerEvents[K]): void {
  handlers.get(type)?.forEach((fn) => {
    try { (fn as (d: ServerEvents[K]) => void)(data); } catch (e) { console.error(e); }
  });
}

/** Подписка на событие сервера; ответ — отписаться */
export function onServer<K extends keyof ServerEvents>(type: K, fn: (data: ServerEvents[K]) => void): () => void {
  if (!__SERVED__) return () => {};
  let set = handlers.get(type);
  if (!set) handlers.set(type, (set = new Set()));
  set.add(fn as Handler);
  connect();
  return () => { set.delete(fn as Handler); };
}
