/**
 * Готовые стили текста и эффекты букв (тень, свечение, контур, плашка): варианты для вкладок «Надпись»
 * и «Фигура» и для кнопки «Эффекты текста» на «Главной» — одни и те же
 */
import { SHADOW_TUNE } from './box-fx';
import { TEXT_SHADOWS, type TextStyle } from './text-style';

export interface TextLook {
  id: string;
  name: string;
  props: TextStyle;
}

/**
 * Что задаёт стиль текста: цвет, начертание и эффекты. Шрифт, размер, выравнивание, интервалы
 * и прозрачность остаются свои — стиль меняет вид, а не вёрстку
 */
export const LOOK_KEYS = ['color', 'weight', 'upper', 'spacing', 'shadow', 'glow', 'outline', 'outlineColor', 'hollow', 'plate'] as const;
/** Ручки эффектов из «Свойств»: стиль начинает с чистого эффекта */
export const TUNE_KEYS = ['shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowDist', 'shadowAngle', 'glowSize', 'glowOpacity', 'plateRadius', 'platePad'] as const;

/** Готовые стили: в цветах темы — меняются вместе с ней, светлой и тёмной */
export const TEXT_LOOKS: TextLook[] = [
  { id: 'plain', name: 'Обычный', props: {} },
  { id: 'accent', name: 'Акцент', props: { color: 'accent', weight: 700 } },
  { id: 'gradient', name: 'Градиент', props: { color: 'g:accent', weight: 800 } },
  { id: 'soft', name: 'Мягкая тень', props: { weight: 700, shadow: 'soft' } },
  { id: 'neon', name: 'Неон', props: { color: 'accent', weight: 700, glow: 'accent' } },
  { id: 'outline', name: 'Контурный', props: { weight: 800, hollow: true, outline: 3, outlineColor: 'accent' } },
  { id: 'extrude', name: 'Объёмный', props: { color: 'accent', weight: 800, shadow: 'extrude' } },
  { id: 'plate', name: 'Плашка', props: { color: '#FFFFFF', weight: 700, plate: 'accent' } },
  { id: 'eyebrow', name: 'Надзаголовок', props: { color: 'accent', weight: 700, upper: true, spacing: 0.14 } },
  { id: 'lift', name: 'Парящий', props: { weight: 800, shadow: 'lift' } },
  { id: 'retro', name: 'Ретро', props: { weight: 800, shadow: 'retro' } },
  { id: 'sticker', name: 'Наклейка', props: { color: 'accent', weight: 800, outline: 4, outlineColor: 'surface', shadow: 'soft' } },
  { id: 'marker', name: 'Подложка', props: { color: 'accent2', weight: 600, plate: 'soft' } },
];

/** На ленте — восемь ходовых, все — по стрелке */
export const PINNED_LOOKS = ['plain', 'accent', 'gradient', 'soft', 'neon', 'outline', 'extrude', 'plate'];

/** Разделы окна «Все стили текста» */
export const LOOK_GROUPS: [string, string[]][] = [
  ['Цвет и начертание', ['plain', 'accent', 'gradient', 'eyebrow', 'marker']],
  ['Эффекты', ['soft', 'lift', 'extrude', 'retro', 'neon', 'outline', 'sticker', 'plate']],
];

/** Оформление с ключами стиля — только стиля look, остальное как было */
export function applyLook(st: TextStyle, look: TextLook): TextStyle {
  const out: TextStyle = { ...st };
  for (const k of [...LOOK_KEYS, ...TUNE_KEYS]) delete out[k];
  return { ...out, ...look.props };
}

/** Стиль совпадает с оформлением текста: эффекты, подкрученные в «Свойствах», — уже не этот стиль */
export function lookOn(st: TextStyle, look: TextLook): boolean {
  return LOOK_KEYS.every((k) => (st[k] ?? undefined) === (look.props[k] ?? undefined)) && TUNE_KEYS.every((k) => st[k] === undefined);
}

// ---------------- эффекты букв: варианты для ленты и для «Главной» ----------------

/** Вариант эффекта: подпись, новое оформление по прежнему, выбран ли сейчас */
export type FxOption = [label: string, edit: (st: TextStyle) => TextStyle, on: boolean];
export interface FxSection { title?: string; cls?: string; options: FxOption[] }
export type FxKind = 'shadow' | 'glow' | 'outline' | 'plate';
export const FX_NAMES: Record<FxKind, string> = { shadow: 'Тень', glow: 'Свечение', outline: 'Контур', plate: 'Плашка' };

/** Цвета эффектов: цвета темы, светлый акцент, фон карточек и постоянные */
export const FX_SWATCH: [string, string][] = [['accent', 'Акцент'], ['accent2', 'Тёмный акцент'], ['text', 'Цвет текста'], ['soft', 'Светлый акцент'], ['surface', 'Цвет фона'], ['#FFFFFF', 'Белый'], ['#111827', 'Чёрный'], ['#FDE047', 'Жёлтый'], ['#22D3EE', 'Голубой'], ['#F472B6', 'Розовый']];

const set = (patch: TextStyle) => (st: TextStyle): TextStyle => ({ ...st, ...patch });
const tuned = (st: TextStyle) => SHADOW_TUNE.some((k) => (st as Record<string, unknown>)[k] !== undefined);

/** Варианты эффекта букв для оформления st (отмечен выбранный) */
export function fxSections(kind: FxKind, st: TextStyle): FxSection[] {
  if (kind === 'shadow') {
    const cur = st.shadow;
    // Готовая тень — с чистого листа: свои ручки («Свойства») сбрасываются
    const fresh = Object.fromEntries(SHADOW_TUNE.map((k) => [k, undefined]));
    return [{ options: [['Без тени', set({ shadow: undefined, ...fresh }), !cur], ...Object.entries(TEXT_SHADOWS).map(([k, v]): FxOption => [v.name, set({ shadow: k, ...fresh }), cur === k && !tuned(st)])] }];
  }
  if (kind === 'glow') {
    const cur = st.glow;
    return [{ cls: 'f', options: [['Без свечения', set({ glow: undefined, glowSize: undefined, glowOpacity: undefined }), !cur], ...FX_SWATCH.filter(([v]) => v !== 'soft' && v !== 'surface').map(([v, l]): FxOption => [l, set({ glow: v }), cur === v])] }];
  }
  if (kind === 'outline') {
    const w = Number(st.outline) || 0;
    // Контур появляется вместе с цветом или видом: без толщины его не видно
    const withW = (patch: TextStyle) => (x: TextStyle): TextStyle => ({ ...x, ...patch, outline: Number(x.outline) || 2 });
    return [
      { title: 'Толщина', cls: 'f', options: [['Без контура', set({ outline: undefined, outlineColor: undefined, hollow: undefined }), !w && !st.hollow], ...[1, 2, 3, 5].map((n): FxOption => [`${n} px`, (x) => ({ ...x, outline: n }), w === n])] },
      { title: 'Цвет', cls: 'f', options: FX_SWATCH.filter(([v]) => v !== 'soft').map(([v, l]): FxOption => [l, withW({ outlineColor: v }), !!w && (st.outlineColor ?? 'accent') === v]) },
      { title: 'Буквы', cls: 't3', options: [['С заливкой', (x) => ({ ...x, hollow: undefined }), !st.hollow], ['Только контур', withW({ hollow: true }), !!st.hollow]] },
    ];
  }
  const cur = st.plate;
  // Плашка подбирает цвет текста, а без плашки подобранный цвет уходит — текст не пропадает на фоне
  const auto = new Set(['#FFFFFF', '#111827', 'accent2']);
  const plate = (v: string | undefined, color?: string) => (x: TextStyle): TextStyle => ({ ...x, plate: v, color: color ?? (auto.has(String(x.color)) ? undefined : x.color), hollow: undefined, ...(v ? {} : { plateRadius: undefined, platePad: undefined }) });
  return [{ options: [
    ['Без плашки', plate(undefined), !cur],
    ['Акцент', plate('accent', '#FFFFFF'), cur === 'accent'],
    ['Светлая', plate('soft', 'accent2'), cur === 'soft'],
    ['Цвет фона', plate('surface'), cur === 'surface'],
    ['Тёмная', plate('#111827', '#FFFFFF'), cur === '#111827'],
    ['Жёлтая', plate('#FDE047', '#111827'), cur === '#FDE047'],
    ['Красная', plate('#DC2626', '#FFFFFF'), cur === '#DC2626'],
    ['Белая', plate('#FFFFFF', '#111827'), cur === '#FFFFFF'],
  ] }];
}
