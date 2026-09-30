import type { Deck } from '../types';
import type { InkMsg } from './ink';
import type { Theme } from './theme';

export type SyncMsg =
  | { type: 'state'; index: number; theme: Theme; black: boolean }
  | { type: 'goto'; index: number }
  | { type: 'theme'; theme: Theme }
  | { type: 'black'; value: boolean }
  | { type: 'deck'; deck: Deck }
  | { type: 'ink'; ink: InkMsg }
  | { type: 'hello' }
  /** Поворот 3D-модели в окне докладчика */
  | { type: 'camera'; key: string; orbit: string; target: string; fov: number }
  /** Заметки слайда, дописанные в окне докладчика; окно показа отвечает notes-ok с тем же id */
  | { type: 'notes'; id: string; index: number; slide?: string; notes: string }
  | { type: 'notes-ok'; id: string; saved: 'auto' | 'file' | 'memory' }
  /** Ползунки слайда сдвинули в одном окне — другое повторяет */
  | { type: 'vars'; index: number; vars: Record<string, number> }
  /** Код песочницы правят в одном окне — другое повторяет */
  | { type: 'code'; index: number; block: string; code: string }
  /** Кнопка «показать / скрыть» нажата в одном окне — другое повторяет */
  | { type: 'trigger'; index: number; action: string };

/** Сервер показа: пересылка сообщений пульта (plugins/remote-relay.mjs) */
export const RELAY = '/__slideria/remote/';

interface Envelope {
  ns: 'htmlpptx';
  deck: string;
  id: string;
  /** Окно-отправитель */
  from: string;
  /** Окно-получатель; без него сообщение для всех окон этой презентации */
  to?: string;
  msg: SyncMsg;
}

/** Постоянный id вкладки: переживает перезагрузку, у другой вкладки — свой. */
export function windowId(): string {
  const key = 'htmlpptx-window';
  try {
    let v = sessionStorage.getItem(key);
    if (!v) {
      v = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(key, v);
    }
    return v;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

/**
 * Связь основного окна и окна докладчика.
 * postMessage работает и для файла, открытого с диска (file://), BroadcastChannel — запасной путь.
 * У каждой вкладки свой id: окно докладчика слушает только своё окно показа, даже если
 * открыто несколько копий презентации (например, исходный файл и сохранённая копия).
 */
export class Sync {
  private peers = new Set<Window>();
  private bc: BroadcastChannel | null = null;
  private handlers: ((m: SyncMsg, from: string) => void)[] = [];
  /** Одно сообщение может прийти дважды (postMessage и BroadcastChannel) — отсеиваем повторы */
  private seen: string[] = [];
  private counter = 0;
  private readonly me = Math.random().toString(36).slice(2);

  constructor(private deck: string, readonly self: string = windowId()) {
    try {
      this.bc = new BroadcastChannel('htmlpptx:' + deck);
      this.bc.onmessage = (e) => this.receive(e.data);
    } catch {
      this.bc = null;
    }
    window.addEventListener('message', (e) => {
      if (this.receive(e.data) && e.source && e.source !== window) this.peers.add(e.source as Window);
    });
    if (window.opener) this.peers.add(window.opener);
  }

  addPeer(w: Window | null): void {
    if (w) this.peers.add(w);
  }

  /**
   * Пульт с телефона: сообщения идут ещё и через сервер показа (yarn dev, yarn present) —
   * всем в комнате room. status — есть ли связь с сервером.
   */
  private room: string | null = null;
  private es: EventSource | null = null;
  relay(room: string, status?: (ok: boolean) => void): void {
    if (this.room === room && this.es) return;
    this.es?.close();
    this.room = room;
    const es = new EventSource(`${RELAY}events?room=${encodeURIComponent(room)}`);
    es.onmessage = (e) => {
      try { this.receive(JSON.parse(e.data)); } catch { /* не сообщение показа */ }
    };
    es.onopen = () => status?.(true);
    // EventSource переподключается сам; пока нет связи — сообщаем
    es.onerror = () => status?.(false);
    this.es = es;
  }

  get relayed(): boolean {
    return !!this.room;
  }

  on(h: (m: SyncMsg, from: string) => void): void {
    this.handlers.push(h);
  }

  send(msg: SyncMsg, to?: string): void {
    const env: Envelope = { ns: 'htmlpptx', deck: this.deck, id: `${this.me}:${++this.counter}`, from: this.self, to, msg };
    for (const p of this.peers) {
      try {
        if (p.closed) this.peers.delete(p);
        else p.postMessage(env, '*');
      } catch {
        this.peers.delete(p);
      }
    }
    try { this.bc?.postMessage(env); } catch { /* канал закрыт */ }
    if (this.room) {
      fetch(`${RELAY}send?room=${encodeURIComponent(this.room)}`, { method: 'POST', body: JSON.stringify(env), keepalive: true }).catch(() => {});
    }
  }

  private receive(data: unknown): boolean {
    const env = data as Envelope;
    if (!env || env.ns !== 'htmlpptx' || env.deck !== this.deck || !env.msg) return false;
    if (this.seen.includes(env.id) || env.id?.startsWith(this.me + ':')) return true;
    if (env.to && env.to !== this.self) return true;
    this.seen.push(env.id);
    if (this.seen.length > 64) this.seen.shift();
    this.handlers.forEach((h) => h(env.msg, env.from));
    return true;
  }
}
