import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/** Временная копия презентаций (tests/prepare.mjs): тесты пишут сюда, а не в presentations/ */
export const DECKS = path.resolve('.tmp', 'test-decks');
export const deckFile = (name: string) => path.join(DECKS, name, 'deck.yaml');
export const readDeck = (name: string) => fs.readFileSync(deckFile(name), 'utf8');

/** Ошибки страницы: необработанные исключения и ошибки в консоли */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Предупреждения WebGL в браузере без видеокарты — не ошибки движка
    if (m.type() === 'error' && !/WebGL|GPU|GroupMarkerNotSet/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Команда сервера разработки (/__htmlpptx/…) из страницы — как её вызывает сам редактор */
export async function api(page: Page, cmd: string, body?: string | number[]): Promise<{ status: number; json: any; text: string }> {
  return page.evaluate(async ([c, b]) => {
    const data = Array.isArray(b) ? new Uint8Array(b) : b;
    const r = await fetch(`/__htmlpptx/${c}`, { method: 'POST', body: data as BodyInit | undefined });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* не JSON */ }
    return { status: r.status, json, text };
  }, [cmd, body] as const);
}

/** Номер слайда и всего слайдов из счётчика внизу показа */
export async function counter(page: Page): Promise<[number, number]> {
  const t = (await page.locator('#ct').textContent()) ?? '';
  const m = /(\d+) из (\d+)/.exec(t);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** PNG 1×1 — для загрузки картинки */
export const PNG = [...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')];

/** Ждать, пока условие над файлом станет верным (сервер пишет файл не мгновенно) */
export async function waitFile(check: () => boolean, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return check();
}
