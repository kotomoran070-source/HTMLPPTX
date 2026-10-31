import { icon } from '../components/icons';
import { gradColor, gradientMid, TEXT_GRADIENTS } from '../engine/gradients';
import { gradientPanel, type GradValue } from '../engine/editor/gradient-edit';
import { GRADIENTS, PRESET_KINDS, SHAPE_COLORS, SHAPE_STYLES, SHAPE_SWATCHES, gradientCss, gradientOn, isGradient, sameGradient, shapeFill, type ShapeGradient } from '../components/shape/shape';
import { frameList, joinFrames, moveFrame, removeFrame, setFrameList } from '../components/layout/frame-list';
import { showFrame, shownFrame } from '../components/layout/frames';
import { IMAGE_ADJUST, IMAGE_FILTER_GROUPS, IMAGE_FILTERS, IMAGE_LOOK_KEYS, IMAGE_SHADOWS, IMAGE_STYLES, adjustCss, filterCss, imageLookCss, type ImageLook } from '../components/layout/image-look';

/** Цвет снимка и свечение: стиль рисунка (рамка, тень, форма) их не трогает — как и у стилей фигуры */
const COLOR_KEYS = new Set<string>(['filter', 'opacity', 'bright', 'contrast', 'saturate', 'glow', 'glowSize', 'glowOpacity']);
/** Тень подкручена в «Свойствах» — она уже не та готовая, что на ленте: плитка не отмечается */
const shadowTuned = (st: object | null | undefined) => SHADOW_TUNE.some((k) => (st as Record<string, unknown> | null | undefined)?.[k] !== undefined);
/**
 * Что стиль меняет в картинке: он про рамку, тень и форму — цвет и прозрачность остаются.
 * Растворение: выбранная часть (fadeSize) остаётся, если стиль тоже с растворением
 */
const stylePatch = (st: (typeof IMAGE_STYLES)[number]): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  for (const k of IMAGE_LOOK_KEYS) if (!COLOR_KEYS.has(k) && !(k === 'fadeSize' && st.props.fade)) patch[k] = undefined;
  return { ...patch, ...st.props };
};
const styleOn = (st: (typeof IMAGE_STYLES)[number], b: Block) => IMAGE_LOOK_KEYS.every((k) => COLOR_KEYS.has(k) || k === 'fadeSize' || b[k] === (st.props as Record<string, unknown>)[k]);

interface LookKind {
  type: string;
  /** Элемент оформления внутри корня блока на слайде */
  el(root: HTMLElement): HTMLElement | null;
  /** Что ещё внутри меняет примерка (вид запоминается и возвращается); по умолчанию — снимки */
  parts?(el: HTMLElement): Element[];
  /** Показать на нём вид блока b */
  apply(el: HTMLElement, b: Block): void;
  sample(b: Block): string;
}
interface LookOption {
  label: string; patch: Record<string, unknown>; /** Для образца, если отличается от примерки на слайде */ preview?: Record<string, unknown>; on: boolean; pick(): void;
  /** Каким станет блок (вместо patch): у надписи вид — в styles.text, у каждой своё */
  fn?(b: Block): Block;
  /** Образец, если отличается от примерки */
  sample?(b: Block): Block;
}
interface LookSlider {
  label: string; min: number; max: number; unit: string; key: string; value: number; set(n: number): unknown; /** Ползунок недоступен: подсказка почему */ off?: string;
  /** Примерка и запись значения не полем key блока (оформление текста надписи) */
  fn?(b: Block, v: unknown): Block;
  write?(v: unknown): void;
}
import { BOX_GLOW, boxFxCss, SHADOW_TUNE } from '../engine/box-fx';
import { applyImageLook, applyShapeLook, blockEl, imageEl, putStyle, shapeEl } from './look-apply';
import { B_GLOW_COLORS } from './fx-panel';
import { getAt, setAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { placeOf } from '../engine/render';
import { esc } from '../engine/html';
import { themeSwatches } from '../engine/deck-theme';
import type { Block, Deck } from '../types';
import { showMenu, showPopover, type MenuEntry } from './menu';
import { fontItems, fontPicker, tryFontOn, type FontItem } from '../engine/editor/font-picker';
import { fontNameOk, fontStack } from '../engine/fonts';
import { colorCss, FONTS, SWATCHES, TEXT_SHADOWS, THEME_COLORS, type TextStyle } from '../engine/text-style';
import { textGradientCss } from '../engine/gradients';
import { angleOf } from '../engine/render';
import { applyLook, LOOK_GROUPS, lookOn, textPanelHtml, textSampleHtml, TEXT_LOOKS } from './text-tab';
import { cellAnchor, cellOf, cellRange, cellSpan, colCount, dropCols, dropRows, expandRange, hasMerge, mergeRange, shiftMerges, sortRows, splitCell, splitRange, tableCells, type CellRange, type TableData as CellTable } from './table-cells';

/**
 * Контекстные вкладки ленты, как «Формат фигуры» и «Макет таблицы» в PowerPoint:
 * появляются, пока выделена фигура или таблица, и несут её оформление —
 * панель свойств справа остаётся для содержимого и положения.
 * Из PowerPoint взято только то, чем пользуются каждый день.
 */

interface Command {
  run(): void;
  enabled?(): boolean;
  active?(): boolean;
}

export interface ContextHost {
  deck: Deck;
  editor: Editor;
  stage(): HTMLElement;
  /** Выполнить общую команду студии (удаление объекта) */
  run(cmd: string): void;
  /** Обновить ленту (выделение ячеек поменялось — кнопки «Объединить» и т. п.) */
  refresh?(): void;
}

export type ContextTab = 'shape' | 'table' | 'image' | 'video' | 'text';

/** Какая контекстная вкладка нужна для выделения (у группы — если все одного типа). */
export function contextTab(deck: Deck, ed: Editor): ContextTab | null {
  const sel = ed.selection;
  if (!sel) return null;
  const paths = sel.group.length > 1 ? sel.group : [sel.block];
  const types = new Set(paths.map((p) => (getAt(deck, p) as Block | undefined)?.type ?? ''));
  if (types.size !== 1) return null;
  const t = [...types][0];
  // Плитка с фото оформляется как рисунок
  if (t === 'tile') return paths.every((p) => !!(getAt(deck, p) as Block).image) ? 'image' : null;
  // Ролик — когда файл уже выбран
  if (t === 'video') return paths.length === 1 && !!(getAt(deck, paths[0]) as Block).src ? 'video' : null;
  return t === 'shape' || t === 'table' || t === 'image' || t === 'text' ? t : null;
}

/** Блок подходит вкладке: «рисунок» — картинка или плитка с фото */
const ofType = (b: Block | undefined, type: string) => (type === 'image' ? b?.type === 'image' || (b?.type === 'tile' && !!b.image) : b?.type === type);

interface BtnOpts { big?: boolean; menu?: boolean; title?: string; swatch?: string; ico?: boolean; chk?: boolean }

const btn = (cmd: string, ic: string, label: string, o: BtnOpts = {}) =>
  `<button type="button" class="st-rb${o.big ? ' big' : ''}${o.ico ? ' ico' : ''}${o.chk ? ' st-chk' : ''}" data-cmd="${cmd}" title="${esc(o.title ?? label)}"${o.menu ? ' aria-haspopup="true"' : ''}${o.ico ? ` aria-label="${esc(label)}"` : ''}>`
  + (o.chk ? `<i class="st-box">${icon('check')}</i>` : icon(ic))
  + (o.swatch ? `<i class="st-rb-sw" data-sw="${o.swatch}"></i>` : '')
  + (o.ico ? '' : `<span>${esc(label)}${o.menu ? '<b class="st-caret"></b>' : ''}</span>`) + `</button>`;

const group = (label: string, body: string) =>
  `<div class="st-rgroup" role="group" aria-label="${esc(label)}"><div class="st-rgroup-body">${body}</div><div class="st-rgroup-label">${esc(label)}</div></div>`;

const row = (...b: string[]) => `<div class="st-rrow">${b.join('')}</div>`;
const stack = (...b: string[]) => `<div class="st-rstack">${b.join('')}</div>`;

/** Кнопка с меню, как в PowerPoint: щелчок — на шаг, стрелка — варианты (команда `${cmd}-menu`) */
const split = (cmd: string, ic: string, label: string, title: string, menuTitle: string) =>
  `<span class="st-rsplit">${btn(cmd, ic, label, { title })}`
  + `<button type="button" class="st-rb st-split-m" data-cmd="${cmd}-menu" data-pal="skip" title="${esc(menuTitle)}" aria-label="${esc(menuTitle)}" aria-haspopup="menu"><b class="st-caret"></b></button></span>`;

/** «Упорядочить» — на каждой вкладке объекта, как «Упорядочение» в PowerPoint */
const ORDER = group('Упорядочить', stack(
  split('obj.forward', 'front', 'Вперёд', 'Переместить вперёд — над ближайшим объектом (Ctrl+])', 'Вперёд: на шаг или на передний план'),
  split('obj.backward', 'back', 'Назад', 'Переместить назад — под ближайший объект (Ctrl+[)', 'Назад: на шаг или на задний план'),
));

const KINDS: [string, string, string][] = [
  ['round', 'sh-round', 'Скруглённый'], ['rect', 'sh-rect', 'Прямоугольник'], ['pill', 'sh-pill', 'Капсула'],
  ['ellipse', 'sh-ellipse', 'Овал'], ['line', 'sh-line', 'Линия'], ['arrow', 'sh-arrow', 'Стрелка'],
];

const VARIANTS: [string, string][] = [
  ['lines', 'Линии'], ['stripes', 'Зебра'], ['boxed', 'Сетка'], ['accent', 'Акцент'], ['soft', 'Мягкая'], ['dark', 'Тёмная шапка'], ['heat', 'Тепловая карта'],
];

/** Живой образец стиля фигуры: те же цвета темы, что на слайде */
const styleTile = (s: (typeof SHAPE_STYLES)[number]) => {
  const p = s.props;
  const fill = p.fill === 'gradient' ? gradientCss(p.gradient) : shapeFill(p.fill) ?? 'var(--acs)';
  const on = p.fill === 'gradient' ? gradientOn(p.gradient) : SHAPE_COLORS[p.fill ?? '']?.on ?? 'var(--tx)';
  const border = p.width ? `${p.width > 1 ? 1.5 : 1}px ${p.dash ? 'dashed' : 'solid'} ${SHAPE_COLORS[p.stroke ?? '']?.css ?? 'var(--bd2)'}` : '1px solid transparent';
  return `<button type="button" class="st-stile" data-cmd="shape.style.${s.id}" title="${esc(s.name)}" aria-label="${esc(s.name)}">`
    + `<i style="background:${fill};color:${on};border:${border}${p.shadow ? ';box-shadow:0 1px 3px rgba(15,23,42,.25)' : ''}">Аа</i></button>`;
};

/** Живой образец стиля таблицы: настоящая таблица в миниатюре */
const tableTile = ([v, label]: [string, string]) => {
  const tr = (tag: string) => `<tr>${[0, 1, 2].map(() => `<${tag}><i></i></${tag}>`).join('')}</tr>`;
  return `<button type="button" class="st-ttile" data-cmd="table.variant.${v}" title="${esc(label)}" aria-label="${esc(label)}">`
    + `<span class="tbl tbl-${v} st-tmini"><table><thead>${tr('th')}</thead><tbody>${tr('td')}${tr('td')}${tr('td')}</tbody></table></span></button>`;
};

/** Живой образец стиля картинки: «снимок» с тем же оформлением, что получит картинка */
const imageTile = (s: (typeof IMAGE_STYLES)[number], recent = false) => {
  const look = imageLookCss({ ...s.props, ...(s.props.width ? { width: Math.min(2, s.props.width) } : {}), ...(s.props.mat ? { mat: 3 } : {}), ...(typeof s.props.radius === 'number' ? { radius: Math.round(s.props.radius / 3) } : {}) });
  return `<button type="button" class="st-stile st-itile" data-cmd="image.style.${s.id}"${recent ? ' data-recent=""' : ''} title="${esc(recent ? `${s.name} · недавний` : s.name)}" aria-label="${esc(s.name)}">`
    + `<i style="${look.box || 'border-radius:4px'}${s.props.shadow ? ';box-shadow:0 2px 5px rgba(15,23,42,.3)' : ''}"><b${look.img ? ` style="${look.img}"` : ''}></b></i></button>`;
};

/** Тени образца — в его масштабе: на маленьком снимке настоящая тень расплылась бы за плитку */
const SAMPLE_SHADOWS: Record<string, string> = { sm: '0 1px 4px rgba(15,23,42,.24)', md: '0 4px 10px rgba(15,23,42,.32)', lg: '0 8px 18px rgba(15,23,42,.42)' };
/**
 * Образец для галерей «Рисунка», как плитки вкладки «Дизайн»: пейзаж, на котором форма, рамка, тень,
 * растворение и цвет видны отчётливо (на скриншоте или тёмном фото их не разглядеть). Сам снимок — при наведении
 */
const sample = (b: ImageLook) => {
  const look = imageLookCss({
    ...b, shadow: undefined, glow: undefined, width: b.width ? Math.min(3, Number(b.width)) : undefined,
    radius: typeof b.radius === 'number' ? Math.round(b.radius * 0.3) : b.radius, mat: b.mat ? Math.max(2, Math.round(Number(b.mat) * 0.3)) : undefined,
  });
  // Свечение — в масштабе образца, одной box-shadow с его тенью
  const halo = boxFxCss({ glow: b.glow, glowSize: Math.max(3, (Number(b.glowSize) || BOX_GLOW.size) * 0.35), glowOpacity: b.glowOpacity });
  const layers = [halo, b.shadow ? SAMPLE_SHADOWS[b.shadow] : ''].filter(Boolean).join(', ');
  const sh = layers ? `box-shadow:${layers}` : '';
  return `<i class="st-smp"><i class="st-smp-pic${look.cls}" style="${esc([look.box, sh].filter(Boolean).join(';'))}"><b${look.img ? ` style="${esc(look.img)}"` : ''}></b></i></i>`;
};

/**
 * Образец фигуры для галерей «Фигуры»: сама фигура в уменьшенном виде (скругление — в её масштабе,
 * тень заметнее), чтобы вариант было видно отчётливо. Саму фигуру — при наведении
 */
const shapeSample = (b: Block) => {
  const line = b.kind === 'line' || b.kind === 'arrow';
  const r = Number(b.radius);
  // Фигура PowerPoint — в своих пропорциях, вписанная в образец
  const pre = PRESET_KINDS[b.kind as string];
  const k = pre ? Math.min(54 / pre.size[0], 34 / pre.size[1]) : 0;
  const fit = pre ? { place: { w: Math.round(pre.size[0] * k), h: Math.round(pre.size[1] * k) } } : {};
  const size = pre ? `flex:none;width:${fit.place!.w}px;height:${fit.place!.h}px;margin:auto` : undefined;
  // Образец формы (галерея «Ещё»): сама форма — без «Аа» и с контуром, даже если у фигуры его нет
  const form = (b as { sample?: unknown }).sample === 'form';
  const outline = form && !Number(b.width) ? { stroke: 'accent', width: 1.5 } : {};
  const wd = outline.width ?? b.width;
  const glowSize = b.glow ? Math.max(3, (Number(b.glowSize) || BOX_GLOW.size) * 0.4) : undefined;
  const n = blockEl('shape', { ...b, ...fit, ...outline, text: line || form ? undefined : 'Аа', radius: Number.isFinite(r) && b.radius !== undefined ? Math.round(r * 0.35) : b.kind === 'rect' ? 0 : 6, style: size, width: wd ? Math.min(3, Number(wd)) : wd, glowSize });
  return `<i class="st-smp st-smp-sh"><i class="st-smp-shape${line ? ' line' : ''}">${n?.outerHTML ?? ''}</i></i>`;
};

/** Поля вида таблицы, которые переносит образец (данные, размеры и свои правки ячеек — нет) */
const TABLE_LOOK = ['variant', 'colors', 'labels', 'lastcol', 'bands', 'total', 'head', 'density', 'valign', 'borders'] as const;
/**
 * Образец таблицы для галерей «Таблицы»: мини-таблица 3×3 с шапкой тем же кодом, что на слайде,
 * вместо текста — полоски, как у плиток стиля таблицы. Саму таблицу — при наведении
 */
const tableSample = (b: Block) => {
  const head = b.head !== false;
  const n = blockEl('table', {
    type: 'table', ...Object.fromEntries(TABLE_LOOK.map((k) => [k, b[k]])),
    header: ['a', 'b', 'c'], rows: [['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']],
    total: undefined, ...(head ? {} : { head: false }),
  });
  if (!n) return '';
  n.classList.add('st-tmini');
  n.querySelectorAll('th, td').forEach((c) => { c.innerHTML = '<i></i>'; });
  return `<i class="st-smp st-smp-tbl">${n.outerHTML}</i>`;
};

/** На ленте — ходовые стили и последний столбец с недавними (на этом компьютере); все стили — по стрелке */
const PINNED_STYLES = ['plain', 'shadow', 'thin', 'accent', 'photo', 'soft'];
const RECENT_STYLES = 'slideria-image-styles-recent';
const recentStyles = (): string[] => {
  let saved: unknown = [];
  try { saved = JSON.parse(localStorage.getItem(RECENT_STYLES) ?? '[]'); } catch { /* нет хранилища */ }
  // Пока недавних нет — круг и растворение
  const ids = [...(Array.isArray(saved) ? saved : []), 'circle', 'fade'];
  return [...new Set(ids)].filter((id) => !PINNED_STYLES.includes(id) && IMAGE_STYLES.some((s) => s.id === id)).slice(0, 2);
};
const imageGallery = () => `<div class="st-gallery i">${[...PINNED_STYLES, ...recentStyles()].map((id, i) => imageTile(IMAGE_STYLES.find((s) => s.id === id)!, i >= PINNED_STYLES.length)).join('')}`
  + `<button type="button" class="st-gmore" data-cmd="image.styles" title="Все стили рисунка" aria-label="Все стили рисунка" aria-haspopup="true"><b class="st-caret"></b></button></div>`;
/** Стиль выбран: если его нет на ленте — встаёт в столбец недавних */
const rememberStyle = (id: string) => {
  const shown = recentStyles();
  if (PINNED_STYLES.includes(id) || shown.includes(id)) return;
  try { localStorage.setItem(RECENT_STYLES, JSON.stringify([id, ...shown].slice(0, 2))); } catch { /* нет хранилища */ }
  document.querySelectorAll('.st-ribbon .st-gallery.i').forEach((g) => { g.outerHTML = imageGallery(); });
};

/** Вкладки и панели ленты (скрыты, пока нет подходящего выделения). */
export function contextTabsHtml(): string {
  return `<button type="button" role="tab" data-tab="text" class="ctx" aria-selected="false" hidden>Надпись</button>`
    + `<button type="button" role="tab" data-tab="shape" class="ctx" aria-selected="false" hidden>Фигура</button>`
    + `<button type="button" role="tab" data-tab="table" class="ctx" aria-selected="false" hidden>Таблица</button>`
    + `<button type="button" role="tab" data-tab="image" class="ctx" aria-selected="false" hidden>Рисунок</button>`
    + `<button type="button" role="tab" data-tab="video" class="ctx" aria-selected="false" hidden>Видео</button>`;
}

export function contextPanelsHtml(): string {
  return `<div class="st-rpanel" data-panel="shape" hidden>
  ${group('Стили', `<div class="st-gallery">${SHAPE_STYLES.map(styleTile).join('')}</div>`)}
  ${group('Форма', `<div class="st-rgrid">${KINDS.map(([k, ic, l]) => btn(`shape.kind.${k}`, ic, l, { ico: true })).join('')}</div>`
    + btn('shape.kinds', 'sh-more', 'Ещё', { big: true, menu: true, title: 'Ромб, звезда, стрелки, выноска…' }))}
  ${group('Цвет', btn('shape.fill', 'fill', 'Заливка', { big: true, menu: true, swatch: 'fill' }) + btn('shape.stroke', 'outline', 'Контур', { big: true, menu: true, swatch: 'stroke', title: 'Цвет, толщина и штрих контура' }))}
  ${group('Текст', btn('shape.text', 'text-box', 'Надпись', { big: true, title: 'Текст внутри фигуры' })
    + stack(
      row(btn('shape.font.up', 'text-up', 'Крупнее', { ico: true }), btn('shape.font.down', 'text-down', 'Мельче', { ico: true }), btn('shape.bold', 'bold', 'Жирный', { ico: true })),
      row(btn('shape.align.left', 'align-left', 'По левому краю', { ico: true }), btn('shape.align.center', 'align-center', 'По центру', { ico: true }), btn('shape.align.right', 'align-right', 'По правому краю', { ico: true })),
      row(btn('shape.valign.top', 'v-top', 'Сверху', { ico: true }), btn('shape.valign.middle', 'v-middle', 'Посередине по высоте', { ico: true }), btn('shape.valign.bottom', 'v-bottom', 'Снизу', { ico: true })),
    ))}
  ${group('Эффекты', stack(btn('shape.shadow', 'shadow', 'Тень', { menu: true }), btn('shape.glow', 'glow', 'Свечение', { menu: true, title: 'Свечение по краю фигуры' }), btn('shape.radius', 'corner', 'Скругление', { menu: true }))
    + stack(btn('shape.rotate', 'rotate', 'Поворот', { menu: true }), btn('shape.opacity', 'opacity', 'Прозрачность', { menu: true })))}
  ${ORDER}
</div>
<div class="st-rpanel" data-panel="table" hidden>
  ${group('Стиль таблицы', `<div class="st-gallery t" data-shrink="66 194">${VARIANTS.map(tableTile).join('')}</div>` + btn('table.fill', 'fill', 'Заливка', { big: true, menu: true, title: 'Заливка выделенных ячеек' }) + btn('table.borders', 'borders', 'Границы', { big: true, menu: true, title: 'Границы выделенных ячеек или всей таблицы' }))}
  ${group('Показать', stack(btn('table.head', '', 'Строка заголовка', { chk: true }), btn('table.total', '', 'Строка итогов', { chk: true, title: 'Последняя строка как итог' }), btn('table.bands', '', 'Чередующиеся строки', { chk: true }))
    + stack(btn('table.labels', '', 'Первый столбец', { chk: true, title: 'Первый столбец жирным' }), btn('table.lastcol', '', 'Последний столбец', { chk: true, title: 'Последний столбец жирным' }), btn('table.highlight', '', 'Выделить строку', { chk: true, title: 'Выделить строку с курсором' })))}
  ${group('Строки и столбцы', btn('table.select', 'cursor', 'Выделить', { big: true, menu: true, title: 'Выделить строку, столбец или всю таблицу' })
    + stack(btn('table.row.above', 'row-above', 'Вставить сверху'), btn('table.row.below', 'row-below', 'Вставить снизу'))
    + stack(btn('table.col.left', 'col-left', 'Вставить слева'), btn('table.col.right', 'col-right', 'Вставить справа'))
    + btn('table.del', 'table-del', 'Удалить', { big: true, menu: true, title: 'Удалить строку, столбец или таблицу' }))}
  ${group('Объединение', btn('table.merge', 'cell-merge', 'Объединить', { big: true, title: 'Объединить выделенные ячейки' }) + btn('table.split', 'cell-split', 'Разделить', { big: true, title: 'Разбить ячейку на столбцы и строки' }))}
  ${group('Ячейки', stack(
    row(btn('table.align.left', 'align-left', 'Столбцы — по левому краю', { ico: true }), btn('table.align.center', 'align-center', 'Столбцы — по центру', { ico: true }), btn('table.align.right', 'align-right', 'Столбцы — по правому краю', { ico: true })),
    row(btn('table.valign.top', 'v-top', 'В ячейках — сверху', { ico: true }), btn('table.valign.middle', 'v-middle', 'В ячейках — посередине', { ico: true }), btn('table.valign.bottom', 'v-bottom', 'В ячейках — снизу', { ico: true })),
    row(btn('table.cols.equal', 'eq-cols', 'Выровнять ширину', { ico: true }), btn('table.rows.equal', 'rows-eq', 'Выровнять высоту строк', { ico: true }), btn('table.sort', 'sort', 'Сортировка по столбцу', { ico: true, menu: true })),
  ) + stack(btn('table.density', 'density', 'Плотность', { menu: true, title: 'Отступы в ячейках' }), row(btn('table.size.up', 'text-up', 'Крупнее', { ico: true }), btn('table.size.down', 'text-down', 'Мельче', { ico: true }))))}
  ${ORDER}
</div>
<div class="st-rpanel" data-panel="image" hidden>
  ${group('Стили рисунка', imageGallery())}
  ${group('Рамка', btn('image.stroke', 'outline', 'Контур', { big: true, menu: true, swatch: 'istroke', title: 'Цвет, толщина и штрих контура' }) + btn('image.mat', 'mat', 'Паспарту', { big: true, menu: true, title: 'Поле вокруг снимка' }))}
  ${group('Эффекты', stack(btn('image.shadow', 'shadow', 'Тень', { menu: true }), btn('image.glow', 'glow', 'Свечение', { menu: true, title: 'Свечение по краю рисунка' }), btn('image.radius', 'corner', 'Скругление', { menu: true }))
    + stack(btn('image.filter', 'recolor', 'Цвет', { menu: true, title: 'Цветовой фильтр' }), btn('image.opacity', 'opacity', 'Прозрачность', { menu: true })))}
  ${group('Цветокоррекция', btn('image.grade', 'sliders', 'Цвет+', { big: true, title: 'Цветокоррекция: круги, кривые, HSL, LUT' }))}
  ${group('Кадр', btn('image.crop', 'crop', 'Кадр', { big: true, title: 'Сдвинуть снимок в рамке (Esc — готово)' })
    + btn('image.shape', 'star', 'Форма', { big: true, menu: true, title: 'Обрезать по фигуре: ромб, звезда, сердце, облако…' })
    + btn('image.fit', 'contain', 'Вписать', { big: true, menu: true, title: 'Как снимок заполняет рамку' }))}
  ${group('Галерея', btn('image.frames.join', 'frames', 'Собрать в галерею', { big: true, title: 'Объединить выделенные картинки в одну с кадрами' })
    + btn('image.frame.add', 'frames', 'Ещё кадры', { big: true, title: 'Добавить кадры в картинку' })
    // Кнопки кадров — только у картинки с кадрами (studio.ts): обычной хватает «Ещё кадры», лента не теснится
    + `<div class="st-frames">${stack(btn('image.frame.del', 'trash', 'Убрать кадр', { title: 'Убрать открытый кадр' }),
      row(btn('image.frame.prev', 'arr-left', 'Кадр раньше', { ico: true }), btn('image.frame.next', 'arr-right', 'Кадр позже', { ico: true })),
      btn('image.flip', '', 'По «Далее»', { chk: true, title: 'Переключать кадры кнопкой «Далее», как анимации' }))}</div>`)}
  ${group('Сброс', btn('image.reset', 'reset', 'Сбросить', { big: true, title: 'Убрать всё оформление рисунка' }))}
  ${group('Файл', btn('obj.picture', 'save', 'Сохранить', { big: true, title: 'Сохранить как PNG' }))}
  ${ORDER}
</div>
<div class="st-rpanel" data-panel="video" hidden>
  ${group('Воспроизведение', stack(btn('video.autoplay', '', 'Запуск со слайдом', { chk: true, title: 'Ролик запускается, когда открывается слайд' }), btn('video.muted', '', 'Без звука', { chk: true }))
    + stack(btn('video.loop', '', 'По кругу', { chk: true }), btn('video.controls', '', 'Кнопки плеера', { chk: true, title: 'Кнопки плеера при наведении' })))}
  ${group('Кадр', btn('video.fit', 'crop', 'Заполнить', { big: true, title: 'Заполнить рамку или показать ролик целиком' }))}
  ${group('Цветокоррекция', btn('video.grade', 'sliders', 'Цвет+', { big: true, title: 'Цветокоррекция ролика' }))}
  ${ORDER}
</div>
${textPanelHtml({ btn, group, row, stack, order: ORDER })}`;
}

/** Цвет из данных фигуры → CSS для образца на кнопке. */
const swatchCss = (v: unknown, fallback: string): string => shapeFill(v) ?? fallback;

const FONT_STEPS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96];

/**
 * «Прозрачность» — как в PowerPoint: 0 % — объект виден полностью, 80 % — почти растворился.
 * Пишется непрозрачность (opacity, как в CSS): 1 − прозрачность
 */
const CLEAR_STEPS: [number | undefined, string][] = [[undefined, '0 %'], [0.8, '20 %'], [0.6, '40 %'], [0.4, '60 %'], [0.2, '80 %']];
const CLEAR_SLIDER = {
  min: 0, max: 90, unit: ' %',
  get: (v: unknown) => Math.round((1 - (Number(v) || 1)) * 100),
  set: (n: number) => (n <= 0 ? undefined : Math.round(100 - n) / 100),
};

let tableMenuFn: (() => MenuEntry[]) | null = null;

/** Пункты таблицы для меню правого щелчка (строка/столбец ячейки под курсором) */
export function tableMenu(): MenuEntry[] {
  return tableMenuFn?.() ?? [];
}

export function contextCommands(h: ContextHost): Record<string, Command> {
  const { deck, editor: ed } = h;
  /** Вкладка «Видео»: настройки плеера и цветокоррекция своего ролика */
  const videoCommands = (): Record<string, Command> => {
    const v = () => first('video');
    const isVideo = () => !!v()?.src;
    // Без звука по умолчанию — если ролик запускается сам (как в блоке video)
    const flag = (key: string, def: () => boolean): Command => ({
      run: () => { const on = v()?.[key] ?? def(); setAll('video', key, on ? (def() ? false : undefined) : (def() ? undefined : true)); },
      enabled: isVideo,
      active: () => isVideo() && !!(v()?.[key] ?? def()),
    });
    const auto = () => v()?.autoplay !== false;
    return {
      'video.autoplay': flag('autoplay', () => true),
      'video.muted': flag('muted', auto),
      'video.loop': flag('loop', () => false),
      'video.controls': flag('controls', () => true),
      'video.fit': { run: () => setAll('video', 'fit', v()?.fit === 'cover' ? undefined : 'cover'), enabled: isVideo, active: () => v()?.fit === 'cover' },
      'video.grade': {
        run: () => { const p = targets('video')[0]; if (p) void import('./color/panel').then((m) => m.openColor({ deck, editor: ed }, p)); },
        enabled: () => targets('video').length === 1 && isVideo(),
      },
    };
  };
  /** Выделенные блоки нужного типа: одна фигура или группа фигур */
  const targets = (type: string): Path[] => {
    const sel = ed.selection;
    if (!sel) return [];
    const paths = sel.group.length > 1 ? sel.group : [sel.block];
    return paths.every((p) => ofType(getAt(deck, p) as Block | undefined, type)) ? paths : [];
  };
  const first = (type: string) => {
    const p = targets(type)[0];
    return p ? (getAt(deck, p) as Block) : null;
  };
  const clean = (v: unknown) => (v === '' || v === null ? undefined : v);
  const setAll = (type: string, key: string, value: unknown) => {
    const paths = targets(type);
    if (!paths.length) return;
    ed.commit((d) => paths.forEach((p) => setAt(d, [...p, key], clean(value))), { rebuild: true });
  };
  const isShape = () => targets('shape').length > 0;
  const isTable = () => targets('table').length > 0;
  const isLine = (b: Block | null) => b?.kind === 'line' || b?.kind === 'arrow';
  /** Фигуры, у которых есть тело (не линии) */
  const isBody = () => isShape() && !isLine(first('shape'));
  const anchor = (cmd: string) => document.querySelector<HTMLElement>(`.st-ribbon [data-cmd="${cmd}"]`)!;
  /** Цвета темы в палитре: наискось — у светлых и у тёмных слайдов, если они разные */
  const themeRow = (cur: unknown) => {
    const bg = themeSwatches(deck.theme, deck.origin, SHAPE_COLORS);
    return Object.entries(SHAPE_COLORS).filter(([v]) => v !== 'bg').map(([v, c]) => {
      const two = bg[v].startsWith('linear-gradient');
      const name = two ? `${c.name} · меняется с темой` : c.name;
      return `<button type="button" class="st-psw${cur === v ? ' on' : ''}" data-v="${esc(v)}" style="--c:${bg[v]}" title="${esc(name)}" aria-label="${esc(c.name)}"></button>`;
    }).join('');
  };

  // ---------- фигура: цвета ----------

  /** Палитра, как в PowerPoint: цвета темы, постоянные цвета, «нет», другой цвет. У контура — ещё толщина и штрих. */
  const palette = (cmd: string, key: 'fill' | 'stroke', type: 'shape' | 'image' = 'shape') => {
    const b = first(type);
    const line = isLine(b);
    // У линии цвет хранится в stroke (или по старинке в fill)
    const k = line ? 'stroke' : key;
    const cur = line ? b?.stroke ?? b?.fill : b?.[key];
    const sw = (v: string, css: string, name: string) =>
      `<button type="button" class="st-psw${cur === v ? ' on' : ''}" data-v="${esc(v)}" style="--c:${css}" title="${esc(name)}" aria-label="${esc(name)}"></button>`;
    const theme = themeRow(cur);
    // Градиенты — только у заливки фигуры
    // Градиент хранится рядом: gradient у заливки, strokeGradient у контура и линии
    const gk = k === 'fill' ? 'gradient' : 'strokeGradient';
    const curGrad = cur === 'gradient' ? (isGradient(b?.[gk]) ? b![gk] as ShapeGradient : GRADIENTS[0].g) : null;
    // У контура — только контрастные градиенты: светлые на рамке не видны
    const list = k === 'fill' ? GRADIENTS : GRADIENTS.filter((g) => TEXT_GRADIENTS.includes(g.id));
    const grads = type === 'shape' && (key === 'stroke' || !line)
      ? `<div class="st-plabel">Градиенты</div><div class="st-pgrid st-grads${k === 'fill' ? '' : ' by8'}">${list.map((g) => `<button type="button" class="st-psw${curGrad && sameGradient(curGrad, g.g) ? ' on' : ''}" data-g="${g.id}" style="--c:${gradientCss(g.g)}" title="${esc(g.name)}" aria-label="${esc(g.name)}"></button>`).join('')}</div>
      <button type="button" class="st-pmore" data-v="grad-edit"><i style="background:${curGrad ? gradientCss(curGrad) : 'linear-gradient(135deg, #F97316, #2563EB)'}"></i><span>Настроить градиент…</span></button>`
      : '';
    const width = Number(b?.width ?? (line ? 3 : 0));
    const outline = key === 'stroke' || line;
    const html = `${line ? '' : `<button type="button" class="st-pnone${cur === 'none' || (key === 'stroke' && !width) ? ' on' : ''}" data-v="none">${icon('close')}<span>${key === 'fill' ? 'Без заливки' : 'Без контура'}</span></button>`}
      <div class="st-plabel">Цвета темы</div><div class="st-pgrid">${theme}</div>
      <div class="st-plabel">Стандартные</div><div class="st-pgrid">${SHAPE_SWATCHES.map((c) => sw(c, c, c)).join('')}</div>
      <button type="button" class="st-pmore" data-v="custom"><i style="background:conic-gradient(#f87171, #fbbf24, #34d399, #60a5fa, #c084fc, #f87171)"></i><span>Другой цвет…</span></button>
      ${grads}
      ${outline ? `<div class="st-plabel">Толщина</div><div class="st-pseg">${[1, 2, 3, 4, 6, 8].map((w) => `<button type="button" data-w="${w}" class="${width === w ? 'on' : ''}" title="${w} px"><i style="height:${Math.min(w, 6)}px"></i></button>`).join('')}</div>
      <div class="st-plabel">Штрих</div><div class="st-pseg">${([['', 'Сплошной'], ['dash', 'Пунктир'], ['dot', 'Точки']] as const).map(([v, l]) => `<button type="button" data-dash="${v}" class="${(b?.dash ?? '') === v ? 'on' : ''}" title="${l}"><i class="d-${v || 'solid'}"></i></button>`).join('')}</div>` : ''}`;
    // Рамка появляется вместе с цветом: без толщины её не видно
    const withWidth = (d: Deck, p: Path) => {
      if (k === 'stroke' && !line && !Number((getAt(d, p) as Block).width)) setAt(d, [...p, 'width'], 2);
    };
    const apply = (fn: (d: Deck, p: Path) => void) => {
      const paths = targets(type);
      ed.commit((d) => paths.forEach((p) => fn(d, p)), { rebuild: true });
    };
    const pop = showPopover(anchor(cmd), html, (el) => {
      const v = el.dataset.v;
      if (el.dataset.g) {
        const g = GRADIENTS.find((x) => x.id === el.dataset.g)!.g;
        return { run: () => apply((d, p) => { setAt(d, [...p, k], 'gradient'); setAt(d, [...p, gk], { ...g }); withWidth(d, p); }) };
      }
      if (v === 'grad-edit') return { run: () => gradientEditor(cmd, curGrad ?? GRADIENTS[0].g, k) };
      if (v === 'custom') {
        return {
          run: () => {
            const input = document.createElement('input');
            input.type = 'color';
            if (typeof cur === 'string' && /^#[0-9a-f]{6}$/i.test(cur)) input.value = cur;
            input.addEventListener('change', () => apply((d, p) => { setAt(d, [...p, k], input.value.toUpperCase()); setAt(d, [...p, gk], undefined); withWidth(d, p); }));
            input.click();
          },
        };
      }
      if (v === 'none') return { run: () => apply((d, p) => { setAt(d, [...p, k === 'stroke' ? 'width' : 'fill'], k === 'stroke' ? undefined : 'none'); if (k === 'fill') setAt(d, [...p, 'gradient'], undefined); }) };
      if (v) return { run: () => apply((d, p) => { setAt(d, [...p, k], v); setAt(d, [...p, gk], undefined); withWidth(d, p); }) };
      if (el.dataset.w) {
        const w = Number(el.dataset.w);
        return { keep: true, run: () => { apply((d, p) => setAt(d, [...p, 'width'], w)); mark(el); } };
      }
      if (el.dataset.dash !== undefined) {
        const dv = el.dataset.dash;
        return { keep: true, run: () => { apply((d, p) => { setAt(d, [...p, 'dash'], dv || undefined); withWidth(d, p); }); mark(el); } };
      }
      return null;
    }, 'st-palette');
    // Наведение на цвет, градиент, толщину или штрих — примерка на самой фигуре (рисунке)
    const wide = (b: Block): Block => (k === 'stroke' && !isLine(b) && !Number(b.width) ? { ...b, width: 2 } : b);
    bindTry(pop, tryLook(type === 'image' ? IMAGE_KIND : SHAPE_KIND, targets(type)), (el) => {
      const v = el.dataset.v;
      if (el.dataset.g) {
        const g = GRADIENTS.find((x) => x.id === el.dataset.g)?.g;
        return g ? (b) => wide({ ...b, [k]: 'gradient', [gk]: { ...g } }) : null;
      }
      if (v === 'none') return (b) => (k === 'stroke' ? { ...b, width: undefined } : { ...b, fill: 'none', gradient: undefined });
      if (v && v !== 'custom' && v !== 'grad-edit') return (b) => wide({ ...b, [k]: v, [gk]: undefined });
      if (el.dataset.w) return (b) => ({ ...b, width: Number(el.dataset.w) });
      if (el.dataset.dash !== undefined) return (b) => wide({ ...b, dash: el.dataset.dash || undefined });
      return null;
    });
  };
  /** Свой градиент: два цвета, направление или от центра; правки видны сразу и в истории — одним шагом */
  /** Свой градиент заливки или контура: точки (цвета темы или постоянные), направление, готовые */
  const gradientEditor = (cmd: string, start: ShapeGradient, k: 'fill' | 'stroke' = 'fill') => {
    const gk = k === 'fill' ? 'gradient' : 'strokeGradient';
    const key = `grad:${Date.now()}`;
    const value = (g: GradValue): ShapeGradient => {
      const mid = gradientMid(g.mid);
      return { from: g.from, to: g.to, ...(mid.length ? { mid } : {}), ...(g.type === 'radial' ? { type: 'radial' as const } : { angle: g.angle ?? 135 }) };
    };
    /** Пока тянут — градиент только на самих фигурах на слайде, без пересборки; запись — когда отпустили */
    const preview = (g: GradValue) => {
      for (const p of targets('shape')) {
        for (const root of h.stage().querySelectorAll<HTMLElement>(`.slide.on [data-block='${JSON.stringify(p)}']`)) {
          const el = SHAPE_KIND.el(root);
          if (el) SHAPE_KIND.apply(el, { ...(getAt(deck, p) as Block), [k]: 'gradient', [gk]: value(g) });
        }
      }
    };
    const save = (g: GradValue) => {
      const paths = targets('shape');
      const val = value(g);
      ed.commit((d) => paths.forEach((p) => {
        setAt(d, [...p, k], 'gradient');
        setAt(d, [...p, gk], val);
        const b = getAt(d, p) as Block;
        if (k === 'stroke' && !isLine(b) && !Number(b.width)) b.width = 2;
      }), { rebuild: true, merge: key, hold: true });
    };
    const list = k === 'fill' ? GRADIENTS : GRADIENTS.filter((x) => TEXT_GRADIENTS.includes(x.id));
    const theme: [string, string, string][] = [
      ...Object.entries(SHAPE_COLORS).filter(([v]) => v !== 'bg').map(([v, c]) => [v, c.css, c.name] as [string, string, string]),
      ['accent-light', 'color-mix(in srgb, var(--ac) 72%, #fff)', 'Светлый акцент'], ['accent-dark', 'color-mix(in srgb, var(--ac) 78%, #000)', 'Тёмный акцент'], ['accent2', 'var(--ac2)', 'Второй цвет акцента'],
    ];
    const panel = gradientPanel({
      css: gradColor,
      hex: toHex,
      swatches: [{ label: 'Цвета темы', items: theme }, { label: 'Стандартные', items: SHAPE_SWATCHES.map((c) => [c, c, c]) }],
      direction: true,
      presets: list.map((x) => ({ name: x.name, css: gradientCss(x.g), g: { from: x.g.from, to: x.g.to, mid: gradientMid(x.g.mid), angle: x.g.angle, type: x.g.type }, on: sameGradient(x.g, start) })),
      preview,
      commit: (g) => { if (g) save(g); },
    }, { from: start.from, to: start.to, mid: gradientMid(start.mid), angle: start.angle, type: start.type });
    const pop = showPopover(anchor(cmd), `<div class="st-plabel">Свой градиент</div>${panel.html}`, panel.pick, 'st-palette st-grad');
    panel.bind(pop);
  };
  /** Цвет темы или CSS-цвет → #RRGGBB для поля выбора цвета */
  const toHex = (c: string): string => {
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    const probe = document.createElement('i');
    probe.style.color = gradColor(c);
    h.stage().appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(v) ?? /srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(v);
    if (!m) return '#2563eb';
    const k = v.startsWith('color(') ? 255 : 1;
    return `#${[m[1], m[2], m[3]].map((x) => Math.round(Number(x) * k).toString(16).padStart(2, '0')).join('')}`;
  };
  const mark = (el: HTMLElement) => el.parentElement?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));

  // ---------- рисунок: цвет — галерея превью и ползунки; наведение и ползунки примеряются на слайде ----------
  const filterGallery = () => {
    const paths = targets('image');
    // Снимки на слайде: после записи слайд перерисовывается — берём заново
    const snap = () => paths.flatMap((p) => [...h.stage().querySelectorAll<HTMLElement>(`.slide.on [data-block='${JSON.stringify(p)}'] .imgbox`)])
      .map((bx) => ({ bx, img: bx.querySelector('img'), cls: bx.className, style: bx.getAttribute('style'), imgStyle: bx.querySelector('img')?.getAttribute('style') ?? null }));
    let saved = snap();
    const fresh = () => { if (saved[0] && !saved[0].bx.isConnected) saved = snap(); };
    const b0 = first('image');
    const cur = typeof b0?.filter === 'string' && IMAGE_FILTERS[b0.filter] ? b0.filter : '';
    const adj: Record<string, number> = Object.fromEntries(IMAGE_ADJUST.map(([k]) => [k, Number(b0?.[k]) || 100]));
    let picked = false;
    const put = (el: Element | null, v: string | null) => { if (el) { if (v === null) el.removeAttribute('style'); else el.setAttribute('style', v); } };
    const restore = () => { if (picked) return; fresh(); saved.forEach((x) => { x.bx.className = x.cls; put(x.bx, x.style); put(x.img, x.imgStyle); }); };
    /** Показать на слайде фильтр key (null — выбранный) с текущими ползунками */
    const tryOn = (key: string | null) => {
      restore();
      const k = key ?? cur;
      const f = filterCss(k);
      const css = [k ? IMAGE_FILTERS[k].css : '', adjustCss(adj)].filter(Boolean).join(' ');
      for (const { bx, img } of saved) {
        if (img) img.style.filter = css || 'none';
        bx.classList.toggle('img-tint', f.tint);
        for (const v of ['--tint', '--tint-blend', '--tint-op']) bx.style.removeProperty(v);
        if (f.tint) for (const d of f.box.split(';')) { const [n, ...v] = d.split(':'); bx.style.setProperty(n, v.join(':')); }
      }
    };
    const tile = (key: string, name: string) => `<button type="button" class="st-flt${key === cur ? ' on' : ''}" data-flt="${key}" title="${esc(name)}">`
      + `${sample({ ...(b0 ?? {}), filter: key || undefined, bright: undefined, contrast: undefined, saturate: undefined } as ImageLook)}<span>${esc(name)}</span></button>`;
    const groups = Object.entries(IMAGE_FILTER_GROUPS).map(([g, label]) => {
      const list = Object.entries(IMAGE_FILTERS).filter(([, f]) => f.group === g);
      return `<h4>${esc(label)}</h4><div class="st-flt-grid">${g === 'base' ? tile('', 'Исходный') : ''}${list.map(([k, f]) => tile(k, f.name)).join('')}</div>`;
    }).join('');
    const sliders = `<h4>Настройка</h4><div class="st-adj">${IMAGE_ADJUST.map(([k, l, min, max]) =>
      `<label><span>${esc(l)}</span><input type="range" min="${min}" max="${max}" step="1" value="${adj[k]}" data-adj="${k}" aria-label="${esc(l)}"><output>${adj[k]}%</output></label>`).join('')}`
      + `<button type="button" class="st-adj-reset" data-adj-reset="1">Сбросить настройку</button></div>`;
    const pop = showPopover(anchor('image.filter'), `<div class="st-flt-pop">${groups}${sliders}</div>`, (b) => {
      if (b.dataset.adjReset) {
        return { keep: true, run: () => {
          IMAGE_ADJUST.forEach(([k]) => { adj[k] = 100; });
          pop.querySelectorAll<HTMLInputElement>('[data-adj]').forEach((r) => { r.value = '100'; r.nextElementSibling!.textContent = '100%'; });
          ed.commit((d) => paths.forEach((p) => IMAGE_ADJUST.forEach(([k]) => setAt(d, [...p, k], undefined))), { rebuild: true });
        } };
      }
      const key = b.dataset.flt;
      if (key === undefined) return null;
      return { run: () => { restore(); picked = true; setAll('image', 'filter', key || undefined); } };
    }, 'st-fltpop');
    // Меню меньше закрывает слайд: видны все фильтры, «Настройка» с ползунками — ниже, прокруткой.
    // Граница считается по месту — шрифты и масштаб у всех разные
    const adjHead = pop.querySelector<HTMLElement>('.st-adj')?.previousElementSibling;
    if (adjHead) {
      const cut = adjHead.getBoundingClientRect().top - pop.getBoundingClientRect().top + pop.scrollTop - 2;
      if (cut > 200) pop.style.maxHeight = `min(${Math.round(cut)}px, calc(100vh - 140px))`;
    }
    pop.addEventListener('pointerover', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-flt]');
      if (b) tryOn(b.dataset.flt!);
    });
    pop.addEventListener('pointerout', (e) => {
      // Ушли с превью (на ползунки, заголовки) — на слайде снова выбранный фильтр
      if ((e.target as Element).closest('[data-flt]') && !(e.relatedTarget as Element | null)?.closest?.('[data-flt]')) restore();
    });
    pop.addEventListener('pointerleave', restore);
    pop.addEventListener('focusin', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-flt]');
      if (b) tryOn(b.dataset.flt!);
    });
    // Ползунок: на слайде — сразу, в данные — когда отпустили (один шаг отмены на ползунок)
    pop.addEventListener('input', (e) => {
      const r = e.target as HTMLInputElement;
      const k = r.dataset.adj;
      if (!k) return;
      adj[k] = Number(r.value);
      r.nextElementSibling!.textContent = `${r.value}%`;
      tryOn(null);
    });
    pop.addEventListener('change', (e) => {
      const r = e.target as HTMLInputElement;
      const k = r.dataset.adj;
      if (!k) return;
      const v = Number(r.value);
      ed.commit((d) => paths.forEach((p) => setAt(d, [...p, k], v === 100 ? undefined : v)), { rebuild: true, merge: `img-adj-${k}` });
      saved = snap();
    });
    // Закрыли без выбора (Esc, щелчок мимо) — снимки как были
    const mo = new MutationObserver(() => { if (!pop.isConnected) { mo.disconnect(); restore(); } });
    mo.observe(document.body, { childList: true });
  };
  const put = putStyle;
  /**
   * Примерка на объектах на слайде, без записи: вид (классы и style) запоминается, tryOn показывает
   * блок, каким его сделает выбор, restore возвращает как было. forget — выбор сделан, объект
   * перерисован с новым видом: прежний вид больше не возвращать (следующая примерка запомнит новый)
   */
  const tryLook = (kind: LookKind, paths: Path[] = targets(kind.type)) => {
    const snap = () => paths.flatMap((p) => [...h.stage().querySelectorAll<HTMLElement>(`.slide.on [data-block='${JSON.stringify(p)}']`)].map((root) => ({ el: kind.el(root), p })))
      .filter((x): x is { el: HTMLElement; p: Path } => !!x.el)
      .map(({ el, p }) => ({ el, p, parts: [el, ...(kind.parts?.(el) ?? el.querySelectorAll('img'))].map((n) => ({ n, cls: n.className, style: n.getAttribute('style') })) }));
    let saved = snap();
    const fresh = () => { if (!saved.length || !saved[0].el.isConnected) saved = snap(); };
    const restore = () => saved.forEach((x) => x.parts.forEach(({ n, cls, style }) => { n.className = cls; put(n, style); }));
    return {
      kind,
      tryOn(fn: (b: Block) => Block) {
        fresh();
        restore();
        for (const { el, p } of saved) kind.apply(el, fn(getAt(deck, p) as Block));
      },
      restore,
      forget() { saved = []; },
    };
  };
  /**
   * Примерка в окошке с вариантами: наведение и фокус на варианте — tryOn, уход — restore, щелчок —
   * forget (выбор записан и перерисован), закрыли окошко — restore
   */
  const bindTry = (pop: HTMLElement, look: ReturnType<typeof tryLook>, fnOf: (el: HTMLElement) => ((b: Block) => Block) | null) => {
    const opt = (t: EventTarget | null) => (t as Element | null)?.closest?.<HTMLElement>('button');
    const show = (t: EventTarget | null) => { const b = opt(t); const fn = b && pop.contains(b) ? fnOf(b) : null; if (fn) look.tryOn(fn); else look.restore(); };
    pop.addEventListener('pointerover', (e) => show(e.target));
    pop.addEventListener('focusin', (e) => show(e.target));
    pop.addEventListener('pointerleave', () => look.restore());
    pop.addEventListener('pointerdown', (e) => { if (opt(e.target)) look.forget(); });
    const mo = new MutationObserver(() => { if (!pop.isConnected) { mo.disconnect(); look.restore(); } });
    mo.observe(document.body, { childList: true });
  };
  /** Рисунок: оформление — на рамке .imgbox и самом снимке, образец — пейзаж */
  const IMAGE_KIND: LookKind = { type: 'image', el: imageEl, apply: applyImageLook, sample: (b) => sample(b as ImageLook) };
  /** Фигура: перерисовывается тем же кодом, что на слайде; образец — фигура с «Аа» */
  const SHAPE_KIND: LookKind = { type: 'shape', el: shapeEl, apply: applyShapeLook, sample: shapeSample };
  /** Таблица: класс вида у корня и линии ячеек — из разметки, перерисованной тем же кодом */
  const TABLE_KIND: LookKind = {
    type: 'table',
    el: (root) => (root.matches('.tbl') ? root : root.querySelector('.tbl')),
    parts: (el) => [...el.querySelectorAll('th, td')],
    apply: (el, b) => {
      const n = blockEl('table', b);
      if (!n) return;
      el.className = [...[...el.classList].filter((c) => c !== 'r' && !c.startsWith('tbl')), ...n.classList].join(' ');
      put(el, n.getAttribute('style'));
      const live = el.querySelectorAll('th, td');
      const fresh = n.querySelectorAll('th, td');
      if (live.length === fresh.length) live.forEach((c, i) => put(c, fresh[i].getAttribute('style')));
    },
    sample: tableSample,
  };
  /**
   * Тень, скругление, прозрачность, паспарту, поворот, все стили — как «Цвет»: превью на образце, наведение
   * примеряет на самом объекте на слайде, щелчок — применить; ползунок — своё значение (на слайде сразу, в данные — когда отпустили).
   */
  const lookPopover = (at: HTMLElement, sections: { title?: string; cls?: string; options: LookOption[] }[], slider?: LookSlider, cls = '', kind = IMAGE_KIND) => {
    const paths = targets(kind.type);
    const look = tryLook(kind, paths);
    const b0 = first(kind.type);
    let picked = false;
    const restore = () => { if (!picked) look.restore(); };
    const tryFn = (fn: (b: Block) => Block) => { if (!picked) look.tryOn(fn); };
    const fnOf = (o: LookOption) => o.fn ?? ((b: Block) => ({ ...b, ...o.patch }));
    const options = sections.flatMap((s) => s.options);
    const tile = (o: LookOption) => `<button type="button" class="st-flt${o.on ? ' on' : ''}" data-lk="${options.indexOf(o)}" title="${esc(o.label)}">`
      + `${kind.sample((o.sample ?? o.fn)?.({ ...(b0 ?? {}) } as Block) ?? { ...(b0 ?? {}), ...(o.preview ?? o.patch) } as Block)}<span>${esc(o.label)}</span></button>`;
    const grids = sections.map((s) => `${s.title ? `<h4>${esc(s.title)}</h4>` : ''}<div class="st-flt-grid${s.cls ? ` ${s.cls}` : ''}">${s.options.map(tile).join('')}</div>`).join('');
    const range = slider ? `<div class="st-adj"><label${slider.off ? ` title="${esc(slider.off)}"` : ''}><span>${esc(slider.label)}</span><input type="range" min="${slider.min}" max="${slider.max}" step="1" value="${slider.value}" data-lkr="1" aria-label="${esc(slider.label)}"${slider.off ? ' disabled' : ''}><output>${slider.value}${slider.unit}</output></label></div>` : '';
    const pop = showPopover(at, `<div class="st-flt-pop">${grids}${range}</div>`, (b) => {
      const i = b.dataset.lk;
      if (i === undefined) return null;
      return { run: () => { restore(); picked = true; options[Number(i)].pick(); } };
    }, `st-fltpop st-lkpop ${cls}`.trim());
    const hovered = (e: Event) => (e.target as Element).closest<HTMLElement>('[data-lk]');
    pop.addEventListener('pointerover', (e) => { const b = hovered(e); if (b) tryFn(fnOf(options[Number(b.dataset.lk)])); });
    pop.addEventListener('pointerout', (e) => { if (hovered(e) && !(e.relatedTarget as Element | null)?.closest?.('[data-lk]')) restore(); });
    pop.addEventListener('pointerleave', restore);
    pop.addEventListener('focusin', (e) => { const b = hovered(e); if (b) tryFn(fnOf(options[Number(b.dataset.lk)])); });
    pop.addEventListener('input', (e) => {
      const r = e.target as HTMLInputElement;
      if (!slider || !r.dataset.lkr) return;
      r.nextElementSibling!.textContent = `${r.value}${slider.unit}`;
      const v = slider.set(Number(r.value));
      tryFn(slider.fn ? (b) => slider.fn!(b, v) : (b) => ({ ...b, [slider.key]: v }));
    });
    pop.addEventListener('change', (e) => {
      const r = e.target as HTMLInputElement;
      if (!slider || !r.dataset.lkr) return;
      const v = slider.set(Number(r.value));
      if (slider.write) slider.write(v);
      else ed.commit((d) => paths.forEach((p) => setAt(d, [...p, slider.key], v)), { rebuild: true, merge: `${kind.type}-${slider.key}` });
      look.forget();
    });
    const mo = new MutationObserver(() => { if (!pop.isConnected) { mo.disconnect(); restore(); } });
    mo.observe(document.body, { childList: true });
  };
  /** Одно поле: тень, скругление, прозрачность, паспарту, поворот (cls «f» — пять образцов в ряд) */
  const lookGallery = (cmd: string, key: string, options: [unknown, string][],
    slider?: { label: string; min: number; max: number; unit: string; get: (v: unknown) => number; set: (n: number) => unknown }, cls?: string, kind = IMAGE_KIND) => {
    const cur = first(kind.type)?.[key];
    lookPopover(anchor(cmd), [{ cls, options: options.map(([v, label]) => ({ label, patch: { [key]: v }, on: cur === v, pick: () => setAll(kind.type, key, v) })) }],
      slider && { ...slider, key, value: slider.get(cur) }, '', kind);
  };
  /**
   * Тень и свечение с ленты — готовые варианты; подкрутка — в «Свойствах» (fx-panel.ts). Готовая тень и «Без …»
   * начинают с чистого листа (своя подкрутка сбрасывается), другой цвет свечения — с прежними размером и яркостью
   */
  const fxGallery = (cmd: string, key: 'shadow' | 'glow', options: [unknown, string][], kind: LookKind, cls?: string) => {
    const cur = first(kind.type)?.[key];
    const tune: readonly string[] = key === 'shadow' ? SHADOW_TUNE : ['glowSize', 'glowOpacity'];
    const patchOf = (v: unknown) => ({ [key]: v, ...(key === 'shadow' || v === undefined ? Object.fromEntries(tune.map((k) => [k, undefined])) : {}) });
    lookPopover(anchor(cmd), [{ cls, options: options.map(([v, label]): LookOption => ({
      label, patch: patchOf(v), on: cur === v && (key !== 'shadow' || v === undefined || !shadowTuned(first(kind.type))),
      pick: () => { const paths = targets(kind.type); ed.commit((d) => paths.forEach((p) => Object.entries(patchOf(v)).forEach(([k, x]) => setAt(d, [...p, k], x))), { rebuild: true }); },
    })) }], undefined, '', kind);
  };
  /** Цвета свечения — те же, что в «Свойствах» */
  const GLOWS: [unknown, string][] = [[undefined, 'Без свечения'], ...B_GLOW_COLORS];
  /** Все стили рисунка: рамка и тень, растворение и сколько снимка тает */
  const stylesGallery = () => {
    const b0 = first('image');
    const opt = (st: (typeof IMAGE_STYLES)[number]): LookOption => ({ label: st.name, patch: stylePatch(st), on: !!b0 && styleOn(st, b0), pick: () => cmds[`image.style.${st.id}`].run() });
    const at = anchor('image.styles');
    lookPopover(at.closest<HTMLElement>('.st-gallery') ?? at, [
      { title: 'Рамка и тень', options: IMAGE_STYLES.filter((s) => !s.props.fade).map(opt) },
      { title: 'Растворение', cls: 'f', options: IMAGE_STYLES.filter((s) => s.props.fade).map(opt) },
    ], { label: 'Растворяется', min: 10, max: 90, unit: ' %', key: 'fadeSize', value: Number(b0?.fadeSize) || 50, set: (n) => (n === 50 ? undefined : n), off: b0?.fade ? undefined : 'Сначала выберите, с какой стороны снимок тает' }, 'st-stpop');
  };
  const isImage = () => targets('image').length > 0 && targets('image').every((p) => { const b = getAt(deck, p) as Block; return !!(b.src ?? b.image); });

  // ---------- рисунок: кадры (картинка с кадрами, frames.ts) ----------
  const frameBlock = () => (targets('image').length === 1 && isImage() ? targets('image')[0] : null);
  const frameCount = () => { const p = frameBlock(); return p ? frameList(getAt(deck, p) as Block).length : 0; };
  /** Открытый кадр — его убирают и переставляют */
  const frameNow = () => { const p = frameBlock(); return p ? shownFrame(p, frameCount()) : 0; };
  /** Правка кадров; d — куда сдвинулся открытый кадр (он и остаётся открытым) */
  const frameEdit = (edit: (b: Block, k: number) => void, d = 0) => {
    const p = frameBlock();
    if (!p) return;
    const k = frameNow();
    showFrame(p, k + d);
    ed.commit((x) => edit(getAt(x, p) as Block, k), { rebuild: true });
  };

  /** Как вписаны снимки: у всех кадров одинаково (заполнить, целиком, целиком на размытом фоне) */
  type FitMode = 'cover' | 'contain' | 'blur';
  const fitMode = (b: Block): FitMode => {
    const list = frameList(b);
    const contain = list.length > 0 && list.every((f) => f.fit === 'contain');
    return contain ? (b.fitBlur === true ? 'blur' : 'contain') : 'cover';
  };
  const setFit = (b: Block, m: FitMode) => {
    const list = frameList(b).map((f) => {
      const { fit: _fit, ...rest } = f;
      return m === 'cover' ? rest : { ...rest, fit: 'contain' };
    });
    if (list.length) setFrameList(b, list);
    if (m === 'blur') b.fitBlur = true;
    else delete b.fitBlur;
  };
  const fitMenu = () => {
    const paths = targets('image').filter((p) => (getAt(deck, p) as Block).type === 'image');
    const cur = paths.length ? fitMode(getAt(deck, paths[0]) as Block) : 'cover';
    const item = (m: FitMode, ic: string, label: string, sub: string) => ({
      label, sub, icon: ic, checked: cur === m,
      run: () => ed.commit((d) => paths.forEach((p) => setFit(getAt(d, p) as Block, m)), { rebuild: true }),
    });
    showMenu(anchor('image.fit'), [
      item('cover', 'cover', 'Заполнить рамку', 'Края обрезаются, сдвинуть — «Кадр»'),
      item('contain', 'contain', 'Целиком', 'Без обрезки, по краям поля'),
      item('blur', 'fit-blur', 'Целиком на размытом фоне', 'Поля — тот же снимок, размытый'),
    ]);
  };

  /** Несколько картинок выделено — их можно собрать кадрами одной */
  const joinable = () => { const ps = targets('image'); return ps.length > 1 && isImage() && ps.every((p) => (getAt(deck, p) as Block).type === 'image'); };
  const joinImages = () => {
    const sel = ed.selection;
    if (!sel || !joinable()) return;
    // По порядку чтения: сверху вниз, в ряду — слева направо
    const paths = [...targets('image')].map((p) => ({ p, pl: placeOf(getAt(deck, p) as Block) }))
      .sort((a, b) => (Math.abs(a.pl.y - b.pl.y) > 40 ? a.pl.y - b.pl.y : a.pl.x - b.pl.x)).map((x) => x.p);
    const [main, ...rest] = paths;
    // Удаляются с конца списка: номера остальных не сдвигаются
    const gone = [...rest].sort((a, b) => Number(b.at(-1)) - Number(a.at(-1)));
    const shift = gone.filter((p) => JSON.stringify(p.slice(0, -1)) === JSON.stringify(main.slice(0, -1)) && Number(p.at(-1)) < Number(main.at(-1))).length;
    // Снимки разной формы: целиком на размытом фоне, а не обрезанные под первый
    const ratio = (p: Path) => {
      const img = [...h.stage().querySelectorAll<HTMLElement>('.slide.on [data-block]')].find((x) => x.getAttribute('data-block') === JSON.stringify(p))?.querySelector('img');
      return img?.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0;
    };
    const rs = paths.map(ratio).filter((r) => r > 0);
    const mixed = rs.length > 1 && Math.max(...rs) / Math.min(...rs) > 1.15;
    ed.clearSelection();
    ed.commit((d) => {
      joinFrames(getAt(d, main) as Block, rest.map((p) => getAt(d, p) as Block));
      if (mixed) setFit(getAt(d, main) as Block, 'blur');
      for (const p of gone) (getAt(d, p.slice(0, -1)) as unknown[]).splice(Number(p.at(-1)), 1);
    }, { rebuild: true });
    if (main[2] === 'free') ed.selectFree(Number(main[1]), Number(main.at(-1)) - shift);
  };

  // ---------- фигура: текст ----------
  const textStyle = (b: Block | null) => ((b?.styles as Record<string, Record<string, unknown>> | undefined)?.text ?? {});
  const hasText = () => isBody() && targets('shape').some((p) => !!(getAt(deck, p) as Block).text);
  const setText = (key: string, value: unknown) => {
    const paths = targets('shape');
    ed.commit((d) => paths.forEach((p) => {
      const b = getAt(d, p) as Block;
      if (isLine(b)) return;
      setAt(d, [...p, 'styles', 'text', key], clean(value));
      const st = b.styles as Record<string, Record<string, unknown>> | undefined;
      if (st?.text && !Object.keys(st.text).length) delete st.text;
      if (st && !Object.keys(st).length) delete b.styles;
    }), { rebuild: true });
  };
  const fontStep = (dir: 1 | -1) => {
    const cur = Number(textStyle(first('shape')).size) || 18;
    const next = dir > 0 ? FONT_STEPS.find((s) => s > cur) ?? cur : [...FONT_STEPS].reverse().find((s) => s < cur) ?? cur;
    setText('size', next === 18 ? undefined : next);
  };
  const editShapeText = () => {
    const p = targets('shape')[0];
    const b = first('shape');
    if (!p || !b) return;
    if (!b.text) ed.commit((d) => setAt(d, [...p, 'text'], 'Текст'), { rebuild: true });
    requestAnimationFrame(() => {
      const el = h.stage().querySelector<HTMLElement>(`[data-edit="${CSS.escape(JSON.stringify([...p, 'text']))}"]`);
      if (el) ed.editField(el, { keep: true, selectAll: true });
    });
  };

  // ---------- таблица: ячейка с курсором и выделенный диапазон ячеек (table-cells) ----------
  const cells = tableCells({ deck: () => deck, editor: () => ed, stage: h.stage, refresh: h.refresh });
  let lastCell: { table: string; r: number; c: number } | null = null;
  const tableKey = () => JSON.stringify(targets('table')[0] ?? null);
  const cell = (): { r: number; c: number } => {
    const key = tableKey();
    const editing = cellOf(ed.editingField);
    if (editing?.table === key) return editing;
    const a = cellAnchor();
    if (a?.table === key) return a;
    const t = first('table');
    const rows = (t?.rows as unknown[][] | undefined) ?? [];
    if (lastCell?.table === key) return lastCell;
    return { r: rows.length - 1, c: Math.max(0, ((t?.header as unknown[]) ?? rows[0] ?? []).length - 1) };
  };
  /** Выделенные ячейки или одна — с курсором */
  const span = (): CellRange => {
    const r = cellRange();
    if (r && r.table === tableKey()) return r;
    const at = cell();
    return { table: tableKey(), r0: at.r, r1: at.r, c0: at.c, c1: at.c };
  };
  // Первое нажатие на ещё не выделенную таблицу (дальше ячейки ведёт table-cells)
  h.stage().addEventListener('pointerdown', (e) => {
    const at = cellOf(e.target as Element);
    if (at) lastCell = at;
  }, true);

  type TableData = { header?: unknown[]; rows: unknown[][]; widths?: number[]; align?: string[]; fills?: unknown[][]; headFills?: unknown[] } & Record<string, unknown>;
  const editTable = (fn: (t: TableData, at: CellRange) => void) => {
    const p = targets('table')[0];
    if (!p) return;
    const at = span();
    ed.commit((d) => {
      const t = getAt(d, p) as TableData;
      t.rows = Array.isArray(t.rows) ? t.rows : [];
      fn(t, at);
      // Заливка без единого цвета не хранится
      if (Array.isArray(t.fills) && !t.fills.some((r) => Array.isArray(r) && r.some((v) => v))) delete t.fills;
      if (Array.isArray(t.headFills) && !t.headFills.some((v) => v)) delete t.headFills;
    }, { rebuild: true });
  };
  const cols = colCount;
  const many = (n: number, what: [string, string, string]) => (n > 1 ? `${what[1]} (${n})` : what[0]);
  const addRow = (below: boolean) => editTable((t, at) => {
    const n = at.r1 - Math.max(0, at.r0) + 1;
    const i = Math.max(0, Math.min(t.rows.length, below ? at.r1 + 1 : Math.max(0, at.r0)));
    t.rows.splice(i, 0, ...Array.from({ length: n }, () => Array.from({ length: cols(t) }, () => '')));
    shiftMerges(t, 0, i, n);
    if (Array.isArray(t.fills) && t.fills.length > i) t.fills.splice(i, 0, ...Array.from({ length: n }, () => []));
    // Выделенная строка остаётся той же строкой данных
    if (Number.isInteger(t.highlight) && Number(t.highlight) >= i) t.highlight = Number(t.highlight) + n;
    cells.select(null);
    lastCell = null;
  });
  const addCol = (right: boolean) => editTable((t, at) => {
    const n = at.c1 - at.c0 + 1;
    const i = right ? at.c1 + 1 : at.c0;
    const have = cols(t);
    const avg = Array.isArray(t.widths) ? Math.round((t.widths.reduce((a, b) => a + Number(b), 0) / t.widths.length) * 100) / 100 : 0;
    t.header?.splice(i, 0, ...Array.from({ length: n }, () => 'Столбец'));
    t.rows.forEach((r) => { while (r.length < have) r.push(''); r.splice(i, 0, ...Array.from({ length: n }, () => '')); });
    // Новый столбец — средней ширины среди остальных
    if (Array.isArray(t.widths)) t.widths.splice(i, 0, ...Array.from({ length: n }, () => avg));
    if (Array.isArray(t.align)) t.align.splice(i, 0, ...Array.from({ length: n }, () => ''));
    if (Array.isArray(t.columns)) t.columns.splice(i, 0, ...Array.from({ length: n }, () => null));
    shiftMerges(t, 1, i, n);
    for (const list of [t.headFills, ...(Array.isArray(t.fills) ? t.fills : [])]) if (Array.isArray(list) && list.length > i) list.splice(i, 0, ...Array.from({ length: n }, () => null));
    cells.select(null);
    lastCell = null;
  });
  const delRow = () => editTable((t, at) => {
    dropRows(t, at.r0, at.r1);
    cells.select(null);
    lastCell = null;
  });
  const delCol = () => editTable((t, at) => {
    dropCols(t, at.c0, at.c1);
    cells.select(null);
    lastCell = null;
  });
  /** Заливка выделенных ячеек: цвет темы, свой #RRGGBB или undefined — как у таблицы */
  const fillCells = (v: string | undefined) => editTable((t, at) => paintCells(t, at, v));
  const paintCells = (t: TableData, at: CellRange, v: string | undefined) => {
    for (let r = at.r0; r <= at.r1; r++) {
      let row: unknown[];
      if (r < 0) row = Array.isArray(t.headFills) ? t.headFills : (t.headFills = []);
      else {
        const fills = Array.isArray(t.fills) ? t.fills : (t.fills = []);
        while (fills.length <= r) fills.push([]);
        row = Array.isArray(fills[r]) ? fills[r] : (fills[r] = []);
      }
      for (let c = at.c0; c <= at.c1; c++) {
        while (row.length <= c) row.push(null);
        row[c] = v ?? null;
      }
    }
  };
  const fillOfCell = (): string | undefined => {
    const t = first('table') as TableData | null;
    const at = span();
    const v = at.r0 < 0 ? t?.headFills?.[at.c0] : (t?.fills?.[at.r0] as unknown[] | undefined)?.[at.c0];
    return typeof v === 'string' ? v : undefined;
  };
  const tableFill = () => {
    const cur = fillOfCell();
    const sw = (v: string, css: string, name: string) =>
      `<button type="button" class="st-psw${cur === v ? ' on' : ''}" data-v="${esc(v)}" style="--c:${css}" title="${esc(name)}" aria-label="${esc(name)}"></button>`;
    const theme = themeRow(cur);
    const html = `<button type="button" class="st-pnone${cur ? '' : ' on'}" data-v="none">${icon('close')}<span>Как у таблицы</span></button>
      <div class="st-plabel">Цвета темы</div><div class="st-pgrid">${theme}</div>
      <div class="st-plabel">Стандартные</div><div class="st-pgrid">${SHAPE_SWATCHES.map((c) => sw(c, c, c)).join('')}</div>
      <button type="button" class="st-pmore" data-v="custom"><i style="background:conic-gradient(#f87171, #fbbf24, #34d399, #60a5fa, #c084fc, #f87171)"></i><span>Другой цвет…</span></button>`;
    const pop = showPopover(anchor('table.fill'), html, (el) => {
      const v = el.dataset.v;
      if (v === 'custom') {
        return {
          run: () => {
            const input = document.createElement('input');
            input.type = 'color';
            if (cur && /^#[0-9a-f]{6}$/i.test(cur)) input.value = cur;
            input.addEventListener('change', () => fillCells(input.value.toUpperCase()));
            input.click();
          },
        };
      }
      return v ? { run: () => fillCells(v === 'none' ? undefined : v) } : null;
    });
    // Наведение на цвет — выделенные ячейки на слайде уже в нём
    const at = span();
    bindTry(pop, tryLook(TABLE_KIND, targets('table').slice(0, 1)), (el) => {
      const v = el.dataset.v;
      if (!v || v === 'custom') return null;
      return (b) => {
        const t = structuredClone(b) as unknown as TableData;
        paintCells(t, at, v === 'none' ? undefined : v);
        return t as unknown as Block;
      };
    });
  };
  /** Выделить строку, столбец или всю таблицу (как «Выделить» в PowerPoint) */
  const selectCells = (what: 'row' | 'col' | 'all') => {
    const t = first('table') as TableData | null;
    if (!t) return;
    const at = span();
    const top = Array.isArray(t.header) && t.head !== false ? -1 : 0;
    const last = { r: (t.rows?.length ?? 1) - 1, c: cols(t) - 1 };
    cells.select({
      table: at.table,
      r0: what === 'col' || what === 'all' ? top : at.r0,
      r1: what === 'col' || what === 'all' ? last.r : at.r1,
      c0: what === 'row' || what === 'all' ? 0 : at.c0,
      c1: what === 'row' || what === 'all' ? last.c : at.c1,
    });
  };
  /**
   * Подсветка того, что удалится: строки, столбцы или вся таблица — пока пункт меню под мышью.
   * Строка шапки — r = -1.
   */
  const killMark = (what: 'row' | 'col' | 'all', on: boolean) => {
    const box = h.stage().querySelector<HTMLElement>(`.slide.on [data-block="${CSS.escape(tableKey())}"]`);
    const tbl = box?.querySelector('table');
    if (!box || !tbl) return;
    box.querySelectorAll('.tbl-kill').forEach((x) => x.classList.remove('tbl-kill'));
    box.classList.remove('tbl-kill-all');
    if (!on) return;
    const at = span();
    if (what === 'all') box.classList.add('tbl-kill-all');
    else if (what === 'row') {
      if (at.r0 < 0) tbl.tHead?.querySelectorAll('th').forEach((x) => x.classList.add('tbl-kill'));
      for (let r = Math.max(0, at.r0); r <= at.r1; r++) tbl.tBodies[0]?.rows[r]?.querySelectorAll('td').forEach((x) => x.classList.add('tbl-kill'));
    }
    else [...tbl.rows].forEach((tr) => { for (let c = at.c0; c <= at.c1; c++) tr.cells[c]?.classList.add('tbl-kill'); });
  };
  /** Меню таблицы: правый щелчок по ячейке и кнопка «Удалить» на ленте (сортировка — только на ленте) */
  const tableItems = (withInsert: boolean): MenuEntry[] => {
    const t = first('table');
    const rows = ((t?.rows as unknown[]) ?? []).length;
    const at = span();
    const nr = Math.max(0, at.r1 - Math.max(0, at.r0) + 1);
    // Строки вместе с шапкой: удалить можно все, кроме последней (всю таблицу — «Удалить таблицу»)
    const head = at.r0 < 0 ? 1 : 0;
    const total = rows + (Array.isArray(t?.header) && t?.head !== false ? 1 : 0);
    const nc = at.c1 - at.c0 + 1;
    const nCols = cols({ header: t?.header as unknown[], rows: (t?.rows as unknown[][]) ?? [] });
    const range = cellRange()?.table === tableKey();
    return [
      ...(withInsert ? [
        { label: many(nr, ['Вставить строку сверху', 'Вставить строки сверху', '']), icon: 'row-above', run: () => addRow(false) },
        { label: many(nr, ['Вставить строку снизу', 'Вставить строки снизу', '']), icon: 'row-below', run: () => addRow(true) },
        { label: many(nc, ['Вставить столбец слева', 'Вставить столбцы слева', '']), icon: 'col-left', run: () => addCol(false) },
        { label: many(nc, ['Вставить столбец справа', 'Вставить столбцы справа', '']), icon: 'col-right', run: () => addCol(true) },
        null,
        ...(range ? [{ label: 'Очистить ячейки', icon: 'eraser', hint: 'Backspace', run: () => { fillCellsText(''); } }] : []),
        ...(multiCell() ? [{ label: 'Объединить ячейки', icon: 'cell-merge', run: mergeCells }] : []),
        { label: 'Разбить ячейку…', icon: 'cell-split', run: () => splitDialog(cellEl() ?? anchor('table.split')) },
        null,
      ] : []),
      { label: many(nr + head, ['Удалить строку', 'Удалить строки', '']), icon: 'row-del', disabled: nr + head >= total, run: delRow, preview: (on) => killMark('row', on) },
      { label: many(nc, ['Удалить столбец', 'Удалить столбцы', '']), icon: 'col-del', disabled: nCols < 2 || nc >= nCols, run: delCol, preview: (on) => killMark('col', on) },
      null,
      { label: 'Удалить таблицу', icon: 'trash', danger: true, run: () => h.run('obj.del'), preview: (on) => killMark('all', on) },
    ];
  };
  /** Куда границы: выделенные ячейки, ячейка с курсором; таблица только выделена — вся таблица */
  const borderRect = (): CellRange => {
    const t = first('table') as unknown as CellTable;
    const key = tableKey();
    const r = cellRange();
    if (r && r.table === key) return r;
    const at = cellOf(ed.editingField) ?? cellAnchor();
    if (at && at.table === key) return expandRange(t, { table: key, r0: at.r, r1: at.r, c0: at.c, c1: at.c });
    const top = Array.isArray(t.header) && t.head !== false ? -1 : 0;
    return { table: key, r0: top, r1: t.rows.length - 1, c0: 0, c1: colCount(t) - 1 };
  };
  /** Правила границ после выбора kind для диапазона at (null — «как в стиле»: правила, целиком внутри него, убираются) */
  const bordersWith = (raw: unknown, at: CellRange, kind: string | null) => {
    const list = Array.isArray(raw) ? (raw as (number | string)[][]) : [];
    const keep = list.filter((b) => !(Number(b[0]) >= at.r0 && Number(b[0]) + Number(b[2]) - 1 <= at.r1 && Number(b[1]) >= at.c0 && Number(b[1]) + Number(b[3]) - 1 <= at.c1));
    const next = kind ? [...keep, [at.r0, at.c0, at.r1 - at.r0 + 1, at.c1 - at.c0 + 1, kind]] : keep;
    return next.length ? next : undefined;
  };
  const setBorders = (kind: string | null) => {
    const at = borderRect();
    ed.finishText();
    editTable((t) => {
      const next = bordersWith(t.borders, at, kind);
      if (next) t.borders = next;
      else delete t.borders;
    });
  };
  /** Границы выделенных ячеек (или всей таблицы): образец — мини-таблица целиком, наведение — на самих ячейках */
  const bordersGallery = () => {
    const at = borderRect();
    const raw = first('table')?.borders;
    const kinds: [string | null, string][] = [['all', 'Все'], ['outer', 'Внешние'], ['inner', 'Внутренние'], ['bottom', 'Нижняя'], ['none', 'Без границ'], [null, 'Как в стиле']];
    lookPopover(anchor('table.borders'), [{ cls: 't3', options: kinds.map(([k, label]) => ({
      label, patch: { borders: bordersWith(raw, at, k) }, preview: { borders: k ? [[-1, 0, 4, 3, k]] : undefined }, on: false, pick: () => setBorders(k),
    })) }], undefined, '', TABLE_KIND);
  };
  const sortBy = (desc: boolean) => {
    const c = cell().c;
    ed.finishText();
    let err: string | null = null;
    editTable((t) => { err = sortRows(t as unknown as CellTable, c, desc); });
    if (err) ed.toast(err, 3500);
    cells.select(null);
  };
  const sortItems = (): MenuEntry[] => [
    { label: 'По возрастанию (А→Я, 1→9)', icon: 'sort', run: () => sortBy(false) },
    { label: 'По убыванию (Я→А, 9→1)', icon: 'sort', run: () => sortBy(true) },
  ];
  /** Выровнять высоту строк: все — по средней (шапка как есть) */
  const equalRows = () => {
    const p = targets('table')[0];
    const tbl = p ? h.stage().querySelector<HTMLTableElement>(`.slide.on [data-block="${CSS.escape(JSON.stringify(p))}"] table`) : null;
    const rows = tbl ? [...(tbl.tBodies[0]?.rows ?? [])] : [];
    if (!rows.length) return;
    const avg = Math.round(rows.reduce((a, r) => a + r.offsetHeight, 0) / rows.length);
    editTable((t) => { t.heights = t.rows.map(() => avg); });
  };
  const multiCell = () => { const r = span(); return r.r0 !== r.r1 || r.c0 !== r.c1; };
  const mergeCells = () => {
    let err: string | null = null;
    editTable((t, at) => { err = mergeRange(t, at); });
    if (err) ed.toast(err, 2500);
    else { const r = span(); cells.select({ ...r, r1: r.r0, c1: r.c0 }); }
  };
  /** Ячейка с курсором на слайде — к ней окошко «Разбиение ячеек» из меню */
  const cellEl = () => {
    const p = targets('table')[0];
    const at = cell();
    return p ? h.stage().querySelector<HTMLElement>(`.slide.on [data-edit="${CSS.escape(JSON.stringify([...p, ...(at.r < 0 ? ['header'] : ['rows', at.r]), at.c]))}"]`) : null;
  };
  const splitCells = () => editTable((t, at) => { splitRange(t, at); });
  /**
   * «Разбиение ячеек», как в PowerPoint: число столбцов и строк. Объединённая ячейка — по умолчанию
   * её размер (просто разъединить); в диапазоне несколько объединённых — разъединяются все
   */
  const splitDialog = (at: HTMLElement | { x: number; y: number }) => {
    const t = first('table') as unknown as CellTable | null;
    const r = span();
    const c0 = cell();
    const many = (r.r0 !== r.r1 || r.c0 !== r.c1) && hasMerge(t ?? undefined, r) && !(cellSpan(t ?? undefined, r.r0, r.c0)[0] === r.r1 - r.r0 + 1 && cellSpan(t ?? undefined, r.r0, r.c0)[1] === r.c1 - r.c0 + 1);
    if (many) return splitCells();
    const [rs, cs] = cellSpan(t ?? undefined, c0.r, c0.c);
    const merged = rs * cs > 1;
    const html = `<div class="st-splitf">
      <label><span>Число столбцов</span><input type="number" data-k="cols" min="1" max="12" value="${merged ? cs : 2}"></label>
      <label><span>Число строк</span><input type="number" data-k="rows" min="1" max="12" value="${merged ? rs : 1}"${c0.r < 0 ? ' disabled title="Шапку — только на столбцы"' : ''}></label>
      <div class="st-splitf-ok"><button type="button" class="btn primary small" data-v="ok">Разбить</button></div></div>`;
    const pop = showPopover(at as HTMLElement, html, (b) => {
      if (b.dataset.v !== 'ok') return null;
      const val = (k: string) => Math.max(1, Math.min(12, Math.round(Number(b.closest('.st-pop')!.querySelector<HTMLInputElement>(`[data-k="${k}"]`)!.value) || 1)));
      const cols = val('cols');
      const rows = val('rows');
      return {
        run: () => {
          let err: string | null = null;
          editTable((tt) => { err = splitCell(tt as unknown as CellTable, c0.r, c0.c, cols, rows); });
          if (err) ed.toast(err, 2500);
          cells.select(null);
        },
      };
    });
    const first0 = pop.querySelector<HTMLInputElement>('input');
    first0?.focus();
    first0?.select();
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); pop.querySelector<HTMLButtonElement>('[data-v="ok"]')?.click(); }
    });
  };
  /** Текст выделенных ячеек (очистить — пустая строка) */
  const fillCellsText = (v: string) => editTable((t, at) => {
    for (let r = at.r0; r <= at.r1; r++) {
      const row = r < 0 ? t.header : t.rows[r];
      if (Array.isArray(row)) for (let c = at.c0; c <= at.c1 && c < row.length; c++) row[c] = v;
    }
  });
  tableMenuFn = () => (isTable() ? tableItems(true) : []);

  /** Выравнивание столбца с курсором: заданное или то, что таблица выбрала сама (числа — вправо) */
  const colAlign = (): string => {
    const t = first('table');
    const c = cell().c;
    const set = Array.isArray(t?.align) ? (t.align as string[])[c] : '';
    if (set) return set;
    const td = h.stage().querySelector(`[data-block="${CSS.escape(JSON.stringify(targets('table')[0]))}"] tr > :nth-child(${c + 1})`);
    return td?.classList.contains('a-right') ? 'right' : td?.classList.contains('a-center') ? 'center' : 'left';
  };

  // ---------- надпись: оформление всего текста выделенных надписей (вкладка «Надпись», text-tab.ts) ----------
  const isText = () => targets('text').length > 0;
  /** Только свободные надписи: поворот и место текста в рамке — у них */
  const freeText = () => isText() && targets('text').every((p) => p[2] === 'free');
  const tst = (b: Block | null | undefined): TextStyle => ((b?.styles as Record<string, TextStyle> | undefined)?.text ?? {});
  const tidy = (st: TextStyle): TextStyle => Object.fromEntries(Object.entries(st).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)) as TextStyle;
  /** Надпись с другим оформлением текста — для примерки и образцов */
  const withStyle = (b: Block, st: TextStyle): Block => ({ ...b, styles: { ...((b.styles as Record<string, unknown>) ?? {}), text: tidy(st) } });
  /** Оформление текста всех выделенных надписей: fn — новое по прежнему (у каждой — своё прежнее) */
  const editText = (fn: (st: TextStyle) => TextStyle, merge?: string) => {
    const paths = targets('text');
    if (!paths.length) return;
    ed.commit((d) => paths.forEach((p) => {
      const b = getAt(d, p) as Block;
      const next = tidy(fn({ ...tst(b) }));
      const styles = { ...((b.styles as Record<string, unknown>) ?? {}) };
      if (Object.keys(next).length) styles.text = next;
      else delete styles.text;
      if (Object.keys(styles).length) b.styles = styles;
      else delete b.styles;
    }), { rebuild: true, ...(merge ? { merge } : {}) });
  };
  const setTx = (patch: TextStyle) => editText((st) => ({ ...st, ...patch }));
  const tx0 = () => tst(first('text'));
  /** Текст надписей на слайде (для примерки шрифта и вычисленного вида) */
  const textEls = () => targets('text').flatMap((p) => [...h.stage().querySelectorAll<HTMLElement>(`.slide.on [data-block='${JSON.stringify(p)}']`)]);
  const shown = () => { const el = textEls()[0]; return el ? getComputedStyle(el) : null; };
  /** Надпись: оформление — style самого текста, поворот — у рамки свободного объекта */
  const TEXT_KIND: LookKind = {
    type: 'text',
    el: (root) => root,
    parts: (el) => (el.parentElement?.classList.contains('free') ? [el.parentElement] : []),
    apply: (el, b) => {
      const n = blockEl('text', b);
      if (n) put(el, n.getAttribute('style'));
      const box = el.parentElement;
      if (box?.classList.contains('free')) box.style.rotate = angleOf(b) ? `${angleOf(b)}deg` : '';
    },
    sample: (b) => textSampleHtml(tst(b), angleOf(b)),
  };
  /** Окно вариантов оформления текста: образец на каждом, наведение — примерка на всех выделенных */
  type TxOption = [label: string, edit: (st: TextStyle) => TextStyle, on: boolean];
  const txPopover = (cmd: string, sections: { title?: string; cls?: string; options: TxOption[] }[], slider?: Omit<LookSlider, 'fn' | 'write'> & { put(st: TextStyle, v: unknown): TextStyle }, cls = '') => {
    // Образцы тени, свечения, контура — без плашки: на ней эффекты букв не разглядеть (на слайде примерка — как есть)
    const bare = (st: TextStyle): TextStyle => (cmd === 'text.plate' || !st.plate ? st : { ...st, plate: undefined, color: st.color === '#FFFFFF' ? undefined : st.color });
    lookPopover(anchor(cmd), sections.map((sec) => ({
      ...sec,
      options: sec.options.map(([label, edit, on]) => ({
        label, patch: {}, on, pick: () => editText(edit),
        fn: (b: Block) => withStyle(b, edit({ ...tst(b) })),
        sample: (b: Block) => withStyle(b, bare(edit({ ...tst(b) }))),
      })),
    })), slider && { ...slider, fn: (b, v) => withStyle(b, slider.put({ ...tst(b) }, v)), write: (v) => editText((st) => slider.put(st, v), `text-${slider.key}`) }, cls, TEXT_KIND);
  };
  const set = (patch: TextStyle) => (st: TextStyle): TextStyle => ({ ...st, ...patch });
  /** Цвета эффектов: цвета темы, светлый акцент, фон карточек и постоянные */
  const FX_SWATCH: [string, string][] = [['accent', 'Акцент'], ['accent2', 'Тёмный акцент'], ['text', 'Цвет текста'], ['soft', 'Светлый акцент'], ['surface', 'Цвет фона'], ['#FFFFFF', 'Белый'], ['#111827', 'Чёрный'], ['#FDE047', 'Жёлтый'], ['#22D3EE', 'Голубой'], ['#F472B6', 'Розовый']];
  const shadowMenu = () => {
    const cur = tx0().shadow;
    const tuned = shadowTuned(tx0());
    // Готовая тень — с чистого листа: свои ручки («Свойства») сбрасываются
    const fresh = Object.fromEntries(SHADOW_TUNE.map((k) => [k, undefined]));
    txPopover('text.shadow', [{ options: [['Без тени', set({ shadow: undefined, ...fresh }), !cur], ...Object.entries(TEXT_SHADOWS).map(([k, v]): TxOption => [v.name, set({ shadow: k, ...fresh }), cur === k && !tuned])] }], undefined, 'st-txpop');
  };
  const glowMenu = () => {
    const cur = tx0().glow;
    txPopover('text.glow', [{ cls: 'f', options: [['Без свечения', set({ glow: undefined, glowSize: undefined, glowOpacity: undefined }), !cur], ...FX_SWATCH.filter(([v]) => v !== 'soft' && v !== 'surface').map(([v, l]): TxOption => [l, set({ glow: v }), cur === v])] }], undefined, 'st-txpop');
  };
  const outlineMenu = () => {
    const st = tx0();
    const w = Number(st.outline) || 0;
    // Контур появляется вместе с цветом или видом: без толщины его не видно
    const withW = (patch: TextStyle) => (x: TextStyle): TextStyle => ({ ...x, ...patch, outline: Number(x.outline) || 2 });
    txPopover('text.outline', [
      { title: 'Толщина', cls: 'f', options: [['Без контура', set({ outline: undefined, outlineColor: undefined, hollow: undefined }), !w && !st.hollow], ...[1, 2, 3, 5].map((n): TxOption => [`${n} px`, (x) => ({ ...x, outline: n }), w === n])] },
      { title: 'Цвет', cls: 'f', options: FX_SWATCH.filter(([v]) => v !== 'soft').map(([v, l]): TxOption => [l, withW({ outlineColor: v }), !!w && (st.outlineColor ?? 'accent') === v]) },
      { title: 'Буквы', cls: 't3', options: [['С заливкой', (x) => ({ ...x, hollow: undefined }), !st.hollow], ['Только контур', withW({ hollow: true }), !!st.hollow]] },
    ], undefined, 'st-txpop');
  };
  const plateMenu = () => {
    const st = tx0();
    const cur = st.plate;
    // Плашка подбирает цвет текста, а без плашки подобранный цвет уходит — текст не пропадает на фоне
    const auto = new Set(['#FFFFFF', '#111827', 'accent2']);
    const plate = (v: string | undefined, color?: string) => (x: TextStyle): TextStyle => ({ ...x, plate: v, color: color ?? (auto.has(String(x.color)) ? undefined : x.color), hollow: undefined, ...(v ? {} : { plateRadius: undefined, platePad: undefined }) });
    txPopover('text.plate', [{ options: [
      ['Без плашки', plate(undefined), !cur],
      ['Акцент', plate('accent', '#FFFFFF'), cur === 'accent'],
      ['Светлая', plate('soft', 'accent2'), cur === 'soft'],
      ['Цвет фона', plate('surface'), cur === 'surface'],
      ['Тёмная', plate('#111827', '#FFFFFF'), cur === '#111827'],
      ['Жёлтая', plate('#FDE047', '#111827'), cur === '#FDE047'],
      ['Красная', plate('#DC2626', '#FFFFFF'), cur === '#DC2626'],
      ['Белая', plate('#FFFFFF', '#111827'), cur === '#FFFFFF'],
    ] }], undefined, 'st-txpop');
  };
  const opacityMenu = () => {
    const cur = tx0().opacity;
    txPopover('text.opacity', [{ cls: 'f', options: CLEAR_STEPS.map(([v, l]): TxOption => [l, set({ opacity: v }), cur === v]) }],
      { label: 'Своя', ...CLEAR_SLIDER, key: 'opacity', value: CLEAR_SLIDER.get(cur), put: (st, v) => ({ ...st, opacity: v as number | undefined }) }, 'st-txpop');
  };
  /** Поворот свободной надписи — у её рамки (angle), как ручкой поворота на слайде */
  const rotateMenu = () => {
    const cur = angleOf(first('text'));
    lookPopover(anchor('text.rotate'), [{ cls: 'f', options: ([[0, 'Без поворота'], [-90, '−90°'], [-45, '−45°'], [-15, '−15°'], [15, '15°'], [45, '45°'], [90, '90°'], [180, '180°']] as [number, string][])
      .map(([v, label]) => ({ label, patch: { angle: v || undefined }, on: cur === v, pick: () => setAll('text', 'angle', v || undefined) })) }],
    { label: 'Свой, °', min: -180, max: 180, unit: '°', key: 'angle', value: cur, set: (n) => n || undefined }, 'st-txpop', TEXT_KIND);
  };
  const stepMenu = (cmd: string, key: 'leading' | 'spacing', list: [number | undefined, string][]) => {
    const cur = tx0()[key];
    showMenu(anchor(cmd), list.map(([v, label]) => ({ label, checked: cur === v, run: () => setTx({ [key]: v }) })));
  };
  /** Шрифт всего текста: тот же список, что у панели «Текст»; наведение — примерка на всех выделенных */
  const fontMenu = () => {
    const head: FontItem[] = [{ value: '', label: 'Шрифт темы', css: 'inherit', group: 'Шрифты темы' }, ...Object.entries(FONTS).map(([k, f]) => ({ value: k, label: f.name, css: f.css, group: 'Шрифты темы' }))];
    const els = textEls();
    fontPicker().toggle(anchor('text.font'), () => fontItems(head, ed.fontChoices(), fontStack), tx0().font ?? '', (v) => {
      els.forEach((el) => tryFontOn(el, 'font-family', null));
      setTx({ font: v || undefined });
      // Шрифт библиотеки или компьютера — копией в презентацию
      if (fontNameOk(v) && !FONTS[v]) void ed.ensureFont(v, Number(tx0().weight) || undefined);
    }, (f) => els.forEach((el) => tryFontOn(el, 'font-family', f ? (f.value ? f.css : '') : null)));
  };
  /** Цвет текста: цвета темы, постоянные, градиенты; наведение — примерка */
  const colorMenu = () => {
    const cur = tx0().color;
    const sw = (v: string, css: string, name: string) => `<button type="button" class="st-psw${cur === v ? ' on' : ''}" data-v="${esc(v)}" style="--c:${css}" title="${esc(name)}" aria-label="${esc(name)}"></button>`;
    const grads = GRADIENTS.filter((g) => TEXT_GRADIENTS.includes(g.id));
    const html = `<button type="button" class="st-pnone${!cur ? ' on' : ''}" data-v="">${icon('reset')}<span>Как в теме</span></button>
      <div class="st-plabel">Цвета темы</div><div class="st-pgrid">${Object.entries(THEME_COLORS).map(([v, c]) => sw(v, c.css, c.name)).join('')}</div>
      <div class="st-plabel">Стандартные</div><div class="st-pgrid">${SWATCHES.map((c) => sw(c, c, c)).join('')}</div>
      <div class="st-plabel">Градиент</div><div class="st-pgrid st-grads by8">${grads.map((g) => sw(`g:${g.id}`, gradientCss(g.g), g.name)).join('')}</div>
      <button type="button" class="st-pmore" data-v="custom"><i style="background:conic-gradient(#f87171, #fbbf24, #34d399, #60a5fa, #c084fc, #f87171)"></i><span>Другой цвет…</span></button>`;
    // Градиент и контурные буквы не вместе: градиент заливает буквы
    const paint = (v: string) => (x: TextStyle): TextStyle => ({ ...x, color: v || undefined, ...(v.startsWith('g:') ? { hollow: undefined, plate: undefined } : {}) });
    const pop = showPopover(anchor('text.color'), html, (el) => {
      const v = el.dataset.v;
      if (v === undefined) return null;
      if (v === 'custom') {
        return {
          run: () => {
            const input = document.createElement('input');
            input.type = 'color';
            if (typeof cur === 'string' && /^#[0-9a-f]{6}$/i.test(cur)) input.value = cur;
            input.addEventListener('change', () => editText(paint(input.value.toUpperCase())));
            input.click();
          },
        };
      }
      return { run: () => editText(paint(v)) };
    }, 'st-palette');
    bindTry(pop, tryLook(TEXT_KIND, targets('text')), (el) => {
      const v = el.dataset.v;
      return v === undefined || v === 'custom' ? null : (b) => withStyle(b, paint(v)({ ...tst(b) }));
    });
  };
  const sizeNow = () => Number(tx0().size) || Math.round(parseFloat(shown()?.fontSize ?? '') || 24);
  const sizeStep = (dir: 1 | -1) => {
    const steps = [...FONT_STEPS, 120, 160, 200];
    const cur = sizeNow();
    setTx({ size: dir > 0 ? steps.find((x) => x > cur) ?? cur : [...steps].reverse().find((x) => x < cur) ?? cur });
  };
  const boldNow = () => (Number(tx0().weight) || Number(shown()?.fontWeight) || 400) >= 600;
  const allStyles = () => {
    const st = tx0();
    const opt = (id: string): LookOption => {
      const l = TEXT_LOOKS.find((x) => x.id === id)!;
      return { label: l.name, patch: {}, on: lookOn(st, l), fn: (b) => withStyle(b, applyLook(tst(b), l)), pick: () => cmds[`text.style.${id}`].run() };
    };
    const at = anchor('text.styles');
    lookPopover(at.closest<HTMLElement>('.st-gallery') ?? at, LOOK_GROUPS.map(([title, ids]) => ({ title, options: ids.map(opt) })), undefined, 'st-txpop st-stpop', TEXT_KIND);
  };
  // Размер — числом в поле на ленте
  document.addEventListener('change', (e) => {
    const inp = e.target as HTMLInputElement;
    if (!inp.matches?.('.st-ribbon [data-txsize]')) return;
    const v = Math.round(Number(inp.value));
    if (v >= 6 && v <= 300) setTx({ size: v });
  });
  document.addEventListener('keydown', (e) => {
    const inp = e.target as HTMLInputElement;
    if (!inp.matches?.('.st-ribbon [data-txsize]')) return;
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); inp.dispatchEvent(new Event('change', { bubbles: true })); inp.blur(); }
  }, true);
  /** Выравнивание объектов — те же команды, что на «Главной» («Выровнять»): надписи часто выделяют именно для этого */
  const arrangeMenu = () => {
    const n = ed.selection?.group.length ?? 0;
    const it = (cmd: string, ic: string, label: string, off = false) => ({ label, icon: ic, disabled: off, run: () => h.run(cmd) });
    showMenu(anchor('text.arrange'), [
      { head: n > 1 ? 'Относительно друг друга' : 'По слайду' },
      it('align.left', 'obj-left', 'Слева'), it('align.center', 'obj-center', 'По центру'), it('align.right', 'obj-right', 'Справа'),
      null,
      it('align.top', 'obj-top', 'Сверху'), it('align.middle', 'obj-middle', 'Посередине'), it('align.bottom', 'obj-bottom', 'Снизу'),
      null,
      it('dist.h', 'dist-h', 'Равные промежутки по ширине', n < 3), it('dist.v', 'dist-v', 'Равные промежутки по высоте', n < 3),
    ]);
  };
  const textCmds: Record<string, Command> = {
    'text.arrange': { run: arrangeMenu, enabled: freeText },
    'text.styles': { run: allStyles, enabled: isText },
    'text.font': { run: fontMenu, enabled: isText },
    'text.size.up': { run: () => sizeStep(1), enabled: isText },
    'text.size.down': { run: () => sizeStep(-1), enabled: isText },
    'text.bold': { run: () => setTx({ weight: !boldNow() ? 700 : Number(tx0().weight) >= 600 ? undefined : 400 }), enabled: isText, active: () => isText() && boldNow() },
    'text.italic': { run: () => setTx({ italic: !tx0().italic || undefined }), enabled: isText, active: () => isText() && !!tx0().italic },
    'text.underline': { run: () => setTx({ underline: !tx0().underline || undefined }), enabled: isText, active: () => isText() && !!tx0().underline },
    'text.upper': { run: () => setTx({ upper: !tx0().upper || undefined }), enabled: isText, active: () => isText() && !!tx0().upper },
    'text.color': { run: colorMenu, enabled: isText },
    'text.clear': { run: () => editText(() => ({})), enabled: () => isText() && targets('text').some((p) => Object.keys(tst(getAt(deck, p) as Block)).length > 0) },
    'text.leading': { run: () => stepMenu('text.leading', 'leading', [[undefined, 'Как в теме'], [1, '1,0'], [1.15, '1,15'], [1.3, '1,3'], [1.5, '1,5'], [2, '2,0']]), enabled: isText },
    'text.spacing': { run: () => stepMenu('text.spacing', 'spacing', [[-0.03, 'Сжатый'], [undefined, 'Обычный'], [0.04, 'Разреженный'], [0.1, 'Широкий'], [0.2, 'Очень широкий']]), enabled: isText },
    'text.shadow': { run: shadowMenu, enabled: isText, active: () => isText() && !!tx0().shadow },
    'text.glow': { run: glowMenu, enabled: isText, active: () => isText() && !!tx0().glow },
    'text.outline': { run: outlineMenu, enabled: isText, active: () => isText() && (!!tx0().outline || !!tx0().hollow) },
    'text.plate': { run: plateMenu, enabled: isText, active: () => isText() && !!tx0().plate },
    'text.opacity': { run: opacityMenu, enabled: isText },
    'text.rotate': { run: rotateMenu, enabled: freeText },
  };
  for (const a of ['left', 'center', 'right', 'justify'] as const) {
    textCmds[`text.align.${a}`] = { run: () => setTx({ align: a === 'left' ? undefined : a }), enabled: isText, active: () => isText() && (tx0().align ?? 'left') === a };
  }
  // Место текста в рамке — у надписи с высотой (у растущей по тексту оно не видно)
  const framed = () => freeText() && targets('text').every((p) => !!placeOf(getAt(deck, p) as Block).h);
  for (const v of ['top', 'middle', 'bottom'] as const) {
    textCmds[`text.valign.${v}`] = { run: () => setAll('text', 'valign', v === 'top' ? undefined : v), enabled: framed, active: () => framed() && (first('text')?.valign ?? 'top') === v };
  }
  for (const l of TEXT_LOOKS) {
    textCmds[`text.style.${l.id}`] = { run: () => editText((st) => applyLook(st, l)), enabled: isText, active: () => isText() && lookOn(tx0(), l) };
  }
  const cmds: Record<string, Command> = {
    'shape.fill': { run: () => palette('shape.fill', 'fill'), enabled: isBody },
    'shape.stroke': { run: () => palette('shape.stroke', 'stroke'), enabled: isShape },
    // Фигуры PowerPoint: образцы — выделенная фигура в каждой форме, наведение примеряет форму на слайде
    'shape.kinds': {
      run: () => {
        const b0 = first('shape');
        const cur = b0?.kind;
        const opt = (k: string): LookOption => ({
          label: PRESET_KINDS[k].short ?? PRESET_KINDS[k].name, on: cur === k, pick: () => cmds[`shape.kind.${k}`].run(),
          patch: isLine(b0) ? { kind: k, fill: 'soft', width: undefined } : { kind: k },
          preview: { ...(isLine(b0) ? { fill: 'soft', width: undefined } : {}), kind: k, sample: 'form' },
        });
        lookPopover(anchor('shape.kinds'), [
          { title: 'Многоугольники и знаки', options: ['diamond', 'triangle', 'right-triangle', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'star', 'plus', 'heart', 'lightning', 'donut', 'cloud'].map(opt) },
          { title: 'Стрелки и выноски', options: ['block-arrow', 'double-arrow', 'chevron', 'pointer', 'callout', 'cylinder', 'brace'].map(opt) },
        ], undefined, 'st-kindpop', SHAPE_KIND);
      },
      enabled: isShape, active: () => isShape() && !!PRESET_KINDS[first('shape')?.kind as string],
    },
    'shape.shadow': { run: () => fxGallery('shape.shadow', 'shadow', [[undefined, 'Без тени'], ...Object.entries(IMAGE_SHADOWS).map(([v, s]) => [v, s.name] as [string, string])], SHAPE_KIND), enabled: isBody, active: () => isBody() && !!first('shape')?.shadow },
    'shape.glow': { run: () => fxGallery('shape.glow', 'glow', GLOWS, SHAPE_KIND, 'f'), enabled: isShape, active: () => isShape() && !!first('shape')?.glow },
    'shape.radius': {
      run: () => lookGallery('shape.radius', 'radius', [[0, 'Без скругления'], [8, 'Малое'], [undefined, 'Обычное'], [24, 'Большое'], [40, 'Очень большое']],
        { label: 'Своё, px', min: 0, max: 120, unit: ' px', get: (v) => (Number.isFinite(Number(v)) && v !== undefined ? Number(v) : first('shape')?.kind === 'rect' ? 0 : 16), set: (n) => n }, 'f', SHAPE_KIND),
      enabled: () => isShape() && ['round', 'rect', undefined].includes(first('shape')?.kind as string | undefined),
    },
    'shape.rotate': {
      run: () => lookGallery('shape.rotate', 'rotate', [[undefined, 'Без поворота'], [-90, '−90°'], [-45, '−45°'], [45, '45°'], [90, '90°'], [135, '135°'], [180, '180°']],
        { label: 'Свой, °', min: -180, max: 180, unit: '°', get: (v) => Number(v) || 0, set: (n) => n || undefined }, undefined, SHAPE_KIND),
      enabled: isShape,
    },
    'shape.opacity': {
      run: () => lookGallery('shape.opacity', 'opacity', CLEAR_STEPS, { label: 'Своя', ...CLEAR_SLIDER }, 'f', SHAPE_KIND),
      enabled: isShape,
    },
    'shape.text': { run: editShapeText, enabled: () => isBody() && targets('shape').length === 1 },
    'shape.font.up': { run: () => fontStep(1), enabled: hasText },
    'shape.font.down': { run: () => fontStep(-1), enabled: hasText },
    'shape.bold': {
      run: () => setText('weight', (Number(textStyle(first('shape')).weight) || 600) >= 600 ? 400 : undefined),
      enabled: hasText, active: () => hasText() && (Number(textStyle(first('shape')).weight) || 600) >= 600,
    },
    'image.stroke': { run: () => palette('image.stroke', 'stroke', 'image'), enabled: isImage },
    'image.mat': {
      run: () => lookGallery('image.mat', 'mat', [[undefined, 'Без паспарту'], [6, 'Узкое'], [12, 'Среднее'], [20, 'Широкое'], [32, 'Очень широкое']],
        { label: 'Своё, px', min: 0, max: 80, unit: ' px', get: (v) => Number(v) || 0, set: (n) => n || undefined }, 'f'),
      enabled: isImage,
    },
    'image.shadow': { run: () => fxGallery('image.shadow', 'shadow', [[undefined, 'Без тени'], ...Object.entries(IMAGE_SHADOWS).map(([v, s]) => [v, s.name] as [string, string])], IMAGE_KIND), enabled: isImage, active: () => isImage() && !!first('image')?.shadow },
    'image.glow': { run: () => fxGallery('image.glow', 'glow', GLOWS, IMAGE_KIND, 'f'), enabled: isImage, active: () => isImage() && !!first('image')?.glow },
    'image.radius': {
      run: () => lookGallery('image.radius', 'radius', [[0, 'Без скругления'], [6, 'Малое'], [undefined, 'Обычное'], [24, 'Большое'], [48, 'Очень большое'], ['oval', 'Овал'], ['circle', 'Круг']],
        { label: 'Своё, px', min: 0, max: 120, unit: ' px', get: (v) => (typeof v === 'number' ? v : v === 'circle' || v === 'oval' ? 120 : 12), set: (n) => n }),
      enabled: isImage,
    },
    // Обрезка по фигуре PowerPoint: образцы — снимок в каждой форме, наведение примеряет на слайде
    'image.shape': {
      run: () => {
        const cur = first('image')?.crop;
        const opt = (k: string | undefined): LookOption => ({
          label: k ? PRESET_KINDS[k].short ?? PRESET_KINDS[k].name : 'Без формы', on: cur === k, patch: { crop: k }, pick: () => setAll('image', 'crop', k),
        });
        lookPopover(anchor('image.shape'), [
          { options: [undefined, 'diamond', 'triangle', 'right-triangle', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'star', 'plus', 'heart', 'lightning', 'donut', 'cloud'].map(opt) },
          { title: 'Стрелки и выноски', options: ['block-arrow', 'double-arrow', 'chevron', 'pointer', 'callout'].map(opt) },
        ], undefined, 'st-kindpop', IMAGE_KIND);
      },
      enabled: isImage, active: () => isImage() && !!PRESET_KINDS[first('image')?.crop as string],
    },
    'image.filter': { run: () => filterGallery(), enabled: isImage },
    'image.grade': {
      run: () => { const p = targets('image')[0]; if (p) void import('./color/panel').then((m) => m.openColor({ deck, editor: ed }, p)); },
      enabled: () => targets('image').length === 1 && isImage(),
    },
    ...videoCommands(),
    ...textCmds,
    'image.opacity': {
      run: () => lookGallery('image.opacity', 'opacity', CLEAR_STEPS, { label: 'Своя', ...CLEAR_SLIDER }, 'f'),
      enabled: isImage,
    },
    'image.styles': { run: stylesGallery, enabled: isImage },
    'image.frame.add': { run: () => { const p = frameBlock(); if (p) ed.pickFrames(p, frameNow()); }, enabled: () => !!frameBlock() },
    'image.frames.join': { run: joinImages, enabled: joinable },
    'image.fit': { run: fitMenu, enabled: () => isImage() && targets('image').some((p) => (getAt(deck, p) as Block).type === 'image') },
    'image.frame.del': { run: () => frameEdit((b, k) => removeFrame(b, k)), enabled: () => frameCount() > 1 },
    'image.frame.prev': { run: () => frameEdit((b, k) => moveFrame(b, k, -1), -1), enabled: () => frameCount() > 1 && frameNow() > 0 },
    'image.frame.next': { run: () => frameEdit((b, k) => moveFrame(b, k, 1), 1), enabled: () => frameCount() > 1 && frameNow() < frameCount() - 1 },
    'image.flip': {
      run: () => setAll('image', 'flip', first('image')?.flip === 'click' ? undefined : 'click'),
      enabled: () => frameCount() > 1, active: () => frameCount() > 1 && first('image')?.flip === 'click',
    },
    'image.reset': {
      run: () => { const paths = targets('image'); ed.commit((d) => paths.forEach((p) => { const b = getAt(d, p) as Block; IMAGE_LOOK_KEYS.forEach((k) => delete b[k]); }), { rebuild: true }); },
      enabled: () => isImage() && targets('image').some((p) => IMAGE_LOOK_KEYS.some((k) => (getAt(deck, p) as Block)[k] !== undefined)),
    },
    'table.head': { run: () => setAll('table', 'head', first('table')?.head === false ? undefined : false), enabled: () => isTable() && Array.isArray(first('table')?.header), active: () => isTable() && first('table')?.head !== false && Array.isArray(first('table')?.header) },
    'table.labels': { run: () => setAll('table', 'labels', first('table')?.labels ? undefined : true), enabled: isTable, active: () => !!first('table')?.labels },
    'table.total': { run: () => setAll('table', 'total', first('table')?.total ? undefined : true), enabled: () => isTable() && ((first('table')?.rows as unknown[]) ?? []).length > 1, active: () => !!first('table')?.total },
    'table.highlight': {
      run: () => { const at = cell(); setAll('table', 'highlight', first('table')?.highlight === at.r || at.r < 0 ? undefined : at.r); },
      enabled: isTable, active: () => isTable() && Number.isInteger(first('table')?.highlight),
    },
    'table.lastcol': { run: () => setAll('table', 'lastcol', first('table')?.lastcol ? undefined : true), enabled: isTable, active: () => !!first('table')?.lastcol },
    'table.bands': {
      // Зебра у вида «Полосы» уже есть; у остальных — флажок
      run: () => setAll('table', 'bands', first('table')?.bands ? undefined : true),
      enabled: () => isTable() && first('table')?.variant !== 'stripes', active: () => !!first('table')?.bands || first('table')?.variant === 'stripes',
    },
    'table.fill': { run: tableFill, enabled: isTable },
    'table.borders': { run: bordersGallery, enabled: isTable },
    'table.sort': { run: () => showMenu(anchor('table.sort'), sortItems()), enabled: () => isTable() && ((first('table')?.rows as unknown[]) ?? []).length > 1 },
    'table.rows.equal': { run: equalRows, enabled: isTable },
    'table.merge': { run: mergeCells, enabled: () => isTable() && multiCell() },
    'table.split': { run: () => splitDialog(anchor('table.split')), enabled: isTable },
    'table.select': {
      run: () => showMenu(anchor('table.select'), [
        { label: 'Выделить строку', icon: 'row-below', run: () => selectCells('row') },
        { label: 'Выделить столбец', icon: 'col-right', run: () => selectCells('col') },
        { label: 'Выделить таблицу', icon: 'grid', run: () => selectCells('all') },
      ]),
      enabled: isTable,
    },
    'table.row.above': { run: () => addRow(false), enabled: isTable },
    'table.row.below': { run: () => addRow(true), enabled: isTable },
    'table.col.left': { run: () => addCol(false), enabled: isTable },
    'table.col.right': { run: () => addCol(true), enabled: isTable },
    'table.row.del': { run: delRow, enabled: () => isTable() && (((first('table')?.rows as unknown[]) ?? []).length > 1) },
    'table.col.del': { run: delCol, enabled: isTable },
    'table.del': {
      run: () => showMenu(anchor('table.del'), tableItems(false)),
      enabled: isTable,
    },
    'table.cols.equal': { run: () => setAll('table', 'widths', undefined), enabled: () => isTable() && Array.isArray(first('table')?.widths) },
    'table.density': { run: () => lookGallery('table.density', 'density', [[undefined, 'Обычная'], ['compact', 'Компактная'], ['roomy', 'Свободная']], undefined, 't3', TABLE_KIND), enabled: isTable },
    'table.size.up': { run: () => setAll('table', 'size', Math.min(40, (Number(first('table')?.size) || 17) + 1)), enabled: isTable },
    'table.size.down': { run: () => setAll('table', 'size', Math.max(10, (Number(first('table')?.size) || 17) - 1)), enabled: isTable },
  };
  for (const k of [...KINDS.map(([id]) => id), ...Object.keys(PRESET_KINDS)]) {
    cmds[`shape.kind.${k}`] = {
      run: () => {
        const paths = targets('shape');
        ed.commit((d) => paths.forEach((p) => {
          const b = getAt(d, p) as Block;
          const wasLine = isLine(b);
          const toLine = k === 'line' || k === 'arrow';
          setAt(d, [...p, 'kind'], k === 'round' ? undefined : k);
          // Линия берёт цвет у заливки, фигура из линии — обычную заливку
          if (toLine && !wasLine) {
            if (!b.stroke || !Number(b.width)) b.stroke = b.fill && b.fill !== 'none' && b.fill !== 'gradient' ? b.fill : 'accent';
            delete b.width;
          }
          if (!toLine && wasLine) {
            delete b.width;
            if (!b.fill) b.fill = 'soft';
          }
        }), { rebuild: true });
      },
      enabled: isShape, active: () => isShape() && (first('shape')?.kind ?? 'round') === k,
    };
  }
  for (const st of IMAGE_STYLES) {
    cmds[`image.style.${st.id}`] = {
      run: () => {
        const paths = targets('image');
        const patch = stylePatch(st);
        rememberStyle(st.id);
        ed.commit((d) => paths.forEach((p) => {
          const b = getAt(d, p) as Block;
          for (const [k, v] of Object.entries(patch)) if (v === undefined) delete b[k]; else b[k] = v;
        }), { rebuild: true });
      },
      enabled: isImage,
      active: () => { const b = first('image'); return !!b && styleOn(st, b); },
    };
  }
  // Стиль — сочетание заливки, контура и тени: подкрутка прежней тени уходит вместе с ней
  const STYLE_KEYS = ['fill', 'stroke', 'width', 'shadow', ...SHADOW_TUNE, 'dash', 'gradient', 'strokeGradient'] as const;
  for (const s of SHAPE_STYLES) {
    cmds[`shape.style.${s.id}`] = {
      run: () => {
        const paths = targets('shape');
        ed.commit((d) => paths.forEach((p) => {
          const b = getAt(d, p) as Block;
          if (isLine(b)) {
            b.stroke = s.line;
            if (s.props.dash) b.dash = s.props.dash;
            else delete b.dash;
            return;
          }
          for (const k of STYLE_KEYS) delete b[k];
          Object.assign(b, s.props);
        }), { rebuild: true });
      },
      enabled: isShape,
      active: () => {
        const b = first('shape');
        if (!b) return false;
        if (isLine(b)) return (b.stroke ?? b.fill) === s.line && b.dash === s.props.dash;
        return STYLE_KEYS.every((k) => b[k] === (s.props as Record<string, unknown>)[k]);
      },
    };
  }
  for (const a of ['left', 'center', 'right']) {
    cmds[`shape.align.${a}`] = { run: () => setText('align', a === 'center' ? undefined : a), enabled: hasText, active: () => hasText() && (textStyle(first('shape')).align ?? 'center') === a };
    cmds[`table.align.${a}`] = {
      run: () => editTable((t, at) => {
        const list = Array.isArray(t.align) ? t.align : [];
        while (list.length < cols(t)) list.push('');
        for (let c = at.c0; c <= at.c1; c++) list[c] = a;
        t.align = list;
      }),
      enabled: isTable, active: () => isTable() && colAlign() === a,
    };
  }
  for (const v of ['top', 'middle', 'bottom']) {
    cmds[`table.valign.${v}`] = { run: () => setAll('table', 'valign', v === 'middle' ? undefined : v), enabled: isTable, active: () => isTable() && (first('table')?.valign ?? 'middle') === v };
    cmds[`shape.valign.${v}`] = { run: () => setAll('shape', 'valign', v === 'middle' ? undefined : v), enabled: hasText, active: () => hasText() && (first('shape')?.valign ?? 'middle') === v };
  }
  for (const [v] of VARIANTS) {
    cmds[`table.variant.${v}`] = { run: () => setAll('table', 'variant', v === 'lines' ? undefined : v), enabled: isTable, active: () => isTable() && (first('table')?.variant ?? 'lines') === v };
  }

  // ---------- примерка с ленты: плитка под мышью или в фокусе — вид на самом объекте ----------
  /** Каким станет блок, если нажать плитку ленты cmd (как в её команде); null — плитка без примерки */
  const ribbonTry = (cmd: string): { kind: LookKind; fn: (b: Block) => Block } | null => {
    const [, group, id] = /^(shape\.style|shape\.kind|table\.variant|image\.style|text\.style)\.(.+)$/.exec(cmd) ?? [];
    if (group === 'text.style') {
      const l = TEXT_LOOKS.find((x) => x.id === id);
      return l ? { kind: TEXT_KIND, fn: (b) => withStyle(b, applyLook(tst(b), l)) } : null;
    }
    if (group === 'shape.style') {
      const s = SHAPE_STYLES.find((x) => x.id === id);
      return s ? {
        kind: SHAPE_KIND,
        fn: (b) => (isLine(b) ? { ...b, stroke: s.line, dash: s.props.dash } : { ...Object.fromEntries(Object.entries(b).filter(([k]) => !(STYLE_KEYS as readonly string[]).includes(k))), ...s.props } as Block),
      } : null;
    }
    // Форма — только у фигур с телом: линия и стрелка устроены иначе, их показывает щелчок
    if (group === 'shape.kind') return id === 'line' || id === 'arrow' ? null : { kind: SHAPE_KIND, fn: (b) => (isLine(b) ? b : { ...b, kind: id === 'round' ? undefined : id }) };
    if (group === 'table.variant') return { kind: TABLE_KIND, fn: (b) => ({ ...b, variant: id === 'lines' ? undefined : id }) };
    if (group === 'image.style') {
      const st = IMAGE_STYLES.find((x) => x.id === id);
      return st ? { kind: IMAGE_KIND, fn: (b) => ({ ...b, ...stylePatch(st) }) } : null;
    }
    return null;
  };
  let trying: { cmd: string; look: ReturnType<typeof tryLook> } | null = null;
  const tileOf = (t: EventTarget | null) => (t as Element | null)?.closest?.<HTMLElement>('.st-ribbon [data-cmd]') ?? null;
  const showTile = (tile: HTMLElement | null) => {
    const cmd = tile && !(tile as HTMLButtonElement).disabled ? tile.dataset.cmd ?? '' : '';
    if (trying?.cmd === cmd) return;
    trying?.look.restore();
    trying = null;
    const spec = cmd ? ribbonTry(cmd) : null;
    if (!spec || cmds[cmd]?.enabled?.() === false) return;
    const look = tryLook(spec.kind);
    look.tryOn(spec.fn);
    trying = { cmd, look };
  };
  document.addEventListener('pointerover', (e) => showTile(tileOf(e.target)));
  document.addEventListener('focusin', (e) => showTile(tileOf(e.target)));
  // Нажали плитку — команда запишет этот вид: прежний не возвращаем
  document.addEventListener('pointerdown', (e) => { if (trying && tileOf(e.target)?.dataset.cmd === trying.cmd) { trying.look.forget(); trying = null; } }, true);
  document.addEventListener('keydown', (e) => { if (trying && (e.key === 'Enter' || e.key === ' ') && tileOf(e.target)) { trying.look.forget(); trying = null; } }, true);
  return cmds;
}

/** Образцы текущей заливки и контура на кнопках вкладки «Фигура»; шрифт, размер и цвет текста — на «Надписи». */
export function syncSwatches(deck: Deck, ed: Editor): void {
  const sel = ed.selection;
  const b = sel ? (getAt(deck, sel.block) as Block | undefined) : undefined;
  if (b?.type === 'text') syncText(b, ed);
  const line = b?.kind === 'line' || b?.kind === 'arrow';
  document.querySelectorAll<HTMLElement>('.st-rb-sw').forEach((el) => {
    const key = el.dataset.sw as 'fill' | 'stroke' | 'istroke' | 'tcolor';
    let css = 'transparent';
    if (key === 'tcolor') {
      const c = ((b?.styles as Record<string, TextStyle> | undefined)?.text ?? {}).color;
      const g = typeof c === 'string' && c.startsWith('g:') ? /--g:([^;]+)/.exec(textGradientCss(c) ?? '')?.[1] : null;
      el.style.background = b?.type === 'text' ? g ?? colorCss(c) ?? 'var(--tx)' : 'transparent';
      return;
    }
    if (key === 'istroke') {
      el.style.background = ofType(b, 'image') && Number(b?.width) ? swatchCss(b!.stroke, 'var(--bd2)') : 'transparent';
      return;
    }
    if (b?.type === 'shape') {
      if (b.stroke === 'gradient' && key === 'stroke' && (line || Number(b.width))) css = gradientCss(b.strokeGradient);
      else if (line) css = key === 'stroke' ? swatchCss(b.stroke ?? b.fill, 'var(--ac)') : 'transparent';
      else if (key === 'fill') css = b.fill === 'gradient' ? gradientCss(b.gradient) : swatchCss(b.fill, 'var(--acs)');
      else css = Number(b.width) ? swatchCss(b.stroke, 'var(--acb)') : 'transparent';
    }
    el.style.background = css;
  });
}

/** Шрифт и размер выделенной надписи — на её вкладке */
function syncText(b: Block, ed: Editor): void {
  const st = (b.styles as Record<string, TextStyle> | undefined)?.text ?? {};
  const font = document.querySelector<HTMLElement>('.st-ribbon .st-txfont span');
  if (font) {
    const f = st.font ?? '';
    font.textContent = !f ? 'Шрифт темы' : FONTS[f]?.name ?? f;
    font.style.fontFamily = !f ? '' : FONTS[f]?.css ?? (fontNameOk(f) ? fontStack(f) : '');
  }
  const size = document.querySelector<HTMLInputElement>('.st-ribbon [data-txsize]');
  if (size && document.activeElement !== size) {
    const path = ed.selection?.block;
    const el = path ? document.querySelector<HTMLElement>(`.slide.on [data-block='${JSON.stringify(path)}']`) : null;
    size.value = String(Number(st.size) || (el ? Math.round(parseFloat(getComputedStyle(el).fontSize)) : ''));
  }
}
