/**
 * «Мои темы»: оформление презентации (цвета, шрифты, фон, карточки, углы, вид слайдов),
 * сохранённое пользователем, — в галерее тем рядом с готовыми. Свои шрифты темы (не из набора
 * студии) сохраняются вместе с ней содержимым: тема работает и в другой презентации.
 * Хранится в браузере; файлом .slideria-theme.json темой можно поделиться.
 */
import type { Deck, DeckTheme } from '../types';
import { blobToDataUrl } from '../engine/editor/persist';
import { THEME_FONTS } from './theme-presets';

export interface MyTheme {
  id: string;
  name: string;
  created: number;
  theme: DeckTheme;
  /** Свои шрифты темы: файл содержимым (data: URL) */
  fonts?: { name: string; weight?: number; style?: 'italic'; file: string; data: string }[];
}

const KEY = 'slideria-themes';
/** Признак своей темы в theme.preset: «my:<id>» */
export const MY = 'my:';

export function listMyThemes(): MyTheme[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((t) => t && typeof t.id === 'string' && t.theme && typeof t.theme === 'object') : [];
  } catch {
    return [];
  }
}

function store(list: MyTheme[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** false — не хватило места в хранилище браузера */
export function addMyTheme(t: MyTheme): boolean {
  return store([t, ...listMyThemes().filter((x) => x.id !== t.id)]);
}

export function removeMyTheme(id: string): void {
  store(listMyThemes().filter((t) => t.id !== id));
}

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Оформление презентации → своя тема: без отметки галереи, со своими шрифтами */
export async function captureTheme(deck: Deck, name: string): Promise<MyTheme> {
  const theme = structuredClone(deck.theme ?? {});
  delete theme.preset;
  const names = new Set([theme.font, theme.head].filter((n): n is string => !!n && !THEME_FONTS[n]));
  const fonts: NonNullable<MyTheme['fonts']> = [];
  for (const f of deck.fonts ?? []) {
    if (!names.has(f.name) || f.from === 'theme') continue;
    try {
      const blob = await (await fetch(f.src)).blob();
      if (blob.size > 3 * 1024 * 1024) continue;
      const file = decodeURIComponent(f.src.split(/[?#]/)[0].split('/').pop() ?? '').replace(/^data:.*/, '') || `${f.name.replace(/\W+/g, '-')}.woff2`;
      fonts.push({ name: f.name, weight: f.weight, style: f.style, file, data: await blobToDataUrl(blob) });
    } catch { /* файл недоступен — шрифт останется именем */ }
  }
  return { id: newId(), name, created: Date.now(), theme, ...(fonts.length ? { fonts } : {}) };
}

/** Шрифты своих тем — в браузер: плитки галереи сразу своими буквами */
const loaded = new Set<string>();
export function registerMyFonts(list: MyTheme[]): void {
  for (const t of list) {
    for (const f of t.fonts ?? []) {
      const key = `${f.name}|${f.weight ?? 400}|${f.style ?? ''}|${t.id}`;
      if (loaded.has(key)) continue;
      loaded.add(key);
      try {
        const face = new FontFace(f.name, `url(${f.data})`, { weight: String(f.weight ?? 400), style: f.style ?? 'normal' });
        document.fonts.add(face);
        void face.load().catch(() => {});
      } catch { /* испорченный файл */ }
    }
  }
}

/** Файл темы — скачать */
export function downloadTheme(t: MyTheme): void {
  const blob = new Blob([JSON.stringify({ slideria: 'theme', version: 1, ...t }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'theme'}.slideria-theme.json`;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Файл темы → своя тема (новый id: можно загрузить тот же файл дважды) */
export function parseThemeFile(text: string): MyTheme {
  const v = JSON.parse(text) as Partial<MyTheme> & { slideria?: string };
  if (v.slideria !== 'theme' || !v.theme || typeof v.theme !== 'object') throw new Error('это не файл темы Slideria');
  const fonts = Array.isArray(v.fonts) ? v.fonts.filter((f) => f && typeof f.name === 'string' && typeof f.data === 'string' && f.data.startsWith('data:')) : [];
  const theme = v.theme as DeckTheme;
  delete theme.preset;
  return { id: newId(), name: String(v.name || 'Тема').slice(0, 60), created: Date.now(), theme, ...(fonts.length ? { fonts } : {}) };
}
