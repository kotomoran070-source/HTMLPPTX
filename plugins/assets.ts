import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/avif': 'avif', 'image/svg+xml': 'svg', 'text/html': 'htm',
};

export const DATA_URL_RE = /^data:(image\/(?:png|jpeg|gif|webp|avif|svg\+xml)|text\/html);base64,([a-z0-9+/=\s]+)$/i;

const TEXT_URL_RE = /^data:(image\/svg\+xml|text\/html)(?:;charset=[\w-]+)?,([\s\S]*)$/i;

const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');

/**
 * Картинки папки assets/ презентации: встроенная картинка (data:) превращается в файл,
 * а если такой файл уже есть — используется он (логотип не размножается копиями).
 */
export class AssetStore {
  private byHash = new Map<string, string>();
  private pending = new Map<string, Buffer>();

  constructor(private deckDir: string) {
    const dir = path.join(deckDir, 'assets');
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const abs = path.join(dir, f);
      if (fs.statSync(abs).isFile()) this.byHash.set(sha(fs.readFileSync(abs)), `./assets/${f}`);
    }
  }

  /** Путь ./assets/… для встроенной картинки; новый файл записывается при flush(). */
  pathFor(dataUrl: string): string | null {
    let m = DATA_URL_RE.exec(dataUrl);
    let buf: Buffer;
    if (m) buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
    else {
      // Текстовые форматы бывают и без base64: data:image/svg+xml;charset=utf-8,%3Csvg…
      m = TEXT_URL_RE.exec(dataUrl);
      if (!m) return null;
      try { buf = Buffer.from(decodeURIComponent(m[2]), 'utf8'); } catch { return null; }
    }
    const h = sha(buf);
    const known = this.byHash.get(h);
    if (known) return known;
    const ext = EXT[m[1].toLowerCase()] ?? 'png';
    const rel = `./assets/${ext === 'htm' ? 'embed' : 'image'}-${h.slice(0, 10)}.${ext}`;
    this.byHash.set(h, rel);
    this.pending.set(rel, buf);
    return rel;
  }

  /** Новые файлы, которые появятся после flush(). */
  get added(): string[] {
    return [...this.pending.keys()];
  }

  flush(): void {
    if (!this.pending.size) return;
    fs.mkdirSync(path.join(this.deckDir, 'assets'), { recursive: true });
    for (const [rel, buf] of this.pending) fs.writeFileSync(path.join(this.deckDir, rel), buf);
    this.pending.clear();
  }

  /** Заменяет все встроенные картинки в данных путями к файлам. */
  normalize(v: unknown): unknown {
    if (typeof v === 'string') return v.startsWith('data:') ? this.pathFor(v) ?? v : v;
    if (Array.isArray(v)) return v.map((x) => this.normalize(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.normalize(x)]));
    return v;
  }
}
