/**
 * Переходы между слайдами: один список для показа (render, base.css), ленты «Анимация» и подсказок кода.
 * Без DOM. У слайда: transition — переход к нему, transitionMs — длительность, transitionDir — откуда
 * (у Сдвига, Наплыва, Открывания и Шторки): right, left, top, bottom.
 */
export const TRANSITIONS: readonly (readonly [id: string, name: string])[] = [
  ['', 'Стандартный'], ['none', 'Без перехода'], ['fade', 'Растворение'], ['push', 'Сдвиг'], ['cover', 'Наплыв'],
  ['uncover', 'Открывание'], ['wipe', 'Шторка'], ['split', 'Панорама'], ['circle', 'Круг'], ['clock', 'Часы'],
  ['flash', 'Вспышка'], ['zoom', 'Приближение'], ['blur', 'Размытие'], ['morph', 'Морф'],
];
export const TRANSITION_IDS: ReadonlySet<string> = new Set(TRANSITIONS.map(([k]) => k).filter(Boolean));

/** Направления: откуда идёт новый слайд (у Открывания — куда открывается старый) */
export const TR_DIRS: readonly (readonly [id: string, name: string])[] = [['right', 'Справа'], ['left', 'Слева'], ['top', 'Сверху'], ['bottom', 'Снизу']];
const DIR_IDS = new Set(TR_DIRS.map(([k]) => k));
/** У каких переходов есть направление и какое по умолчанию */
export const TR_DIR_DEFAULT: Readonly<Record<string, string>> = { push: 'right', cover: 'right', uncover: 'right', wipe: 'left' };

/** Направление перехода слайда: своё, если задано и переходу оно бывает, иначе по умолчанию; без направления — '' */
export function trDir(transition: unknown, dir: unknown): string {
  const def = TR_DIR_DEFAULT[String(transition)];
  if (!def) return '';
  return typeof dir === 'string' && DIR_IDS.has(dir) ? dir : def;
}
