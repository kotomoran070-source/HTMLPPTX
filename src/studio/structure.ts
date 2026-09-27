import { KEY, type Path } from '../engine/data';
import { blockName } from '../engine/editor/block-edit';

/**
 * Состав слайда и блоков: из чего сложен элемент под курсором или выделенный блок.
 * Путь (слайд › сетка › карточка › заголовок) и части блока берутся из разметки:
 * data-block — блоки, data-edit — поля с текстом.
 */

const FIELDS: Record<string, string> = {
  title: 'Заголовок', text: 'Текст', lead: 'Подзаголовок', caption: 'Подпись', label: 'Подпись', value: 'Значение',
  sub: 'Подпись', meta: 'Нижняя строка', badge: 'Надпись', note: 'Подпись', delta: 'Изменение', author: 'Автор', role: 'Должность',
  date: 'Дата', node: 'Подпись узла', start: 'Подпись слева', end: 'Подпись справа', url: 'Ссылка', items: 'Пункт',
  header: 'Шапка', rows: 'Строка', cells: 'Ячейка', steps: 'Шаг', texts: 'Текст', buttons: 'Кнопка', chips: 'Чип',
};

export interface Crumb {
  label: string;
  /** Элемент блока: клик по звену выделяет его */
  el?: HTMLElement;
  /** Поле с текстом: клик начинает правку */
  field?: HTMLElement;
}

const readPath = (el: Element, attr: string): Path | null => {
  try {
    const v = JSON.parse(el.getAttribute(attr) ?? '');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/** Название поля по его пути: «Заголовок», «Пункт 3», «Ячейка 2 · 1». */
export function fieldName(path: Path): string {
  const k = path.indexOf(KEY);
  if (k >= 0) return 'Ключ';
  const last = path[path.length - 1];
  if (typeof last === 'string') return FIELDS[last] ?? last;
  // Элемент списка: по имени списка выше
  const prev = path[path.length - 2];
  if (typeof prev === 'number' && path[path.length - 3] === 'rows') return `Ячейка ${prev + 1} · ${last + 1}`;
  if (prev === 'header') return `Столбец ${last + 1}`;
  const name = typeof prev === 'string' ? FIELDS[prev] ?? 'Элемент' : 'Элемент';
  return `${name} ${last + 1}`;
}

/** Путь от слайда до элемента. */
export function crumbs(target: Element | null, slideLabel: string): Crumb[] {
  const out: Crumb[] = [];
  let el: Element | null = target;
  const field = target?.closest<HTMLElement>('[data-edit]');
  if (field && !(field instanceof SVGElement)) {
    const p = readPath(field, 'data-edit');
    if (p) out.unshift({ label: fieldName(p), field });
  }
  while (el && !el.classList.contains('slide')) {
    if (el.hasAttribute('data-block')) out.unshift({ label: blockName(el.getAttribute('data-type') ?? '').replace(/&[^;]+;/g, ''), el: el as HTMLElement });
    el = el.parentElement;
  }
  out.unshift({ label: slideLabel });
  return out;
}

export interface Part {
  label: string;
  snippet: string;
  kind: 'block' | 'field';
  el: HTMLElement;
}

/** Непосредственные части блока: вложенные блоки и собственные поля с текстом. */
export function partsOf(root: HTMLElement): Part[] {
  const own = (el: Element) => el.parentElement?.closest('[data-block]') === root;
  const out: Part[] = [];
  root.querySelectorAll<HTMLElement>('[data-block], [data-edit]').forEach((el) => {
    if (el instanceof SVGElement && !el.hasAttribute('data-block')) return;
    if (el.hasAttribute('data-block')) {
      if (!own(el)) return;
      out.push({ label: blockName(el.getAttribute('data-type') ?? '').replace(/&[^;]+;/g, ''), snippet: snippet(el), kind: 'block', el });
      return;
    }
    // Поле внутри вложенного блока относится к нему, не к этому
    if (el.closest('[data-block]') !== root) return;
    const p = readPath(el, 'data-edit');
    if (p) out.push({ label: fieldName(p), snippet: snippet(el), kind: 'field', el });
  });
  return out;
}

function snippet(el: HTMLElement): string {
  return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}
