import { icon } from '../components/icons';
import { TEXT_GRADIENTS } from '../engine/gradients';
import { GRADIENTS, SHAPE_COLORS, SHAPE_STYLES, SHAPE_SWATCHES, gradientCss, gradientOn, isGradient, sameGradient, shapeFill, type ShapeGradient } from '../components/shape/shape';
import { IMAGE_ADJUST, IMAGE_FILTER_GROUPS, IMAGE_FILTERS, IMAGE_LOOK_KEYS, IMAGE_SHADOWS, IMAGE_STYLES, adjustCss, filterCss, imageLookCss, type ImageLook } from '../components/layout/image-look';

/** Цвет снимка: стиль рисунка (рамка, тень, форма) его не трогает */
const COLOR_KEYS = new Set<string>(['filter', 'opacity', 'bright', 'contrast', 'saturate']);
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

interface LookOption { label: string; patch: Record<string, unknown>; on: boolean; pick(): void }
interface LookSlider { label: string; min: number; max: number; unit: string; key: string; value: number; set(n: number): unknown; /** Ползунок недоступен: подсказка почему */ off?: string }
import { getAt, setAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import { frameCss } from '../engine/marks';
import type { Block, Deck } from '../types';
import { showMenu, showPopover, type MenuEntry } from './menu';
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

export type ContextTab = 'shape' | 'table' | 'image' | 'video';

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
  return t === 'shape' || t === 'table' || t === 'image' ? t : null;
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
  ['lines', 'Линии'], ['stripes', 'Зебра'], ['boxed', 'Сетка'], ['accent', 'Акцент'], ['soft', 'Мягкая'], ['dark', 'Тёмная шапка'],
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
    ...b, shadow: undefined, width: b.width ? Math.min(3, Number(b.width)) : undefined,
    radius: typeof b.radius === 'number' ? Math.round(b.radius * 0.3) : b.radius, mat: b.mat ? Math.max(2, Math.round(Number(b.mat) * 0.3)) : undefined,
  });
  const sh = b.shadow && SAMPLE_SHADOWS[b.shadow] ? `box-shadow:${SAMPLE_SHADOWS[b.shadow]}` : '';
  return `<i class="st-smp"><i class="st-smp-pic${look.cls}" style="${esc([look.box, sh].filter(Boolean).join(';'))}"><b${look.img ? ` style="${esc(look.img)}"` : ''}></b></i></i>`;
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
  return `<button type="button" role="tab" data-tab="shape" class="ctx" aria-selected="false" hidden>Фигура</button>`
    + `<button type="button" role="tab" data-tab="table" class="ctx" aria-selected="false" hidden>Таблица</button>`
    + `<button type="button" role="tab" data-tab="image" class="ctx" aria-selected="false" hidden>Рисунок</button>`
    + `<button type="button" role="tab" data-tab="video" class="ctx" aria-selected="false" hidden>Видео</button>`;
}

export function contextPanelsHtml(): string {
  return `<div class="st-rpanel" data-panel="shape" hidden>
  ${group('Стили', `<div class="st-gallery">${SHAPE_STYLES.map(styleTile).join('')}</div>`)}
  ${group('Форма', `<div class="st-rgrid">${KINDS.map(([k, ic, l]) => btn(`shape.kind.${k}`, ic, l, { ico: true })).join('')}</div>`)}
  ${group('Цвет', btn('shape.fill', 'fill', 'Заливка', { big: true, menu: true, swatch: 'fill' }) + btn('shape.stroke', 'outline', 'Контур', { big: true, menu: true, swatch: 'stroke', title: 'Цвет, толщина и штрих контура' }))}
  ${group('Текст', btn('shape.text', 'text-box', 'Надпись', { big: true, title: 'Текст внутри фигуры' })
    + stack(
      row(btn('shape.font.up', 'text-up', 'Крупнее', { ico: true }), btn('shape.font.down', 'text-down', 'Мельче', { ico: true }), btn('shape.bold', 'bold', 'Жирный', { ico: true })),
      row(btn('shape.align.left', 'align-left', 'По левому краю', { ico: true }), btn('shape.align.center', 'align-center', 'По центру', { ico: true }), btn('shape.align.right', 'align-right', 'По правому краю', { ico: true })),
      row(btn('shape.valign.top', 'v-top', 'Сверху', { ico: true }), btn('shape.valign.middle', 'v-middle', 'Посередине по высоте', { ico: true }), btn('shape.valign.bottom', 'v-bottom', 'Снизу', { ico: true })),
    ))}
  ${group('Эффекты', stack(btn('shape.shadow', 'shadow', 'Тень', { menu: true }), btn('shape.radius', 'corner', 'Скругление', { menu: true }))
    + stack(btn('shape.rotate', 'rotate', 'Поворот', { menu: true }), btn('shape.opacity', 'opacity', 'Прозрачность', { menu: true })))}
  ${ORDER}
</div>
<div class="st-rpanel" data-panel="table" hidden>
  ${group('Стиль таблицы', `<div class="st-gallery t">${VARIANTS.map(tableTile).join('')}</div>` + btn('table.fill', 'fill', 'Заливка', { big: true, menu: true, title: 'Цвет выделенных ячеек (протяните мышью по ячейкам или Shift+щелчок)' }) + btn('table.borders', 'borders', 'Границы', { big: true, menu: true, title: 'Границы выделенных ячеек или всей таблицы' }))}
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
  ${group('Рамка', btn('image.stroke', 'outline', 'Контур', { big: true, menu: true, swatch: 'istroke', title: 'Цвет, толщина и штрих контура' }) + btn('image.mat', 'mat', 'Паспарту', { big: true, menu: true, title: 'Поле вокруг снимка, как у фотографии в рамке' }))}
  ${group('Эффекты', stack(btn('image.shadow', 'shadow', 'Тень', { menu: true }), btn('image.radius', 'corner', 'Скругление', { menu: true }))
    + stack(btn('image.filter', 'recolor', 'Цвет', { menu: true, title: 'Чёрно-белый, сепия, приглушённый…' }), btn('image.opacity', 'opacity', 'Прозрачность', { menu: true })))}
  ${group('Цветокоррекция', btn('image.grade', 'sliders', 'Цвет+', { big: true, title: 'Цветокоррекция, как в DaVinci: круги, кривые, HSL, LUT, цвета бренда. Исходный файл не меняется' }))}
  ${group('Кадр', btn('image.crop', 'crop', 'Кадр', { big: true, title: 'Сдвинуть снимок внутри рамки, как «Обрезка» в PowerPoint: тяните картинку. Масштаб — на панели над картинкой. Готово — Esc' }))}
  ${group('Сброс', btn('image.reset', 'reset', 'Сбросить', { big: true, title: 'Убрать всё оформление рисунка' }))}
  ${group('Файл', btn('obj.picture', 'save', 'Сохранить', { big: true, title: 'Сохранить как рисунок: PNG с прозрачным фоном, с кадром, цветом и рамкой' }))}
  ${ORDER}
</div>
<div class="st-rpanel" data-panel="video" hidden>
  ${group('Воспроизведение', stack(btn('video.autoplay', '', 'Запуск со слайдом', { chk: true, title: 'Ролик запускается, когда открывается слайд' }), btn('video.muted', '', 'Без звука', { chk: true }))
    + stack(btn('video.loop', '', 'По кругу', { chk: true }), btn('video.controls', '', 'Кнопки плеера', { chk: true, title: 'Кнопки плеера при наведении' })))}
  ${group('Кадр', btn('video.fit', 'crop', 'Заполнить', { big: true, title: 'Заполнить рамку целиком (края ролика обрезаются) или показать ролик полностью' }))}
  ${group('Цветокоррекция', btn('video.grade', 'sliders', 'Цвет+', { big: true, title: 'Цветокоррекция ролика: круги, кривые, HSL, LUT, цвета бренда. Применяется при показе, файл не меняется' }))}
  ${ORDER}
</div>`;
}

/** Цвет из данных фигуры → CSS для образца на кнопке. */
const swatchCss = (v: unknown, fallback: string): string => shapeFill(v) ?? fallback;

const FONT_STEPS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96];

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
    const theme = Object.entries(SHAPE_COLORS).filter(([v]) => v !== 'bg').map(([v, c]) => sw(v, c.css, c.name)).join('');
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
      <div class="st-plabel">Постоянные</div><div class="st-pgrid">${SHAPE_SWATCHES.map((c) => sw(c, c, c)).join('')}</div>
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
    showPopover(anchor(cmd), html, (el) => {
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
  };
  /** Свой градиент: два цвета, направление или от центра; правки видны сразу и в истории — одним шагом */
  const gradientEditor = (cmd: string, start: ShapeGradient, k: 'fill' | 'stroke' = 'fill') => {
    const gk = k === 'fill' ? 'gradient' : 'strokeGradient';
    const g: ShapeGradient = { ...start };
    const DIRS: [number, string][] = [[0, '↑'], [45, '↗'], [90, '→'], [135, '↘'], [180, '↓'], [225, '↙'], [270, '←'], [315, '↖']];
    const html = `<div class="st-plabel">Свой градиент</div>
      <div class="st-gprev"></div>
      <div class="st-grow"><label class="st-gcol"><input type="color" data-gc="from" aria-label="Цвет начала"><span>Начало</span></label>
        <button type="button" class="st-gswap" data-swap="1" title="Поменять цвета местами" aria-label="Поменять цвета местами">⇄</button>
        <label class="st-gcol"><input type="color" data-gc="to" aria-label="Цвет конца"><span>Конец</span></label></div>
      <div class="st-plabel">Направление</div>
      <div class="st-pseg st-gdir">${DIRS.map(([a, l]) => `<button type="button" data-ang="${a}" title="${a}°">${l}</button>`).join('')}<button type="button" data-ang="radial" title="От центра">◎</button></div>`;
    const key = `grad:${Date.now()}`;
    const save = () => {
      const paths = targets('shape');
      const val: ShapeGradient = g.type === 'radial' ? { from: g.from, to: g.to, type: 'radial' } : { from: g.from, to: g.to, angle: g.angle ?? 135 };
      ed.commit((d) => paths.forEach((p) => {
        setAt(d, [...p, k], 'gradient');
        setAt(d, [...p, gk], val);
        const b = getAt(d, p) as Block;
        if (k === 'stroke' && !isLine(b) && !Number(b.width)) b.width = 2;
      }), { rebuild: true, merge: key, hold: true });
      paint();
    };
    let pop: HTMLElement;
    const paint = () => {
      pop.querySelector<HTMLElement>('.st-gprev')!.style.background = gradientCss(g);
      pop.querySelectorAll<HTMLButtonElement>('[data-ang]').forEach((b) => b.classList.toggle('on', b.dataset.ang === (g.type === 'radial' ? 'radial' : String(g.angle ?? 135))));
      for (const k of ['from', 'to'] as const) {
        const input = pop.querySelector<HTMLInputElement>(`[data-gc="${k}"]`)!;
        if (document.activeElement !== input) input.value = toHex(g[k]);
      }
    };
    pop = showPopover(anchor(cmd), html, (el) => {
      if (el.dataset.swap) return { keep: true, run: () => { [g.from, g.to] = [g.to, g.from]; save(); } };
      const a = el.dataset.ang;
      if (a) return { keep: true, run: () => { if (a === 'radial') g.type = 'radial'; else { delete g.type; g.angle = Number(a); } save(); } };
      return null;
    }, 'st-palette st-grad');
    pop.querySelectorAll<HTMLInputElement>('[data-gc]').forEach((input) => input.addEventListener('input', () => {
      g[input.dataset.gc as 'from' | 'to'] = input.value.toUpperCase();
      save();
    }));
    paint();
  };
  /** Цвет темы или CSS-цвет → #RRGGBB для поля выбора цвета */
  const toHex = (c: string): string => {
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    const probe = document.createElement('i');
    probe.style.color = c === 'accent-light' ? 'color-mix(in srgb, var(--ac) 72%, #fff)' : c === 'accent-dark' ? 'color-mix(in srgb, var(--ac) 78%, #000)' : shapeFill(c) ?? c;
    h.stage().appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(v) ?? /srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(v);
    if (!m) return '#2563eb';
    const k = v.startsWith('color(') ? 255 : 1;
    return `#${[m[1], m[2], m[3]].map((x) => Math.round(Number(x) * k).toString(16).padStart(2, '0')).join('')}`;
  };
  const mark = (el: HTMLElement) => el.parentElement?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));

  const choice = (cmd: string, key: string, options: [unknown, string][], def: unknown, type = 'shape') => {
    const cur = first(type)?.[key] ?? def;
    showMenu(anchor(cmd), options.map(([v, l]) => ({ label: l, checked: cur === v, run: () => setAll(type, key, v === def ? undefined : v) })));
  };
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
    const pop = showPopover(anchor('image.filter'), `<div class="st-flt-pop">${groups}${sliders}<p class="st-flt-note">Наведите — примерка на слайде, щелчок — применить. Ползунки — поверх фильтра</p></div>`, (b) => {
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
  /**
   * Тень, скругление, прозрачность, паспарту, все стили — как «Цвет»: превью на образце, наведение примеряет
   * на самом снимке на слайде, щелчок — применить; ползунок — своё значение (на слайде сразу, в данные — когда отпустили).
   */
  const lookPopover = (at: HTMLElement, sections: { title?: string; cls?: string; options: LookOption[] }[], slider?: LookSlider, cls = '') => {
    const paths = targets('image');
    const snap = () => paths.flatMap((p) => [...h.stage().querySelectorAll<HTMLElement>(`.slide.on [data-block='${JSON.stringify(p)}'] .imgbox`)].map((bx) => ({ bx, p })))
      .map(({ bx, p }) => ({ bx, p, img: bx.querySelector('img'), cls: bx.className, style: bx.getAttribute('style'), imgStyle: bx.querySelector('img')?.getAttribute('style') ?? null }));
    let saved = snap();
    const fresh = () => { if (saved[0] && !saved[0].bx.isConnected) saved = snap(); };
    const b0 = first('image');
    let picked = false;
    const put = (el: Element | null, v: string | null) => { if (el) { if (v === null) el.removeAttribute('style'); else el.setAttribute('style', v); } };
    const restore = () => { if (picked) return; fresh(); saved.forEach((x) => { x.bx.className = x.cls; put(x.bx, x.style); put(x.img, x.imgStyle); }); };
    const tryOn = (patch: Record<string, unknown>) => {
      restore();
      for (const { bx, p, img } of saved) {
        const b = { ...(getAt(deck, p) as Block), ...patch } as Parameters<typeof imageLookCss>[0] & Parameters<typeof frameCss>[0];
        const look = imageLookCss(b);
        bx.className = `${bx.className.replace(/\s*\bimg-(fx|tint|round)\b/g, '')}${look.cls}`;
        put(bx, look.box || null);
        if (img) put(img, `${frameCss(b)}${look.img ? `;${look.img}` : ''}`);
      }
    };
    const options = sections.flatMap((s) => s.options);
    const tile = (o: LookOption) => `<button type="button" class="st-flt${o.on ? ' on' : ''}" data-lk="${options.indexOf(o)}" title="${esc(o.label)}">`
      + `${sample({ ...(b0 ?? {}), ...o.patch } as ImageLook)}<span>${esc(o.label)}</span></button>`;
    const grids = sections.map((s) => `${s.title ? `<h4>${esc(s.title)}</h4>` : ''}<div class="st-flt-grid${s.cls ? ` ${s.cls}` : ''}">${s.options.map(tile).join('')}</div>`).join('');
    const range = slider ? `<div class="st-adj"><label${slider.off ? ` title="${esc(slider.off)}"` : ''}><span>${esc(slider.label)}</span><input type="range" min="${slider.min}" max="${slider.max}" step="1" value="${slider.value}" data-lkr="1" aria-label="${esc(slider.label)}"${slider.off ? ' disabled' : ''}><output>${slider.value}${slider.unit}</output></label></div>` : '';
    const pop = showPopover(at, `<div class="st-flt-pop">${grids}${range}<p class="st-flt-note">Наведите — примерка на слайде, щелчок — применить</p></div>`, (b) => {
      const i = b.dataset.lk;
      if (i === undefined) return null;
      return { run: () => { restore(); picked = true; options[Number(i)].pick(); } };
    }, `st-fltpop st-lkpop ${cls}`.trim());
    const hovered = (e: Event) => (e.target as Element).closest<HTMLElement>('[data-lk]');
    pop.addEventListener('pointerover', (e) => { const b = hovered(e); if (b) tryOn(options[Number(b.dataset.lk)].patch); });
    pop.addEventListener('pointerout', (e) => { if (hovered(e) && !(e.relatedTarget as Element | null)?.closest?.('[data-lk]')) restore(); });
    pop.addEventListener('pointerleave', restore);
    pop.addEventListener('focusin', (e) => { const b = hovered(e); if (b) tryOn(options[Number(b.dataset.lk)].patch); });
    pop.addEventListener('input', (e) => {
      const r = e.target as HTMLInputElement;
      if (!slider || !r.dataset.lkr) return;
      r.nextElementSibling!.textContent = `${r.value}${slider.unit}`;
      tryOn({ [slider.key]: slider.set(Number(r.value)) });
    });
    pop.addEventListener('change', (e) => {
      const r = e.target as HTMLInputElement;
      if (!slider || !r.dataset.lkr) return;
      const v = slider.set(Number(r.value));
      ed.commit((d) => paths.forEach((p) => setAt(d, [...p, slider.key], v)), { rebuild: true, merge: `img-${slider.key}` });
      saved = snap();
    });
    const mo = new MutationObserver(() => { if (!pop.isConnected) { mo.disconnect(); restore(); } });
    mo.observe(document.body, { childList: true });
  };
  /** Одно поле: тень, скругление, прозрачность, паспарту (cls «f» — пять образцов в ряд) */
  const lookGallery = (cmd: string, key: string, options: [unknown, string][],
    slider?: { label: string; min: number; max: number; unit: string; get: (v: unknown) => number; set: (n: number) => unknown }, cls?: string) => {
    const cur = first('image')?.[key];
    lookPopover(anchor(cmd), [{ cls, options: options.map(([v, label]) => ({ label, patch: { [key]: v }, on: cur === v, pick: () => setAll('image', key, v) })) }],
      slider && { ...slider, key, value: slider.get(cur) });
  };
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
  const fillCells = (v: string | undefined) => editTable((t, at) => {
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
  });
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
    const theme = Object.entries(SHAPE_COLORS).filter(([v]) => v !== 'bg').map(([v, c]) => sw(v, c.css, c.name)).join('');
    const html = `<button type="button" class="st-pnone${cur ? '' : ' on'}" data-v="none">${icon('close')}<span>Как у таблицы</span></button>
      <div class="st-plabel">Цвета темы</div><div class="st-pgrid">${theme}</div>
      <div class="st-plabel">Постоянные</div><div class="st-pgrid">${SHAPE_SWATCHES.map((c) => sw(c, c, c)).join('')}</div>
      <button type="button" class="st-pmore" data-v="custom"><i style="background:conic-gradient(#f87171, #fbbf24, #34d399, #60a5fa, #c084fc, #f87171)"></i><span>Другой цвет…</span></button>`;
    showPopover(anchor('table.fill'), html, (el) => {
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
  /** Меню таблицы: правый щелчок по ячейке и кнопка «Удалить» на ленте */
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
        ...sortItems().map((it) => it && { ...it, label: `Сортировать ${it.label.toLowerCase()}` }),
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
  const setBorders = (kind: string | null) => {
    const at = borderRect();
    ed.finishText();
    editTable((t) => {
      const list = Array.isArray(t.borders) ? (t.borders as (number | string)[][]) : [];
      // «Как в стиле»: правила, целиком внутри выделения, убираются
      const keep = list.filter((b) => !(Number(b[0]) >= at.r0 && Number(b[0]) + Number(b[2]) - 1 <= at.r1 && Number(b[1]) >= at.c0 && Number(b[1]) + Number(b[3]) - 1 <= at.c1));
      const next = kind ? [...keep, [at.r0, at.c0, at.r1 - at.r0 + 1, at.c1 - at.c0 + 1, kind]] : keep;
      if (next.length) t.borders = next;
      else delete t.borders;
    });
  };
  const borderItems = (): MenuEntry[] => [
    { label: 'Все границы', run: () => setBorders('all') },
    { label: 'Внешние границы', run: () => setBorders('outer') },
    { label: 'Внутренние границы', run: () => setBorders('inner') },
    { label: 'Нижняя граница', run: () => setBorders('bottom') },
    { label: 'Без границ', run: () => setBorders('none') },
    null,
    { label: 'Как в стиле таблицы', run: () => setBorders(null) },
  ];
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
      <div class="st-splitf-ok"><button type="button" class="btn small" data-v="ok">ОК</button></div></div>`;
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

  const cmds: Record<string, Command> = {
    'shape.fill': { run: () => palette('shape.fill', 'fill'), enabled: isBody },
    'shape.stroke': { run: () => palette('shape.stroke', 'stroke'), enabled: isShape },
    'shape.shadow': { run: () => choice('shape.shadow', 'shadow', [[undefined, 'Без тени'], ['sm', 'Лёгкая'], ['md', 'Заметная']], undefined), enabled: isBody },
    'shape.radius': { run: () => choice('shape.radius', 'radius', [[0, 'Острые углы'], [8, 'Малое — 8 px'], [16, 'Среднее — 16 px'], [24, 'Большое — 24 px'], [40, 'Очень большое — 40 px']], undefined), enabled: () => isShape() && ['round', 'rect', undefined].includes(first('shape')?.kind as string | undefined) },
    'shape.rotate': { run: () => choice('shape.rotate', 'rotate', [[undefined, 'Без поворота'], [45, '45°'], [90, '90°'], [135, '135°'], [180, '180°'], [-45, '−45°'], [-90, '−90°']], undefined), enabled: isShape },
    'shape.opacity': { run: () => choice('shape.opacity', 'opacity', [[undefined, 'Непрозрачная'], [0.8, '80 %'], [0.6, '60 %'], [0.4, '40 %'], [0.2, '20 %']], undefined), enabled: isShape },
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
    'image.shadow': { run: () => lookGallery('image.shadow', 'shadow', [[undefined, 'Без тени'], ...Object.entries(IMAGE_SHADOWS).map(([v, s]) => [v, s.name] as [string, string])]), enabled: isImage },
    'image.radius': {
      run: () => lookGallery('image.radius', 'radius', [[0, 'Острые'], [6, 'Малое'], [undefined, 'Обычное'], [24, 'Большое'], [48, 'Очень большое'], ['oval', 'Овал'], ['circle', 'Круг']],
        { label: 'Своё, px', min: 0, max: 120, unit: ' px', get: (v) => (typeof v === 'number' ? v : v === 'circle' || v === 'oval' ? 120 : 12), set: (n) => n }),
      enabled: isImage,
    },
    'image.filter': { run: () => filterGallery(), enabled: isImage },
    'image.grade': {
      run: () => { const p = targets('image')[0]; if (p) void import('./color/panel').then((m) => m.openColor({ deck, editor: ed }, p)); },
      enabled: () => targets('image').length === 1 && isImage(),
    },
    ...videoCommands(),
    'image.opacity': {
      run: () => lookGallery('image.opacity', 'opacity', [[undefined, '100 %'], [0.8, '80 %'], [0.6, '60 %'], [0.4, '40 %'], [0.2, '20 %']],
        { label: 'Своя', min: 10, max: 100, unit: ' %', get: (v) => Math.round((Number(v) || 1) * 100), set: (n) => (n >= 100 ? undefined : n / 100) }, 'f'),
      enabled: isImage,
    },
    'image.styles': { run: stylesGallery, enabled: isImage },
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
    'table.borders': { run: () => showMenu(anchor('table.borders'), borderItems()), enabled: isTable },
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
    'table.density': {
      run: () => {
        const cur = first('table')?.density;
        showMenu(anchor('table.density'), ([[undefined, 'Обычная'], ['compact', 'Компактная'], ['roomy', 'Свободная']] as const).map(([v, l]) => ({ label: l, checked: cur === v, run: () => setAll('table', 'density', v) })));
      },
      enabled: isTable,
    },
    'table.size.up': { run: () => setAll('table', 'size', Math.min(40, (Number(first('table')?.size) || 17) + 1)), enabled: isTable },
    'table.size.down': { run: () => setAll('table', 'size', Math.max(10, (Number(first('table')?.size) || 17) - 1)), enabled: isTable },
  };
  for (const [k] of KINDS) {
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
  const STYLE_KEYS = ['fill', 'stroke', 'width', 'shadow', 'dash', 'gradient', 'strokeGradient'] as const;
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
  return cmds;
}

/** Образцы текущей заливки и контура на кнопках вкладки «Фигура». */
export function syncSwatches(deck: Deck, ed: Editor): void {
  const sel = ed.selection;
  const b = sel ? (getAt(deck, sel.block) as Block | undefined) : undefined;
  const line = b?.kind === 'line' || b?.kind === 'arrow';
  document.querySelectorAll<HTMLElement>('.st-rb-sw').forEach((el) => {
    const key = el.dataset.sw as 'fill' | 'stroke' | 'istroke';
    let css = 'transparent';
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
