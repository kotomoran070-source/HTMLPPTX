/**
 * Буфер обмена студии: скопированные объекты или слайды.
 * В системный буфер кладётся текст (его можно вставить куда угодно) и метка своего формата,
 * по которой вставка в студии находит данные. Данные живут в памяти и в localStorage,
 * поэтому вставка работает и в другой вкладке с той же презентацией.
 */

export const CLIP_TYPE = 'application/x-htmlpptx';
const KEY = 'htmlpptx-clip';

export interface Clip {
  id: string;
  /** Презентация, из которой скопировано: картинки лежат в её папке */
  deck: string;
  kind: 'objects' | 'slides';
  items: unknown[];
  /** Слайд, с которого скопированы объекты: вставка на него же — со сдвигом */
  slide: number;
  /** Для вставки в другую презентацию: стили, SVG-определения и эффекты появления исходной */
  css?: string;
  defs?: string;
  effects?: Record<string, { name: string; ms?: number; ease?: string }>;
  /** Изолированные стили вёрстки, которая сама была вставлена из третьей презентации */
  scoped?: Record<string, string>;
}

let mem: Clip | null = null;

export function putClip(c: Omit<Clip, 'id'>): Clip {
  const clip = { ...c, id: Math.random().toString(36).slice(2, 10) };
  mem = clip;
  try { localStorage.setItem(KEY, JSON.stringify(clip)); } catch { /* хранилище недоступно или переполнено */ }
  return clip;
}

/** Данные по метке из системного буфера; без метки — последнее скопированное. */
export function takeClip(id?: string): Clip | null {
  if (mem && (!id || mem.id === id)) return mem;
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Clip | null;
    if (c && (!id || c.id === id)) return c;
  } catch { /* нет данных */ }
  return null;
}
