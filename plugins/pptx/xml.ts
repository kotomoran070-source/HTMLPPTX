/**
 * Чтение PPTX: zip с XML-частями и связями (rels). Небольшие помощники над DOM из @xmldom/xmldom:
 * элементы ищутся по локальному имени (a:xfrm и p:xfrm — оба «xfrm»), префиксы в файлах бывают разные.
 */
import path from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

export type El = Element;

export const kids = (el: El | null | undefined, name?: string): El[] => {
  const out: El[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || (n as El).localName === name)) out.push(n as El);
  }
  return out;
};

export const kid = (el: El | null | undefined, name: string): El | null => kids(el, name)[0] ?? null;

/** Путь из локальных имён: one(sp, 'spPr', 'xfrm', 'off') */
export function one(el: El | null | undefined, ...names: string[]): El | null {
  let cur: El | null | undefined = el;
  for (const n of names) cur = kid(cur, n);
  return cur ?? null;
}

/** Первый потомок на любой глубине */
export function find(el: El | null | undefined, name: string): El | null {
  if (!el) return null;
  const all = el.getElementsByTagNameNS('*', name);
  return all.length ? (all[0] as El) : null;
}

export const attr = (el: El | null | undefined, name: string): string | null => (el && el.hasAttribute(name) ? el.getAttribute(name) : null);
export const num = (el: El | null | undefined, name: string): number | null => {
  const v = attr(el, name);
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const bool = (el: El | null | undefined, name: string): boolean | null => {
  const v = attr(el, name);
  return v === null ? null : v === '1' || v === 'true';
};

/** Текст всех a:t внутри */
export const textOf = (el: El | null | undefined): string => (el ? Array.from(el.getElementsByTagNameNS('*', 't')).map((t) => t.textContent ?? '').join('') : '');

const parser = new DOMParser({ onError: () => { /* битые части пропускаются ниже */ } });

/** Пакет PPTX: части по путям и связи между ними */
export class Pkg {
  private xmlCache = new Map<string, El | null>();
  private relCache = new Map<string, Map<string, { target: string; type: string; external: boolean }>>();
  constructor(readonly zip: JSZip, private texts: Map<string, string>) {}

  static async open(data: Buffer | Uint8Array): Promise<Pkg> {
    const zip = await JSZip.loadAsync(data);
    const texts = new Map<string, string>();
    await Promise.all(Object.keys(zip.files).filter((f) => /\.(xml|rels)$/i.test(f)).map(async (f) => texts.set(f, await zip.files[f].async('string'))));
    return new Pkg(zip, texts);
  }

  has(part: string): boolean { return this.texts.has(part) || !!this.zip.files[part]; }

  xml(part: string): El | null {
    if (!this.xmlCache.has(part)) {
      const src = this.texts.get(part);
      let root: El | null = null;
      if (src) {
        try { root = parser.parseFromString(src, 'text/xml').documentElement as unknown as El; } catch { root = null; }
      }
      this.xmlCache.set(part, root);
    }
    return this.xmlCache.get(part)!;
  }

  async bytes(part: string): Promise<Buffer | null> {
    const f = this.zip.files[part];
    return f ? f.async('nodebuffer') : null;
  }

  /** Связи части: rId → путь цели (абсолютный в архиве) */
  rels(part: string): Map<string, { target: string; type: string; external: boolean }> {
    if (!this.relCache.has(part)) {
      const relPath = path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels');
      const map = new Map<string, { target: string; type: string; external: boolean }>();
      for (const r of kids(this.xml(relPath), 'Relationship')) {
        const external = attr(r, 'TargetMode') === 'External';
        const t = attr(r, 'Target') ?? '';
        const target = external ? t : t.startsWith('/') ? t.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(part), t));
        map.set(attr(r, 'Id') ?? '', { target, type: (attr(r, 'Type') ?? '').split('/').pop() ?? '', external });
      }
      this.relCache.set(part, map);
    }
    return this.relCache.get(part)!;
  }

  rel(part: string, id: string | null): string | null {
    if (!id) return null;
    const r = this.rels(part).get(id);
    return r && !r.external ? r.target : null;
  }

  relByType(part: string, type: string): string | null {
    for (const r of this.rels(part).values()) if (r.type === type && !r.external) return r.target;
    return null;
  }
}
