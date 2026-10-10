import type { Deck } from '../../types';
import { packDeck } from '../pack';

/** id тега с данными презентации в собранном HTML (см. plugins/decks.ts) */
export const DATA_ID = 'htmlpptx-deck';

// ---------- собранный файл: сохранение копии HTML ----------

let snapshot: string | null = null;

/**
 * Запоминает исходную разметку страницы до того, как приложение её изменит.
 * Вызывается первой строкой main.ts: копия с правками строится из этого снимка.
 */
export function captureSnapshot(): void {
  if (document.getElementById(DATA_ID)) snapshot = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}

export function canSaveFile(): boolean {
  return snapshot !== null;
}

function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** HTML-файл презентации с новыми данными. */
export function buildHtml(deck: Deck): string {
  if (!snapshot) throw new Error('Сохранение копии доступно только в собранном файле');
  const open = `<script type="application/json" id="${DATA_ID}">`;
  const start = snapshot.indexOf(open);
  const end = snapshot.indexOf('</script>', start);
  if (start < 0 || end < 0) throw new Error('В файле не найдены данные презентации');
  let html = snapshot.slice(0, start + open.length) + scriptJson(packDeck(deck)) + snapshot.slice(end);
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(deck.title ?? '')}</title>`);
  return html;
}

interface Writable { write(data: Blob): Promise<void>; close(): Promise<void> }
interface FileHandle { name: string; createWritable(): Promise<Writable> }
type SavePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileHandle>;

let handle: FileHandle | null = null;

export function suggestedFileName(fallback: string): string {
  const last = decodeURIComponent(location.pathname.split('/').pop() ?? '');
  return /\.html?$/i.test(last) ? last : `${fallback}.html`;
}

/**
 * Сохраняет HTML: в Chrome и Edge — в выбранный файл (повторные сохранения пишут туда же),
 * в остальных браузерах — скачиванием копии.
 */
export async function saveHtmlFile(html: string, name: string): Promise<{ how: 'file' | 'download'; name: string } | null> {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      if (!handle) {
        handle = await picker({ suggestedName: name, types: [{ description: 'HTML-презентация', accept: { 'text/html': ['.html'] } }] });
      }
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return { how: 'file', name: handle.name };
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      handle = null;
      // Нет доступа к файловой системе (например, запрет политики) — скачиваем
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return { how: 'download', name };
}

// ---------- yarn dev: запись в deck.yaml ----------

async function api<T>(url: string, body: BodyInit, type: string, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': type }, body, keepalive });
  } catch {
    throw new Error('нет связи с yarn dev — сервер остановлен?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `ошибка ${res.status}`);
  return data as T;
}

/** Окно, которое пишет: остальные окна этой презентации узнают, что файл изменили не они */
export const WINDOW_ID = Math.random().toString(36).slice(2, 10);

/**
 * Записать данные; base — версия, с которой окно начинало (тогда чужие правки в файле не затираются).
 * deck в ответе — итог с чужими правками, если они были
 */
export function saveToProject(deckKey: string, deck: Deck, keepalive = false, base?: Deck): Promise<{ changed: boolean; deck?: Deck }> {
  return api(`/__htmlpptx/save?deck=${encodeURIComponent(deckKey)}&from=${WINDOW_ID}`, JSON.stringify({ deck, base }), 'application/json', keepalive);
}

/** Перезаписать файл живой вставки (assets/*.htm) по его адресу — правка кода в студии */
export function writeAssetText(deckKey: string, url: string, text: string): Promise<{ ok: boolean }> {
  return api(`/__htmlpptx/asset-text?deck=${encodeURIComponent(deckKey)}&url=${encodeURIComponent(url)}`, text, 'text/plain; charset=utf-8');
}

/** Файлы презентации с размерами; неиспользуемые — в корзину проекта */
export function listDeckAssets(deckKey: string): Promise<{ path: string; size: number }[]> {
  return api(`/__htmlpptx/assets-list?deck=${encodeURIComponent(deckKey)}`, '', 'text/plain');
}
export function trashDeckAssets(deckKey: string, paths: string[]): Promise<{ moved: number }> {
  return api(`/__htmlpptx/assets-trash?deck=${encodeURIComponent(deckKey)}`, JSON.stringify(paths), 'application/json');
}

/** Контрольные точки: копия deck.yaml сейчас, список (новые первыми), текст точки */
export function makeCheckpoint(deckKey: string): Promise<{ id: string; time: number; same: boolean }> {
  return api(`/__htmlpptx/checkpoint?deck=${encodeURIComponent(deckKey)}`, '', 'text/plain');
}
export function listCheckpoints(deckKey: string): Promise<{ id: string; time: number }[]> {
  return api(`/__htmlpptx/checkpoints?deck=${encodeURIComponent(deckKey)}`, '', 'text/plain');
}
export function readCheckpoint(deckKey: string, id: string): Promise<{ deck: unknown }> {
  return api(`/__htmlpptx/checkpoint-read?deck=${encodeURIComponent(deckKey)}&id=${encodeURIComponent(id)}`, '', 'text/plain');
}

/** Общая библиотека шрифтов (папка fonts/ проекта) */
export function listLibraryFonts(): Promise<{ file: string; url: string }[]> {
  return api('/__htmlpptx/font-list', '', 'text/plain');
}
export function saveLibraryFont(file: Blob, name: string): Promise<{ file: string }> {
  return api(`/__htmlpptx/font-save?file=${encodeURIComponent(name)}`, file, 'application/octet-stream');
}
/** Шрифт из библиотеки — копией в assets/ презентации */
export function useLibraryFont(deckKey: string, file: string): Promise<{ url: string; path: string }> {
  return api(`/__htmlpptx/font-use?deck=${encodeURIComponent(deckKey)}&file=${encodeURIComponent(file)}`, '', 'text/plain');
}

export function uploadAsset(deckKey: string, file: Blob, name: string): Promise<{ url: string; path: string }> {
  return api(`/__htmlpptx/asset?deck=${encodeURIComponent(deckKey)}&name=${encodeURIComponent(name)}`, file, 'application/octet-stream');
}

// ---------- картинки ----------

const MAX_SIDE = 2400;
export const MAX_FILE = 25 * 1024 * 1024;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('не удалось прочитать изображение'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Уменьшает слишком большие фотографии до 2400 px по длинной стороне:
 * презентация остаётся лёгкой, качество на экране не страдает. SVG и GIF не трогаем.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; name: string; resized: boolean }> {
  if (!/^image\/(png|jpeg|webp|avif)$/.test(file.type)) return { blob: file, name: file.name, resized: false };
  const img = await loadImage(file);
  URL.revokeObjectURL(img.src);
  const side = Math.max(img.naturalWidth, img.naturalHeight);
  if (side <= MAX_SIDE && file.size <= 3 * 1024 * 1024) return { blob: file, name: file.name, resized: false };
  const k = Math.min(1, MAX_SIDE / side);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * k);
  canvas.height = Math.round(img.naturalHeight * k);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.9));
  if (!blob || blob.size >= file.size) return { blob: file, name: file.name, resized: false };
  const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
  return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.' + ext, resized: true };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('не удалось прочитать файл'));
    r.readAsDataURL(blob);
  });
}
