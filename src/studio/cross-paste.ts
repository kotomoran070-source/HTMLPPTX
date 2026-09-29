import { cssKey, statements } from '../engine/deck-css';
import type { Block, Deck } from '../types';
import type { Clip } from './clipboard';
import { assetUrls, mergeCss, mergeDefs, pickDefs, replaceUrls } from './templates';

type Doc = Deck & { css?: string; defs?: string };

/**
 * Вставка слайдов и объектов из другой презентации — так, чтобы основная не «поплыла».
 * Вёрстка получает пространство стилей (ns): стили исходной презентации действуют только
 * внутри неё, а стили этой презентации — не действуют на неё (см. deck-css.ts). Имена анимаций
 * получают суффикс, SVG-определения с тем же id, но другим содержимым, — новые id.
 * Файлы (картинки, видео, модели) копируются в папку этой презентации.
 */

export interface CrossResult<T> {
  items: T[];
  /** Что дописать в данные презентации */
  apply(d: Deck): void;
  files: number;
}

/** Все строки внутри данных — через функцию (html вёрстки, адреса, inline-стили) */
function mapStrings<T>(v: T, f: (s: string) => string): T {
  if (typeof v === 'string') return f(v) as T;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)])) as T;
  return v;
}

/** Html-блоки внутри слайдов и объектов (включая группы и раскладку) */
function htmlBlocks(v: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(v)) v.forEach((x) => htmlBlocks(x, out));
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.type === 'html' && typeof o.html === 'string') out.push(o);
    Object.values(o).forEach((x) => htmlBlocks(x, out));
  }
  return out;
}

/** Имена анимаций в свойствах animation / animation-name: переименовать по словарю */
function renameAnimations(text: string, names: Map<string, string>): string {
  if (!names.size) return text;
  return text.replace(/(animation(?:-name)?\s*:)([^;}"]*)/gi, (_m, prop: string, value: string) =>
    prop + value.replace(/[\w-]+/g, (w) => names.get(w) ?? w));
}

export async function crossPaste<T>(
  clip: Clip, raw: T[], target: Deck,
  upload: (blob: Blob, name: string) => Promise<string>,
): Promise<CrossResult<T>> {
  let items = JSON.parse(JSON.stringify(raw)) as T[];

  // 1. Файлы: в папку этой презентации, адреса в данных — новые
  const map = new Map<string, string>();
  for (const url of assetUrls(items)) {
    try {
      const blob = await (await fetch(url)).blob();
      const name = decodeURIComponent(url.split('/').pop()!.split('?')[0]);
      map.set(url, await upload(blob, name));
    } catch { /* файл недоступен — адрес остаётся прежним */ }
  }
  items = replaceUrls(items, map);

  // 2. Стили исходной презентации — в своё пространство (одно на одинаковые стили)
  const css = typeof clip.css === 'string' && clip.css.trim() ? clip.css : '';
  let scoped: { ns: string; css: string } | null = null;
  if (css && htmlBlocks(items).length) {
    const ns = `xp-${cssKey(css).slice(0, 8)}`;
    // Анимации — глобальные имена: с суффиксом, чтобы не заменить одноимённые у этой презентации.
    // Свои эффекты появления (ufx-…) не трогаем: на них ссылается deck.effects
    const names = new Map<string, string>();
    for (const st of statements(css)) {
      const kf = /^@(?:-webkit-)?keyframes\s+([\w-]+)/i.exec(st);
      if (kf && !kf[1].startsWith('ufx-')) names.set(kf[1], `${kf[1]}-${ns}`);
    }
    const text = renameAnimations(css, names).replace(/(@(?:-webkit-)?keyframes\s+)([\w-]+)/gi, (_m, at: string, n: string) => at + (names.get(n) ?? n));
    items = mapStrings(items, (s) => renameAnimations(s, names));
    // Вёрстка, уже вставленная из третьей презентации, остаётся в своём пространстве
    htmlBlocks(items).forEach((b) => { if (typeof b.ns !== 'string') b.ns = ns; });
    scoped = { ns, css: text };
  }

  // 3. SVG-определения: нужные объектам; тот же id с другим содержимым — новый id
  let defs = pickDefs(clip.defs, items as unknown as Block[]);
  if (defs) {
    const have = document.createElement('template');
    const td = (target as Doc).defs;
    have.innerHTML = `<svg>${typeof td === 'string' ? td : ''}</svg>`;
    const add = document.createElement('template');
    add.innerHTML = `<svg>${defs}</svg>`;
    const sfx = cssKey(defs).slice(0, 6);
    const ids = new Map<string, string>();
    for (const el of add.content.firstElementChild!.children) {
      const same = el.id ? have.content.getElementById?.(el.id) ?? have.content.querySelector(`[id="${CSS.escape(el.id)}"]`) : null;
      if (same && same.outerHTML !== el.outerHTML) ids.set(el.id, `${el.id}-x${sfx}`);
    }
    if (ids.size) {
      const re = new RegExp(`(#|id=\\\\?["'])(${[...ids.keys()].map((i) => i.replace(/[-]/g, '\\-')).join('|')})(?![\\w-])`, 'g');
      const fix = (s: string) => s.replace(re, (_m, pre: string, id: string) => pre + ids.get(id));
      defs = fix(defs);
      items = mapStrings(items, fix);
      if (scoped) scoped.css = fix(scoped.css);
    }
  }

  // 4. Свои эффекты появления, которыми пользуются объекты
  const used = new Set<string>();
  JSON.stringify(items).replace(/"enter":"(ufx-[\w-]+)"/g, (_m, id: string) => { used.add(id); return ''; });
  const effects = Object.fromEntries(Object.entries(clip.effects ?? {}).filter(([id]) => used.has(id)));
  // Их анимации — в стили этой презентации (они и так глобальные, имена уникальные)
  const fxCss = css ? statements(css).filter((st) => {
    const kf = /^@(?:-webkit-)?keyframes\s+(ufx-[\w-]+)/i.exec(st);
    return !!kf && used.has(kf[1]);
  }).join('\n') : '';

  return {
    items,
    files: map.size,
    apply(d: Deck) {
      const x = d as Doc;
      if (scoped && !d.scoped?.[scoped.ns]) d.scoped = { ...(d.scoped ?? {}), [scoped.ns]: scoped.css };
      for (const b of htmlBlocks(items)) {
        const own = typeof b.ns === 'string' ? clip.scoped?.[b.ns] : undefined;
        if (own && !d.scoped?.[b.ns as string]) d.scoped = { ...(d.scoped ?? {}), [b.ns as string]: own };
      }
      const merged = mergeDefs(x.defs, defs || undefined);
      if (merged) x.defs = merged;
      const withFx = mergeCss(x.css, fxCss || undefined);
      if (withFx) x.css = withFx;
      for (const [id, e] of Object.entries(effects)) {
        if (!d.effects?.[id]) d.effects = { ...(d.effects ?? {}), [id]: e };
      }
    },
  };
}
