import { icon } from '../components/icons';
import { TEXT_GRADIENTS } from '../engine/gradients';
import { GRADIENTS, SHAPE_COLORS, SHAPE_STYLES, SHAPE_SWATCHES, gradientCss, gradientOn, isGradient, sameGradient, shapeFill, type ShapeGradient } from '../components/shape/shape';
import { IMAGE_FILTER_GROUPS, IMAGE_FILTERS, IMAGE_LOOK_KEYS, IMAGE_SHADOWS, IMAGE_STYLES, filterCss, imageLookCss } from '../components/layout/image-look';
import { getAt, setAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import type { Block, Deck } from '../types';
import { showMenu, showPopover, type MenuEntry } from './menu';

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
}

export type ContextTab = 'shape' | 'table' | 'image';

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
const imageTile = (s: (typeof IMAGE_STYLES)[number]) => {
  const look = imageLookCss({ ...s.props, ...(s.props.width ? { width: Math.min(2, s.props.width) } : {}), ...(s.props.mat ? { mat: 3 } : {}), ...(typeof s.props.radius === 'number' ? { radius: Math.round(s.props.radius / 3) } : {}) });
  return `<button type="button" class="st-stile st-itile" data-cmd="image.style.${s.id}" title="${esc(s.name)}" aria-label="${esc(s.name)}">`
    + `<i style="${look.box || 'border-radius:4px'}${s.props.shadow ? ';box-shadow:0 2px 5px rgba(15,23,42,.3)' : ''}"><b${look.img ? ` style="${look.img}"` : ''}></b></i></button>`;
};

/** Вкладки и панели ленты (скрыты, пока нет подходящего выделения). */
export function contextTabsHtml(): string {
  return `<button type="button" role="tab" data-tab="shape" class="ctx" aria-selected="false" hidden>Фигура</button>`
    + `<button type="button" role="tab" data-tab="table" class="ctx" aria-selected="false" hidden>Таблица</button>`
    + `<button type="button" role="tab" data-tab="image" class="ctx" aria-selected="false" hidden>Рисунок</button>`;
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
</div>
<div class="st-rpanel" data-panel="table" hidden>
  ${group('Стиль таблицы', `<div class="st-gallery t">${VARIANTS.map(tableTile).join('')}</div>`)}
  ${group('Показать', stack(btn('table.head', '', 'Строка заголовка', { chk: true }), btn('table.labels', '', 'Первый столбец', { chk: true, title: 'Выделить первый столбец' }))
    + stack(btn('table.total', '', 'Итоговая строка', { chk: true, title: 'Последняя строка как итог' }), btn('table.highlight', '', 'Выделить строку', { chk: true, title: 'Выделить текущую строку' })))}
  ${group('Строки и столбцы', stack(btn('table.row.above', 'row-above', 'Вставить сверху'), btn('table.row.below', 'row-below', 'Вставить снизу'))
    + stack(btn('table.col.left', 'col-left', 'Вставить слева'), btn('table.col.right', 'col-right', 'Вставить справа'))
    + btn('table.del', 'table-del', 'Удалить', { big: true, menu: true, title: 'Удалить строку, столбец или таблицу' }))}
  ${group('Ячейки', stack(
    row(btn('table.align.left', 'align-left', 'Столбец — по левому краю', { ico: true }), btn('table.align.center', 'align-center', 'Столбец — по центру', { ico: true }), btn('table.align.right', 'align-right', 'Столбец — по правому краю', { ico: true })),
    btn('table.cols.equal', 'eq-cols', 'Выровнять ширину', { title: 'Одинаковая ширина столбцов' }),
  ) + stack(btn('table.density', 'density', 'Плотность', { menu: true, title: 'Отступы в ячейках' }), row(btn('table.size.up', 'text-up', 'Крупнее', { ico: true }), btn('table.size.down', 'text-down', 'Мельче', { ico: true }))))}
</div>
<div class="st-rpanel" data-panel="image" hidden>
  ${group('Стили рисунка', `<div class="st-gallery">${IMAGE_STYLES.map(imageTile).join('')}</div>`)}
  ${group('Рамка', btn('image.stroke', 'outline', 'Контур', { big: true, menu: true, swatch: 'istroke', title: 'Цвет, толщина и штрих контура' }) + btn('image.mat', 'mat', 'Паспарту', { big: true, menu: true, title: 'Поле вокруг снимка, как у фотографии в рамке' }))}
  ${group('Эффекты', stack(btn('image.shadow', 'shadow', 'Тень', { menu: true }), btn('image.radius', 'corner', 'Скругление', { menu: true }))
    + stack(btn('image.filter', 'recolor', 'Цвет', { menu: true, title: 'Чёрно-белый, сепия, приглушённый…' }), btn('image.opacity', 'opacity', 'Прозрачность', { menu: true })))}
  ${group('Кадр', btn('image.crop', 'crop', 'Кадр', { big: true, title: 'Сдвинуть снимок внутри рамки, как «Обрезка» в PowerPoint: тяните картинку. Масштаб — на панели над картинкой. Готово — Esc' }))}
  ${group('Сброс', btn('image.reset', 'reset', 'Сбросить', { big: true, title: 'Убрать всё оформление рисунка' }))}
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
  // ---------- рисунок: цвет — галерея превью; наведение примеряет фильтр на выделенные снимки ----------
  const filterGallery = () => {
    const paths = targets('image');
    const boxes = paths.flatMap((p) => [...h.stage().querySelectorAll<HTMLElement>(`.slide.on [data-block='${JSON.stringify(p)}'] .imgbox`)]);
    const src = boxes[0]?.querySelector('img')?.currentSrc ?? '';
    const curKey = first('image')?.filter;
    const cur = typeof curKey === 'string' && IMAGE_FILTERS[curKey] ? curKey : '';
    const saved = boxes.map((bx) => ({ bx, img: bx.querySelector('img'), cls: bx.className, style: bx.getAttribute('style'), imgStyle: bx.querySelector('img')?.getAttribute('style') ?? null }));
    const put = (el: Element | null, v: string | null) => { if (el) { if (v === null) el.removeAttribute('style'); else el.setAttribute('style', v); } };
    let picked = false;
    const restore = () => !picked && saved.forEach((x) => { x.bx.className = x.cls; put(x.bx, x.style); put(x.img, x.imgStyle); });
    const tryOn = (key: string) => {
      restore();
      const f = filterCss(key);
      for (const { bx, img } of saved) {
        if (img) img.style.filter = key ? IMAGE_FILTERS[key].css : 'none';
        bx.classList.toggle('img-tint', f.tint);
        if (f.tint) for (const d of f.box.split(';')) { const [k, ...v] = d.split(':'); bx.style.setProperty(k, v.join(':')); }
      }
    };
    const tile = (key: string, name: string) => {
      const f = filterCss(key);
      return `<button type="button" class="st-flt${key === cur ? ' on' : ''}" data-flt="${key}" title="${esc(name)}">`
        + `<i class="st-flt-img${f.tint ? ' img-tint' : ''}"${f.box ? ` style="${esc(f.box)}"` : ''}>${src ? `<img alt="" src="${esc(src)}"${f.img ? ` style="${esc(f.img)}"` : ''}>` : ''}</i><span>${esc(name)}</span></button>`;
    };
    const groups = Object.entries(IMAGE_FILTER_GROUPS).map(([g, label]) => {
      const list = Object.entries(IMAGE_FILTERS).filter(([, f]) => f.group === g);
      return `<h4>${esc(label)}</h4><div class="st-flt-grid">${g === 'base' ? tile('', 'Исходный') : ''}${list.map(([k, f]) => tile(k, f.name)).join('')}</div>`;
    }).join('');
    const pop = showPopover(anchor('image.filter'), `<div class="st-flt-pop">${groups}<p class="st-flt-note">Наведите — примерка на слайде, щелчок — применить</p></div>`, (b) => {
      const key = b.dataset.flt;
      if (key === undefined) return null;
      return { run: () => { restore(); picked = true; setAll('image', 'filter', key || undefined); } };
    }, 'st-fltpop');
    pop.addEventListener('pointerover', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-flt]');
      if (b) tryOn(b.dataset.flt!);
    });
    pop.addEventListener('pointerleave', restore);
    pop.addEventListener('focusin', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-flt]');
      if (b) tryOn(b.dataset.flt!);
    });
    // Закрыли без выбора (Esc, щелчок мимо) — снимки как были
    const mo = new MutationObserver(() => { if (!pop.isConnected) { mo.disconnect(); restore(); } });
    mo.observe(document.body, { childList: true });
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

  // ---------- таблица: ячейка, в которой был курсор ----------
  let lastCell: { table: string; r: number; c: number } | null = null;
  const cell = (): { r: number; c: number } => {
    const t = first('table');
    const rows = (t?.rows as unknown[][] | undefined) ?? [];
    const last = { r: rows.length - 1, c: Math.max(0, ((t?.header as unknown[]) ?? rows[0] ?? []).length - 1) };
    if (!lastCell || lastCell.table !== JSON.stringify(targets('table')[0])) return last;
    return { r: lastCell.r, c: lastCell.c };
  };
  h.stage().addEventListener('pointerdown', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('td[data-edit], th[data-edit]');
    const tbl = el?.closest<HTMLElement>('[data-type="table"]');
    if (!el || !tbl) return;
    try {
      const p = JSON.parse(el.getAttribute('data-edit')!) as Path;
      const isHead = p[p.length - 2] === 'header';
      lastCell = { table: tbl.getAttribute('data-block')!, r: isHead ? -1 : Number(p[p.length - 2]), c: Number(p[p.length - 1]) };
    } catch { /* не ячейка */ }
  }, true);

  type TableData = { header?: unknown[]; rows: unknown[][]; widths?: number[]; align?: string[] } & Record<string, unknown>;
  const editTable = (fn: (t: TableData, at: { r: number; c: number }) => void) => {
    const p = targets('table')[0];
    if (!p) return;
    const at = cell();
    ed.commit((d) => {
      const t = getAt(d, p) as TableData;
      t.rows = Array.isArray(t.rows) ? t.rows : [];
      fn(t, at);
    }, { rebuild: true });
  };
  const cols = (t: { header?: unknown[]; rows: unknown[][] }) => Math.max(t.header?.length ?? 0, ...t.rows.map((r) => r.length), 1);
  const addRow = (below: boolean) => editTable((t, at) => {
    const i = Math.max(0, Math.min(t.rows.length, at.r + (below ? 1 : 0)));
    t.rows.splice(i, 0, Array.from({ length: cols(t) }, () => ''));
    // Выделенная строка остаётся той же строкой данных
    if (Number.isInteger(t.highlight) && Number(t.highlight) >= i) t.highlight = Number(t.highlight) + 1;
    lastCell = null;
  });
  const addCol = (right: boolean) => editTable((t, at) => {
    const i = at.c + (right ? 1 : 0);
    const n = cols(t);
    t.header?.splice(i, 0, 'Столбец');
    t.rows.forEach((r) => { while (r.length < n) r.push(''); r.splice(i, 0, ''); });
    // Новый столбец — средней ширины среди остальных
    if (Array.isArray(t.widths)) t.widths.splice(i, 0, Math.round((t.widths.reduce((a, b) => a + Number(b), 0) / t.widths.length) * 100) / 100);
    if (Array.isArray(t.align)) t.align.splice(i, 0, '');
    lastCell = null;
  });
  const delRow = () => editTable((t, at) => {
    if (at.r < 0 || t.rows.length < 2) return;
    t.rows.splice(at.r, 1);
    const hl = Number(t.highlight);
    if (Number.isInteger(t.highlight)) {
      if (hl === at.r) delete t.highlight;
      else if (hl > at.r) t.highlight = hl - 1;
    }
    lastCell = null;
  });
  const delCol = () => editTable((t, at) => {
    if (cols(t) < 2) return;
    t.header?.splice(at.c, 1);
    t.rows.forEach((r) => r.splice(at.c, 1));
    for (const k of ['widths', 'align'] as const) { const a = t[k]; if (Array.isArray(a)) a.splice(at.c, 1); }
    lastCell = null;
  });
  /**
   * Подсветка того, что удалится: строка (r), столбец (c) или вся таблица — пока пункт меню под мышью.
   * Строка шапки — r = -1.
   */
  const killMark = (what: 'row' | 'col' | 'all', on: boolean) => {
    const box = h.stage().querySelector<HTMLElement>(`.slide.on [data-block="${CSS.escape(JSON.stringify(targets('table')[0] ?? ''))}"]`);
    const tbl = box?.querySelector('table');
    if (!box || !tbl) return;
    box.querySelectorAll('.tbl-kill').forEach((x) => x.classList.remove('tbl-kill'));
    box.classList.remove('tbl-kill-all');
    if (!on) return;
    const at = cell();
    if (what === 'all') box.classList.add('tbl-kill-all');
    else if (what === 'row') tbl.tBodies[0]?.rows[at.r]?.querySelectorAll('td').forEach((x) => x.classList.add('tbl-kill'));
    else [...tbl.rows].forEach((tr) => tr.cells[at.c]?.classList.add('tbl-kill'));
  };
  /** Меню таблицы: правый щелчок по ячейке и кнопка «Удалить» на ленте */
  const tableItems = (withInsert: boolean): MenuEntry[] => {
    const t = first('table');
    const rows = ((t?.rows as unknown[]) ?? []).length;
    const at = cell();
    const nCols = cols({ header: t?.header as unknown[], rows: (t?.rows as unknown[][]) ?? [] });
    return [
      ...(withInsert ? [
        { label: 'Вставить строку сверху', icon: 'row-above', run: () => addRow(false) },
        { label: 'Вставить строку снизу', icon: 'row-below', run: () => addRow(true) },
        { label: 'Вставить столбец слева', icon: 'col-left', run: () => addCol(false) },
        { label: 'Вставить столбец справа', icon: 'col-right', run: () => addCol(true) },
        null,
      ] : []),
      { label: at.r < 0 ? 'Удалить строку (шапку скрывает «Строка заголовка»)' : 'Удалить строку', icon: 'row-del', disabled: rows < 2 || at.r < 0, run: delRow, preview: (on) => killMark('row', on) },
      { label: 'Удалить столбец', icon: 'col-del', disabled: nCols < 2, run: delCol, preview: (on) => killMark('col', on) },
      null,
      { label: 'Удалить таблицу', icon: 'trash', danger: true, run: () => h.run('obj.del'), preview: (on) => killMark('all', on) },
    ];
  };
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
    'image.mat': { run: () => choice('image.mat', 'mat', [[undefined, 'Без паспарту'], [6, 'Узкое — 6 px'], [12, 'Среднее — 12 px'], [20, 'Широкое — 20 px'], [32, 'Очень широкое — 32 px']], undefined, 'image'), enabled: isImage },
    'image.shadow': { run: () => choice('image.shadow', 'shadow', [[undefined, 'Без тени'], ...Object.entries(IMAGE_SHADOWS).map(([v, s]) => [v, s.name] as [string, string])], undefined, 'image'), enabled: isImage },
    'image.radius': { run: () => choice('image.radius', 'radius', [[0, 'Острые углы'], [6, 'Малое — 6 px'], [undefined, 'Обычное — 12 px'], [24, 'Большое — 24 px'], [48, 'Очень большое — 48 px'], ['circle', 'Круг или овал']], undefined, 'image'), enabled: isImage },
    'image.filter': { run: () => filterGallery(), enabled: isImage },
    'image.opacity': { run: () => choice('image.opacity', 'opacity', [[undefined, 'Непрозрачная'], [0.8, '80 %'], [0.6, '60 %'], [0.4, '40 %'], [0.2, '20 %']], undefined, 'image'), enabled: isImage },
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
        ed.commit((d) => paths.forEach((p) => {
          const b = getAt(d, p) as Block;
          // Стиль — про рамку, тень и форму; цвет и прозрачность картинки остаются
          for (const k of IMAGE_LOOK_KEYS) if (k !== 'filter' && k !== 'opacity') delete b[k];
          Object.assign(b, st.props);
        }), { rebuild: true });
      },
      enabled: isImage,
      active: () => {
        const b = first('image');
        return !!b && IMAGE_LOOK_KEYS.every((k) => k === 'filter' || k === 'opacity' || b[k] === (st.props as Record<string, unknown>)[k]);
      },
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
        list[at.c] = a;
        t.align = list;
      }),
      enabled: isTable, active: () => isTable() && colAlign() === a,
    };
  }
  for (const v of ['top', 'middle', 'bottom']) {
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
