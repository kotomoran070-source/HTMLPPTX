/**
 * Виды фигур со стандартной геометрией PowerPoint и их контуры — без стилей (нужны и панелям студии, и тестам).
 * Отрисовка — в shape.ts
 */
import { customPaths, parsePresets, type GeomPath } from '../../engine/geom';
import PRESET_XML from './presets';

/**
 * Фигуры со стандартной геометрией PowerPoint: вид в deck.yaml → фигура PowerPoint (prst), название (short — в
 * плитках галерей) и размер при вставке. Контур считается по определению ECMA-376 под размер фигуры (как в
 * PowerPoint), в PPTX уходит той же фигурой. Новая — сюда и в scripts/shape-presets.mjs
 */
export const PRESET_KINDS: Record<string, { prst: string; name: string; size: [number, number]; short?: string }> = {
  diamond: { prst: 'diamond', name: 'Ромб', size: [200, 200] },
  triangle: { prst: 'triangle', name: 'Треугольник', size: [220, 190] },
  'right-triangle': { prst: 'rtTriangle', name: 'Прямоугольный треугольник', short: 'Треугольник 90°', size: [200, 180] },
  parallelogram: { prst: 'parallelogram', name: 'Параллелограмм', size: [280, 160] },
  trapezoid: { prst: 'trapezoid', name: 'Трапеция', size: [260, 170] },
  pentagon: { prst: 'pentagon', name: 'Пятиугольник', size: [200, 190] },
  hexagon: { prst: 'hexagon', name: 'Шестиугольник', size: [220, 190] },
  octagon: { prst: 'octagon', name: 'Восьмиугольник', size: [200, 200] },
  star: { prst: 'star5', name: 'Звезда', size: [200, 190] },
  plus: { prst: 'plus', name: 'Плюс', size: [180, 180] },
  heart: { prst: 'heart', name: 'Сердце', size: [200, 180] },
  lightning: { prst: 'lightningBolt', name: 'Молния', size: [160, 200] },
  donut: { prst: 'donut', name: 'Кольцо', size: [200, 200] },
  cloud: { prst: 'cloud', name: 'Облако', size: [280, 180] },
  'block-arrow': { prst: 'rightArrow', name: 'Стрелка-блок', size: [260, 130] },
  'double-arrow': { prst: 'leftRightArrow', name: 'Двойная стрелка', size: [300, 120] },
  chevron: { prst: 'chevron', name: 'Шеврон', size: [200, 140] },
  pointer: { prst: 'homePlate', name: 'Указатель', size: [260, 130] },
  callout: { prst: 'wedgeRoundRectCallout', name: 'Выноска', size: [300, 180] },
  cylinder: { prst: 'can', name: 'Цилиндр', size: [200, 220] },
  brace: { prst: 'rightBrace', name: 'Фигурная скобка', size: [60, 240] },
};

let presetDefs: Map<string, Element> | null = null;
const geomCache = new Map<string, GeomPath[]>();
/** Контуры фигуры из PRESET_KINDS в пикселях w × h */
export function presetGeometry(kind: string, w: number, h: number): GeomPath[] {
  const prst = PRESET_KINDS[kind]?.prst;
  if (!prst) return [];
  const key = `${prst} ${w} ${h}`;
  let out = geomCache.get(key);
  if (!out) {
    presetDefs ??= parsePresets(PRESET_XML);
    const def = presetDefs.get(prst);
    out = def ? customPaths(def, w, h) : [];
    if (geomCache.size > 500) geomCache.clear();
    geomCache.set(key, out);
  }
  return out;
}


/** Границы контуров вместе с рамкой фигуры: точки и опорные точки кривых (кривая внутри них), у дуг — концы */
export function boundsOf(paths: GeomPath[], w: number, h: number): [number, number, number, number] {
  let [x0, y0, x1, y1] = [0, 0, w, h];
  for (const g of paths) {
    for (const [, cmd, args] of g.d.matchAll(/([MLCQAZ])([^MLCQAZ]*)/g)) {
      const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
      const pts = cmd === 'A' ? n.slice(-2) : n;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
        y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
      }
    }
  }
  return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)];
}

/**
 * Значок фигуры для галерей: контуры в поле 48 × 32 (как у остальных значков вставки), пропорции — фигуры по
 * умолчанию; толщину линий задаёт галерея
 */
export function presetGlyph(kind: string): string {
  const [w, h] = PRESET_KINDS[kind]?.size ?? [100, 100];
  const paths = presetGeometry(kind, w, h);
  const [x0, y0, x1, y1] = boundsOf(paths, w, h);
  const k = Math.min(38 / (x1 - x0), 24 / (y1 - y0));
  const at = (n: number) => Math.round(n * 100) / 100;
  return `<g transform="translate(${at(24 - ((x0 + x1) / 2) * k)} ${at(16 - ((y0 + y1) / 2) * k)}) scale(${at(k * 1000) / 1000})">`
    + paths.map((g) => `<path d="${g.d}" vector-effect="non-scaling-stroke"${!g.fill ? ' class="ln"' : !g.stroke ? ' stroke="none"' : ''}/>`).join('') + '</g>';
}
