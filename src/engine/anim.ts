/**
 * Анимация объектов: появление, выделение, исчезновение — названия и порядок щелчков. Один список
 * для показа (render, base.css), ленты «Анимация» и панели свойств. Без DOM: годится и серверу.
 *
 * У объекта (slide.free[]):
 *   enter: rise, delay: 300 — появление; click: true — по щелчку (delay — место в очереди щелчков);
 *   emphasis: pulse — выделение; с emphAt: 900 — шагом по щелчку (иначе только кнопкой «Проиграть»);
 *   exit: fade, exitAt: 1200 — исчезновение по щелчку (exitAt — место в очереди; нет — в конце).
 * Места в очереди — числа одной шкалы (как delay у появлений по щелчку): кто меньше — тот раньше.
 */
import type { Block } from '../types';

export type Pair = readonly [id: string, name: string];

/** Появления: простые, раскрытия (обрезкой и маской), текст по частям, прорисовка контура */
export const ENTER: readonly Pair[] = [
  ['fade', 'Проявление'], ['rise', 'Всплытие снизу'], ['drop', 'Появление сверху'], ['left', 'Выезд слева'],
  ['right', 'Выезд справа'], ['scale', 'Увеличение'], ['pop', 'Пружина'], ['blur', 'Из фокуса'],
  ['wipe', 'Шторка'], ['circle', 'Круг'], ['diamond', 'Ромб'], ['mask', 'Проявление маской'],
  ['words', 'По словам'], ['letters', 'По буквам'], ['draw', 'Прорисовка'],
];
export const ENTER_IDS: ReadonlySet<string> = new Set(ENTER.map(([k]) => k));
/** Только у текста (надпись, текст фигуры) */
export const TEXT_ENTER: ReadonlySet<string> = new Set(['words', 'letters']);

/** Исчезновения — всегда по щелчку; короче появления и с ускорением к концу */
export const EXIT: readonly Pair[] = [
  ['fade', 'Растворение'], ['sink', 'Уход вниз'], ['left', 'Уход влево'], ['right', 'Уход вправо'], ['shrink', 'Сжатие'], ['wipe', 'Шторка'],
];
export const EXIT_IDS: ReadonlySet<string> = new Set(EXIT.map(([k]) => k));

/** Выделения: по щелчку или кнопкой «Проиграть». «Маркер» проводит выделение маркером в тексте ({mark|…}) */
export const EMPHASIS: readonly Pair[] = [
  ['pulse', 'Пульс'], ['shake', 'Покачивание'], ['spin', 'Вращение'], ['bounce', 'Прыжок'], ['flash', 'Вспышка'], ['glow', 'Свечение'], ['mark', 'Маркер'],
];
export const EMPHASIS_IDS: ReadonlySet<string> = new Set(EMPHASIS.map(([k]) => k));

export const nameOf = (list: readonly Pair[], id: unknown): string => list.find(([k]) => k === id)?.[1] ?? '';

/** Шаг очереди щелчков: появление, выделение или исчезновение объекта k */
export type ActKind = 'in' | 'emph' | 'out';
export interface Act { k: number; kind: ActKind; key: number }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const RANK: Record<ActKind, number> = { in: 0, emph: 1, out: 2 };

/** Шаги объекта по щелчку (без порядка между объектами) */
export function actsOf(b: Block, k: number): Act[] {
  const out: Act[] = [];
  if (b.click === true) out.push({ k, kind: 'in', key: Number(b.delay) || 0 });
  const em = num(b.emphAt);
  if (em !== null && EMPHASIS_IDS.has(String(b.emphasis))) out.push({ k, kind: 'emph', key: em });
  if (EXIT_IDS.has(String(b.exit))) out.push({ k, kind: 'out', key: num(b.exitAt) ?? Number.MAX_SAFE_INTEGER });
  return out;
}

/** Очередь щелчков слайда: по месту, при равенстве — появление, выделение, исчезновение, потом по номеру объекта */
export function clickActs(free: Block[]): Act[] {
  return free.flatMap((b, k) => actsOf(b, k)).sort((a, b) => a.key - b.key || RANK[a.kind] - RANK[b.kind] || a.k - b.k);
}
