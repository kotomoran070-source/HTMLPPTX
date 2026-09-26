import { icon } from '../../components/icons';
import type { Deck, SlideData } from '../../types';
import { applyAccent, HEX_RE } from '../accent';
import { clone, getAt, replaceContents, setAt, type Path } from '../data';
import { esc } from '../html';
import { BlockEditor } from './block-edit';
import { ImageEditor } from './image-edit';
import {
  blobToDataUrl, buildHtml, canSaveFile, MAX_FILE, prepareImage, saveHtmlFile,
  saveToProject, suggestedFileName, uploadAsset,
} from './persist';
import { TextEditor } from './text-edit';
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
  { name: 'Картинка', make: () => ({ title: 'Новый слайд', body: { type: 'image', src: '', caption: 'Подпись', height: 520 } }) },
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

  private text!: TextEditor;
  private image!: ImageEditor;
  private blocks!: BlockEditor;
  private notesOpen = false;
  private lastIndex = -1;
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
    const deck = () => this.host.deck as unknown as Record<string, unknown>;
    const commit = (fn: (d: Record<string, unknown>) => void, opts?: Commit) => this.commit((d) => fn(d as unknown as Record<string, unknown>), opts);
    this.text = new TextEditor({
      deck, commit,
      stage: () => this.host.stage(),
      prompt: (a, o) => this.prompt(a, o),
      toast: (t, ms, err) => this.toast(t, ms, err),
      save: () => void this.save(),
      neighbour: (el, dir) => this.editNeighbour(el, dir),
      blockOf: (p) => this.blockOf(p),
      removeBlock: (p) => this.removeBlock(p),
      normalizeUrl,
    });
    this.image = new ImageEditor({
      deck, commit,
      stage: () => this.host.stage(),
      toast: (t, ms, err) => this.toast(t, ms, err),
      pick: (p) => this.pickImage(p),
      blockOf: (p) => this.blockOf(p),
      removeBlock: (p) => this.removeBlock(p),
    });
    this.blocks = new BlockEditor({
      deck: () => this.host.deck,
      stage: () => this.host.stage(),
      index: () => this.host.index(),
      commit: (fn, opts) => this.commit(fn, opts),
      toast: (t, ms, err) => this.toast(t, ms, err),
      clearOthers: () => { this.text.finish(true); this.image.clear(); },
    });
    addEventListener('resize', () => this.reposition());
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
    <span class="edmenu">
      <button class="btn ghost small" id="ed-insert" type="button" aria-haspopup="true" aria-expanded="false" title="Добавить на слайд свободный текст или картинку">${icon('plus')}<span>Вставить</span></button>
      <span class="edmenu-list" id="ed-insert-menu" role="menu">
        <button type="button" role="menuitem" data-add="text">${icon('text')} Текст</button>
        <button type="button" role="menuitem" data-add="image">${icon('image')} Картинку</button>
      </span>
    </span>
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
    const menu = $('ed-insert-menu');
    const setMenu = (on: boolean) => {
      menu.classList.toggle('on', on);
      $('ed-insert').setAttribute('aria-expanded', String(on));
    };
    $('ed-insert').addEventListener('click', () => setMenu(!menu.classList.contains('on')));
    menu.addEventListener('click', (e) => {
      const kind = (e.target as Element).closest<HTMLElement>('[data-add]')?.dataset.add;
      setMenu(false);
      if (kind === 'text' || kind === 'image') this.addBlock(kind);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!(e.target as Element).closest?.('.edmenu')) setMenu(false);
    });
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
    if (!on) {
      this.text.finish(true);
      this.image.clear();
      this.blocks.clear();
    }
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
          ? 'Клик по тексту — правка и оформление, по картинке — её настройки, по блоку — удалить или «Свободно» (двигать и масштабировать). Правки сразу сохраняются в deck.yaml.'
          : 'Клик по тексту — правка и оформление, по картинке — её настройки, по блоку — удалить или «Свободно» (двигать и масштабировать). Чтобы не потерять правки, нажмите «Сохранить».', 7000);
      }
    } else {
      this.detach();
      this.hideHint();
      this.closePop();
      if (this.mode === 'project') void this.flush();
    }
    this.host.relayout();
    this.reposition();
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
      if (this.text.active && !this.text.owns(e.target as Node)) e.preventDefault();
    }, true);
    on(stage, 'pointerdown', (e) => {
      if (this.text.active && this.text.owns(e.target as Node)) return;
      // Перемещение свободного объекта; иначе — сдвиг кадра выделенной картинки
      if (this.blocks.pointerDown(e, this.image.selected)) {
        if (this.text.active) this.text.finish(true);
        return;
      }
      if (!this.text.active) this.image.pointerDown(e);
    }, true);
    // Клик вне слайда и панелей завершает правку текста и снимает выделение картинки
    on(document, 'pointerdown', (e) => {
      const t = e.target as Element;
      if (stage.contains(t) || this.pop.contains(t) || this.bar.contains(t) || this.notes.contains(t)) return;
      if (this.text.active && !this.text.owns(t)) this.text.finish(true);
      if (this.image.selected && !this.image.owns(t) && !this.blocks.owns(t)) this.image.clear();
      if (this.blocks.selected && !this.blocks.owns(t) && !this.image.owns(t) && !this.text.owns(t)) this.blocks.clear();
    }, true);
    on(stage, 'click', (e) => this.onClick(e), true);
    on(stage, 'dblclick', (e) => this.onDblClick(e), true);
    on(stage, 'mouseover', (e) => {
      this.onOver(e);
      this.blocks.onOver(e.target as Element);
    });
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
    this.text.finish(true);
    const prev = this.past.pop();
    if (prev === undefined) return this.toast('Отменять нечего', 1500);
    this.future.push(JSON.stringify(this.host.deck));
    replaceContents(this.host.deck as unknown as Record<string, unknown>, JSON.parse(prev));
    this.lastMerge = '';
    this.changed(true);
  }

  redo(): void {
    this.text.finish(true);
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
    if (rebuild) {
      this.image.refresh();
      this.blocks.refresh();
    }
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
    this.text.finish(true);
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
    this.reposition();
    if (this.notesOpen) (document.getElementById('ed-notes-text') as HTMLTextAreaElement).focus();
  }

  /** Движок сообщает о смене слайда. */
  onSlideChange(): void {
    if (this.text.active) this.text.finish(true);
    this.hideHint();
    this.closePop();
    const i = this.host.index();
    if (i !== this.lastIndex) {
      this.image.clear();
      this.blocks.clear();
    }
    this.lastIndex = i;
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
      else if (this.image.selected || this.blocks.selected) {
        this.image.clear();
        this.blocks.clear();
      } else this.toggle(false);
      e.preventDefault();
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && (this.image.selected || this.blocks.selected)) {
      e.preventDefault();
      // Выделен свободный объект — удаляется объект; выделена картинка в раскладке — убирается картинка
      if (this.blocks.selected && (this.blocks.isFree || !this.image.selected)) this.blocks.remove();
      else document.querySelector<HTMLElement>('#ed-img [data-i="remove"]:not([hidden])')?.click();
      this.image.clear();
      return true;
    }
    if (this.blocks.isFree && !mod && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) this.blocks.nudge(d[0], d[1]);
      return true;
    }
    if (this.blocks.isFree && mod && (k === 'd' || k === 'в')) {
      e.preventDefault();
      this.blocks.duplicate();
      return true;
    }
    return false;
  }

  // ---------------- клики по сцене ----------------

  private onClick(e: MouseEvent): void {
    const target = e.target as Element;
    if (this.blocks.justDragged) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.text.owns(target)) return;
    const free = target.closest<HTMLElement>('[data-free]');
    // Первый клик по свободному объекту выделяет его целиком (двигать, масштабировать)
    if (free && !this.blocks.isSelected(free)) {
      e.preventDefault();
      e.stopPropagation();
      this.text.finish(true);
      this.image.clear();
      this.blocks.select(free);
      const img = free.querySelector<HTMLElement>('[data-edit-img]');
      const path = img ? readPath(img, 'data-edit-img') : null;
      if (img && path && getAt(this.host.deck, path)) this.image.select(img);
      return;
    }
    const text = target.closest('[data-edit]');
    const img = target.closest('[data-edit-img]');
    // Внутри плитки подпись — это текст; сама плитка — картинка
    if (text && (!img || img.contains(text))) {
      e.preventDefault();
      e.stopPropagation();
      this.image.clear();
      if (!free) this.blocks.clear();
      this.startEdit(text as HTMLElement, { x: e.clientX, y: e.clientY });
      return;
    }
    if (img) {
      e.preventDefault();
      e.stopPropagation();
      if (!free) {
        // Вместе с картинкой выделяется её блок (плитка, картинка): его можно удалить или сделать свободным
        const owner = img.closest<HTMLElement>('[data-block]');
        if (owner) this.blocks.select(owner);
        else this.blocks.clear();
      }
      const path = readPath(img, 'data-edit-img');
      const value = path ? getAt(this.host.deck, path) : null;
      // Пустое место — сразу выбор файла; картинка — выделение и её панель
      if (!value && path && img.getAttribute('data-img-kind') !== 'logo' && !img.querySelector('svg')) this.pickImage(path);
      else this.image.select(img as HTMLElement);
      return;
    }
    this.image.clear();
    // Ссылки в режиме правки не открываются
    if (target.closest('a[href]')) {
      e.preventDefault();
      const link = target.closest('[data-edit-url]');
      if (link) this.editUrl(link);
      return;
    }
    // Остальное — выделение блока: удалить, сделать свободным
    const block = target.closest<HTMLElement>('[data-block]');
    if (block && !free) {
      e.preventDefault();
      this.blocks.select(block);
    } else if (!free) {
      this.blocks.clear();
    }
  }

  private onDblClick(e: MouseEvent): void {
    const img = (e.target as Element).closest('[data-edit-img]');
    if (!img || (e.target as Element).closest('[data-edit]')) return;
    const path = readPath(img, 'data-edit-img');
    if (path) this.pickImage(path);
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
    this.text.finish(true);
    const el = this.refind(target, 'data-edit') as HTMLElement | null;
    if (!el) return;
    // SVG-текст (подписи на схемах) правится во всплывающем поле
    if (el instanceof SVGElement) {
      const path = readPath(el, 'data-edit');
      if (!path) return;
      const value = getAt(this.host.deck, path);
      const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : el.textContent?.trim() ?? '';
      void this.prompt(el, { label: 'Текст', value: raw }).then((v) => {
        if (v !== null && v !== raw) this.commit((d) => setAt(d, path, v), { rebuild: true });
      });
      return;
    }
    this.text.start(el, at);
  }

  private editNeighbour(el: HTMLElement, dir: 1 | -1): void {
    const path = el.getAttribute('data-edit');
    const slide = el.closest('.slide');
    const before = slide ? [...slide.querySelectorAll<HTMLElement>('[data-edit]')].filter((x) => !(x instanceof SVGElement)) : [];
    const i = before.indexOf(el);
    this.text.finish(true);
    // После перерисовки элементы новые — ищем соседа по пути
    const fresh = this.host.stage().querySelector('.slide.on');
    const list = fresh ? [...fresh.querySelectorAll<HTMLElement>('[data-edit]')].filter((x) => !(x instanceof SVGElement)) : [];
    const cur = list.findIndex((x) => x.getAttribute('data-edit') === path);
    const next = list[(cur >= 0 ? cur : i) + dir];
    if (next) this.startEdit(next);
  }

  // ---------------- блоки ----------------

  /** Ближайший блок (объект с type), который лежит в списке блоков или в body слайда. */
  blockOf(path: Path): Path | null {
    const deck = this.host.deck;
    for (let i = path.length; i >= 2; i--) {
      const p = path.slice(0, i);
      const obj = getAt(deck, p) as { type?: unknown } | undefined;
      if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.type !== 'string') continue;
      const parentKey = p[p.length - 1];
      const parent = getAt(deck, p.slice(0, -1));
      if (Array.isArray(parent) || parentKey === 'body') return p;
    }
    return null;
  }

  removeBlock(path: Path): void {
    const last = path[path.length - 1];
    if (this.commit((d) => {
      const parent = getAt(d, path.slice(0, -1));
      if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
      else setAt(d, path, undefined);
      // Пустой список свободных объектов в данных не нужен
      const sl = d.slides[Number(path[1])];
      if (Array.isArray(sl?.free) && !sl.free.length) delete sl.free;
    }, { rebuild: true })) this.toast('Блок удалён. Вернуть: Ctrl+Z', 3000);
  }

  /** Вставка текста или картинки свободным объектом в центр текущего слайда. */
  addBlock(kind: 'text' | 'image'): void {
    const i = this.host.index();
    const n = (this.host.deck.slides[i].free ?? []).length;
    // Каждый новый объект чуть смещён, чтобы не лечь ровно поверх предыдущего
    const shift = (n % 6) * 24;
    const block = kind === 'text'
      ? { type: 'text', text: 'Новый текст', place: { x: 440 + shift, y: 330 + shift, w: 400 } }
      : { type: 'image', src: '', place: { x: 400 + shift, y: 190 + shift, w: 480, h: 320 } };
    let at = -1;
    this.commit((d) => {
      const s = d.slides[i];
      s.free = Array.isArray(s.free) ? s.free : [];
      s.free.push(block);
      at = s.free.length - 1;
    }, { rebuild: true });
    if (at < 0) return;
    this.blocks.selectFree(i, at);
    const path: Path = ['slides', i, 'free', at, kind === 'text' ? 'text' : 'src'];
    if (kind === 'text') {
      const el = [...this.host.stage().querySelectorAll<HTMLElement>('.slide.on [data-edit]')]
        .find((x) => x.getAttribute('data-edit') === JSON.stringify(path));
      if (el) this.text.start(el);
    } else {
      this.pickImage(path);
    }
  }

  private reposition(): void {
    this.text.position();
    this.image.position();
    this.blocks.position();
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
    this.text.finish(true);
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

  private pickImage(path: Path): void {
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
      // Новая картинка сразу выделена: видно, что её можно вписать или кадрировать
      const el = [...this.host.stage().querySelectorAll<HTMLElement>('.slide.on [data-edit-img]')]
        .find((x) => x.getAttribute('data-edit-img') === JSON.stringify(path));
      if (el) this.image.select(el);
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
    // Подсказка нужна ссылкам; у картинок своя панель по клику
    const t = (e.target as Element).closest('[data-edit-url]');
    if (!t) return this.scheduleHintHide();
    clearTimeout(this.hintTimer);
    if (t === this.hintTarget && this.hint.classList.contains('on')) return;
    this.hintTarget = t;
    this.hint.innerHTML = `<button type="button">${icon('link')}<span>Изменить ссылку</span></button>`;
    this.hint.querySelector('button')!.onclick = () => {
      this.hideHint();
      void this.editUrl(t);
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
