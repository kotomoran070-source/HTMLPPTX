/**
 * «Эффекты текста» в «Свойствах»: эффект, выбранный на ленте («Надпись» → «Эффекты»), появляется здесь
 * со своими ручками, как в панели «Формат» PowerPoint. Лента — готовые варианты, панель — подкрутка:
 * тень (цвет, плотность, размытие, расстояние, направление), свечение (цвет, размер, яркость),
 * контур букв (цвет, толщина, только контур), плашка (цвет, скругление, поля).
 * Пока тянут ползунок — вид меняется на слайде сразу, отпустили — запись одним шагом отмены.
 * Размеры показываются в пикселях при нынешнем размере текста, хранятся в em — растут вместе с текстом.
 */
import { icon } from '../components/icons';
import { getBlock } from '../engine/component';
import { getAt, setAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import { fxColor, GLOW_SIZE, PLATE_PAD, PLATE_RADIUS, TEXT_SHADOWS, textShadowOf, type TextStyle } from '../engine/text-style';
import type { Block, Deck } from '../types';

export interface FxHost {
  deck(): Deck;
  editor(): Editor;
  stage(): HTMLElement;
}

type Key = keyof TextStyle;

/** Ползунок: что пишет, в каких единицах показывает */
interface Knob {
  key: Key;
  label: string;
  min: number;
  max: number;
  step: number;
  /** em — размер в пикселях текста, pct — доля 0–1 в процентах, deg — градусы, px — пиксели как есть */
  unit: 'em' | 'pct' | 'deg' | 'px';
  /** Значение, когда своего нет */
  def(st: TextStyle): number;
}

const SHADOW_KNOBS: Knob[] = [
  { key: 'shadowOpacity', label: 'Плотность', min: 5, max: 100, step: 1, unit: 'pct', def: (st) => textShadowOf(st)?.opacity ?? 0.4 },
  { key: 'shadowBlur', label: 'Размытие', min: 0, max: 60, step: 1, unit: 'em', def: (st) => textShadowOf(st)?.blur ?? 0 },
  { key: 'shadowDist', label: 'Расстояние', min: 0, max: 60, step: 1, unit: 'em', def: (st) => textShadowOf(st)?.dist ?? 0 },
  { key: 'shadowAngle', label: 'Направление', min: 0, max: 355, step: 5, unit: 'deg', def: (st) => textShadowOf(st)?.angle ?? 90 },
];
const GLOW_KNOBS: Knob[] = [
  { key: 'glowSize', label: 'Размер', min: 2, max: 80, step: 1, unit: 'em', def: () => GLOW_SIZE },
  { key: 'glowOpacity', label: 'Яркость', min: 10, max: 100, step: 1, unit: 'pct', def: () => 1 },
];
const OUTLINE_KNOBS: Knob[] = [
  { key: 'outline', label: 'Толщина', min: 0.5, max: 12, step: 0.5, unit: 'px', def: (st) => (st.hollow ? 2 : 1) },
];
const PLATE_KNOBS: Knob[] = [
  { key: 'plateRadius', label: 'Скругление', min: 0, max: 60, step: 1, unit: 'em', def: () => PLATE_RADIUS },
  { key: 'platePad', label: 'Поля', min: 0, max: 60, step: 1, unit: 'em', def: () => PLATE_PAD },
];

/** Цвета эффектов: имя для подсказки */
const SHADOW_COLORS: [string, string][] = [['#0F172A', 'Тёмная'], ['accent', 'Акцент'], ['accent2', 'Тёмный акцент'], ['text', 'Цвет текста'], ['#FFFFFF', 'Белая']];
const GLOW_COLORS: [string, string][] = [['accent', 'Акцент'], ['accent2', 'Тёмный акцент'], ['text', 'Цвет текста'], ['#FFFFFF', 'Белое'], ['#FDE047', 'Жёлтое'], ['#22D3EE', 'Голубое'], ['#F472B6', 'Розовое']];
const OUTLINE_COLORS: [string, string][] = [['accent', 'Акцент'], ['accent2', 'Тёмный акцент'], ['text', 'Цвет текста'], ['surface', 'Цвет фона'], ['#FFFFFF', 'Белый'], ['#111827', 'Чёрный']];
const PLATE_COLORS: [string, string][] = [['accent', 'Акцент'], ['soft', 'Светлый акцент'], ['surface', 'Цвет фона'], ['#111827', 'Тёмная'], ['#FDE047', 'Жёлтая'], ['#DC2626', 'Красная'], ['#FFFFFF', 'Белая']];

/** Какие ключи убирает «×» у эффекта */
const OFF: Record<string, Key[]> = {
  shadow: ['shadow', 'shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowDist', 'shadowAngle'],
  glow: ['glow', 'glowSize', 'glowOpacity'],
  outline: ['outline', 'outlineColor', 'hollow'],
  plate: ['plate', 'plateRadius', 'platePad'],
};

const tst = (b: unknown): TextStyle => ((b as Block | undefined)?.styles as Record<string, TextStyle> | undefined)?.text ?? {};

/** Выделенные надписи (одна или несколько): все — текст, иначе пусто */
export function textTargets(deck: Deck, ed: Editor): Path[] {
  const sel = ed.selection;
  if (!sel) return [];
  const paths = sel.group.length > 1 ? sel.group : [sel.block];
  return paths.every((p) => (getAt(deck, p) as Block | undefined)?.type === 'text') ? paths : [];
}

/** Какие эффекты есть у текста: от них — карточки панели (вид панели меняется, когда их набор другой) */
function effects(st: TextStyle): string[] {
  const out: string[] = [];
  if (textShadowOf(st)) out.push('shadow');
  if (fxColor(st.glow)) out.push('glow');
  if (Number(st.outline) > 0 || st.hollow) out.push('outline');
  const grad = typeof st.color === 'string' && st.color.startsWith('g:');
  if (fxColor(st.plate) && !grad) out.push('plate');
  return out;
}

export function textFxSig(deck: Deck, paths: Path[]): string {
  if (!paths.length) return '';
  const st = tst(getAt(deck, paths[0]));
  return `${effects(st).join(',')}:${st.shadow ?? ''}`;
}

const swatches = (key: Key, list: [string, string][]) => `<div class="st-fx-sw" role="group" aria-label="Цвет">${list.map(([v, name]) =>
  `<button type="button" data-fxc="${key}" data-v="${esc(v)}" style="--c:${fxColor(v) ?? v}" title="${esc(name)}" aria-label="${esc(name)}"></button>`).join('')}`
  + `<label class="st-fx-own" title="Свой цвет"><input type="color" data-fxown="${key}" aria-label="Свой цвет"></label></div>`;

const knobs = (list: Knob[]) => `<div class="st-tune st-fx-tune">${list.map((k) =>
  `<label><span>${esc(k.label)}</span><input type="range" data-fx="${k.key}" min="${k.min}" max="${k.max}" step="${k.step}" aria-label="${esc(k.label)}"><output></output></label>`).join('')}</div>`;

const card = (kind: string, ic: string, title: string, sub: string, body: string) =>
  `<div class="st-fx-card" data-fxk="${kind}"><header>${icon(ic)}<b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`
  + `<button type="button" class="st-fx-off" data-fxoff="${kind}" title="Убрать: ${esc(title.toLowerCase())}" aria-label="Убрать: ${esc(title.toLowerCase())}">${icon('close')}</button></header>${body}</div>`;

/** Раздел «Эффекты текста»: карточки эффектов, которые есть; нет эффектов — нет раздела */
export function textFxHtml(deck: Deck, paths: Path[]): string {
  if (!paths.length) return '';
  const st = tst(getAt(deck, paths[0]));
  const list = effects(st);
  if (!list.length) return '';
  const cards = list.map((k) => {
    if (k === 'shadow') return card('shadow', 'text-shadow', 'Тень', TEXT_SHADOWS[st.shadow!]?.name ?? '', swatches('shadowColor', SHADOW_COLORS) + knobs(SHADOW_KNOBS));
    if (k === 'glow') return card('glow', 'text-glow', 'Свечение', '', swatches('glow', GLOW_COLORS) + knobs(GLOW_KNOBS));
    if (k === 'outline') {
      return card('outline', 'text-outline', 'Контур букв', '', swatches('outlineColor', OUTLINE_COLORS) + knobs(OUTLINE_KNOBS)
        + `<label class="st-p-check st-fx-chk" title="Буквы без заливки — виден только контур"><input type="checkbox" data-fxchk="hollow"><span>Только контур</span></label>`);
    }
    return card('plate', 'plate', 'Плашка', '', swatches('plate', PLATE_COLORS) + knobs(PLATE_KNOBS));
  }).join('');
  return `<section class="st-p-sec st-fx"><h3>Эффекты текста</h3>${cards}<p class="st-p-note">Другие эффекты и готовые варианты — «Надпись» → «Эффекты»</p></section>`;
}

/** Размер текста первой надписи на слайде, px: им пересчитываются em в пиксели */
function sizeOf(host: FxHost, paths: Path[]): number {
  const el = paths[0] ? host.stage().querySelector<HTMLElement>(`.slide.on [data-block='${JSON.stringify(paths[0])}']`) : null;
  return (el && parseFloat(getComputedStyle(el).fontSize)) || 32;
}

/** Значение ползунка из оформления и обратно */
const toSlider = (k: Knob, v: number, size: number) => (k.unit === 'em' ? v * size : k.unit === 'pct' ? v * 100 : k.unit === 'deg' ? ((v % 360) + 360) % 360 : v);
const fromSlider = (k: Knob, v: number, size: number) => (k.unit === 'em' ? Math.round((v / size) * 1000) / 1000 : k.unit === 'pct' ? v / 100 : v);
// Размеры в em — целыми пикселями (доли пикселя тут ничего не дают), толщина контура — с половинками
const shown = (k: Knob, v: number) => (k.unit === 'pct' ? `${Math.round(v)} %` : k.unit === 'deg' ? `${Math.round(v)}°` : k.unit === 'em' ? `${Math.round(v)} px` : `${String(Math.round(v * 10) / 10).replace('.', ',')} px`);
const KNOBS = [...SHADOW_KNOBS, ...GLOW_KNOBS, ...OUTLINE_KNOBS, ...PLATE_KNOBS];

/** Значения ручек и выбранные цвета — по оформлению первой надписи (поле в руках не трогается) */
export function fillTextFx(root: HTMLElement, host: FxHost, paths: Path[]): void {
  if (!paths.length || !root.querySelector('.st-fx')) return;
  const st = tst(getAt(host.deck(), paths[0]));
  const size = sizeOf(host, paths);
  root.querySelectorAll<HTMLInputElement>('input[data-fx]').forEach((inp) => {
    if (inp === document.activeElement && inp.dataset.dragging) return;
    const k = KNOBS.find((x) => x.key === inp.dataset.fx)!;
    const own = Number(st[k.key]);
    const v = toSlider(k, Number.isFinite(own) && st[k.key] !== undefined ? own : k.def(st), size);
    inp.value = String(v);
    inp.nextElementSibling!.textContent = shown(k, v);
  });
  const cur: Partial<Record<Key, string>> = {
    shadowColor: textShadowOf(st)?.color, glow: st.glow, outlineColor: st.outlineColor ?? (st.hollow ? st.color : undefined) ?? 'accent', plate: st.plate,
  };
  root.querySelectorAll<HTMLElement>('[data-fxc]').forEach((b) => b.setAttribute('aria-pressed', String(cur[b.dataset.fxc as Key] === b.dataset.v)));
  const hollow = root.querySelector<HTMLInputElement>('[data-fxchk="hollow"]');
  if (hollow) hollow.checked = !!st.hollow;
}

/** Ручки панели: живой вид на слайде, пока тянут, запись — когда отпустили */
export function bindTextFx(root: HTMLElement, host: FxHost): void {
  const paths = () => textTargets(host.deck(), host.editor());
  const write = (fn: (st: TextStyle) => TextStyle, merge?: string) => {
    const ps = paths();
    if (!ps.length) return;
    host.editor().commit((d) => ps.forEach((p) => {
      const b = getAt(d, p) as Block;
      const next = Object.fromEntries(Object.entries(fn({ ...tst(b) })).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false));
      const styles = { ...((b.styles as Record<string, unknown>) ?? {}) };
      if (Object.keys(next).length) styles.text = next;
      else delete styles.text;
      setAt(d, [...p, 'styles'], Object.keys(styles).length ? styles : undefined);
    }), { rebuild: true, ...(merge ? { merge } : {}) });
  };
  /** Как выглядит надпись с этим оформлением — прямо на слайде, без записи */
  const preview = (fn: (st: TextStyle) => TextStyle) => {
    const render = getBlock('text')?.render;
    if (!render) return;
    for (const p of paths()) {
      const b = getAt(host.deck(), p) as Block;
      const t = document.createElement('div');
      t.innerHTML = render({ ...b, styles: { ...((b.styles as Record<string, unknown>) ?? {}), text: fn({ ...tst(b) }) } }, {} as never);
      const css = t.firstElementChild?.getAttribute('style') ?? null;
      host.stage().querySelectorAll<HTMLElement>(`.slide.on [data-block='${JSON.stringify(p)}']`).forEach((el) => {
        if (css === null) el.removeAttribute('style');
        else el.setAttribute('style', css);
      });
    }
  };
  const knobOf = (inp: HTMLInputElement) => KNOBS.find((x) => x.key === inp.dataset.fx);
  /** Новое значение ручки; у тени и свечения — поверх готового, остальное как было */
  const put = (k: Knob, v: number) => (st: TextStyle): TextStyle => ({ ...st, [k.key]: v });
  root.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    const k = inp.dataset?.fx ? knobOf(inp) : undefined;
    if (k) {
      inp.dataset.dragging = '1';
      const v = Number(inp.value);
      inp.nextElementSibling!.textContent = shown(k, v);
      preview(put(k, fromSlider(k, v, sizeOf(host, paths()))));
      return;
    }
    const own = inp.dataset?.fxown as Key | undefined;
    if (own) preview((st) => ({ ...st, [own]: inp.value.toUpperCase() }));
  });
  root.addEventListener('change', (e) => {
    const inp = e.target as HTMLInputElement;
    const k = inp.dataset?.fx ? knobOf(inp) : undefined;
    if (k) {
      delete inp.dataset.dragging;
      write(put(k, fromSlider(k, Number(inp.value), sizeOf(host, paths()))), `fx-${k.key}`);
      return;
    }
    const own = inp.dataset?.fxown as Key | undefined;
    if (own) return write((st) => ({ ...st, [own]: inp.value.toUpperCase() }));
    if (inp.dataset?.fxchk === 'hollow') write((st) => ({ ...st, hollow: inp.checked || undefined, outline: Number(st.outline) || 2 }));
  });
  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    const sw = t.closest<HTMLElement>('[data-fxc]');
    if (sw) return write((st) => ({ ...st, [sw.dataset.fxc as Key]: sw.dataset.v }));
    const off = t.closest<HTMLElement>('[data-fxoff]')?.dataset.fxoff;
    if (off) {
      write((st) => {
        const out = { ...st };
        for (const k of OFF[off] ?? []) delete out[k];
        // Белый текст на плашке без неё пропал бы на светлом слайде
        if (off === 'plate' && (out.color === '#FFFFFF' || out.color === 'accent2')) delete out.color;
        return out;
      });
    }
  });
  // Наведение на цвет — примерка на слайде; ушли с цветов — как было
  root.addEventListener('pointerover', (e) => {
    const sw = (e.target as Element).closest<HTMLElement>('[data-fxc]');
    if (!sw || !paths().length) return;
    preview((st) => ({ ...st, [sw.dataset.fxc as Key]: sw.dataset.v }));
  });
  root.addEventListener('pointerout', (e) => {
    const from = (e.target as Element).closest('[data-fxc]');
    const to = (e.relatedTarget as Element | null)?.closest?.('[data-fxc]');
    if (from && !to) preview((st) => st);
  });
}
