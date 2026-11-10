/**
 * «Главная» → «Шрифт» без правки текста, как в PowerPoint: выделены объекты (один, несколько или все
 * на слайде — Ctrl+A) — шрифт, размер, цвет, начертание и выравнивание ложатся на весь их текст сразу:
 * надписи, текст фигур, карточки, пункты шкалы и списков, ячейки таблиц
 */
import type { Editor } from '../engine/editor/editor';
import { putStyle, type TextTarget } from '../engine/editor/text-edit';
import { getAt, KEY, setAt, type Path } from '../engine/data';
import { dropSpanAttrs } from '../engine/span-attrs';
import type { TextStyle } from '../engine/text-style';

interface Field {
  el: HTMLElement;
  /** Где текст */
  path: Path;
  /** Оформление в owner.styles[field] … */
  owner: Path | null;
  field: string;
  /** … или по своему пути (ячейка таблицы) */
  at: Path | null;
}

const readPath = (el: Element, attr: string): Path | null => {
  try {
    const v = JSON.parse(el.getAttribute(attr) ?? 'null') as unknown;
    return Array.isArray(v) ? (v as Path) : null;
  } catch {
    return null;
  }
};

const within = (p: Path, base: Path) => base.length <= p.length && base.every((x, i) => x === p[i]);

/** Текстовые поля выделенных объектов на слайде, у которых есть своё оформление */
function fieldsOf(stage: HTMLElement, blocks: Path[]): Field[] {
  const out: Field[] = [];
  for (const el of stage.querySelectorAll<HTMLElement>('.slide.on [data-edit]')) {
    const path = readPath(el, 'data-edit');
    if (!path || path.includes(KEY) || !blocks.some((b) => within(path, b))) continue;
    const owner = readPath(el, 'data-ed-style');
    const at = owner ? null : readPath(el, 'data-ed-style-at');
    if (!owner && !at) continue;
    out.push({ el, path, owner, field: String(path[path.length - 1]), at });
  }
  return out;
}

const tidy = (st: TextStyle): TextStyle => {
  for (const k of Object.keys(st) as (keyof TextStyle)[]) if (st[k] === undefined || st[k] === null || (st[k] as unknown) === '') delete st[k];
  return st;
};

export function objectsText(ed: Editor, deck: () => unknown, stage: () => HTMLElement, blocks: Path[], refresh?: () => void): TextTarget | null {
  if (!blocks.length || !fieldsOf(stage(), blocks).length) return null;
  const styleOf = (f: Field): TextStyle => {
    const v = (f.owner ? getAt(deck(), [...f.owner, 'styles', f.field]) : getAt(deck(), f.at!)) as TextStyle | undefined;
    return v && typeof v === 'object' ? { ...v } : {};
  };
  /** Записать оформление полей: next — новое по прежнему и по полю */
  const write = (fields: Field[], next: (st: TextStyle, f: Field) => TextStyle, d: unknown) => {
    const done = new Set<string>();
    for (const f of fields) {
      const key = `${JSON.stringify(f.owner ?? f.at)}|${f.owner ? f.field : ''}`;
      if (done.has(key)) continue;
      done.add(key);
      if (f.owner) {
        const owner = getAt(d, f.owner) as Record<string, unknown> | undefined;
        if (!owner || typeof owner !== 'object') continue;
        const all = { ...((owner.styles as Record<string, TextStyle> | undefined) ?? {}) };
        const st = tidy(next({ ...(all[f.field] ?? {}) }, f));
        if (Object.keys(st).length) all[f.field] = st;
        else delete all[f.field];
        if (Object.keys(all).length) owner.styles = all;
        else delete owner.styles;
      } else {
        const cur = getAt(d, f.at!) as TextStyle | undefined;
        putStyle(d, f.at!, tidy(next(cur && typeof cur === 'object' ? { ...cur } : {}, f)));
      }
    }
  };
  return {
    els: () => fieldsOf(stage(), blocks).map((f) => f.el),
    step: (delta) => {
      const fields = fieldsOf(stage(), blocks);
      if (!fields.length) return;
      // Размер поля сейчас — свой или из оформления (как на слайде): до записи, пока поля на месте
      const now = new Map(fields.map((f) => [f, Math.round(parseFloat(getComputedStyle(f.el).fontSize))]));
      ed.commit((d) => write(fields, (st, f) => ({ ...st, size: Math.max(6, Math.min(300, (Number(st.size) || now.get(f)!) + delta)) }), d), { rebuild: true });
      refresh?.();
    },
    styles: () => {
      const f = fieldsOf(stage(), blocks)[0];
      return f ? styleOf(f) : {};
    },
    // Стиль или эффект текста — каждому полю по его прежнему (цвета частей текста остаются, как у «Надписи»)
    edit: (fn) => {
      const fields = fieldsOf(stage(), blocks);
      if (!fields.length) return;
      ed.commit((d) => write(fields, (st) => fn(st), d), { rebuild: true });
      refresh?.();
    },
    apply: (patch, o) => {
      const fields = fieldsOf(stage(), blocks);
      if (!fields.length) return;
      // Цвет, шрифт и точный размер — и частям текста (их своё снимается); «больше/меньше» — пропорционально
      const drop: ('paint' | 'size' | 'font')[] = patch === null ? ['paint', 'size', 'font']
        : [...('color' in patch ? ['paint' as const] : []), ...('font' in patch ? ['font' as const] : []), ...('size' in patch && o?.exact ? ['size' as const] : [])];
      ed.commit((d) => {
        write(fields, (st) => (patch === null ? {} : { ...st, ...patch }), d);
        for (const f of fields) {
          const text = getAt(d, f.path);
          if (drop.length && typeof text === 'string' && text.includes('|')) {
            const next = dropSpanAttrs(text, drop);
            if (next !== text) setAt(d, f.path, next);
          }
        }
      }, { rebuild: true });
      refresh?.();
    },
  };
}
