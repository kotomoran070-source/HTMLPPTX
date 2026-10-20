/**
 * Анимация объектов: появление, выделение, исчезновение — названия и порядок щелчков. Один список
 * для показа (render, base.css), ленты «Анимация» и панели свойств. Без DOM: годится и серверу.
 *
 * У объекта (slide.free[]):
 *   enter: rise, delay: 300 — появление; click: true — по щелчку (delay — место в очереди щелчков);
 *   emphasis: pulse — выделение; с emphAt: 900 — шагом по щелчку (иначе только кнопкой «Проиграть»);
 *   exit: fade, exitAt: 1200 — исчезновение по щелчку (exitAt — место в очереди; нет — в конце).
 * Места в очереди — числа одной шкалы (как delay у появлений по щелчку): кто меньше — тот раньше.
 * clickWith, emphWith, exitWith: true — шаг идёт на том же щелчке, что предыдущий («вместе с предыдущим»).
 * byItem: true — список (или пункты «- » в тексте) появляется по пункту: с щелчком — по пункту на щелчок,
 * без щелчка — пункты один за другим. tempo: fast, slow, slower — длительность всех эффектов объекта.
 */
import type { Block } from '../types';

export type Pair = readonly [id: string, name: string];

/** Появления: простые, раскрытия (обрезкой и маской), текст по частям, прорисовка контура */
export const ENTER: readonly Pair[] = [
  ['appear', 'Возникновение'], ['fade', 'Проявление'], ['rise', 'Всплытие снизу'], ['drop', 'Появление сверху'], ['left', 'Выезд слева'],
  ['right', 'Выезд справа'], ['scale', 'Увеличение'], ['pop', 'Пружина'], ['swivel', 'Вращение'], ['growturn', 'Увеличение с поворотом'],
  ['blur', 'Из фокуса'], ['ripple', 'Из ряби'], ['wipe', 'Шторка'], ['split', 'Панорама'], ['circle', 'Круг'], ['diamond', 'Ромб'], ['wheel', 'Часовая стрелка'],
  ['mask', 'Проявление маской'], ['words', 'По словам'], ['letters', 'По буквам'], ['draw', 'Прорисовка'],
];
export const ENTER_IDS: ReadonlySet<string> = new Set(ENTER.map(([k]) => k));
/** Только у текста (надпись, текст фигуры) */
export const TEXT_ENTER: ReadonlySet<string> = new Set(['words', 'letters']);

/** Исчезновения — всегда по щелчку; короче появления и с ускорением к концу */
export const EXIT: readonly Pair[] = [
  ['vanish', 'Исчезновение'], ['fade', 'Растворение'], ['sink', 'Уход вниз'], ['up', 'Уход вверх'], ['left', 'Уход влево'], ['right', 'Уход вправо'],
  ['shrink', 'Сжатие'], ['swivel', 'Вращение'], ['wipe', 'Шторка'], ['split', 'Панорама'], ['wheel', 'Часовая стрелка'],
];
export const EXIT_IDS: ReadonlySet<string> = new Set(EXIT.map(([k]) => k));

/**
 * Выделения: по щелчку или кнопкой «Проиграть». «Маркер» проводит выделение маркером в тексте ({mark|…}).
 * Стойкие (PERSIST) остаются после своего шага: объект приглушён, увеличен или перекрашен, пока не вернулись назад
 */
export const EMPHASIS: readonly Pair[] = [
  ['pulse', 'Пульс'], ['shake', 'Покачивание'], ['spin', 'Вращение'], ['bounce', 'Прыжок'], ['flash', 'Вспышка'], ['glow', 'Свечение'], ['mark', 'Маркер'],
  ['dim', 'Приглушить'], ['grow', 'Увеличить'], ['recolor', 'Перекрасить'],
];
export const PERSIST: ReadonlySet<string> = new Set(['dim', 'grow', 'recolor']);
export const EMPHASIS_IDS: ReadonlySet<string> = new Set(EMPHASIS.map(([k]) => k));

export const nameOf = (list: readonly Pair[], id: unknown): string => list.find(([k]) => k === id)?.[1] ?? '';

/** Длительность эффектов объекта: tempo → множитель */
export const TEMPO: readonly (readonly [string, string, number])[] = [['fast', 'Быстрее', 0.6], ['', 'Обычно', 1], ['slow', 'Медленнее', 1.6], ['slower', 'Очень медленно', 2.4]];
export const tempoOf = (b: Block): number => TEMPO.find(([k]) => k && k === b.tempo)?.[2] ?? 1;

/** Сколько пунктов у объекта для появления по пунктам: строки списка или пункты «- » в тексте */
export function partsOf(b: Block): number {
  if (b.type === 'list') return Array.isArray(b.items) ? b.items.length : 0;
  return typeof b.text === 'string' ? b.text.split('\n').filter((l) => /^[-•]\s+/.test(l)).length : 0;
}
/** Появление по пунктам действует: галочка и хотя бы два пункта */
export const byItems = (b: Block): boolean => b.byItem === true && partsOf(b) > 1;

/**
 * Шаг очереди щелчков: появление, следующий пункт, выделение или исчезновение объекта k.
 * key — место в очереди, together — на том же щелчке, что предыдущий шаг; step — номер щелчка (с нуля)
 */
export type ActKind = 'in' | 'item' | 'emph' | 'out';
export interface Act { k: number; kind: ActKind; key: number; together: boolean; step: number }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const RANK: Record<ActKind, number> = { in: 0, item: 0, emph: 1, out: 2 };

/** Шаги объекта по щелчку (без порядка между объектами и без пунктов) */
export function actsOf(b: Block, k: number): Act[] {
  const out: Act[] = [];
  if (b.click === true) out.push({ k, kind: 'in', key: Number(b.delay) || 0, together: b.clickWith === true, step: 0 });
  const em = num(b.emphAt);
  if (em !== null && EMPHASIS_IDS.has(String(b.emphasis))) out.push({ k, kind: 'emph', key: em, together: b.emphWith === true, step: 0 });
  if (EXIT_IDS.has(String(b.exit))) out.push({ k, kind: 'out', key: num(b.exitAt) ?? Number.MAX_SAFE_INTEGER, together: b.exitWith === true, step: 0 });
  return out;
}

/** Появления при открытии слайда по порядку (по задержке, при равной — по номеру объекта); animated — у объекта есть эффект */
export function timedOrder(free: Block[], animated: (b: Block) => boolean): number[] {
  return free.map((b, k) => ({ b, k })).filter(({ b }) => b.click !== true && animated(b))
    .sort((x, y) => (Number(x.b.delay) || 0) - (Number(y.b.delay) || 0) || x.k - y.k).map(({ k }) => k);
}

/**
 * Очередь щелчков слайда: по месту, при равенстве — появление, выделение, исчезновение, потом по номеру объекта.
 * За появлением по пунктам — остальные пункты, по щелчку на каждый. Номер щелчка: «вместе с предыдущим» —
 * тот же, что у предыдущего шага, иначе следующий
 */
export function clickActs(free: Block[]): Act[] {
  const sorted = free.flatMap((b, k) => actsOf(b, k)).sort((a, b) => a.key - b.key || RANK[a.kind] - RANK[b.kind] || a.k - b.k);
  const out: Act[] = [];
  for (const a of sorted) {
    out.push(a);
    if (a.kind === 'in' && byItems(free[a.k])) {
      for (let i = 1; i < partsOf(free[a.k]); i++) out.push({ k: a.k, kind: 'item', key: a.key, together: false, step: 0 });
    }
  }
  out.forEach((a, n) => { a.step = n === 0 ? 0 : a.together ? out[n - 1].step : out[n - 1].step + 1; });
  return out;
}
