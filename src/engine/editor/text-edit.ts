import { icon } from '../../components/icons';
import { getAt, KEY, setAt, type Path } from '../data';
import { esc, t } from '../html';
import { colorCss, FONTS, SWATCHES, THEME_COLORS, type TextStyle } from '../text-style';
import { plainMarkup, toggleList, toMarkup } from './serialize';

/** Что текстовому редактору нужно от основного редактора. */
export interface TextHost {
  deck(): Record<string, unknown>;
  stage(): HTMLElement;
  commit(fn: (d: Record<string, unknown>) => void, opts?: { rebuild?: boolean }): boolean;
  prompt(anchor: Element, o: { label: string; value: string; placeholder?: string; hint?: string; allowEmpty?: boolean; validate?: (v: string) => string | null }): Promise<string | null>;
  toast(text: string, ms?: number, error?: boolean): void;
  save(): void;
  /** Перейти к соседнему полю (Tab) */
  neighbour(el: HTMLElement, dir: 1 | -1): void;
  /** Путь блока, который можно удалить целиком (или null) */
  blockOf(path: Path): Path | null;
  removeBlock(path: Path): void;
  normalizeUrl(s: string): string;
}

const readPath = (el: Element, attr: string): Path | null => {
  try {
    const v = JSON.parse(el.getAttribute(attr) ?? '');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

interface Session {
  el: HTMLElement;
  path: Path;
  suffix: string;
  before: string;
  /** Текст до правки в том виде, в каком его вернёт редактор: сравнение без ложных изменений */
  baseline: string;
  html: string;
  styleAttr: string | null;
  /** Путь объекта-владельца: оформление хранится в owner.styles[field] */
  owner: Path | null;
  field: string;
  styles: TextStyle;
  stylesBefore: string;
  isKey: boolean;
  block: Path | null;
  off: () => void;
}

/**
 * Правка текста на месте с панелью оформления: шрифт, размер, цвет, жирный, курсив,
 * подчёркивание, ссылка, список, выравнивание. Разметка внутри строки хранится в тексте
 * (**жирный**, *курсив*, __подчёркнутый__, [ссылка](url)), остальное — в styles поля.
 */
export class TextEditor {
  private s: Session | null = null;
  /** Выделение, к которому применится цвет из палитры */
  private partial: Range | null = null;
  readonly bar: HTMLElement;
  private colors: HTMLElement;

  constructor(private host: TextHost) {
    document.body.insertAdjacentHTML('beforeend', `
<div class="edtext" id="ed-text" role="toolbar" aria-label="Оформление текста">
  <select data-t="font" title="Шрифт" aria-label="Шрифт">
    <option value="">Шрифт темы</option>
    ${Object.entries(FONTS).map(([k, f]) => `<option value="${k}">${esc(f.name)}</option>`).join('')}
  </select>
  <span class="edsize" title="Размер шрифта, px">
    <button type="button" data-t="size-" aria-label="Меньше">−</button>
    <input type="number" data-t="size" min="6" max="300" step="1" aria-label="Размер шрифта">
    <button type="button" data-t="size+" aria-label="Больше">+</button>
  </span>
  <i class="edsep"></i>
  <button type="button" data-t="color" class="edswatch" title="Цвет текста" aria-label="Цвет текста"><span></span></button>
  <button type="button" data-t="bold" title="Жирный (Ctrl+B)" aria-label="Жирный"><b>B</b></button>
  <button type="button" data-t="italic" title="Курсив (Ctrl+I)" aria-label="Курсив"><i style="font-family:Georgia,serif">I</i></button>
  <button type="button" data-t="underline" title="Подчёркнутый (Ctrl+U)" aria-label="Подчёркнутый"><u>U</u></button>
  <button type="button" data-t="link" title="Ссылка (Ctrl+K)" aria-label="Ссылка">${icon('link')}</button>
  <i class="edsep" data-g="block"></i>
  <button type="button" data-t="list" data-g="block" title="Список" aria-label="Список">${icon('list')}</button>
  <button type="button" data-t="align-left" data-g="block" title="По левому краю" aria-label="По левому краю">${icon('align-left')}</button>
  <button type="button" data-t="align-center" data-g="block" title="По центру" aria-label="По центру">${icon('align-center')}</button>
  <button type="button" data-t="align-right" data-g="block" title="По правому краю" aria-label="По правому краю">${icon('align-right')}</button>
  <i class="edsep"></i>
  <button type="button" data-t="reset" title="Сбросить оформление" aria-label="Сбросить оформление">${icon('eraser')}</button>
  <button type="button" data-t="delete" class="danger" title="Удалить блок" aria-label="Удалить блок">${icon('trash')}</button>
</div>
<div class="edcolors" id="ed-colors" role="dialog" aria-label="Цвет текста">
  <div class="edcolors-row">${Object.entries(THEME_COLORS).map(([k, c]) => `<button type="button" data-c="${k}" title="${esc(c.name)}" style="background:${c.css}"></button>`).join('')}</div>
  <div class="edcolors-row">${SWATCHES.map((c) => `<button type="button" data-c="${c}" title="${c}" style="background:${c}"></button>`).join('')}</div>
  <div class="edcolors-foot"><label><input type="color" data-c="custom"> Свой цвет</label><button type="button" data-c="" class="btn ghost small">Как в теме</button></div>
</div>`);
    this.bar = document.getElementById('ed-text')!;
    this.colors = document.getElementById('ed-colors')!;
    this.bindBar();
  }

  get active(): boolean {
    return this.s !== null;
  }

  get element(): HTMLElement | null {
    return this.s?.el ?? null;
  }

  /** Клик пришёлся в зону, которая относится к текущей правке (текст, панель, палитра). */
  owns(node: Node | null): boolean {
    if (!node || !this.s) return false;
    return this.s.el.contains(node) || this.bar.contains(node) || this.colors.contains(node);
  }

  // ---------------- начало и конец правки ----------------

  /** at — точка клика: курсор ставится туда; без неё (Tab) выделяется весь текст. */
  start(el: HTMLElement, at?: { x: number; y: number }): void {
    const path = readPath(el, 'data-edit');
    if (!path) return;
    const suffix = el.getAttribute('data-suffix') ?? '';
    const value = getAt(this.host.deck(), path);
    let raw = typeof value === 'string' || typeof value === 'number' ? String(value) : el.textContent?.trim() ?? '';
    if (suffix && raw.endsWith(suffix)) raw = raw.slice(0, -suffix.length).trimEnd();
    const isKey = path.includes(KEY);
    const owner = readPath(el, 'data-ed-style');
    const field = String(path[path.length - 1]);
    const stored = owner ? (getAt(this.host.deck(), [...owner, 'styles', field]) as TextStyle | undefined) : undefined;
    const styles: TextStyle = stored && typeof stored === 'object' ? { ...stored } : {};

    el.classList.add('ed-active');
    const html = el.innerHTML;
    el.innerHTML = isKey ? esc(raw) : t(raw);
    el.contentEditable = 'true';
    el.spellcheck = true;
    el.focus({ preventScroll: true });
    try { document.execCommand('styleWithCSS', false, 'false'); } catch { /* старые браузеры */ }
    placeCaret(el, at);

    const onKey = (ev: KeyboardEvent) => {
      ev.stopPropagation();
      const mod = ev.ctrlKey || ev.metaKey;
      const k = ev.key.toLowerCase();
      if (mod && (k === 's' || k === 'ы')) {
        ev.preventDefault();
        this.finish(true);
        this.host.save();
      } else if (mod && (k === 'k' || k === 'л')) {
        ev.preventDefault();
        void this.link();
      } else if (mod && ['b', 'и', 'i', 'ш', 'u', 'г'].includes(k)) {
        // Жирный, курсив, подчёркнутый — и в русской раскладке
        ev.preventDefault();
        this.format(k === 'b' || k === 'и' ? 'bold' : k === 'i' || k === 'ш' ? 'italic' : 'underline');
      } else if (ev.key === 'Enter' && ev.shiftKey) {
        ev.preventDefault();
        document.execCommand('insertLineBreak');
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        this.finish(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.finish(false);
      } else if (ev.key === 'Tab') {
        ev.preventDefault();
        this.host.neighbour(el, ev.shiftKey ? -1 : 1);
      }
    };
    const onPaste = (ev: ClipboardEvent) => {
      // Вставка всегда простым текстом: чужие стили не попадают в презентацию
      ev.preventDefault();
      document.execCommand('insertText', false, ev.clipboardData?.getData('text/plain') ?? '');
    };
    const onBlur = () => setTimeout(() => {
      if (this.s?.el !== el) return;
      const a = document.activeElement;
      // Фокус ушёл в панель, палитру или всплывающее поле — правка продолжается
      if (a && (this.bar.contains(a) || this.colors.contains(a) || a.closest('.edpop'))) return;
      this.finish(true);
    }, 0);
    const onInput = () => this.position();
    const onSel = () => this.syncButtons();
    el.addEventListener('keydown', onKey);
    el.addEventListener('paste', onPaste);
    el.addEventListener('blur', onBlur);
    el.addEventListener('input', onInput);
    document.addEventListener('selectionchange', onSel);
    addEventListener('resize', onInput);

    const probe = document.createElement('div');
    probe.innerHTML = t(raw);
    const baseline = isKey ? raw.replace(/\s+/g, ' ').trim() : toMarkup(probe);
    this.s = {
      el, path, suffix, before: raw, baseline, html, styleAttr: el.getAttribute('style'), owner, field,
      styles, stylesBefore: JSON.stringify(styles), isKey, block: this.host.blockOf(path),
      off: () => {
        el.removeEventListener('keydown', onKey);
        el.removeEventListener('paste', onPaste);
        el.removeEventListener('blur', onBlur);
        el.removeEventListener('input', onInput);
        document.removeEventListener('selectionchange', onSel);
        removeEventListener('resize', onInput);
      },
    };
    this.showBar();
  }

  /** Завершает правку: сохраняет (commit) или возвращает как было. */
  finish(save: boolean): void {
    const s = this.s;
    if (!s) return;
    this.s = null;
    s.off();
    this.hideBar();
    const { el } = s;
    const markup = s.isKey ? (el.innerText ?? '').replace(/\s+/g, ' ').trim() : toMarkup(el);
    el.removeAttribute('contenteditable');
    el.classList.remove('ed-active');
    getSelection()?.removeAllRanges();
    const stylesNow = JSON.stringify(clean(s.styles));
    const textChanged = markup !== s.baseline;
    const styleChanged = stylesNow !== JSON.stringify(clean(JSON.parse(s.stylesBefore)));
    let ok = false;
    if (save && (textChanged || styleChanged)) {
      if (s.isKey && !markup) {
        this.host.toast('Название не может быть пустым', 2500, true);
      } else {
        const value = s.isKey ? markup : s.suffix ? `${markup.trimEnd()}${s.suffix}` : markup;
        ok = this.host.commit((d) => {
          if (textChanged) setAt(d, s.path, value);
          if (styleChanged && s.owner) {
            const st = clean(s.styles);
            const owner = getAt(d, s.owner) as Record<string, unknown> | undefined;
            if (owner && typeof owner === 'object') {
              const all = { ...((owner.styles as Record<string, unknown>) ?? {}) };
              if (Object.keys(st).length) all[s.field] = st;
              else delete all[s.field];
              if (Object.keys(all).length) owner.styles = all;
              else delete owner.styles;
            }
          }
        }, { rebuild: true });
      }
    }
    if (!ok) {
      el.innerHTML = s.html;
      if (s.styleAttr === null) el.removeAttribute('style');
      else el.setAttribute('style', s.styleAttr);
    }
  }

  // ---------------- команды ----------------

  private selectionInside(): boolean {
    const sel = getSelection();
    return !!sel && sel.rangeCount > 0 && !!this.s && this.s.el.contains(sel.getRangeAt(0).commonAncestorContainer);
  }

  /** Без выделения команда применяется ко всему тексту поля. */
  private ensureSelection(): void {
    const sel = getSelection();
    if (!this.s || !sel) return;
    if (!this.selectionInside() || sel.isCollapsed) {
      const r = document.createRange();
      r.selectNodeContents(this.s.el);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  private format(cmd: 'bold' | 'italic' | 'underline'): void {
    if (!this.s || this.s.isKey) return;
    this.s.el.focus({ preventScroll: true });
    this.ensureSelection();
    document.execCommand(cmd);
    this.syncButtons();
  }

  private async link(): Promise<void> {
    const s = this.s;
    if (!s || s.isKey) return;
    s.el.focus({ preventScroll: true });
    this.ensureSelection();
    const sel = getSelection()!;
    const range = sel.getRangeAt(0).cloneRange();
    const node = range.commonAncestorContainer;
    const existing = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest('a');
    const current = existing && s.el.contains(existing) ? existing.getAttribute('href') ?? '' : '';
    const v = await this.host.prompt(s.el, {
      label: 'Ссылка на выделенный текст',
      value: current,
      placeholder: 'https://… или mailto:…',
      hint: current ? 'Оставьте пустым, чтобы убрать ссылку.' : undefined,
      allowEmpty: !!current,
      validate: (x) => (x.trim() && !this.host.normalizeUrl(x) ? 'Нужен адрес вида https://…, mailto:… или tel:…' : null),
    });
    if (this.s !== s) return;
    s.el.focus({ preventScroll: true });
    sel.removeAllRanges();
    sel.addRange(range);
    if (v === null) return;
    if (!v.trim()) {
      if (existing) {
        const r = document.createRange();
        r.selectNodeContents(existing);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      document.execCommand('unlink');
    } else {
      document.execCommand('createLink', false, this.host.normalizeUrl(v));
    }
    this.position();
  }

  private toggleList(): void {
    const s = this.s;
    if (!s) return;
    s.el.innerHTML = t(toggleList(toMarkup(s.el)));
    s.el.focus({ preventScroll: true });
    placeCaret(s.el, undefined, true);
    this.position();
  }

  private setStyle(patch: Partial<TextStyle>): void {
    const s = this.s;
    if (!s) return;
    if (!s.owner) {
      this.host.toast('У этого текста оформление не настраивается', 2500);
      return;
    }
    Object.assign(s.styles, patch);
    for (const k of Object.keys(patch) as (keyof TextStyle)[]) if (patch[k] === undefined || patch[k] === '') delete s.styles[k];
    this.applyLive();
    this.syncButtons();
    this.position();
  }

  private applyLive(): void {
    const s = this.s;
    if (!s) return;
    const st = s.el.style;
    const size = Number(s.styles.size);
    // Сначала исходный style элемента, поверх — новое оформление
    if (s.styleAttr === null) s.el.removeAttribute('style');
    else s.el.setAttribute('style', s.styleAttr);
    for (const p of ['font-size', 'color', 'fill', 'text-align', 'font-family']) st.removeProperty(p);
    if (size) st.fontSize = `${size}px`;
    const c = colorCss(s.styles.color);
    if (c) {
      st.color = c;
      st.setProperty('fill', c);
    }
    if (s.styles.align) st.textAlign = s.styles.align;
    if (s.styles.font && FONTS[s.styles.font]) st.fontFamily = FONTS[s.styles.font].css;
  }

  private reset(): void {
    const s = this.s;
    if (!s) return;
    s.styles = {};
    // Исходное оформление компонента без сохранённых styles поля
    if (s.styleAttr === null) s.el.removeAttribute('style');
    else s.el.setAttribute('style', s.styleAttr);
    for (const p of ['font-size', 'color', 'fill', 'text-align', 'font-family']) s.el.style.removeProperty(p);
    s.el.innerHTML = t(plainMarkup(s.el));
    placeCaret(s.el, undefined, true);
    this.syncButtons();
    this.position();
  }

  // ---------------- панель ----------------

  private bindBar(): void {
    // Нажатие на кнопки панели не забирает фокус у текста (и не сбрасывает выделение)
    this.bar.addEventListener('mousedown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'OPTION') e.preventDefault();
    });
    this.colors.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
    });
    this.bar.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-t]');
      if (!b || !this.s) return;
      const cmd = b.dataset.t!;
      if (cmd !== 'color') this.colors.classList.remove('on');
      switch (cmd) {
        case 'bold': case 'italic': case 'underline': this.format(cmd); break;
        case 'link': void this.link(); break;
        case 'list': this.toggleList(); break;
        case 'align-left': case 'align-center': case 'align-right': {
          const a = cmd.slice(6) as TextStyle['align'];
          this.setStyle({ align: this.s.styles.align === a ? undefined : a });
          break;
        }
        case 'size-': case 'size+': {
          const cur = Number(this.s.styles.size) || Math.round(parseFloat(getComputedStyle(this.s.el).fontSize));
          this.setStyle({ size: Math.max(6, Math.min(300, cur + (cmd === 'size+' ? 2 : -2))) });
          break;
        }
        case 'color': this.toggleColors(b); break;
        case 'reset': this.reset(); break;
        case 'delete': {
          const block = this.s.block;
          if (!block) break;
          this.finish(false);
          this.host.removeBlock(block);
          break;
        }
      }
    });
    const size = this.bar.querySelector<HTMLInputElement>('[data-t="size"]')!;
    size.addEventListener('change', () => {
      const v = Math.round(Number(size.value));
      this.setStyle({ size: v >= 6 && v <= 300 ? v : undefined });
    });
    size.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        size.dispatchEvent(new Event('change'));
        this.s?.el.focus({ preventScroll: true });
      }
    });
    const font = this.bar.querySelector<HTMLSelectElement>('[data-t="font"]')!;
    font.addEventListener('change', () => {
      this.setStyle({ font: font.value || undefined });
      this.s?.el.focus({ preventScroll: true });
    });
    font.addEventListener('keydown', (e) => e.stopPropagation());
    this.colors.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button[data-c]');
      if (!b) return;
      if (!this.colorSelection(b.dataset.c ?? '')) this.setStyle({ color: b.dataset.c || undefined });
      this.colors.classList.remove('on');
      this.s?.el.focus({ preventScroll: true });
    });
    const custom = this.colors.querySelector<HTMLInputElement>('input[data-c="custom"]')!;
    custom.addEventListener('input', () => {
      if (!this.partial) this.setStyle({ color: custom.value.toUpperCase() });
    });
    custom.addEventListener('change', () => {
      if (this.partial) this.colorSelection(custom.value.toUpperCase());
      this.colors.classList.remove('on');
      this.s?.el.focus({ preventScroll: true });
    });
  }

  /**
   * Цвет выделенной части текста: {#DC2626|слово}. Без выделения — false (цвет всего поля).
   * c: #RRGGBB, цвет темы (accent…) или '' — вернуть обычный цвет.
   */
  private colorSelection(c: string): boolean {
    const s = this.s;
    const range = this.partial;
    this.partial = null;
    if (!s || !range || s.isKey) return false;
    s.el.focus({ preventScroll: true });
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    // Метка-цвет, по которой находим созданные браузером <font>, и превращаем их в наши span
    const MARK = '#010203';
    document.execCommand('foreColor', false, MARK);
    s.el.querySelectorAll('font').forEach((f) => {
      if ((f.getAttribute('color') ?? '').toLowerCase() !== MARK) return;
      // Внутри выделения прежние цвета больше не действуют
      f.querySelectorAll('font[color], span.md-c').forEach((x) => x.replaceWith(...x.childNodes));
      if (!c) {
        f.replaceWith(...f.childNodes);
        return;
      }
      const span = document.createElement('span');
      span.className = 'md-c';
      span.setAttribute('data-c', c);
      span.style.color = colorCss(c) ?? c;
      span.append(...f.childNodes);
      f.replaceWith(span);
    });
    s.el.normalize();
    this.syncButtons();
    return true;
  }

  private toggleColors(anchor: HTMLElement): void {
    const on = !this.colors.classList.contains('on');
    // Выделенная часть текста запоминается: клик по палитре её не сбросит
    const sel = getSelection();
    this.partial = on && this.s && !this.s.isKey && this.selectionInside() && sel && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
    this.colors.querySelector<HTMLElement>('.edcolors-foot button')!.textContent = this.partial ? 'Как у всего текста' : 'Как в теме';
    this.colors.classList.toggle('on', on);
    if (!on) return;
    const r = anchor.getBoundingClientRect();
    const w = this.colors.offsetWidth;
    this.colors.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left - 8))}px`;
    this.colors.style.top = `${r.bottom + 6}px`;
  }

  private showBar(): void {
    const s = this.s!;
    const disp = getComputedStyle(s.el).display;
    const blockish = !s.isKey && disp !== 'inline' && !s.el.classList.contains('chip');
    this.bar.querySelectorAll<HTMLElement>('[data-g="block"]').forEach((b) => (b.hidden = !blockish));
    this.bar.querySelectorAll<HTMLElement>('[data-t="bold"],[data-t="italic"],[data-t="underline"],[data-t="link"],[data-t="reset"]')
      .forEach((b) => (b.hidden = s.isKey));
    const styleable = !!s.owner;
    this.bar.querySelectorAll<HTMLElement>('select[data-t="font"],.edsize,[data-t="color"]').forEach((b) => (b.hidden = !styleable));
    (this.bar.querySelector('[data-t="delete"]') as HTMLElement).hidden = !s.block;
    this.bar.classList.add('on');
    this.syncButtons();
    this.position();
  }

  private hideBar(): void {
    this.bar.classList.remove('on');
    this.colors.classList.remove('on');
  }

  /** Панель над текстом (или под ним, если сверху нет места). */
  position(): void {
    const s = this.s;
    if (!s) return;
    const r = s.el.getBoundingClientRect();
    const w = this.bar.offsetWidth;
    const h = this.bar.offsetHeight;
    const top = r.top - h - 10 > 60 ? r.top - h - 10 : r.bottom + 10;
    this.bar.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
    this.bar.style.top = `${Math.min(innerHeight - h - 8, top)}px`;
  }

  private syncButtons(): void {
    const s = this.s;
    if (!s) return;
    const q = (k: string) => this.bar.querySelector<HTMLElement>(`[data-t="${k}"]`);
    const state = (cmd: string) => {
      try { return this.selectionInside() && document.queryCommandState(cmd); } catch { return false; }
    };
    q('bold')?.classList.toggle('on', state('bold'));
    q('italic')?.classList.toggle('on', state('italic'));
    q('underline')?.classList.toggle('on', state('underline'));
    for (const a of ['left', 'center', 'right']) q(`align-${a}`)?.classList.toggle('on', s.styles.align === a);
    const size = this.bar.querySelector<HTMLInputElement>('[data-t="size"]')!;
    if (document.activeElement !== size) {
      size.value = s.styles.size ? String(s.styles.size) : '';
      size.placeholder = String(Math.round(parseFloat(getComputedStyle(s.el).fontSize)));
    }
    const font = this.bar.querySelector<HTMLSelectElement>('[data-t="font"]')!;
    font.value = s.styles.font && FONTS[s.styles.font] ? s.styles.font : '';
    const sw = this.bar.querySelector<HTMLElement>('.edswatch span')!;
    sw.style.background = colorCss(s.styles.color) ?? getComputedStyle(s.el).color;
    q('reset')?.classList.toggle('on', false);
  }
}

function clean(st: TextStyle): TextStyle {
  const out: TextStyle = {};
  if (st.size) out.size = Math.round(Number(st.size));
  if (st.color) out.color = st.color;
  if (st.align && st.align !== 'left') out.align = st.align;
  else if (st.align === 'left') out.align = 'left';
  if (st.font) out.font = st.font;
  return out;
}

function placeCaret(el: HTMLElement, at?: { x: number; y: number }, end = false): void {
  const sel = getSelection();
  if (!sel) return;
  let range: Range | null = null;
  if (at) {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const pos = doc.caretPositionFromPoint?.(at.x, at.y);
    if (pos && el.contains(pos.offsetNode)) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    } else {
      const r = doc.caretRangeFromPoint?.(at.x, at.y);
      if (r && el.contains(r.startContainer)) range = r;
    }
    range?.collapse(true);
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(el);
    if (at || end) range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}
