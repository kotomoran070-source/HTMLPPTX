import { icon } from '../../components/icons';
import type { Deck, SlideData } from '../../types';
import { applyAccent, HEX_RE } from '../accent';
import { clone, getAt, KEY, replaceContents, setAt, type Path } from '../data';
import { esc } from '../html';
import {
  blobToDataUrl, buildHtml, canSaveFile, MAX_FILE, prepareImage, saveHtmlFile,
  saveToProject, suggestedFileName, uploadAsset,
} from './persist';
import './editor.css';

export interface EditorHost {
  deck: Deck;
  deckKey: string;
  stage(): HTMLElement;
  index(): number;
  go(i: number): void;
  /** Данные изменились: перерисовать слайды (rebuild) или только обновить служебные части */
  refresh(rebuild: boolean): void;
  /** Раскладка изменилась (панель правки, заметки) — пересчитать размер сцены */
  relayout(): void;
}

type Mode = 'project' | 'file';

interface Commit {
  /** Правки с одинаковым ключом подряд склеиваются в один шаг отмены (набор текста, выбор цвета) */
  merge?: string;
  rebuild?: boolean;
}

const HISTORY = 200;
const MERGE_MS = 1200;
const AUTOSAVE_MS = 600;

export const SLIDE_PRESETS: { name: string; make: () => SlideData }[] = [
  { name: 'Заголовок и текст', make: () => ({ title: 'Новый слайд', body: { type: 'text', text: 'Текст слайда' } }) },
  {
    name: 'Три карточки',
    make: () => ({
      title: 'Новый слайд',
      body: {
        type: 'grid', columns: 3,
        items: [1, 2, 3].map((k) => ({ type: 'card', title: `Пункт ${k}`, text: 'Короткое пояснение' })),
      },
    }),
  },
  { name: 'Картинка', make: () => ({ title: 'Новый слайд', body: { type: 'image', src: '', caption: 'Подпись', style: 'height:520px' } }) },
];

const readPath = (el: Element, attr: string): Path | null => {
  try {
    const v = JSON.parse(el.getAttribute(attr) ?? '');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/**
 * Режим правки: текст на месте, замена картинок и ссылок, заметки, акцентный цвет,
 * порядок слайдов, отмена и повтор. В yarn dev правки сразу пишутся в deck.yaml,
 * в собранном файле — сохраняются копией HTML.
 */
export class Editor {
  active = false;
  /** Данные менялись с момента открытия (окну докладчика нужно их прислать) */
  touched = false;
  readonly mode: Mode;

  private past: string[] = [];
  private future: string[] = [];
  private lastMerge = '';
  private lastTime = 0;

  private dirty = false;
  private saving = false;
  private saveTimer = 0;
  private saveError = '';

  private editing: { el: HTMLElement; path: Path; suffix: string; before: string; html: string } | null = null;
  private notesOpen = false;
  private hintTarget: Element | null = null;
  private hintTimer = 0;
  private listeners: (() => void)[] = [];

  private bar!: HTMLElement;
  private notes!: HTMLElement;
  private hint!: HTMLElement;
  private pop!: HTMLElement;
  private toastEl!: HTMLElement;
  private file!: HTMLInputElement;

  constructor(private host: EditorHost, devServer: boolean) {
    this.mode = devServer ? 'project' : 'file';
    this.buildUi();
    addEventListener('beforeunload', (e) => {
      if (this.mode === 'project' && (this.dirty || this.saving)) {
        // Последняя попытка записать правки перед закрытием вкладки
        saveToProject(this.host.deckKey, this.host.deck, true).catch(() => {});
      }
      if (this.mode === 'file' && this.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // ---------------- интерфейс ----------------

  private buildUi(): void {
    const saveLabel = this.mode === 'project' ? '' : `<button class="btn primary small" id="ed-save" type="button" title="Сохранить файл с правками (Ctrl+S)">${icon('save')}<span>Сохранить</span></button>`;
    document.body.insertAdjacentHTML('beforeend', `
<div class="edbar" id="edbar" role="toolbar" aria-label="Режим правки">
  <div class="edbar-l">
    <span class="edbar-title">${icon('pencil')} Правка</span>
    <button class="ibtn small" id="ed-undo" type="button" aria-label="Отменить" title="Отменить (Ctrl+Z)">${icon('undo')}</button>
    <button class="ibtn small" id="ed-redo" type="button" aria-label="Повторить" title="Повторить (Ctrl+Shift+Z)">${icon('redo')}</button>
  </div>
  <div class="edbar-c">
    <label class="edcolor" title="Акцентный цвет презентации"><input type="color" id="ed-accent" aria-label="Акцентный цвет"><span>Цвет</span></label>
    <button class="btn ghost small" id="ed-accent-reset" type="button" title="Вернуть стандартный цвет">Сбросить</button>
    <button class="btn ghost small" id="ed-notes" type="button" aria-pressed="false">${icon('notes')}<span>Заметки</span></button>
    <button class="btn ghost small" id="ed-add" type="button" title="Слайды: добавить, переставить, удалить">${icon('grid')}<span>Слайды</span></button>
  </div>
  <div class="edbar-r">
    <span class="edstatus" id="ed-status" role="status" aria-live="polite"></span>
    ${saveLabel}
    <button class="btn ghost small" id="ed-done" type="button" title="Выйти из режима правки (E)">Готово</button>
  </div>
</div>
<div class="ednotes" id="ed-notes-panel">
  <label for="ed-notes-text" id="ed-notes-label">Заметки докладчика</label>
  <textarea id="ed-notes-text" spellcheck="true" placeholder="Что сказать на этом слайде. Видно только в окне докладчика."></textarea>
</div>
<div class="edhint" id="ed-hint" role="tooltip"></div>
<div class="edpop" id="ed-pop" role="dialog" aria-modal="false"></div>
<div class="edtoast" id="ed-toast" role="status" aria-live="polite"></div>
<input type="file" id="ed-file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml" hidden>`);
    const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    this.bar = $('edbar');
    this.notes = $('ed-notes-panel');
    this.hint = $('ed-hint');
    this.pop = $('ed-pop');
    this.toastEl = $('ed-toast');
    this.file = $('ed-file');

    $('ed-undo').addEventListener('click', () => this.undo());
    $('ed-redo').addEventListener('click', () => this.redo());
    $('ed-done').addEventListener('click', () => this.toggle(false));
    $('ed-notes').addEventListener('click', () => this.toggleNotes());
    $('ed-add').addEventListener('click', () => document.getElementById('ov')?.click());
    $('ed-save')?.addEventListener('click', () => void this.save());
    $('ed-status').addEventListener('click', () => { if (this.saveError) void this.save(); });

    const accent = $<HTMLInputElement>('ed-accent');
    accent.addEventListener('input', () => this.setAccent(accent.value));
    $('ed-accent-reset').addEventListener('click', () => this.setAccent(null));

    const text = $<HTMLTextAreaElement>('ed-notes-text');
    text.addEventListener('input', () => {
      const i = this.host.index();
      const v = text.value;
      this.commit((d) => {
        if (v.trim()) d.slides[i].notes = v;
        else delete d.slides[i].notes;
      }, { merge: `notes:${i}`, rebuild: false });
    });
    text.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') text.blur();
    });
  }

  // ---------------- включение ----------------

  toggle(on = !this.active): void {
    if (on === this.active) return;
    if (!on) this.finishInline(true);
    this.active = on;
    document.body.classList.toggle('editing', on);
    document.getElementById('ed-btn')?.setAttribute('aria-pressed', String(on));
    if (on) {
      this.attach();
      this.syncBar();
      this.status();
      this.onSlideChange();
      let seen = false;
      try {
        seen = !!sessionStorage.getItem('htmlpptx-edit-hint');
        sessionStorage.setItem('htmlpptx-edit-hint', '1');
      } catch { /* хранилище недоступно — просто покажем подсказку */ }
      if (!seen) {
        this.toast(this.mode === 'project'
          ? 'Кликните по тексту, чтобы исправить. Картинку можно заменить кликом или перетащить файл. Правки сразу сохраняются в deck.yaml.'
          : 'Кликните по тексту, чтобы исправить. Картинку можно заменить кликом или перетащить файл. Чтобы не потерять правки, нажмите «Сохранить».', 6000);
      }
    } else {
      this.detach();
      this.hideHint();
      this.closePop();
      if (this.mode === 'project') void this.flush();
    }
    this.host.relayout();
  }

  private attach(): void {
    const stage = this.host.stage();
    const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K, fn: (e: HTMLElementEventMap[K]) => void, capture = false) => {
      el.addEventListener(type, fn as EventListener, capture);
      this.listeners.push(() => el.removeEventListener(type, fn as EventListener, capture));
    };
    // Клик по другому месту во время правки: не даём фокусу уйти раньше времени,
    // иначе первый клик только завершит правку, а второй начнёт новую
    on(stage, 'mousedown', (e) => {
      if (this.editing && !this.editing.el.contains(e.target as Node)) e.preventDefault();
    }, true);
    on(stage, 'click', (e) => this.onClick(e), true);
    on(stage, 'mouseover', (e) => this.onOver(e));
    on(stage, 'mouseleave', () => this.scheduleHintHide());
    on(stage, 'dragover', (e) => this.onDragOver(e));
    on(stage, 'dragleave', (e) => this.onDragLeave(e));
    on(stage, 'drop', (e) => this.onDrop(e));
    on(this.hint, 'mouseenter', () => clearTimeout(this.hintTimer));
    on(this.hint, 'mouseleave', () => this.scheduleHintHide());
  }

  private detach(): void {
    this.listeners.forEach((f) => f());
    this.listeners = [];
  }

  /** Размеры служебных панелей: движок уменьшает сцену, чтобы они её не перекрывали. */
  insets(): { top: number; bottom: number } {
    if (!this.active) return { top: 0, bottom: 0 };
    return { top: this.bar.offsetHeight || 52, bottom: this.notesOpen ? this.notes.offsetHeight || 150 : 0 };
  }

  // ---------------- данные и история ----------------

  commit(fn: (d: Deck) => void, opts: Commit = {}): boolean {
    const before = JSON.stringify(this.host.deck);
    const draft = clone(this.host.deck);
    try {
      fn(draft);
    } catch (e) {
      this.toast((e as Error).message, 4000, true);
      return false;
    }
    const after = JSON.stringify(draft);
    if (after === before) return false;
    const now = Date.now();
    const merge = !!opts.merge && opts.merge === this.lastMerge && now - this.lastTime < MERGE_MS;
    if (!merge) {
      this.past.push(before);
      if (this.past.length > HISTORY) this.past.shift();
    }
    this.future = [];
    this.lastMerge = opts.merge ?? '';
    this.lastTime = now;
    replaceContents(this.host.deck as unknown as Record<string, unknown>, draft as unknown as Record<string, unknown>);
    this.changed(opts.rebuild !== false);
    return true;
  }

  undo(): void {
    this.finishInline(true);
    const prev = this.past.pop();
    if (prev === undefined) return this.toast('Отменять нечего', 1500);
    this.future.push(JSON.stringify(this.host.deck));
    replaceContents(this.host.deck as unknown as Record<string, unknown>, JSON.parse(prev));
    this.lastMerge = '';
    this.changed(true);
  }

  redo(): void {
    this.finishInline(true);
    const next = this.future.pop();
    if (next === undefined) return this.toast('Повторять нечего', 1500);
    this.past.push(JSON.stringify(this.host.deck));
    replaceContents(this.host.deck as unknown as Record<string, unknown>, JSON.parse(next));
    this.lastMerge = '';
    this.changed(true);
  }

  private changed(rebuild: boolean): void {
    if (rebuild) this.hideHint();
    this.touched = true;
    this.dirty = true;
    applyAccent(this.host.deck.theme?.accent);
    this.host.refresh(rebuild);
    this.syncBar();
    if (this.mode === 'project') {
      clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => void this.flush(), AUTOSAVE_MS);
    }
    this.status();
  }

  // ---------------- сохранение ----------------

  /** Ctrl+S и кнопка «Сохранить». */
  async save(): Promise<void> {
    this.finishInline(true);
    if (this.mode === 'project') return this.flush(true);
    try {
      const html = buildHtml(this.host.deck);
      const res = await saveHtmlFile(html, suggestedFileName(this.host.deckKey));
      if (!res) return;
      this.dirty = false;
      this.saveError = '';
      this.status();
      this.toast(res.how === 'file' ? `Сохранено в «${res.name}»` : `Скачан файл «${res.name}» с правками`, 3500);
    } catch (e) {
      this.saveError = (e as Error).message;
      this.status();
      this.toast(`Не удалось сохранить: ${this.saveError}`, 5000, true);
    }
  }

  private async flush(announce = false): Promise<void> {
    clearTimeout(this.saveTimer);
    if (this.saving) {
      this.saveTimer = window.setTimeout(() => void this.flush(announce), 300);
      return;
    }
    if (!this.dirty) {
      if (announce) this.toast('Все правки уже в deck.yaml', 1800);
      return;
    }
    this.saving = true;
    this.dirty = false;
    this.status();
    try {
      await saveToProject(this.host.deckKey, this.host.deck);
      this.saveError = '';
      if (announce) this.toast('Сохранено в deck.yaml', 1800);
    } catch (e) {
      this.dirty = true;
      this.saveError = (e as Error).message;
      this.toast(`Не удалось сохранить в deck.yaml: ${this.saveError}`, 5000, true);
    } finally {
      this.saving = false;
      this.status();
    }
  }

  private status(): void {
    const el = document.getElementById('ed-status');
    if (!el) return;
    let text: string;
    let cls = '';
    if (this.saveError) {
      text = this.mode === 'project' ? 'Не сохранено — повторить' : 'Не сохранено';
      cls = 'err';
    } else if (this.mode === 'project') {
      text = this.saving || this.dirty ? 'Сохранение…' : this.touched ? 'Сохранено в deck.yaml' : 'Правки сохраняются в deck.yaml';
      cls = this.saving || this.dirty ? '' : 'ok';
    } else {
      text = this.dirty ? 'Есть несохранённые правки' : this.touched ? 'Все правки сохранены' : '';
      cls = this.dirty ? 'warn' : 'ok';
    }
    el.textContent = text;
    el.className = 'edstatus ' + cls;
    el.style.cursor = this.saveError && this.mode === 'project' ? 'pointer' : '';
  }

  // ---------------- панель ----------------

  private syncBar(): void {
    const accent = this.host.deck.theme?.accent;
    const input = document.getElementById('ed-accent') as HTMLInputElement | null;
    const value = typeof accent === 'string' && HEX_RE.test(accent) ? accent : getComputedStyle(document.documentElement).getPropertyValue('--ac').trim();
    if (input && document.activeElement !== input && HEX_RE.test(value)) input.value = value.toLowerCase();
    document.getElementById('ed-accent-reset')?.toggleAttribute('hidden', !accent);
    document.getElementById('ed-undo')?.toggleAttribute('disabled', !this.past.length);
    document.getElementById('ed-redo')?.toggleAttribute('disabled', !this.future.length);
    this.onSlideChange();
  }

  private setAccent(value: string | null): void {
    this.commit((d) => {
      if (value && HEX_RE.test(value)) {
        if (!d.theme) {
          // theme — рядом с brand, а не в конце файла
          const entries = Object.entries(d);
          const at = entries.findIndex(([k]) => k === 'brand');
          entries.splice(at >= 0 ? at + 1 : entries.length - 1, 0, ['theme', {}]);
          replaceContents(d as unknown as Record<string, unknown>, Object.fromEntries(entries));
        }
        d.theme!.accent = value.toUpperCase();
      } else if (d.theme) {
        delete d.theme.accent;
        if (!Object.keys(d.theme).length) delete d.theme;
      }
    }, { merge: 'accent', rebuild: false });
  }

  private toggleNotes(force?: boolean): void {
    this.notesOpen = force ?? !this.notesOpen;
    this.notes.classList.toggle('on', this.notesOpen);
    document.getElementById('ed-notes')?.setAttribute('aria-pressed', String(this.notesOpen));
    this.host.relayout();
    if (this.notesOpen) (document.getElementById('ed-notes-text') as HTMLTextAreaElement).focus();
  }

  /** Движок сообщает о смене слайда. */
  onSlideChange(): void {
    if (this.editing) this.finishInline(true);
    this.hideHint();
    this.closePop();
    const i = this.host.index();
    const text = document.getElementById('ed-notes-text') as HTMLTextAreaElement | null;
    if (!text) return;
    const notes = this.host.deck.slides[i]?.notes;
    if (document.activeElement !== text || text.dataset.slide !== String(i)) text.value = typeof notes === 'string' ? notes : '';
    text.dataset.slide = String(i);
    const label = document.getElementById('ed-notes-label');
    if (label) label.textContent = `Заметки докладчика · слайд ${i + 1}`;
  }

  // ---------------- клавиатура ----------------

  /** Возвращает true, если клавиша обработана редактором. */
  handleKey(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && (k === 's' || k === 'ы')) {
      e.preventDefault();
      if (this.active || this.dirty) void this.save();
      return true;
    }
    if (!this.active) return false;
    if (mod && !e.altKey && (k === 'z' || k === 'я')) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (mod && !e.altKey && (k === 'y' || k === 'н')) {
      e.preventDefault();
      this.redo();
      return true;
    }
    if (e.key === 'Escape' && !mod) {
      if (this.pop.classList.contains('on')) this.closePop();
      else this.toggle(false);
      e.preventDefault();
      return true;
    }
    return false;
  }

  // ---------------- клики по сцене ----------------

  private onClick(e: MouseEvent): void {
    const target = e.target as Element;
    if (this.editing && this.editing.el.contains(target)) return;
    const text = target.closest('[data-edit]');
    const img = target.closest('[data-edit-img]');
    // Внутри картинки-плитки подпись — это текст; сама плитка — картинка
    if (text && (!img || img.contains(text))) {
      e.preventDefault();
      e.stopPropagation();
      this.startEdit(text as HTMLElement, { x: e.clientX, y: e.clientY });
      return;
    }
    if (img) {
      e.preventDefault();
      e.stopPropagation();
      this.pickImage(img);
      return;
    }
    // Ссылки в режиме правки не открываются
    if (target.closest('a[href]')) {
      e.preventDefault();
      const link = target.closest('[data-edit-url]');
      if (link) this.editUrl(link);
    }
  }

  // ---------------- правка текста ----------------

  /** Элемент после перерисовки: тот же атрибут на текущем слайде. */
  private refind(el: Element, attr: string): Element | null {
    if (el.isConnected) return el;
    const value = el.getAttribute(attr);
    const slide = this.host.stage().querySelector('.slide.on');
    return slide ? [...slide.querySelectorAll(`[${attr}]`)].find((x) => x.getAttribute(attr) === value) ?? null : null;
  }

  /** at — точка клика: курсор ставится туда; без неё (Tab) выделяется весь текст. */
  private startEdit(target: HTMLElement, at?: { x: number; y: number }): void {
    this.finishInline(true);
    const el = this.refind(target, 'data-edit') as HTMLElement | null;
    if (!el) return;
    const path = readPath(el, 'data-edit');
    if (!path) return;
    const suffix = el.getAttribute('data-suffix') ?? '';
    const value = getAt(this.host.deck, path);
    let raw = typeof value === 'string' || typeof value === 'number' ? String(value) : el.textContent?.trim() ?? '';
    if (suffix && raw.endsWith(suffix)) raw = raw.slice(0, -suffix.length).trimEnd();

    // SVG-текст правится во всплывающем поле
    if (el instanceof SVGElement) {
      void this.prompt(el, { label: 'Текст', value: raw }).then((v) => {
        if (v !== null) this.setText(path, v, suffix, raw);
      });
      return;
    }

    this.editing = { el, path, suffix, before: raw, html: el.innerHTML };
    el.textContent = raw;
    el.classList.add('ed-active');
    try {
      el.contentEditable = 'plaintext-only';
    } catch {
      el.contentEditable = 'true';
    }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    el.spellcheck = true;
    el.focus();
    const sel = getSelection();
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
      if (at) {
        // Курсор в конец текста
        range.selectNodeContents(el);
        range.collapse(false);
      } else {
        range.selectNodeContents(el);
      }
    }
    sel?.removeAllRanges();
    sel?.addRange(range);

    const onKey = (ev: KeyboardEvent) => {
      ev.stopPropagation();
      if ((ev.ctrlKey || ev.metaKey) && ['s', 'ы'].includes(ev.key.toLowerCase())) {
        ev.preventDefault();
        this.finishInline(true);
        void this.save();
      } else if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        this.finishInline(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.finishInline(false);
      } else if (ev.key === 'Tab') {
        ev.preventDefault();
        this.editNeighbour(el, ev.shiftKey ? -1 : 1);
      }
    };
    const onPaste = (ev: ClipboardEvent) => {
      // Вставка всегда простым текстом
      ev.preventDefault();
      const txt = ev.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, txt);
    };
    const onBlur = () => setTimeout(() => { if (this.editing?.el === el) this.finishInline(true); }, 0);
    el.addEventListener('keydown', onKey);
    el.addEventListener('paste', onPaste);
    el.addEventListener('blur', onBlur);
    (el as HTMLElement & { _edOff?: () => void })._edOff = () => {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('paste', onPaste);
      el.removeEventListener('blur', onBlur);
    };
  }

  private editNeighbour(el: HTMLElement, dir: 1 | -1): void {
    const slide = el.closest('.slide');
    const all = slide ? [...slide.querySelectorAll<HTMLElement>('[data-edit]')].filter((x) => !(x instanceof SVGElement)) : [];
    const path = el.getAttribute('data-edit');
    const i = all.indexOf(el);
    this.finishInline(true);
    // После перерисовки элементы новые — ищем соседа по пути
    const fresh = this.host.stage().querySelector('.slide.on');
    const list = fresh ? [...fresh.querySelectorAll<HTMLElement>('[data-edit]')].filter((x) => !(x instanceof SVGElement)) : [];
    const cur = list.findIndex((x) => x.getAttribute('data-edit') === path);
    const next = list[(cur >= 0 ? cur : i) + dir];
    if (next) this.startEdit(next);
  }

  /** Завершает правку текста: сохраняет (commit) или возвращает как было. */
  private finishInline(save: boolean): void {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const { el, path, suffix, before, html } = ed;
    (el as HTMLElement & { _edOff?: () => void })._edOff?.();
    const value = (el.innerText ?? el.textContent ?? '').replace(/\r/g, '').replace(/\n+$/, '').replace(/ /g, ' ');
    el.removeAttribute('contenteditable');
    el.classList.remove('ed-active');
    getSelection()?.removeAllRanges();
    if (!save || value === before || !this.setText(path, value, suffix, before)) {
      el.innerHTML = html;
    }
  }

  private setText(path: Path, value: string, suffix: string, before: string): boolean {
    if (value === before) return false;
    const isKey = path.includes(KEY);
    const trimmed = value.trim();
    if (isKey && !trimmed) {
      this.toast('Название не может быть пустым', 2500, true);
      return false;
    }
    const final = isKey ? trimmed : suffix ? `${value.trimEnd()}${suffix}` : value;
    return this.commit((d) => setAt(d, path, final), { rebuild: true });
  }

  // ---------------- всплывающее поле ----------------

  private prompt(anchor: Element, o: { label: string; value: string; placeholder?: string; hint?: string; allowEmpty?: boolean; validate?: (v: string) => string | null }): Promise<string | null> {
    this.closePop();
    return new Promise((resolve) => {
      this.pop.innerHTML = `<label>${esc(o.label)}<input type="text" value="${esc(o.value)}" placeholder="${esc(o.placeholder ?? '')}" spellcheck="false"></label>`
        + (o.hint ? `<p class="edpop-hint">${esc(o.hint)}</p>` : '')
        + `<p class="edpop-err" hidden></p><div class="edpop-btns"><button class="btn ghost small" type="button" data-a="cancel">Отмена</button><button class="btn primary small" type="button" data-a="ok">Готово</button></div>`;
      const input = this.pop.querySelector('input')!;
      const err = this.pop.querySelector<HTMLElement>('.edpop-err')!;
      const done = (v: string | null) => {
        (this.pop as HTMLElement & { _cancel?: () => void })._cancel = undefined;
        this.closePop();
        resolve(v);
      };
      const ok = () => {
        const v = input.value;
        if (!v.trim() && !o.allowEmpty) {
          err.textContent = 'Поле не может быть пустым';
          err.hidden = false;
          return;
        }
        const problem = o.validate?.(v) ?? null;
        if (problem) {
          err.textContent = problem;
          err.hidden = false;
          return;
        }
        done(v);
      };
      this.pop.querySelector('[data-a="ok"]')!.addEventListener('click', ok);
      this.pop.querySelector('[data-a="cancel"]')!.addEventListener('click', () => done(null));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); ok(); }
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
      });
      (this.pop as HTMLElement & { _cancel?: () => void })._cancel = () => resolve(null);
      this.pop.classList.add('on');
      const r = anchor.getBoundingClientRect();
      const w = this.pop.offsetWidth;
      const h = this.pop.offsetHeight;
      const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      const below = r.bottom + 8;
      this.pop.style.left = `${left}px`;
      this.pop.style.top = `${below + h > innerHeight - 8 ? Math.max(8, r.top - h - 8) : below}px`;
      input.focus();
      input.select();
    });
  }

  private closePop(): void {
    if (!this.pop.classList.contains('on')) return;
    this.pop.classList.remove('on');
    const cancel = (this.pop as HTMLElement & { _cancel?: () => void })._cancel;
    (this.pop as HTMLElement & { _cancel?: () => void })._cancel = undefined;
    this.pop.innerHTML = '';
    cancel?.();
  }

  // ---------------- ссылки ----------------

  private async editUrl(target: Element): Promise<void> {
    this.finishInline(true);
    const el = this.refind(target, 'data-edit-url');
    if (!el) return;
    const path = readPath(el, 'data-edit-url');
    if (!path) return;
    const current = String(getAt(this.host.deck, path) ?? '');
    const required = path[path.length - 2] === 'link';
    const v = await this.prompt(el, {
      label: 'Адрес ссылки',
      value: current,
      placeholder: 'https://… или mailto:…',
      hint: required ? 'QR-код обновится автоматически.' : 'Оставьте пустым, чтобы кнопка не была ссылкой.',
      allowEmpty: !required,
      validate: (s) => (s.trim() && !normalizeUrl(s) ? 'Нужен адрес вида https://…, mailto:… или tel:…' : null),
    });
    if (v === null) return;
    const url = v.trim() ? normalizeUrl(v) : undefined;
    this.commit((d) => setAt(d, path, url), { rebuild: true });
  }

  // ---------------- картинки ----------------

  private pickImage(el: Element): void {
    const path = readPath(el, 'data-edit-img');
    if (!path) return;
    this.file.value = '';
    this.file.onchange = () => {
      const f = this.file.files?.[0];
      if (f) void this.replaceImage(path, f);
    };
    this.file.click();
  }

  private async replaceImage(path: Path, file: File): Promise<void> {
    if (!/^image\//.test(file.type)) return this.toast('Это не картинка. Подойдут png, jpg, gif, webp, avif, svg.', 3500, true);
    if (file.size > MAX_FILE) return this.toast('Файл больше 25 МБ — уменьшите его и попробуйте снова', 4000, true);
    this.toast('Загрузка картинки…', 0);
    try {
      const { blob, name, resized } = await prepareImage(file);
      const url = this.mode === 'project'
        ? (await uploadAsset(this.host.deckKey, blob, name)).url
        : await blobToDataUrl(blob);
      const isLogo = path.join('.') === 'brand.logo';
      this.commit((d) => setAt(d, path, url), { rebuild: true });
      this.toast((isLogo ? 'Логотип заменён на всех слайдах' : 'Картинка заменена') + (resized ? ' (уменьшена до 2400 px)' : ''), 2500);
    } catch (e) {
      this.toast(`Не удалось заменить картинку: ${(e as Error).message}`, 5000, true);
    }
  }

  private dropTarget(e: DragEvent): Element | null {
    return (e.target as Element)?.closest?.('[data-edit-img]') ?? null;
  }

  private onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    const t = this.dropTarget(e);
    e.dataTransfer.dropEffect = t ? 'copy' : 'none';
    this.host.stage().querySelectorAll('.ed-drop').forEach((x) => x !== t && x.classList.remove('ed-drop'));
    t?.classList.add('ed-drop');
  }

  private onDragLeave(e: DragEvent): void {
    const t = this.dropTarget(e);
    if (t && !t.contains(e.relatedTarget as Node)) t.classList.remove('ed-drop');
  }

  private onDrop(e: DragEvent): void {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    this.host.stage().querySelectorAll('.ed-drop').forEach((x) => x.classList.remove('ed-drop'));
    const t = this.dropTarget(e);
    if (!t) return this.toast('Перетащите файл на картинку или логотип', 2500);
    const path = readPath(t, 'data-edit-img');
    if (path) void this.replaceImage(path, e.dataTransfer.files[0]);
  }

  // ---------------- подсказка у картинок и ссылок ----------------

  private onOver(e: MouseEvent): void {
    const t = (e.target as Element).closest('[data-edit-img],[data-edit-url]');
    if (!t) return this.scheduleHintHide();
    clearTimeout(this.hintTimer);
    if (t === this.hintTarget && this.hint.classList.contains('on')) return;
    this.hintTarget = t;
    const isImg = t.hasAttribute('data-edit-img');
    this.hint.innerHTML = isImg
      ? `<button type="button">${icon('image')}<span>Заменить картинку</span></button><small>или перетащите файл</small>`
      : `<button type="button">${icon('link')}<span>Изменить ссылку</span></button>`;
    this.hint.querySelector('button')!.onclick = () => {
      this.hideHint();
      if (isImg) this.pickImage(t);
      else void this.editUrl(t);
    };
    this.hint.classList.add('on');
    const r = t.getBoundingClientRect();
    const w = this.hint.offsetWidth;
    this.hint.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
    this.hint.style.top = `${Math.max(8, r.top - this.hint.offsetHeight - 6)}px`;
  }

  private scheduleHintHide(): void {
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hideHint(), 350);
  }

  private hideHint(): void {
    this.hint.classList.remove('on');
    this.hintTarget = null;
  }

  // ---------------- слайды ----------------

  private uniqueId(base: string): string {
    const ids = new Set(this.host.deck.slides.map((s) => s.id));
    const stem = (base || 'slide').replace(/-\d+$/, '');
    for (let i = 2; ; i++) if (!ids.has(`${stem}-${i}`)) return `${stem}-${i}`;
  }

  duplicateSlide(i: number): void {
    const copy = clone(this.host.deck.slides[i]);
    copy.id = this.uniqueId(copy.id ?? 'slide');
    if (this.commit((d) => d.slides.splice(i + 1, 0, copy))) {
      this.host.go(i + 1);
      this.toast('Слайд продублирован', 1800);
    }
  }

  deleteSlide(i: number): void {
    const n = this.host.deck.slides.length;
    if (n <= 1) return this.toast('Нельзя удалить единственный слайд', 2500, true);
    const cur = this.host.index();
    if (this.commit((d) => d.slides.splice(i, 1))) {
      this.host.go(cur > i ? cur - 1 : Math.min(cur, n - 2));
      this.toast('Слайд удалён. Вернуть: Ctrl+Z', 3000);
    }
  }

  moveSlide(from: number, to: number): void {
    const n = this.host.deck.slides.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
    const cur = this.host.index();
    if (this.commit((d) => {
      const [s] = d.slides.splice(from, 1);
      d.slides.splice(to, 0, s);
    })) {
      // Остаёмся на том же слайде, где бы он теперь ни стоял
      let next = cur;
      if (cur === from) next = to;
      else if (from < cur && to >= cur) next = cur - 1;
      else if (from > cur && to <= cur) next = cur + 1;
      this.host.go(next);
    }
  }

  addSlide(after: number, preset = 0): void {
    const s = (SLIDE_PRESETS[preset] ?? SLIDE_PRESETS[0]).make();
    s.id = this.uniqueId('slide');
    if (this.commit((d) => d.slides.splice(after + 1, 0, s))) this.host.go(after + 1);
  }

  // ---------------- уведомления ----------------

  private toastTimer = 0;

  toast(text: string, ms = 2500, error = false): void {
    clearTimeout(this.toastTimer);
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('err', error);
    this.toastEl.classList.add('on');
    if (ms > 0) this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }

  /** Можно ли сохранять копию файла (есть снимок исходного HTML). */
  static fileSaveAvailable(): boolean {
    return canSaveFile();
  }
}

/** Приводит адрес к полному виду: example.com → https://example.com, почта → mailto: */
export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (/^(https?:|mailto:|tel:)/i.test(s)) {
    try {
      if (/^https?:/i.test(s)) new URL(s);
      return s;
    } catch {
      return '';
    }
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
  if (/^\+?[\d\s()-]{6,}$/.test(s)) return `tel:${s.replace(/[\s()-]/g, '')}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return `https://${s}`;
  return '';
}
