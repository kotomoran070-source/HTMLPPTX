/**
 * «Мои темы»: оформление презентации (цвета, шрифты, фон, карточки, углы, вид слайдов),
 * сохранённое пользователем, — в галерее тем рядом с готовыми. Свои шрифты темы (не из набора
 * студии) сохраняются вместе с ней содержимым: тема работает и в другой презентации.
 * Хранится в своей библиотеке студии (user-library.ts); файлом .slideria-theme.json темой можно поделиться.
 */
import type { Deck, DeckTheme } from '../types';
import { blobToDataUrl } from '../engine/editor/persist';
import { themeKey } from './same';
import { libList, libPut, libRemove } from './user-library';
import { THEME_FONTS } from './theme-presets';

export interface MyTheme {
  id: string;
  name: string;
  created: number;
  theme: DeckTheme;
  /** Свои шрифты темы: файл содержимым (data: URL) */
  fonts?: { name: string; weight?: number; style?: 'italic'; file: string; data: string }[];
}

/** Признак своей темы в theme.preset: «my:<id>» */
export const MY = 'my:';

export function listMyThemes(): MyTheme[] {
  return libList<MyTheme>('themes').filter((t) => t.theme && typeof t.theme === 'object');
}

/** Новая или обновлённая (тот же id) — первой; false — некуда записать */
export function addMyTheme(t: MyTheme): boolean {
  return libPut('themes', t);
}

/** Своя тема с тем же содержимым (под любым именем) */
export function sameTheme(t: Pick<MyTheme, 'theme' | 'fonts'>, list = listMyThemes()): MyTheme | undefined {
  const key = themeKey(t);
  return list.find((x) => themeKey(x) === key);
}

export function removeMyTheme(id: string): void {
  libRemove('themes', id);
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

function saveJson(data: unknown, file: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = file;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Файл темы — скачать */
export function downloadTheme(t: MyTheme): void {
  saveJson({ slideria: 'theme', version: 1, ...t }, `${t.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'theme'}.slideria-theme.json`);
}

/** Все свои темы одним файлом (набор) — перенести на другой компьютер или поделиться */
export function downloadThemes(list: MyTheme[]): void {
  saveJson({ slideria: 'themes', version: 1, themes: list }, 'Мои темы.slideria-themes.json');
}

/** Файл темы или набор тем ({ slideria: 'themes', themes: […] } или список) → свои темы */
export function parseThemeFiles(text: string): MyTheme[] {
  const v = JSON.parse(text) as { slideria?: string; themes?: unknown };
  // Темы набора — без своей отметки slideria; одиночный файл — только с ней
  const pack = Array.isArray(v) ? v : v?.slideria === 'themes' && Array.isArray(v.themes) ? v.themes : null;
  const out = pack ? pack.map((x) => parseTheme({ slideria: 'theme', ...(x as object) })) : [parseTheme(v)];
  if (!out.length) throw new Error('в наборе нет тем');
  return out;
}

/** Файл темы → своя тема (новый id: можно загрузить тот же файл дважды) */
export function parseThemeFile(text: string): MyTheme {
  return parseTheme(JSON.parse(text));
}

function parseTheme(raw: unknown): MyTheme {
  const v = (raw ?? {}) as Partial<MyTheme> & { slideria?: string };
  if (v.slideria !== 'theme' || !v.theme || typeof v.theme !== 'object') throw new Error('это не файл темы Slideria');
  const fonts = Array.isArray(v.fonts) ? v.fonts.filter((f) => f && typeof f.name === 'string' && typeof f.data === 'string' && f.data.startsWith('data:')) : [];
  const theme = v.theme as DeckTheme;
  delete theme.preset;
  return { id: newId(), name: String(v.name || 'Тема').slice(0, 60), created: Date.now(), theme, ...(fonts.length ? { fonts } : {}) };
}
