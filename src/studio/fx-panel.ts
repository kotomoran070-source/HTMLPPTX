/**
 * Эффекты в «Свойствах», как панель «Формат» в PowerPoint: эффект, выбранный на ленте («Надпись», «Фигура»,
 * «Рисунок»), появляется здесь карточкой со своими ручками. Лента — готовые варианты, панель — подкрутка:
 * тень (цвет, плотность, размытие, расстояние, направление), свечение (цвет, размер, яркость), контур (цвет,
 * толщина, штрих); у надписи ещё плашка, у рисунка — паспарту и растворение.
 * Пока тянут ползунок — вид меняется на слайде сразу, отпустили — запись одним шагом отмены.
 * У надписи размеры хранятся в em и растут вместе с текстом (показываются в пикселях при нынешнем размере),
 * у фигуры и рисунка — в пикселях слайда.
 */
import { icon } from '../components/icons';
import { BOX_GLOW, boxFxColor, boxGlowOf, boxShadowOf, SHADOW_TUNE } from '../engine/box-fx';
import { getBlock } from '../engine/component';
import { getAt, setAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import { fxColor, GLOW_SIZE, PLATE_PAD, PLATE_RADIUS, TEXT_SHADOWS, textShadowOf, type TextStyle } from '../engine/text-style';
import type { Block, Deck } from '../types';
import { applyImageLook, applyShapeLook, imageEl, shapeEl } from './look-apply';

export interface FxHost {
  deck(): Deck;
  editor(): Editor;
  stage(): HTMLElement;
}

type Rec = Record<string, unknown>;
type Kind = 'text' | 'shape' | 'image';

/** Ползунок: что пишет, в каких единицах показывает */
interface Knob {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** em — размер в пикселях текста, px — пиксели как есть, pct — доля 0–1 в процентах, per — проценты как есть, deg — градусы */
  unit: 'em' | 'px' | 'pct' | 'per' | 'deg';
  /** Значение, когда своего нет */
  def(st: Rec): number;
}

/** Карточка эффекта: что в ней и что убирает «×» (нет off — эффект не убирается, у линии) */
interface Card {
  id: string;
  icon: string;
  title: string;
  /** От какой готовой тени */
  sub?: string;
  /** Цвета: поле, варианты, выбранный; set — что пишет выбор (по умолчанию — само поле) */
  colors?: { key: string; list: [string, string][]; cur: unknown; set?(v: string): Rec };
  knobs: Knob[];
  /** Выбор из нескольких: штрих контура, сторона растворения; v — значение, cls — образец */
  seg?: { key: string; list: [v: string, cls: string, label: string][]; cur: string };
  check?: { key: string; label: string; title: string; on: boolean };
  off?(st: Rec): Rec;
}

const without = (st: Rec, keys: readonly string[]) => {
  const out = { ...st };
  for (const k of keys) delete out[k];
  return out;
};

// ---------- надпись: оформление в styles.text, размеры в em ----------

const T_SHADOW_KNOBS: Knob[] = [
  { key: 'shadowOpacity', label: 'Плотность', min: 5, max: 100, step: 1, unit: 'pct', def: (st) => textShadowOf(st)?.opacity ?? 0.4 },
  { key: 'shadowBlur', label: 'Размытие', min: 0, max: 60, step: 1, unit: 'em', def: (st) => textShadowOf(st)?.blur ?? 0 },
  { key: 'shadowDist', label: 'Расстояние', min: 0, max: 60, step: 1, unit: 'em', def: (st) => textShadowOf(st)?.dist ?? 0 },
  { key: 'shadowAngle', label: 'Направление', min: 0, max: 355, step: 5, unit: 'deg', def: (st) => textShadowOf(st)?.angle ?? 90 },
];
const T_GLOW_KNOBS: Knob[] = [
  { key: 'glowSize', label: 'Размер', min: 2, max: 80, step: 1, unit: 'em', def: () => GLOW_SIZE },
  { key: 'glowOpacity', label: 'Яркость', min: 10, max: 100, step: 1, unit: 'pct', def: () => 1 },
];
const T_OUTLINE_KNOBS: Knob[] = [{ key: 'outline', label: 'Толщина', min: 0.5, max: 12, step: 0.5, unit: 'px', def: (st) => (st.hollow ? 2 : 1) }];
const T_PLATE_KNOBS: Knob[] = [
  { key: 'plateRadius', label: 'Скругление', min: 0, max: 60, step: 1, unit: 'em', def: () => PLATE_RADIUS },
  { key: 'platePad', label: 'Поля', min: 0, max: 60, step: 1, unit: 'em', def: () => PLATE_PAD },
];

const T_SHADOW_COLORS: [string, string][] = [['#0F172A', 'Тёмная'], ['accent', 'Акцент'], ['accent2', 'Тёмный акцент'], ['text', 'Цвет текста'], ['#FFFFFF', 'Белая']];
const T_GLOW_COLORS: [string, string][] = [['accent', 'Акцент'], ['accent2', 'Тёмный акцент'], ['text', 'Цвет текста'], ['#FFFFFF', 'Белое'], ['#FDE047', 'Жёлтое'], ['#22D3EE', 'Голубое'], ['#F472B6', 'Розовое']];
const T_OUTLINE_COLORS: [string, string][] = [['accent', 'Акцент'], ['accent2', 'Тёмный акцент'], ['text', 'Цвет текста'], ['surface', 'Цвет фона'], ['#FFFFFF', 'Белый'], ['#111827', 'Чёрный']];
const T_PLATE_COLORS: [string, string][] = [['accent', 'Акцент'], ['soft', 'Светлый акцент'], ['surface', 'Цвет фона'], ['#111827', 'Тёмная'], ['#FDE047', 'Жёлтая'], ['#DC2626', 'Красная'], ['#FFFFFF', 'Белая']];

function textCards(st: TextStyle): Card[] {
  const out: Card[] = [];
  const sh = textShadowOf(st);
  if (sh) {
    out.push({
      id: 'shadow', icon: 'text-shadow', title: 'Тень', sub: TEXT_SHADOWS[st.shadow!]?.name, knobs: T_SHADOW_KNOBS,
      colors: { key: 'shadowColor', list: T_SHADOW_COLORS, cur: sh.color }, off: (x) => without(x, ['shadow', ...SHADOW_TUNE]),
    });
  }
  if (fxColor(st.glow)) out.push({ id: 'glow', icon: 'text-glow', title: 'Свечение', knobs: T_GLOW_KNOBS, colors: { key: 'glow', list: T_GLOW_COLORS, cur: st.glow }, off: (x) => without(x, ['glow', 'glowSize', 'glowOpacity']) });
  if (Number(st.outline) > 0 || st.hollow) {
    out.push({
      id: 'outline', icon: 'text-outline', title: 'Контур букв', knobs: T_OUTLINE_KNOBS,
      colors: { key: 'outlineColor', list: T_OUTLINE_COLORS, cur: st.outlineColor ?? (st.hollow ? st.color : undefined) ?? 'accent' },
      check: { key: 'hollow', label: 'Только контур', title: 'Буквы без заливки — виден только контур', on: !!st.hollow },
      off: (x) => without(x, ['outline', 'outlineColor', 'hollow']),
    });
  }
  const grad = typeof st.color === 'string' && st.color.startsWith('g:');
  if (fxColor(st.plate) && !grad) {
    out.push({
      id: 'plate', icon: 'plate', title: 'Плашка', knobs: T_PLATE_KNOBS, colors: { key: 'plate', list: T_PLATE_COLORS, cur: st.plate },
      off: (x) => {
        const o = without(x, ['plate', 'plateRadius', 'platePad']);
        // Белый текст на плашке без неё пропал бы на светлом слайде
        if (o.color === '#FFFFFF' || o.color === 'accent2') delete o.color;
        return o;
      },
    });
  }
  return out;
}

// ---------- фигура и рисунок: поля блока, размеры в пикселях слайда ----------

const B_SHADOW_KNOBS: Knob[] = [
  { key: 'shadowOpacity', label: 'Плотность', min: 5, max: 100, step: 1, unit: 'pct', def: (b) => boxShadowOf(b)?.opacity ?? 0.2 },
  { key: 'shadowBlur', label: 'Размытие', min: 0, max: 100, step: 1, unit: 'px', def: (b) => boxShadowOf(b)?.blur ?? 0 },
  { key: 'shadowDist', label: 'Расстояние', min: 0, max: 80, step: 1, unit: 'px', def: (b) => boxShadowOf(b)?.dist ?? 0 },
  { key: 'shadowAngle', label: 'Направление', min: 0, max: 355, step: 5, unit: 'deg', def: (b) => boxShadowOf(b)?.angle ?? 90 },
];
const B_GLOW_KNOBS: Knob[] = [
  { key: 'glowSize', label: 'Размер', min: 2, max: 60, step: 1, unit: 'px', def: () => BOX_GLOW.size },
  { key: 'glowOpacity', label: 'Яркость', min: 10, max: 100, step: 1, unit: 'pct', def: () => BOX_GLOW.opacity },
];
const widthKnob = (def: number): Knob => ({ key: 'width', label: 'Толщина', min: 1, max: 24, step: 1, unit: 'px', def: (b) => Number(b.width) || def });
const MAT_KNOBS: Knob[] = [{ key: 'mat', label: 'Ширина', min: 2, max: 80, step: 1, unit: 'px', def: (b) => Number(b.mat) || 12 }];
const FADE_KNOBS: Knob[] = [{ key: 'fadeSize', label: 'Растворяется', min: 10, max: 90, step: 1, unit: 'per', def: () => 50 }];

const B_SHADOW_COLORS: [string, string][] = [['#0F172A', 'Тёмная'], ['#000000', 'Чёрная'], ['accent', 'Акцент'], ['accent-dark', 'Тёмный акцент'], ['#FFFFFF', 'Белая']];
export const B_GLOW_COLORS: [string, string][] = [['accent', 'Акцент'], ['#FFFFFF', 'Белое'], ['#FDE047', 'Жёлтое'], ['#FB923C', 'Оранжевое'], ['#F472B6', 'Розовое'], ['#A78BFA', 'Сиреневое'], ['#22D3EE', 'Голубое'], ['#A3E635', 'Салатовое']];
/** Цвета контура — роли, которые понимает фигура (shapeColor), и постоянные */
const STROKE_COLORS: [string, string][] = [['accent', 'Акцент'], ['text', 'Цвет текста'], ['border', 'Серый'], ['#FFFFFF', 'Белый'], ['#DC2626', 'Красный'], ['#F59E0B', 'Жёлтый'], ['#16A34A', 'Зелёный']];
const MAT_COLORS: [string, string][] = [['surface', 'Цвет карточки'], ['#F5F0E6', 'Кремовое'], ['soft', 'Светлый акцент'], ['accent', 'Акцент'], ['#111827', 'Чёрное']];
const DASHES: [string, string, string][] = [['', 'd-solid', 'Сплошной'], ['dash', 'd-dash', 'Пунктир'], ['dot', 'd-dot', 'Точки']];
const FADES: [string, string, string][] = [['bottom', 'f-bottom', 'Снизу'], ['top', 'f-top', 'Сверху'], ['left', 'f-left', 'Слева'], ['right', 'f-right', 'Справа'], ['edges', 'f-edges', 'По краям']];

const isLine = (b: Rec) => b.kind === 'line' || b.kind === 'arrow';

function boxCards(b: Rec, kind: 'shape' | 'image'): Card[] {
  const out: Card[] = [];
  const line = kind === 'shape' && isLine(b);
  const sh = line ? null : boxShadowOf(b);
  if (sh) {
    out.push({
      id: 'shadow', icon: 'shadow', title: 'Тень', sub: sh.name, knobs: B_SHADOW_KNOBS,
      colors: { key: 'shadowColor', list: B_SHADOW_COLORS, cur: sh.color }, off: (x) => without(x, ['shadow', ...SHADOW_TUNE]),
    });
  }
  if (boxGlowOf(b)) out.push({ id: 'glow', icon: 'glow', title: 'Свечение', knobs: B_GLOW_KNOBS, colors: { key: 'glow', list: B_GLOW_COLORS, cur: b.glow }, off: (x) => without(x, ['glow', 'glowSize', 'glowOpacity']) });
  // Цвет контура — без градиента контура: он уходит, когда выбран цвет
  const stroke = (v: string): Rec => ({ stroke: v, strokeGradient: undefined });
  if (line) {
    out.push({
      id: 'line', icon: 'sh-line', title: kind === 'shape' && b.kind === 'arrow' ? 'Стрелка' : 'Линия', knobs: [widthKnob(3)],
      colors: { key: 'stroke', list: STROKE_COLORS, cur: b.stroke ?? b.fill, set: stroke }, seg: { key: 'dash', list: DASHES, cur: String(b.dash ?? '') },
    });
  } else if (Number(b.width) > 0) {
    out.push({
      id: 'outline', icon: 'outline', title: 'Контур', knobs: [widthKnob(2)],
      colors: { key: 'stroke', list: STROKE_COLORS, cur: b.stroke, set: stroke }, seg: { key: 'dash', list: DASHES, cur: String(b.dash ?? '') },
      off: (x) => without(x, ['width', 'dash', 'stroke', 'strokeGradient']),
    });
  }
  if (kind === 'image' && Number(b.mat) > 0) {
    out.push({
      id: 'mat', icon: 'mat', title: 'Паспарту', knobs: MAT_KNOBS,
      colors: { key: 'matColor', list: MAT_COLORS, cur: b.matColor ?? 'surface', set: (v) => ({ matColor: v === 'surface' ? undefined : v }) },
      off: (x) => without(x, ['mat', 'matColor']),
    });
  }
  if (kind === 'image' && typeof b.fade === 'string' && FADES.some(([v]) => v === b.fade)) {
    out.push({ id: 'fade', icon: 'opacity', title: 'Растворение', knobs: FADE_KNOBS, seg: { key: 'fade', list: FADES, cur: b.fade }, off: (x) => without(x, ['fade', 'fadeSize']) });
  }
  return out;
}

// ---------- общее ----------

const kindOf = (b: Block | undefined): Kind | null => {
  if (b?.type === 'text') return 'text';
  if (b?.type === 'shape') return 'shape';
  return b?.type === 'image' || (b?.type === 'tile' && !!b.image) ? 'image' : null;
};
/** Оформление: у надписи — styles.text, у фигуры и рисунка — поля самого блока */
const read = (b: Block, kind: Kind): Rec => (kind === 'text' ? { ...((b.styles as Record<string, TextStyle> | undefined)?.text ?? {}) } : { ...b });
const cardsOf = (b: Block, kind: Kind): Card[] => (kind === 'text' ? textCards(read(b, kind) as TextStyle) : boxCards(read(b, kind), kind));
const colorCss = (kind: Kind, v: string) => (kind === 'text' ? fxColor(v) : boxFxColor(v)) ?? v;

/** Каким станет блок с оформлением next */
function withLook(b: Block, kind: Kind, next: Rec): Block {
  if (kind !== 'text') return next as Block;
  const text = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false));
  const styles = { ...((b.styles as Rec) ?? {}) };
  if (Object.keys(text).length) styles.text = text;
  else delete styles.text;
  return { ...b, styles: Object.keys(styles).length ? styles : undefined };
}

/** Выделенные объекты одного вида — надписи, фигуры или рисунки; иначе пусто */
export function fxTargets(deck: Deck, ed: Editor): Path[] {
  const sel = ed.selection;
  if (!sel) return [];
  const paths = sel.group.length > 1 ? sel.group : [sel.block];
  const kinds = new Set(paths.map((p) => kindOf(getAt(deck, p) as Block | undefined)));
  return kinds.size === 1 && !kinds.has(null) ? paths : [];
}

const firstOf = (deck: Deck, paths: Path[]) => {
  const b = paths[0] ? (getAt(deck, paths[0]) as Block | undefined) : undefined;
  const kind = kindOf(b);
  return b && kind ? { b, kind } : null;
};

/** Набор карточек: вид панели меняется, когда он другой */
export function fxSig(deck: Deck, paths: Path[]): string {
  const f = firstOf(deck, paths);
  return f ? `${f.kind}:${cardsOf(f.b, f.kind).map((c) => `${c.id}${c.sub ?? ''}`).join(',')}` : '';
}

const TITLES: Record<Kind, [string, string]> = {
  text: ['Эффекты текста', 'Другие эффекты и готовые варианты — «Надпись» → «Эффекты»'],
  shape: ['Эффекты фигуры', 'Другие эффекты и готовые варианты — на вкладке «Фигура»'],
  image: ['Эффекты рисунка', 'Другие эффекты и готовые варианты — на вкладке «Рисунок»'],
};

function cardHtml(c: Card, kind: Kind): string {
  const name = esc(c.title.toLowerCase());
  const head = `<header>${icon(c.icon)}<b>${esc(c.title)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}`
    + (c.off ? `<button type="button" class="st-fx-off" data-fxoff="${c.id}" title="Убрать: ${name}" aria-label="Убрать: ${name}">${icon('close')}</button>` : '') + '</header>';
  const colors = c.colors ? `<div class="st-fx-sw" role="group" aria-label="Цвет">${c.colors.list.map(([v, n]) =>
    `<button type="button" data-fxc="${c.colors!.key}" data-v="${esc(v)}" style="--c:${colorCss(kind, v)}" title="${esc(n)}" aria-label="${esc(n)}"></button>`).join('')}`
    + `<label class="st-fx-own" title="Свой цвет"><input type="color" data-fxown="${c.colors.key}" aria-label="Свой цвет"></label></div>` : '';
  const seg = c.seg ? `<div class="st-pseg st-fx-seg" role="group">${c.seg.list.map(([v, cls, l]) =>
    `<button type="button" data-fxseg="${c.seg!.key}" data-v="${esc(v)}" title="${esc(l)}" aria-label="${esc(l)}"><i class="${cls}"></i></button>`).join('')}</div>` : '';
  const knobs = `<div class="st-tune st-fx-tune">${c.knobs.map((k) =>
    `<label><span>${esc(k.label)}</span><input type="range" data-fx="${k.key}" min="${k.min}" max="${k.max}" step="${k.step}" aria-label="${esc(k.label)}"><output></output></label>`).join('')}</div>`;
  const check = c.check ? `<label class="st-p-check st-fx-chk" title="${esc(c.check.title)}"><input type="checkbox" data-fxchk="${c.check.key}"><span>${esc(c.check.label)}</span></label>` : '';
  return `<div class="st-fx-card" data-fxk="${c.id}">${head}${colors}${seg}${knobs}${check}</div>`;
}

/** Раздел эффектов: карточки эффектов, которые есть; нет ни одного — нет раздела */
export function fxHtml(deck: Deck, paths: Path[]): string {
  const f = firstOf(deck, paths);
  if (!f) return '';
  const cards = cardsOf(f.b, f.kind);
  if (!cards.length) return '';
  const [title, note] = TITLES[f.kind];
  return `<section class="st-p-sec st-fx"><h3>${title}</h3>${cards.map((c) => cardHtml(c, f.kind)).join('')}<p class="st-p-note">${note}</p></section>`;
}

/** Размер текста первой надписи на слайде, px: им пересчитываются em в пиксели */
function sizeOf(host: FxHost, paths: Path[]): number {
  const el = paths[0] ? host.stage().querySelector<HTMLElement>(`.slide.on [data-block='${JSON.stringify(paths[0])}']`) : null;
  return (el && parseFloat(getComputedStyle(el).fontSize)) || 32;
}

/** Значение ползунка из оформления и обратно */
const toSlider = (k: Knob, v: number, size: number) => (k.unit === 'em' ? v * size : k.unit === 'pct' ? v * 100 : k.unit === 'deg' ? ((v % 360) + 360) % 360 : v);
const fromSlider = (k: Knob, v: number, size: number) => (k.unit === 'em' ? Math.round((v / size) * 1000) / 1000 : k.unit === 'pct' ? v / 100 : v);
// Размеры — целыми пикселями (доли пикселя тут ничего не дают), толщина контура букв — с половинками
const shown = (k: Knob, v: number) => (k.unit === 'pct' || k.unit === 'per' ? `${Math.round(v)} %` : k.unit === 'deg' ? `${Math.round(v)}°`
  : k.unit === 'em' || k.step >= 1 ? `${Math.round(v)} px` : `${String(Math.round(v * 10) / 10).replace('.', ',')} px`);
const HEX6 = /^#[0-9a-f]{6}$/i;

/** Значения ручек и выбранные цвета — по оформлению первого объекта (ползунок в руках не трогается) */
export function fillFx(root: HTMLElement, host: FxHost, paths: Path[]): void {
  const f = firstOf(host.deck(), paths);
  if (!f || !root.querySelector('.st-fx')) return;
  const st = read(f.b, f.kind);
  const cards = cardsOf(f.b, f.kind);
  const knobs = cards.flatMap((c) => c.knobs);
  const size = f.kind === 'text' ? sizeOf(host, paths) : 1;
  root.querySelectorAll<HTMLInputElement>('input[data-fx]').forEach((inp) => {
    if (inp === document.activeElement && inp.dataset.dragging) return;
    const k = knobs.find((x) => x.key === inp.dataset.fx);
    if (!k) return;
    const own = Number(st[k.key]);
    const v = toSlider(k, st[k.key] !== undefined && Number.isFinite(own) ? own : k.def(st), size);
    inp.value = String(v);
    inp.nextElementSibling!.textContent = shown(k, v);
  });
  for (const c of cards) {
    const card = root.querySelector(`.st-fx-card[data-fxk="${c.id}"]`);
    if (!card) continue;
    if (c.colors) {
      card.querySelectorAll<HTMLElement>('[data-fxc]').forEach((b) => b.setAttribute('aria-pressed', String(c.colors!.cur === b.dataset.v)));
      const own = card.querySelector<HTMLInputElement>('[data-fxown]');
      if (own && typeof c.colors.cur === 'string' && HEX6.test(c.colors.cur)) own.value = c.colors.cur.toLowerCase();
    }
    if (c.seg) card.querySelectorAll<HTMLElement>('[data-fxseg]').forEach((b) => b.classList.toggle('on', b.dataset.v === c.seg!.cur));
    const chk = c.check ? card.querySelector<HTMLInputElement>(`[data-fxchk="${c.check.key}"]`) : null;
    if (chk) chk.checked = c.check!.on;
  }
}

/** Ручки панели: живой вид на слайде, пока тянут, запись — когда отпустили */
export function bindFx(root: HTMLElement, host: FxHost): void {
  const paths = () => fxTargets(host.deck(), host.editor());
  const kind = () => firstOf(host.deck(), paths())?.kind ?? null;
  const cards = () => { const f = firstOf(host.deck(), paths()); return f ? cardsOf(f.b, f.kind) : []; };
  const write = (fn: (st: Rec) => Rec, merge?: string) => {
    const ps = paths();
    const k = kind();
    if (!ps.length || !k) return;
    host.editor().commit((d) => ps.forEach((p) => {
      const b = getAt(d, p) as Block;
      const next = fn(read(b, k));
      if (k === 'text') {
        setAt(d, [...p, 'styles'], withLook(b, k, next).styles);
        return;
      }
      for (const key of new Set([...Object.keys(b), ...Object.keys(next)])) {
        if (next[key] === undefined) delete b[key];
        else if (b[key] !== next[key]) b[key] = next[key];
      }
    }), { rebuild: true, ...(merge ? { merge } : {}) });
  };
  /** Как выглядит объект с этим оформлением — прямо на слайде, без записи */
  const preview = (fn: (st: Rec) => Rec) => {
    const k = kind();
    if (!k) return;
    for (const p of paths()) {
      const b = getAt(host.deck(), p) as Block;
      const blk = withLook(b, k, fn(read(b, k)));
      for (const root of host.stage().querySelectorAll<HTMLElement>(`.slide.on [data-block='${JSON.stringify(p)}']`)) {
        if (k === 'shape') {
          const el = shapeEl(root);
          if (el) applyShapeLook(el, blk);
        } else if (k === 'image') {
          const bx = imageEl(root);
          if (bx) applyImageLook(bx, blk);
        } else {
          const t = document.createElement('div');
          t.innerHTML = getBlock('text')?.render(blk, {} as never) ?? '';
          const css = t.firstElementChild?.getAttribute('style') ?? null;
          if (css === null) root.removeAttribute('style');
          else root.setAttribute('style', css);
        }
      }
    }
  };
  const knobOf = (inp: HTMLInputElement) => cards().flatMap((c) => c.knobs).find((x) => x.key === inp.dataset.fx);
  const sizeNow = () => (kind() === 'text' ? sizeOf(host, paths()) : 1);
  const colorPatch = (key: string, v: string): Rec => cards().find((c) => c.colors?.key === key)?.colors?.set?.(v) ?? { [key]: v };
  root.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    const k = inp.dataset?.fx ? knobOf(inp) : undefined;
    if (k) {
      inp.dataset.dragging = '1';
      const v = Number(inp.value);
      inp.nextElementSibling!.textContent = shown(k, v);
      preview((st) => ({ ...st, [k.key]: fromSlider(k, v, sizeNow()) }));
      return;
    }
    const own = inp.dataset?.fxown;
    if (own) preview((st) => ({ ...st, ...colorPatch(own, inp.value.toUpperCase()) }));
  });
  root.addEventListener('change', (e) => {
    const inp = e.target as HTMLInputElement;
    const k = inp.dataset?.fx ? knobOf(inp) : undefined;
    if (k) {
      delete inp.dataset.dragging;
      const v = fromSlider(k, Number(inp.value), sizeNow());
      write((st) => ({ ...st, [k.key]: v }), `fx-${k.key}`);
      return;
    }
    const own = inp.dataset?.fxown;
    if (own) return write((st) => ({ ...st, ...colorPatch(own, inp.value.toUpperCase()) }));
    if (inp.dataset?.fxchk === 'hollow') write((st) => ({ ...st, hollow: inp.checked || undefined, outline: Number(st.outline) || 2 }));
  });
  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    const sw = t.closest<HTMLElement>('[data-fxc]');
    if (sw) return write((st) => ({ ...st, ...colorPatch(sw.dataset.fxc!, sw.dataset.v!) }));
    const seg = t.closest<HTMLElement>('[data-fxseg]');
    if (seg) return write((st) => ({ ...st, [seg.dataset.fxseg!]: seg.dataset.v || undefined }));
    const off = t.closest<HTMLElement>('[data-fxoff]')?.dataset.fxoff;
    const card = off ? cards().find((c) => c.id === off) : undefined;
    if (card?.off) write((st) => card.off!(st));
  });
  // Наведение на цвет или вариант — примерка на слайде; ушли — как было
  const hovered = (t: EventTarget | null) => (t as Element | null)?.closest?.<HTMLElement>('[data-fxc], [data-fxseg]') ?? null;
  root.addEventListener('pointerover', (e) => {
    const b = hovered(e.target);
    if (!b || !paths().length) return;
    if (b.dataset.fxc) preview((st) => ({ ...st, ...colorPatch(b.dataset.fxc!, b.dataset.v!) }));
    else preview((st) => ({ ...st, [b.dataset.fxseg!]: b.dataset.v || undefined }));
  });
  root.addEventListener('pointerout', (e) => {
    if (hovered(e.target) && !hovered(e.relatedTarget)) preview((st) => st);
  });
}
