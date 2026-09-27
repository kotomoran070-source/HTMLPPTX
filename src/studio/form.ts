import { icon, iconNames } from '../components/icons';
import { getAt, setAt, type Path } from '../engine/data';
import { esc } from '../engine/html';
import type { Field } from './schema';

/**
 * Форма свойств по схеме (schema.ts). Разметка строится один раз для предмета,
 * значения подставляются из данных при каждом обновлении, правка — одна запись в данные.
 * Каждое поле знает свой путь в презентации (data-p) и тип (data-t).
 */

const P = (p: Path) => esc(JSON.stringify(p));

function row(label: string, body: string, hint?: string, wide = false): string {
  return `<label class="st-f${wide ? ' wide' : ''}"><span class="st-f-l">${esc(label)}</span>${body}${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}

const ICON_OPTIONS = iconNames.filter((n) => !/^(obj-|align-|slide-add|minus|drag|sparkle|home|frame|eraser|contain|cover)/.test(n));

function listTools(p: Path, i: number, n: number, what: string): string {
  return `<span class="st-f-tools">`
    + `<button type="button" data-act="up" data-p="${P(p)}" data-i="${i}" title="Выше" aria-label="${esc(what)} выше"${i === 0 ? ' disabled' : ''}>${icon('up')}</button>`
    + `<button type="button" data-act="down" data-p="${P(p)}" data-i="${i}" title="Ниже" aria-label="${esc(what)} ниже"${i === n - 1 ? ' disabled' : ''}>${icon('back')}</button>`
    + `<button type="button" data-act="del" data-p="${P(p)}" data-i="${i}" title="Удалить" aria-label="Удалить: ${esc(what)}" class="danger">${icon('trash')}</button></span>`;
}

const addBtn = (p: Path, label: string, act = 'add') =>
  `<button type="button" class="st-f-add" data-act="${act}" data-p="${P(p)}">${icon('plus')}<span>${esc(label)}</span></button>`;

/** Разметка полей объекта по пути base. */
export function formHtml(fields: Field[], data: unknown, base: Path): string {
  return fields.map((f) => fieldHtml(f, data, [...base, f.k])).join('');
}

function fieldHtml(f: Field, data: unknown, p: Path): string {
  const v = getAt(data, p);
  switch (f.type) {
    case 'text':
    case 'url':
      return row(f.label, `<input type="${f.type === 'url' ? 'url' : 'text'}" data-t="text" data-p="${P(p)}" placeholder="${esc(f.placeholder ?? '')}" spellcheck="${f.type === 'text'}">`, f.hint);
    case 'textarea':
      return row(f.label, `<textarea rows="3" data-t="text" data-p="${P(p)}" placeholder="${esc(f.placeholder ?? '')}"></textarea>`, f.hint, true);
    case 'number':
      return row(f.label, `<input type="number" data-t="number" data-p="${P(p)}"${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''} step="${f.step ?? 1}" placeholder="${esc(f.placeholder ?? '')}">`, f.hint);
    case 'select':
      return row(f.label, `<select data-t="select" data-p="${P(p)}">${f.options.map(([val, l]) => `<option value="${esc(val)}">${esc(l)}</option>`).join('')}</select>`, f.hint);
    case 'bool':
      return `<label class="st-p-check"><input type="checkbox" data-t="bool" data-p="${P(p)}" data-def="${f.default ? 1 : 0}"><span>${esc(f.label)}</span></label>`;
    case 'icon':
      return row(f.label, `<span class="st-f-icon"><i data-icon-prev="${P(p)}"></i><select data-t="select" data-p="${P(p)}">${ICON_OPTIONS.map((n) => `<option value="${n}">${n}</option>`).join('')}</select></span>`);
    case 'image':
      return row(f.label, `<span class="st-f-img"><span class="st-f-img-prev" data-img-prev="${P(p)}"></span>`
        + `<button type="button" class="st-pbtn" data-act="pick" data-p="${P(p)}">${icon('image')}<span>${v ? 'Заменить' : 'Выбрать'}…</span></button>`
        + (v ? `<button type="button" class="st-f-x" data-act="clear" data-p="${P(p)}" title="Убрать" aria-label="Убрать картинку">${icon('close')}</button>` : '')
        + `</span>`, f.hint, true);
    case 'numbers':
      return row(f.label, `<textarea rows="2" data-t="numbers" data-p="${P(p)}" spellcheck="false"></textarea>`,
        f.hint ?? 'Через пробел или запятую, дробные — через точку', true);
    case 'strings': {
      const list = Array.isArray(v) ? v : [];
      return `<div class="st-f-list"><span class="st-f-l">${esc(f.label)}</span>`
        + list.map((_x, i) => `<div class="st-f-item"><input type="text" data-t="text" data-keep-empty data-p="${P([...p, i])}" aria-label="${esc(f.item)} ${i + 1}">${listTools(p, i, list.length, f.item)}</div>`).join('')
        + addBtn(p, `${f.item}`, 'add-str') + `</div>`;
    }
    case 'chips': {
      const list = Array.isArray(v) ? v : [];
      return `<div class="st-f-list"><span class="st-f-l">${esc(f.label)}</span>`
        + list.map((_x, i) => `<div class="st-f-item"><button type="button" class="st-f-star" data-act="star" data-p="${P([...p, i])}" title="Выделить чип" aria-label="Выделить чип ${i + 1}">★</button>`
          + `<input type="text" data-t="chip" data-p="${P([...p, i])}" aria-label="Чип ${i + 1}">${listTools(p, i, list.length, 'Чип')}</div>`).join('')
        + addBtn(p, 'Чип', 'add-chip') + `</div>`;
    }
    case 'kv': {
      const obj = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
      const keys = Object.keys(obj);
      return `<div class="st-f-list"><span class="st-f-l">${esc(f.label)}</span>`
        + keys.map((key, i) => `<div class="st-f-kv"><input type="text" data-t="kvkey" data-p="${P(p)}" data-key="${esc(key)}" value="${esc(key)}" aria-label="Ключ ${i + 1}">`
          + `<input type="text" data-t="text" data-keep-empty data-p="${P([...p, key])}" aria-label="Значение ${i + 1}">`
          + `<span class="st-f-tools"><button type="button" data-act="kvdel" data-p="${P(p)}" data-key="${esc(key)}" class="danger" title="Удалить строку" aria-label="Удалить строку ${i + 1}">${icon('trash')}</button></span></div>`).join('')
        + addBtn(p, 'Строка', 'kvadd') + `</div>`;
    }
    case 'rows': {
      const list = Array.isArray(v) ? v : [];
      return `<div class="st-f-list"><span class="st-f-l">${esc(f.label)}</span>`
        + list.map((item, i) => `<fieldset class="st-f-row"><legend>${esc(f.item)} ${i + 1}${listTools(p, i, list.length, f.item)}</legend>`
          + f.fields.map((sf) => {
            // Элемент-строка («Redis» в ячейках панели): первое поле правит саму строку
            if (typeof item === 'string' && f.asString && sf.k === f.asString) {
              return row(sf.label, `<input type="text" data-t="text" data-p="${P([...p, i])}">`);
            }
            return fieldHtml(sf, data, [...p, i, sf.k]).replace(/data-p="/g, `data-as="${typeof item === 'string' ? esc(f.asString ?? '') : ''}" data-p="`);
          }).join('')
          + `</fieldset>`).join('')
        + `<button type="button" class="st-f-add" data-act="add-row" data-p="${P(p)}">${icon('plus')}<span>${esc(f.item)}</span></button></div>`;
    }
    case 'group':
      return `<fieldset class="st-f-group"><legend>${esc(f.label)}</legend>${formHtml(f.fields, data, p)}</fieldset>`;
  }
}

/** Подпись формы: длины списков и ключи словарей. Сменилась — форму нужно перестроить. */
export function formSig(fields: Field[], data: unknown, base: Path): string {
  return fields.map((f) => {
    const v = getAt(data, [...base, f.k]);
    if (f.type === 'rows') {
      const list = Array.isArray(v) ? v : [];
      return `${f.k}[${list.map((it, i) => (typeof it === 'string' ? 's' : formSig(f.fields, data, [...base, f.k, i]))).join(',')}]`;
    }
    if (f.type === 'strings' || f.type === 'chips') return `${f.k}:${Array.isArray(v) ? v.length : 0}`;
    if (f.type === 'kv') return `${f.k}:${v && typeof v === 'object' ? Object.keys(v).join('|') : ''}`;
    if (f.type === 'image') return `${f.k}:${v ? 1 : 0}`;
    if (f.type === 'group') return `${f.k}{${formSig(f.fields, data, [...base, f.k])}}`;
    return '';
  }).join(';');
}

const readP = (el: Element) => JSON.parse(el.getAttribute('data-p') ?? '[]') as Path;

/** Подставить значения из данных; поле в фокусе не трогаем. */
export function fillForm(root: HTMLElement, data: unknown, resolveUrl: (src: string) => string): void {
  root.querySelectorAll<HTMLInputElement>('[data-t][data-p]').forEach((el) => {
    if (el === document.activeElement) return;
    const t = el.dataset.t!;
    const p = readP(el);
    let v = getAt(data, p);
    // Поле строки-элемента (ячейка «Redis»): значения ещё нет, кроме главного
    const as = el.dataset.as;
    if (as !== undefined && as !== '' && typeof getAt(data, p.slice(0, -1)) === 'string') v = p[p.length - 1] === as ? getAt(data, p.slice(0, -1)) : undefined;
    if (t === 'bool') {
      el.checked = v === undefined ? el.dataset.def === '1' : !!v;
    } else if (t === 'numbers') {
      el.value = Array.isArray(v) ? v.join(', ') : '';
    } else if (t === 'chip') {
      const s = typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as { text?: string }).text ?? '') : '';
      el.value = s.replace(/(?<!\\)\*$/, '');
      const accent = typeof v === 'string' ? /(?<!\\)\*$/.test(v) : !!(v as { accent?: boolean })?.accent;
      el.parentElement?.querySelector('.st-f-star')?.classList.toggle('on', accent);
    } else if (t === 'kvkey') {
      el.value = el.dataset.key ?? '';
    } else {
      el.value = v === undefined || v === null ? '' : String(v);
    }
  });
  root.querySelectorAll<HTMLElement>('[data-icon-prev]').forEach((el) => {
    const v = getAt(data, JSON.parse(el.dataset.iconPrev!));
    el.innerHTML = icon(typeof v === 'string' ? v : 'link');
  });
  root.querySelectorAll<HTMLElement>('[data-img-prev]').forEach((el) => {
    const v = getAt(data, JSON.parse(el.dataset.imgPrev!));
    el.innerHTML = typeof v === 'string' && v ? `<img alt="" src="${esc(resolveUrl(v))}">` : `<span>${icon('image')}</span>`;
  });
}

/** Записать значение в черновик данных. Пустое — удалить поле. */
function write(d: unknown, p: Path, value: unknown, as?: string): void {
  // Поле строки-элемента: сначала строка становится объектом
  const parent = p.slice(0, -1);
  if (as && typeof getAt(d, parent) === 'string') setAt(d, parent, { [as]: getAt(d, parent) });
  setAt(d, p, value);
}

export interface FormEdit {
  commit(fn: (d: unknown) => void): void;
  pickImage(path: Path): void;
}

/** Правка из поля формы (change). Возвращает false, если значение не принято. */
export function onFieldChange(el: HTMLInputElement, e: FormEdit): boolean {
  const t = el.dataset.t;
  if (!t || !el.dataset.p) return false;
  const p = readP(el);
  const raw = el.value;
  const as = el.dataset.as || undefined;
  if (t === 'text' || t === 'select') {
    const keep = el.hasAttribute('data-keep-empty');
    const v = t === 'text' ? raw.replace(/\s+$/, '') : raw;
    e.commit((d) => write(d, p, v.trim() || keep ? v : undefined, as));
  } else if (t === 'number') {
    const s = raw.trim().replace(',', '.');
    if (s && !Number.isFinite(Number(s))) return false;
    e.commit((d) => write(d, p, s ? Number(s) : undefined, as));
  } else if (t === 'bool') {
    const def = el.dataset.def === '1';
    e.commit((d) => write(d, p, el.checked === def ? undefined : el.checked, as));
  } else if (t === 'numbers') {
    const nums = raw.split(/[\s;,]+/).map((x) => x.trim()).filter(Boolean).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) return false;
    e.commit((d) => write(d, p, nums.length ? nums : undefined, as));
  } else if (t === 'chip') {
    e.commit((d) => {
      const cur = getAt(d, p);
      const accent = typeof cur === 'string' ? /(?<!\\)\*$/.test(cur) : !!(cur as { accent?: boolean })?.accent;
      const text = raw.trim();
      setAt(d, p, accent ? `${text}*` : text);
    });
  } else if (t === 'kvkey') {
    const from = el.dataset.key ?? '';
    const to = raw.trim();
    if (!to || to === from) return false;
    e.commit((d) => {
      const obj = getAt(d, p) as Record<string, unknown>;
      if (to in obj) throw new Error(`Ключ «${to}» уже есть`);
      const entries = Object.entries(obj).map(([k, v]) => [k === from ? to : k, v] as const);
      setAt(d, p, Object.fromEntries(entries));
    });
  }
  return true;
}

/** Кнопки формы: добавить, удалить, переставить, выбрать картинку. */
export function onFieldAction(btn: HTMLElement, fields: Field[], base: Path, e: FormEdit): boolean {
  const act = btn.dataset.act;
  if (!act || !btn.dataset.p) return false;
  const p = readP(btn);
  const i = Number(btn.dataset.i);
  const list = (d: unknown) => {
    const cur = getAt(d, p);
    if (Array.isArray(cur)) return cur;
    const arr: unknown[] = [];
    setAt(d, p, arr);
    return arr;
  };
  switch (act) {
    case 'up':
    case 'down': {
      const j = act === 'up' ? i - 1 : i + 1;
      e.commit((d) => {
        const a = list(d);
        if (j < 0 || j >= a.length) return;
        [a[i], a[j]] = [a[j], a[i]];
      });
      return true;
    }
    case 'del':
      e.commit((d) => { list(d).splice(i, 1); });
      return true;
    case 'add-str': {
      const f = findField(fields, base, p);
      e.commit((d) => { list(d).push(f?.type === 'strings' ? f.item : 'Новый пункт'); });
      return true;
    }
    case 'add-chip':
      e.commit((d) => { list(d).push('Чип'); });
      return true;
    case 'add-row': {
      const f = findField(fields, base, p);
      if (f?.type !== 'rows') return false;
      e.commit((d) => { list(d).push(f.make()); });
      return true;
    }
    case 'star':
      e.commit((d) => {
        const cur = getAt(d, p);
        const s = typeof cur === 'string' ? cur : String((cur as { text?: string })?.text ?? '');
        setAt(d, p, /(?<!\\)\*$/.test(s) ? s.replace(/\*$/, '') : `${s}*`);
      });
      return true;
    case 'kvadd':
      e.commit((d) => {
        const obj = (getAt(d, p) as Record<string, unknown> | undefined) ?? {};
        let k = 'Ключ';
        for (let n = 2; k in obj; n++) k = `Ключ ${n}`;
        setAt(d, p, { ...obj, [k]: 'значение' });
      });
      return true;
    case 'kvdel': {
      const key = btn.dataset.key ?? '';
      e.commit((d) => {
        const obj = { ...(getAt(d, p) as Record<string, unknown>) };
        delete obj[key];
        setAt(d, p, Object.keys(obj).length ? obj : undefined);
      });
      return true;
    }
    case 'pick':
      e.pickImage(p);
      return true;
    case 'clear':
      e.commit((d) => setAt(d, p, undefined));
      return true;
  }
  return false;
}

/** Поле схемы по его пути в данных (для «добавить элемент» во вложенных списках). */
function findField(fields: Field[], base: Path, p: Path): Field | undefined {
  const rel = p.slice(base.length).filter((s) => typeof s === 'string');
  let list = fields;
  let found: Field | undefined;
  for (const k of rel) {
    found = list.find((f) => f.k === k);
    if (!found) return undefined;
    list = found.type === 'rows' || found.type === 'group' ? found.fields : [];
  }
  return found;
}
