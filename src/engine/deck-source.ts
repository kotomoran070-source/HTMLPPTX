/**
 * Откуда страница берёт презентации.
 *   С сервером (yarn dev, программа, облако): список и данные — по адресам сервера (server/http.ts), пути
 *   к файлам в данных уже заменены адресами этого сервера. Так одинаково и с исходниками (Vite), и с готовой
 *   сборкой студии (server/serve.ts).
 *   Собранный файл презентации: данные лежат в самом HTML (<script id="htmlpptx-deck">) — так сохранённая из
 *   браузера копия несёт свои правки; имя — в <meta name="slideria-deck">.
 */
import type { Deck } from '../types';
import { unpackDeck } from './pack';

export type Loaders = Record<string, () => Promise<Deck>>;

/** Адреса данных для страниц (server/http.ts) */
export const DECKS_URL = '/__slideria/decks';
export const DECK_URL = '/__slideria/deck/';

/** Презентации нет (удалили, опечатка в адресе) */
export class DeckMissing extends Error {}

/** Какую версию deck.yaml страница получила последней (заголовок X-Slideria-Rev) */
const revs = new Map<string, string>();
export const loadedRev = (name: string) => revs.get(name) ?? '';

/** Данные презентации с сервера. Ошибка в deck.yaml — { __error: текст }: страница покажет её вместо слайдов */
export async function fetchDeck(name: string): Promise<Deck> {
  const r = await fetch(DECK_URL + encodeURIComponent(name), { cache: 'no-store' });
  revs.set(name, r.headers.get('X-Slideria-Rev') ?? '');
  const body = await r.json().catch(() => null) as { error?: string } | null;
  if (r.status === 404) throw new DeckMissing(body?.error ?? `Презентация «${name}» не найдена`);
  if (!r.ok) return { __error: body?.error ?? `Сервер ответил ${r.status}` } as unknown as Deck;
  if (!body) throw new Error(`Презентация «${name}»: ответ сервера оборвался`);
  return body as Deck;
}

/** Имена презентаций на сервере */
export async function fetchNames(): Promise<string[]> {
  const r = await fetch(DECKS_URL, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Список презентаций: сервер ответил ${r.status}`);
  return ((await r.json()) as { name: string }[]).map((d) => d.name);
}

/** Загрузчики презентаций с сервера */
export const serverLoaders = (names: string[]): Loaders => Object.fromEntries(names.map((n) => [n, () => fetchDeck(n)]));

/** Собранный файл: своя презентация из самого HTML */
export function embeddedDeck(): { name: string; load: () => Promise<Deck> } {
  const el = document.getElementById('htmlpptx-deck');
  const name = document.querySelector('meta[name="slideria-deck"]')?.getAttribute('content') || 'deck';
  return { name, load: async () => unpackDeck(JSON.parse(el?.textContent ?? 'null')) as Deck };
}
