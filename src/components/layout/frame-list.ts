/**
 * Картинка с кадрами (frames.ts): правка списка кадров в данных — добавить, убрать, переставить.
 * Отдельно от показа: без DOM, нужна студии, редактору и модульным тестам
 */

/** Поля кадра: у первого — поля самой картинки */
const FRAME_KEYS = ['src', 'srcDark', 'alt', 'caption', 'fit', 'position', 'zoom'] as const;
type Img = Record<string, unknown> & { images?: unknown[] };
const asFrame = (x: unknown): Record<string, unknown> => (typeof x === 'string' ? { src: x } : { ...(x as Record<string, unknown>) });
/** Кадр с адресом — его рисуют (framesOf), остальные пропускаются */
const valid = (x: unknown) => { const src = asFrame(x).src; return typeof src === 'string' && !!src.trim(); };

/**
 * Кадры картинки списком объектов (первый — из полей картинки), как их рисует framesOf: без адреса — пропущены.
 * Вписывание картинки (fit) кадры без своего берут у неё — в списке оно у каждого: переставили — вид тот же
 */
export function frameList(b: Img): Record<string, unknown>[] {
  const first: Record<string, unknown> = {};
  for (const k of FRAME_KEYS) if (b[k] !== undefined) first[k] = b[k];
  const more = (Array.isArray(b.images) ? b.images : []).filter(valid).map(asFrame);
  if (b.fit !== undefined) for (const x of more) x.fit ??= b.fit;
  // Пустое место под картинку — ещё не кадр: новые файлы встают первыми
  return valid(first) ? [first, ...more] : more;
}

/** Записать кадры: первый — в поля картинки, остальные — в images (один кадр — обычная картинка) */
export function setFrameList(b: Img, list: Record<string, unknown>[]): void {
  const [first = {}, ...rest] = list;
  for (const k of FRAME_KEYS) {
    if (first[k] !== undefined) b[k] = first[k];
    else delete b[k];
  }
  if (rest.length) b.images = rest;
  else {
    delete b.images;
    delete b.flip;
  }
}

/** Убрать кадр k; у последнего оставшегося — обычная картинка */
export function removeFrame(b: Img, k: number): void {
  const list = frameList(b);
  if (list.length < 2) return;
  list.splice(k, 1);
  setFrameList(b, list);
}

/** Новые кадры после кадра k */
export function insertFrames(b: Img, k: number, srcs: string[]): void {
  const list = frameList(b);
  const fresh = srcs.map((src): Record<string, unknown> => ({ src }));
  // У пустого места под картинку первый файл берёт его подпись и кадр
  if (!valid(b.src) && fresh.length) for (const key of FRAME_KEYS) if (key !== 'src' && b[key] !== undefined) fresh[0][key] = b[key];
  list.splice(k + 1, 0, ...fresh);
  setFrameList(b, list);
}

/** Переставить кадр k на d мест (−1 — раньше, 1 — позже) */
export function moveFrame(b: Img, k: number, d: number): void {
  const list = frameList(b);
  if (k < 0 || k >= list.length || k + d < 0 || k + d >= list.length) return;
  list.splice(k + d, 0, ...list.splice(k, 1));
  setFrameList(b, list);
}

/**
 * Картинка и номер кадра по адресу хозяина кадра (data-img-owner): кадр из images — […, 'images', n];
 * сама картинка с кадрами — кадр 0. null — у картинки кадров нет
 */
export function frameAt(owner: (string | number)[], get: (p: (string | number)[]) => unknown): { block: (string | number)[]; k: number } | null {
  if (owner.length > 2 && owner[owner.length - 2] === 'images') {
    const block = owner.slice(0, -2);
    const list = (get(block) as Img | undefined)?.images;
    return { block, k: 1 + (Array.isArray(list) ? list.slice(0, Number(owner[owner.length - 1])).filter(valid).length : 0) };
  }
  const b = get(owner) as Img | undefined;
  return b && Array.isArray(b.images) && b.images.length ? { block: owner, k: 0 } : null;
}
