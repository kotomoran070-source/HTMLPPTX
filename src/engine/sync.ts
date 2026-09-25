import type { Deck } from '../types';
import type { Theme } from './theme';

export type SyncMsg =
  | { type: 'state'; index: number; theme: Theme; black: boolean }
  | { type: 'goto'; index: number }
  | { type: 'theme'; theme: Theme }
  | { type: 'black'; value: boolean }
  | { type: 'deck'; deck: Deck }
  | { type: 'hello' };

interface Envelope { ns: 'htmlpptx'; deck: string; id: string; msg: SyncMsg }

/**
 * Связь основного окна и окна докладчика.
 * postMessage работает и для файла, открытого с диска (file://), BroadcastChannel — запасной путь.
 */
export class Sync {
  private peers = new Set<Window>();
  private bc: BroadcastChannel | null = null;
  private handlers: ((m: SyncMsg) => void)[] = [];
  /** Одно сообщение может прийти дважды (postMessage и BroadcastChannel) — отсеиваем повторы */
  private seen: string[] = [];
  private counter = 0;
  private readonly me = Math.random().toString(36).slice(2);

  constructor(private deck: string) {
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

  on(h: (m: SyncMsg) => void): void {
    this.handlers.push(h);
  }

  send(msg: SyncMsg): void {
    const env: Envelope = { ns: 'htmlpptx', deck: this.deck, id: `${this.me}:${++this.counter}`, msg };
    for (const p of this.peers) {
      try {
        if (p.closed) this.peers.delete(p);
        else p.postMessage(env, '*');
      } catch {
        this.peers.delete(p);
      }
    }
    try { this.bc?.postMessage(env); } catch { /* канал закрыт */ }
  }

  private receive(data: unknown): boolean {
    const env = data as Envelope;
    if (!env || env.ns !== 'htmlpptx' || env.deck !== this.deck || !env.msg) return false;
    if (this.seen.includes(env.id) || env.id?.startsWith(this.me + ':')) return true;
    this.seen.push(env.id);
    if (this.seen.length > 64) this.seen.shift();
    this.handlers.forEach((h) => h(env.msg));
    return true;
  }
}
