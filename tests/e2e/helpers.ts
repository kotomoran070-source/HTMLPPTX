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
  // Какой именно адрес не загрузился: в консоли браузера адреса нет
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  return errors;
}

/**
 * Команда сервера разработки (/__htmlpptx/…) — прямо из теста, а не со страницы:
 * страницу в любой момент может перезагрузить Vite (новый файл в папке), а запрос не должен прерываться
 */
export async function api(_page: Page, cmd: string, body?: string | number[]): Promise<{ status: number; json: any; text: string }> {
  const r = await fetch(`http://localhost:5190/__htmlpptx/${cmd}`, { method: 'POST', body: Array.isArray(body) ? new Uint8Array(body) : body });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* не JSON */ }
  return { status: r.status, json, text };
}

/** Номер слайда и всего слайдов из счётчика внизу показа */
export async function counter(page: Page): Promise<[number, number]> {
  const t = (await page.locator('#ct').textContent()) ?? '';
  const m = /(\d+) из (\d+)/.exec(t);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/**
 * «Далее» до слайда i: шаги слайда (объекты «Ждёт щелчка», формула по шагам) тоже идут по «Далее»,
 * поэтому нажатий может быть больше одного
 */
export async function nextTo(page: Page, i: number): Promise<void> {
  for (let k = 0; k < 12 && (await counter(page))[0] < i; k++) {
    const was = (await counter(page))[0];
    await page.keyboard.press('PageDown');
    // Слайд сменился или шаг показан — следующее нажатие только после этого
    await page.waitForFunction((w) => { const m = /(\d+) из/.exec(document.querySelector('#ct')?.textContent ?? ''); return !m || Number(m[1]) !== w; }, was, { timeout: 600 }).catch(() => {});
  }
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
