import { icon } from '../components/icons';
import { SHAPE_COLORS } from '../components/shape/shape';
import { getAt, setAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { esc } from '../engine/html';
import type { Block, Deck } from '../types';
import { showMenu, type MenuEntry } from './menu';

/**
 * Контекстные вкладки ленты, как «Формат фигуры» и «Конструктор таблиц» в PowerPoint:
 * появляются, пока выделена фигура или таблица, и несут её оформление —
 * панель свойств справа остаётся для содержимого и положения.
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
}

export type ContextTab = 'shape' | 'table';

/** Какая контекстная вкладка нужна для выделения (у группы — если все одного типа). */
export function contextTab(deck: Deck, ed: Editor): ContextTab | null {
  const sel = ed.selection;
  if (!sel) return null;
  const paths = sel.group.length > 1 ? sel.group : [sel.block];
  const types = new Set(paths.map((p) => (getAt(deck, p) as Block | undefined)?.type ?? ''));
  if (types.size !== 1) return null;
  const t = [...types][0];
  return t === 'shape' || t === 'table' ? t : null;
}

const btn = (cmd: string, ic: string, label: string, opts: { big?: boolean; menu?: boolean; title?: string; swatch?: string } = {}) =>
  `<button type="button" class="st-rb${opts.big ? ' big' : ''}" data-cmd="${cmd}" title="${esc(opts.title ?? label)}"${opts.menu ? ' aria-haspopup="menu"' : ''}>`
  + `${icon(ic)}${opts.swatch ? `<i class="st-rb-sw" data-sw="${opts.swatch}"></i>` : ''}<span>${esc(label)}${opts.menu ? ' ▾' : ''}</span></button>`;

const group = (label: string, body: string) =>
  `<div class="st-rgroup" role="group" aria-label="${esc(label)}"><div class="st-rgroup-body">${body}</div><div class="st-rgroup-label">${esc(label)}</div></div>`;

const KINDS: [string, string, string][] = [
  ['round', 'sh-round', 'Скруглённый'], ['rect', 'sh-rect', 'Прямоугольник'], ['pill', 'sh-pill', 'Капсула'],
  ['ellipse', 'sh-ellipse', 'Овал'], ['line', 'sh-line', 'Линия'], ['arrow', 'sh-arrow', 'Стрелка'],
];

const VARIANTS: [string, string][] = [['lines', 'Линии'], ['stripes', 'Зебра'], ['boxed', 'Сетка'], ['accent', 'Акцентная шапка']];

/** Вкладки и панели ленты (скрыты, пока нет подходящего выделения). */
export function contextTabsHtml(): string {
  return `<button type="button" role="tab" data-tab="shape" class="ctx" aria-selected="false" hidden>Фигура</button>`
    + `<button type="button" role="tab" data-tab="table" class="ctx" aria-selected="false" hidden>Таблица</button>`;
}

export function contextPanelsHtml(): string {
  return `<div class="st-rpanel" data-panel="shape" hidden>
  ${group('Форма', `<div class="st-rgrid">${KINDS.map(([k, ic, l]) => btn(`shape.kind.${k}`, ic, l)).join('')}</div>`)}
  ${group('Цвет', btn('shape.fill', 'fill', 'Заливка', { big: true, menu: true, swatch: 'fill' }) + btn('shape.stroke', 'outline', 'Контур', { big: true, menu: true, swatch: 'stroke' }) + btn('shape.width', 'weight', 'Толщина', { big: true, menu: true }))}
  ${group('Эффекты', `<div class="st-rstack">${btn('shape.shadow', 'shadow', 'Тень', { menu: true })}${btn('shape.radius', 'corner', 'Скругление', { menu: true })}</div><div class="st-rstack">${btn('shape.rotate', 'rotate', 'Поворот', { menu: true })}</div>`)}
</div>
<div class="st-rpanel" data-panel="table" hidden>
  ${group('Стиль таблицы', VARIANTS.map(([v, l]) => `<button type="button" class="st-rb big st-tstyle" data-cmd="table.variant.${v}" title="${l}"><i class="st-tprev ${v}"><b></b><b></b><b></b><b></b></i><span>${l}</span></button>`).join(''))}
  ${group('Параметры', `<div class="st-rstack">${btn('table.head', 'check', 'Строка заголовка')}${btn('table.labels', 'check', 'Первый столбец')}</div><div class="st-rstack">${btn('table.highlight', 'check', 'Выделить строку', { title: 'Выделить строку, в которой курсор' })}</div>`)}
  ${group('Строки и столбцы', `<div class="st-rstack">${btn('table.row.above', 'row-add', 'Строка выше')}${btn('table.row.below', 'row-add', 'Строка ниже')}</div><div class="st-rstack">${btn('table.col.left', 'col-add', 'Столбец слева')}${btn('table.col.right', 'col-add', 'Столбец справа')}</div><div class="st-rstack">${btn('table.row.del', 'row-del', 'Удалить строку')}${btn('table.col.del', 'col-del', 'Удалить столбец')}</div>`)}
  ${group('Текст', `<div class="st-rstack">${btn('table.size.up', 'text-up', 'Крупнее')}${btn('table.size.down', 'text-down', 'Мельче')}</div>`)}
</div>`;
}

/** Цвет из данных фигуры → CSS для образца на кнопке. */
const swatchCss = (v: unknown, fallback: string): string => {
  if (v === 'none') return 'transparent';
  if (typeof v === 'string' && SHAPE_COLORS[v]) return SHAPE_COLORS[v].css;
  return typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
};

export function contextCommands(h: ContextHost): Record<string, Command> {
  const { deck, editor: ed } = h;
  /** Выделенные блоки нужного типа: одна фигура или группа фигур */
  const targets = (type: string): Path[] => {
    const sel = ed.selection;
    if (!sel) return [];
    const paths = sel.group.length > 1 ? sel.group : [sel.block];
    return paths.every((p) => (getAt(deck, p) as Block | undefined)?.type === type) ? paths : [];
  };
  const first = (type: string) => {
    const p = targets(type)[0];
    return p ? (getAt(deck, p) as Block) : null;
  };
  const setAll = (type: string, key: string, value: unknown) => {
    const paths = targets(type);
    if (!paths.length) return;
    ed.commit((d) => paths.forEach((p) => setAt(d, [...p, key], value === undefined || value === '' ? undefined : value)), { rebuild: true });
  };
  const isShape = () => targets('shape').length > 0;
  const isTable = () => targets('table').length > 0;
  const anchor = (cmd: string) => document.querySelector<HTMLElement>(`.st-ribbon [data-cmd="${cmd}"]`)!;

  /** Меню цвета: роли темы, «нет», свой цвет. */
  const colorMenu = (cmd: string, key: 'fill' | 'stroke') => {
    const cur = first('shape')?.[key];
    const items: MenuEntry[] = [
      { label: 'Нет', swatch: 'linear-gradient(135deg, transparent 45%, #EF4444 45% 55%, transparent 55%), var(--surf)', checked: cur === 'none', run: () => setAll('shape', key, 'none') },
      null,
      ...Object.entries(SHAPE_COLORS).map(([k, c]) => ({ label: c.name, swatch: c.css, checked: cur === k, run: () => setAll('shape', key, k) })),
      null,
      {
        label: 'Другой цвет…', swatch: 'conic-gradient(#f87171, #fbbf24, #34d399, #60a5fa, #c084fc, #f87171)', checked: typeof cur === 'string' && cur.startsWith('#'),
        run: () => {
          const input = document.createElement('input');
          input.type = 'color';
          if (typeof cur === 'string' && /^#[0-9a-f]{6}$/i.test(cur)) input.value = cur;
          input.addEventListener('change', () => setAll('shape', key, input.value.toUpperCase()));
          input.click();
        },
      },
    ];
    showMenu(anchor(cmd), items);
  };
  const choice = (cmd: string, key: string, options: [unknown, string][], def: unknown) => {
    const cur = first('shape')?.[key] ?? def;
    showMenu(anchor(cmd), options.map(([v, l]) => ({ label: l, checked: cur === v, run: () => setAll('shape', key, v === def ? undefined : v) })));
  };

  // ---------- таблица: ячейка, в которой был курсор ----------
  const cell = (): { r: number; c: number } => {
    const t = first('table');
    const rows = (t?.rows as unknown[][] | undefined) ?? [];
    const last = { r: rows.length - 1, c: Math.max(0, ((t?.header as unknown[]) ?? rows[0] ?? []).length - 1) };
    if (!lastCell || lastCell.table !== JSON.stringify(targets('table')[0])) return last;
    return { r: lastCell.r, c: lastCell.c };
  };
  let lastCell: { table: string; r: number; c: number } | null = null;
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

  const editTable = (fn: (t: { header?: unknown[]; rows: unknown[][]; widths?: number[]; align?: string[] } & Record<string, unknown>, at: { r: number; c: number }) => void) => {
    const p = targets('table')[0];
    if (!p) return;
    const at = cell();
    ed.commit((d) => {
      const t = getAt(d, p) as { header?: unknown[]; rows: unknown[][] } & Record<string, unknown>;
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
    t.header?.splice(i, 0, 'Столбец');
    t.rows.forEach((r) => r.splice(i, 0, ''));
    for (const k of ['widths', 'align'] as const) {
      const a = t[k] as unknown[] | undefined;
      if (Array.isArray(a)) a.splice(i, 0, k === 'widths' ? 1 : 'left');
    }
    lastCell = null;
  });

  const cmds: Record<string, Command> = {
    'shape.fill': { run: () => colorMenu('shape.fill', 'fill'), enabled: isShape },
    'shape.stroke': { run: () => colorMenu('shape.stroke', 'stroke'), enabled: isShape },
    'shape.width': { run: () => choice('shape.width', 'width', [[0, 'Без контура'], [1, '1 px'], [2, '2 px'], [3, '3 px'], [4, '4 px'], [6, '6 px'], [8, '8 px']], undefined), enabled: isShape },
    'shape.shadow': { run: () => choice('shape.shadow', 'shadow', [[undefined, 'Без тени'], ['sm', 'Лёгкая'], ['md', 'Заметная']], undefined), enabled: isShape },
    'shape.radius': { run: () => choice('shape.radius', 'radius', [[0, 'Острые углы'], [8, '8 px'], [16, '16 px'], [24, '24 px'], [40, '40 px']], undefined), enabled: () => isShape() && ['round', 'rect', undefined].includes(first('shape')?.kind as string | undefined) },
    'shape.rotate': { run: () => choice('shape.rotate', 'rotate', [[undefined, 'Без поворота'], [45, '45°'], [90, '90°'], [135, '135°'], [180, '180°'], [-45, '−45°'], [-90, '−90°']], undefined), enabled: isShape },
    'table.head': { run: () => setAll('table', 'head', first('table')?.head === false ? undefined : false), enabled: () => isTable() && Array.isArray(first('table')?.header), active: () => isTable() && first('table')?.head !== false && Array.isArray(first('table')?.header) },
    'table.labels': { run: () => setAll('table', 'labels', first('table')?.labels ? undefined : true), enabled: isTable, active: () => !!first('table')?.labels },
    'table.highlight': {
      run: () => { const at = cell(); setAll('table', 'highlight', first('table')?.highlight === at.r || at.r < 0 ? undefined : at.r); },
      enabled: isTable, active: () => isTable() && Number.isInteger(first('table')?.highlight),
    },
    'table.row.above': { run: () => addRow(false), enabled: isTable },
    'table.row.below': { run: () => addRow(true), enabled: isTable },
    'table.col.left': { run: () => addCol(false), enabled: isTable },
    'table.col.right': { run: () => addCol(true), enabled: isTable },
    'table.row.del': {
      run: () => editTable((t, at) => {
        if (at.r < 0 || t.rows.length < 2) return;
        t.rows.splice(at.r, 1);
        const hl = Number(t.highlight);
        if (Number.isInteger(t.highlight)) {
          if (hl === at.r) delete t.highlight;
          else if (hl > at.r) t.highlight = hl - 1;
        }
        lastCell = null;
      }), enabled: () => isTable() && (((first('table')?.rows as unknown[]) ?? []).length > 1) },
    'table.col.del': {
      run: () => editTable((t, at) => {
        if (cols(t) < 2) return;
        t.header?.splice(at.c, 1);
        t.rows.forEach((r) => r.splice(at.c, 1));
        for (const k of ['widths', 'align'] as const) { const a = t[k]; if (Array.isArray(a)) a.splice(at.c, 1); }
        lastCell = null;
      }),
      enabled: isTable,
    },
    'table.size.up': { run: () => setAll('table', 'size', Math.min(40, (Number(first('table')?.size) || 17) + 1)), enabled: isTable },
    'table.size.down': { run: () => setAll('table', 'size', Math.max(10, (Number(first('table')?.size) || 17) - 1)), enabled: isTable },
  };
  for (const [k] of KINDS) {
    cmds[`shape.kind.${k}`] = { run: () => setAll('shape', 'kind', k === 'round' ? undefined : k), enabled: isShape, active: () => isShape() && (first('shape')?.kind ?? 'round') === k };
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
  document.querySelectorAll<HTMLElement>('.st-rb-sw').forEach((el) => {
    const key = el.dataset.sw as 'fill' | 'stroke';
    el.style.background = b?.type === 'shape' ? swatchCss(b[key], key === 'fill' ? 'var(--acs)' : 'transparent') : 'transparent';
  });
}
