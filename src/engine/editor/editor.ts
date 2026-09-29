import { icon } from '../../components/icons';
import type { Deck, SlideData } from '../../types';
import { applyAccent, HEX_RE, previewAccent } from '../accent';
import { clone, getAt, replaceContents, setAt, type Path } from '../data';
import { esc } from '../html';
import { BlockEditor } from './block-edit';
import { ImageEditor } from './image-edit';
import { projectStorage, type DeckStorage } from '../storage';
import {
  blobToDataUrl, buildHtml, canSaveFile, MAX_FILE, prepareImage, saveHtmlFile, suggestedFileName,
} from './persist';
import { TextEditor } from './text-edit';
import { History } from './history';
import './editor.css';

export type MediaKind = 'video' | 'model';

/** Видео и 3D-модели: что принимаем и как проверяем файл */
const MEDIA: Record<MediaKind, { accept: string; formats: string; test(f: File): boolean }> = {
  video: { accept: 'video/mp4,video/webm,.mp4,.webm', formats: 'MP4 и WebM', test: (f) => /^video\/(mp4|webm)$/.test(f.type) || /\.(mp4|webm)$/i.test(f.name) },
  model: { accept: '.glb,model/gltf-binary', formats: 'GLB', test: (f) => /\.glb$/i.test(f.name) },
};
const MAX_MEDIA = 60 * 1024 * 1024;

function mediaKind(f: File | undefined): MediaKind | null {
  if (!f) return null;
  if (MEDIA.video.test(f)) return 'video';
  if (MEDIA.model.test(f)) return 'model';
  return null;
}

/** Перетаскивают HTML-файл: это импорт презентации в yarn dev, а не картинка. */
const draggingHtml = (e: DragEvent) => [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file' && i.type === 'text/html');

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
  /** Изменилось выделение блока, история или состояние сохранения (для панелей студии) */
  state?(): void;
}

export interface EditorOptions {
  /**
   * Студия: у редактора нет своей верхней панели и заметок (их даёт окно студии),
   * режим правки включён всегда, панель блока заменяет панель свойств.
   */
  studio?: boolean;
  storage?: DeckStorage;
  /** Куда встроить панель оформления текста (лента студии); без него панель всплывает над текстом */
  textDock?: HTMLElement;
}

/** Выделенный блок: путь блока в данных, путь свободного объекта (если он свободный) и тип. */
export interface BlockSelection {
  block: Path;
  free: Path | null;
  type: string;
  /** Есть внешний блок, который можно выделить («Выше») */
  hasParent: boolean;
  /** Все выделенные свободные объекты (больше одного — выделена группа) */
  group: Path[];
}

type Mode = 'project' | 'file';

interface Commit {
  /** Правки с одинаковым ключом подряд склеиваются в один шаг отмены (набор текста, выбор цвета) */
  merge?: string;
  /** Склеивать без ограничения по времени — пока не сменился ключ или не вызван endMerge (набор в поле) */
  hold?: boolean;
  rebuild?: boolean;
}

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
  // Для импортированных слайдов: фон как у соседнего, содержимое — «Вставить»
  { name: 'Пустой холст', make: () => ({ template: 'canvas', label: 'Новый слайд', free: [] }) },
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
  readonly studio: boolean;
  private storage: DeckStorage;
  /** Текст и вид строки состояния сохранения */
  statusInfo = { text: '', cls: '' };

  private hist!: History;
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

  constructor(private host: EditorHost, devServer: boolean, opts: EditorOptions = {}) {
    this.mode = devServer ? 'project' : 'file';
    // История правок вкладки: после перезагрузки страницы (обновился код) отмена продолжает работать
    this.hist = new History(host.deckKey);
    this.hist.load(this.hist.snap(host.deck));
    this.studio = !!opts.studio;
    this.storage = opts.storage ?? projectStorage;
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
    }, opts.textDock);
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
      selected: () => this.host.state?.(),
    });
    addEventListener('resize', () => this.reposition());
    // «Сделать редактируемым» у живого слайда: остаётся обычная копия, которую можно править
    addEventListener('htmlpptx:unlive', (e) => {
      const i = (e as CustomEvent<{ index: number }>).detail?.index;
      if (!this.active || !Number.isInteger(i) || !this.host.deck.slides[i]) return;
      if (this.commit((d) => { delete d.slides[i].live; }, { rebuild: true })) {
        this.toast('Слайд преобразован для правки. Отменить: Ctrl+Z', 4000);
      }
    });
    addEventListener('beforeunload', (e) => {
      if (this.mode === 'project' && (this.dirty || this.saving)) {
        // Последняя попытка записать правки перед закрытием вкладки
        this.storage.save(this.host.deckKey, this.host.deck, true).catch(() => {});
      }
      if (this.mode === 'file' && this.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // ---------------- интерфейс ----------------

  private buildUi(): void {
    if (this.studio) {
      // Панели даёт студия; здесь только всплывающие элементы у выделенного
      document.body.insertAdjacentHTML('beforeend', `
<div class="edhint" id="ed-hint" role="tooltip"></div>
<div class="edpop" id="ed-pop" role="dialog" aria-modal="false"></div>
<div class="edtoast" id="ed-toast" role="status" aria-live="polite"></div>
<input type="file" id="ed-file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml" hidden>`);
      this.bar = document.createElement('div');
      this.notes = document.createElement('div');
      this.hint = document.getElementById('ed-hint')!;
      this.pop = document.getElementById('ed-pop')!;
      this.toastEl = document.getElementById('ed-toast')!;
      this.file = document.getElementById('ed-file') as HTMLInputElement;
      return;
    }
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
      <button class="btn ghost small" id="ed-insert" type="button" aria-haspopup="true" aria-expanded="false" title="Добавить текст или изображение">${icon('plus')}<span>Вставить</span></button>
      <span class="edmenu-list" id="ed-insert-menu" role="menu">
        <button type="button" role="menuitem" data-add="text">${icon('text')} Текст</button>
        <button type="button" role="menuitem" data-add="image">${icon('image')} Картинку</button>
      </span>
    </span>
    <button class="btn ghost small" id="ed-add" type="button" title="Слайды">${icon('grid')}<span>Слайды</span></button>
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
    // Подсказка у кнопок: какое именно действие отменится или повторится
    const tip = (id: string, from: 'past' | 'future', base: string) => $(id).addEventListener('mouseenter', () => {
      const what = this.stepLabel(from);
      $(id).title = what ? `${base}: ${what}` : base;
    });
    tip('ed-undo', 'past', 'Отменить (Ctrl+Z)');
    tip('ed-redo', 'future', 'Повторить (Ctrl+Shift+Z)');
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
    accent.addEventListener('input', () => this.previewAccent(accent.value));
    accent.addEventListener('change', () => this.setAccent(accent.value));
    accent.addEventListener('blur', () => this.endAccentPreview());
    $('ed-accent-reset').addEventListener('click', () => this.setAccent(null));

    const text = $<HTMLTextAreaElement>('ed-notes-text');
    text.addEventListener('input', () => {
      const i = this.host.index();
      const v = text.value;
      this.commit((d) => {
        if (v.trim()) d.slides[i].notes = v;
        else delete d.slides[i].notes;
      }, { merge: `notes:${i}`, hold: true, rebuild: false });
    });
    // Набор заметок — один шаг отмены на заход в поле
    text.addEventListener('blur', () => this.endMerge());
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
      if (!seen && !this.studio) {
        this.toast(this.mode === 'project'
          ? 'Щёлкните текст, чтобы изменить его. Изменения сохраняются автоматически.'
          : 'Щёлкните текст, чтобы изменить его. Чтобы не потерять изменения, нажмите «Сохранить».', 7000);
      }
    } else {
      this.detach();
      this.hideHint();
      this.closePop();
      // Подсказка про режим правки вне его не нужна
      clearTimeout(this.toastTimer);
      this.toastEl.classList.remove('on');
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
      // Панели студии (свойства, лента) работают с выделенным: клик по ним его не снимает
      if (t.closest?.('[data-ed-keep]')) return;
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
    const before = this.hist.snap(this.host.deck);
    const draft = clone(this.host.deck);
    try {
      fn(draft);
    } catch (e) {
      this.toast((e as Error).message, 4000, true);
      return false;
    }
    const after = this.hist.snap(draft);
    if (History.same(after, before)) return false;
    const now = Date.now();
    const merge = !!opts.merge && opts.merge === this.lastMerge && (!!opts.hold || now - this.lastTime < MERGE_MS);
    if (!merge) this.hist.push(before);
    this.hist.future = [];
    this.lastMerge = opts.merge ?? '';
    this.lastTime = now;
    replaceContents(this.host.deck as unknown as Record<string, unknown>, draft as unknown as Record<string, unknown>);
    this.changed(opts.rebuild !== false);
    this.hist.save(after);
    return true;
  }

  /** Набор в поле закончен: следующая правка — новый шаг отмены */
  endMerge(): void {
    this.lastMerge = '';
  }

  /** Отмена и повтор: данные шага, переход к слайду, где была правка, короткая подсказка */
  private step(from: 'past' | 'future'): void {
    this.text.finish(true);
    const list = from === 'past' ? this.hist.past : this.hist.future;
    const target = list.pop();
    if (!target) return this.toast(from === 'past' ? 'Отменять нечего' : 'Повторять нечего', 1500);
    const cur = this.hist.snap(this.host.deck);
    const what = from === 'past' ? History.describe(target, cur) : History.describe(cur, target);
    (from === 'past' ? this.hist.future : this.hist.past).push(cur);
    replaceContents(this.host.deck as unknown as Record<string, unknown>, History.restore(target) as unknown as Record<string, unknown>);
    this.lastMerge = '';
    this.changed(true);
    this.hist.save(target);
    // Правка была на другом слайде — показать его, иначе отмена идёт «вслепую»
    const i = Math.min(History.changedSlide(cur, target), this.host.deck.slides.length - 1);
    const word = from === 'past' ? 'Отменено' : 'Повторено';
    if (i >= 0 && i !== this.host.index()) this.host.go(i);
    this.toast(`${word}: ${what[0].toLowerCase()}${what.slice(1)}`, 1600);
  }

  undo(): void {
    this.step('past');
  }

  redo(): void {
    this.step('future');
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

  /** Дописать все правки в deck.yaml и дождаться записи (перед импортом файла). */
  async settle(): Promise<void> {
    this.text.finish(true);
    if (this.mode !== 'project') return;
    for (let i = 0; i < 100 && (this.dirty || this.saving); i++) {
      if (this.saving) await new Promise((r) => setTimeout(r, 100));
      else await this.flush();
    }
  }

  private async flush(announce = false): Promise<void> {
    clearTimeout(this.saveTimer);
    if (this.saving) {
      this.saveTimer = window.setTimeout(() => void this.flush(announce), 300);
      return;
    }
    if (!this.dirty) {
      if (announce) this.toast('Всё сохранено', 1800);
      return;
    }
    this.saving = true;
    this.dirty = false;
    this.status();
    try {
      await this.storage.save(this.host.deckKey, this.host.deck);
      this.saveError = '';
      if (announce) this.toast('Сохранено', 1800);
    } catch (e) {
      this.dirty = true;
      this.saveError = (e as Error).message;
      this.toast(`Не удалось сохранить: ${this.saveError}`, 5000, true);
    } finally {
      this.saving = false;
      this.status();
    }
  }

  private status(): void {
    const el = document.getElementById('ed-status');
    let text: string;
    let cls = '';
    if (this.saveError) {
      text = this.mode === 'project' ? 'Не сохранено — повторить' : 'Не сохранено';
      cls = 'err';
    } else if (this.mode === 'project') {
      text = this.saving || this.dirty ? 'Сохранение…' : this.touched ? 'Сохранено' : 'Автосохранение';
      cls = this.saving || this.dirty ? '' : 'ok';
    } else {
      text = this.dirty ? 'Есть несохранённые правки' : this.touched ? 'Все правки сохранены' : '';
      cls = this.dirty ? 'warn' : 'ok';
    }
    this.statusInfo = { text, cls };
    this.host.state?.();
    if (!el) return;
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
    document.getElementById('ed-undo')?.toggleAttribute('disabled', !this.hist.past.length);
    document.getElementById('ed-redo')?.toggleAttribute('disabled', !this.hist.future.length);
    this.onSlideChange();
    this.host.state?.();
  }

  get canUndo(): boolean {
    return this.hist.past.length > 0;
  }

  /** Что отменит Ctrl+Z и что вернёт Ctrl+Y — для подсказок у кнопок; '' — нечего */
  stepLabel(from: 'past' | 'future'): string {
    const list = from === 'past' ? this.hist.past : this.hist.future;
    const target = list[list.length - 1];
    if (!target) return '';
    const cur = this.hist.snap(this.host.deck);
    return from === 'past' ? History.describe(target, cur) : History.describe(cur, target);
  }

  get canRedo(): boolean {
    return this.hist.future.length > 0;
  }

  /** Повторить сохранение после ошибки (клик по строке состояния). */
  retrySave(): void {
    if (this.saveError) void this.save();
  }

  private accentFrame = 0;
  private accentPreview = '';

  /**
   * Пока тянут палитру: только цвет на экране, не чаще кадра. Без истории, сохранения и перезапуска
   * вставок — всё это один раз в setAccent, когда палитру отпустили.
   */
  previewAccent(value: string): void {
    if (!HEX_RE.test(value)) return;
    this.accentPreview = value;
    if (this.accentFrame) return;
    this.accentFrame = requestAnimationFrame(() => {
      this.accentFrame = 0;
      previewAccent(this.accentPreview, this.host.stage());
    });
  }

  /** Палитру закрыли без выбора — вернуть цвет из данных */
  endAccentPreview(): void {
    cancelAnimationFrame(this.accentFrame);
    this.accentFrame = 0;
    previewAccent(null);
  }

  setAccent(value: string | null): void {
    this.endAccentPreview();
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
      // В студии Esc поднимается к внешнему блоку, а с самого внешнего — снимает выделение
      else if (this.studio && this.blocks.info?.hasParent && !this.blocks.isMulti) {
        this.image.clear();
        this.blocks.selectParent();
      } else if (this.image.selected || this.blocks.selected) {
        this.image.clear();
        this.blocks.clear();
      } else if (!this.studio) this.toggle(false);
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
    // Shift+клик по свободному объекту — добавить к выделению или убрать из него
    if (free && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      this.text.finish(true);
      this.image.clear();
      this.blocks.toggleGroup(free);
      return;
    }
    // Группа: второй клик выделяет объект внутри неё; пока он выделен, клики по нему — правка
    const member = free?.querySelector(':scope > [data-type="group"]') ? target.closest<HTMLElement>('.grp-item > [data-block]') : null;
    const child = this.blocks.groupChild;
    const inChild = !!free && !!child && free.contains(child);
    if (inChild && member && member !== child) {
      e.preventDefault();
      e.stopPropagation();
      this.text.finish(true);
      this.blocks.select(member);
      return;
    }
    // Первый клик по свободному объекту выделяет его целиком (двигать, масштабировать);
    // если он уже выделен нажатием мыши — этот клик тоже первый, не правка текста
    if (free && !(inChild && child!.contains(target)) && (!this.blocks.isSelected(free) || this.blocks.takePressSelected())) {
      e.preventDefault();
      e.stopPropagation();
      this.text.finish(true);
      this.image.clear();
      this.blocks.select(free);
      // В студии настройки картинки — в панели свойств; панель у картинки — по клику на неё
      const img = this.studio ? null : free.querySelector<HTMLElement>('[data-edit-img]');
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
      // В студии картинка настраивается в панели свойств: щелчок выделяет её блок, двойной — замена файла
      if (this.studio) {
        if (free) this.blocks.select(free);
        return;
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
    } else if (member && member !== child) {
      e.preventDefault();
      this.blocks.select(member);
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

  // ---------------- для панелей студии ----------------

  get selection(): BlockSelection | null {
    return this.blocks.info;
  }

  get blockEditor(): BlockEditor {
    return this.blocks;
  }

  /** Снять любое выделение: текст, картинку, блок. */
  clearSelection(): void {
    this.text.finish(true);
    this.image.clear();
    this.blocks.clear();
    this.closePop();
  }

  /** Выделить свободный объект по номеру (после вставки, из списка слоёв). */
  selectFree(slide: number, index: number): void {
    this.text.finish(true);
    this.image.clear();
    this.blocks.selectFree(slide, index);
  }

  /** Выделить блок по его элементу на слайде (навигация по составу). */
  selectBlock(el: HTMLElement): void {
    this.text.finish(true);
    this.image.clear();
    this.blocks.select(el);
  }

  /**
   * Начать правку текстового поля (из списка частей блока).
   * keep — не снимать выделение объекта (текст фигуры), selectAll — выделить весь текст.
   */
  editField(el: HTMLElement, opts: { keep?: boolean; selectAll?: boolean } = {}): void {
    this.image.clear();
    if (!opts.keep) this.blocks.clear();
    this.startEdit(el);
    const cur = document.activeElement;
    if (opts.selectAll && cur instanceof HTMLElement && cur.isContentEditable) getSelection()?.selectAllChildren(cur);
  }

  /** Выделить несколько свободных объектов слайда (Ctrl+A, вставка). */
  selectMany(slide: number, indexes: number[]): void {
    this.text.finish(true);
    this.image.clear();
    if (indexes.length === 1) this.blocks.selectFree(slide, indexes[0]);
    else this.blocks.selectMany(slide, indexes);
  }

  reposition(): void {
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

  /** Видео или 3D-модель для поля формы: выбор файла, загрузка в assets/, путь — в данные. */
  pickMedia(path: Path, kind: MediaKind): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = MEDIA[kind].accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      void this.uploadMedia(f, kind).then((url) => {
        if (url) this.commit((d) => setAt(d, path, url), { rebuild: true });
      });
    };
    input.click();
  }

  /** Загрузить видео или модель; null — не подошёл формат или не удалось. */
  private async uploadMedia(file: File, kind: MediaKind): Promise<string | null> {
    const m = MEDIA[kind];
    if (!m.test(file)) {
      this.toast(`Формат не поддерживается. Подойдут ${m.formats}.`, 3500, true);
      return null;
    }
    if (file.size > MAX_MEDIA) {
      this.toast(`Файл больше ${MAX_MEDIA / 1024 / 1024} МБ`, 4000, true);
      return null;
    }
    this.toast(kind === 'video' ? 'Загрузка видео…' : 'Загрузка модели…', 0);
    try {
      const url = this.mode === 'project'
        ? (await this.storage.uploadAsset(this.host.deckKey, file, file.name)).url
        : await blobToDataUrl(file);
      this.toast(kind === 'video' ? 'Видео добавлено' : 'Модель добавлена', 1500);
      return url;
    } catch (e) {
      this.toast(`Не удалось загрузить файл: ${(e as Error).message}`, 5000, true);
      return null;
    }
  }

  /** Видео или модель, брошенные на слайд: новый свободный объект в точке броска. */
  async insertMediaFile(file: File, kind: MediaKind, at?: { x: number; y: number }): Promise<void> {
    const i = this.host.index();
    const url = await this.uploadMedia(file, kind);
    if (!url) return;
    let w = kind === 'video' ? 640 : 420;
    let h = kind === 'video' ? 360 : 420;
    if (kind === 'video') {
      // Пропорции самого ролика
      const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => resolve(v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null);
        v.onerror = () => resolve(null);
        v.src = url;
      });
      if (dims) {
        const k = Math.min(640 / dims.w, 400 / dims.h);
        w = Math.round(dims.w * k);
        h = Math.round(dims.h * k);
      }
    }
    const cx = at?.x ?? 640;
    const cy = at?.y ?? 360;
    const place = { x: Math.round(Math.max(0, Math.min(1280 - w, cx - w / 2))), y: Math.round(Math.max(0, Math.min(720 - h, cy - h / 2))), w, h };
    let idx = -1;
    this.commit((d) => {
      const sl = d.slides[i];
      sl.free = Array.isArray(sl.free) ? sl.free : [];
      sl.free.push({ type: kind, src: url, place });
      idx = sl.free.length - 1;
    }, { rebuild: true });
    if (idx >= 0) this.selectFree(i, idx);
  }

  pickImage(path: Path): void {
    this.file.value = '';
    this.file.onchange = () => {
      const f = this.file.files?.[0];
      if (f) void this.replaceImage(path, f);
    };
    this.file.click();
  }

  private async replaceImage(path: Path, file: File): Promise<void> {
    if (!/^image\//.test(file.type)) return this.toast('Формат не поддерживается. Подойдут PNG, JPG, GIF, WebP, AVIF, SVG.', 3500, true);
    if (file.size > MAX_FILE) return this.toast('Файл больше 25 МБ', 4000, true);
    this.toast('Загрузка картинки…', 0);
    try {
      const { blob, name, resized } = await prepareImage(file);
      const url = this.mode === 'project'
        ? (await this.storage.uploadAsset(this.host.deckKey, blob, name)).url
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

  /**
   * Новая картинка свободным объектом (вставка из буфера, перетаскивание на пустое место).
   * at — точка на слайде, куда поставить центр; без неё — центр слайда.
   */
  async insertImageFile(file: File, at?: { x: number; y: number }): Promise<void> {
    if (!/^image\//.test(file.type)) return this.toast('Формат не поддерживается. Подойдут PNG, JPG, GIF, WebP, AVIF, SVG.', 3500, true);
    if (file.size > MAX_FILE) return this.toast('Файл больше 25 МБ', 4000, true);
    const i = this.host.index();
    this.toast('Загрузка картинки…', 0);
    try {
      const { blob, name } = await prepareImage(file);
      const url = this.mode === 'project'
        ? (await this.storage.uploadAsset(this.host.deckKey, blob, name)).url
        : await blobToDataUrl(blob);
      // Размер по пропорциям картинки, не больше половины слайда
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth || 480, h: img.naturalHeight || 320 });
        img.onerror = () => resolve({ w: 480, h: 320 });
        img.src = url;
      });
      const k = Math.min(1, 640 / dims.w, 400 / dims.h);
      const w = Math.max(40, Math.round(dims.w * k));
      const h = Math.max(40, Math.round(dims.h * k));
      const cx = at?.x ?? 640;
      const cy = at?.y ?? 360;
      const place = { x: Math.round(Math.max(0, Math.min(1280 - w, cx - w / 2))), y: Math.round(Math.max(0, Math.min(720 - h, cy - h / 2))), w, h };
      let idx = -1;
      this.commit((d) => {
        const sl = d.slides[i];
        sl.free = Array.isArray(sl.free) ? sl.free : [];
        sl.free.push({ type: 'image', src: url, place });
        idx = sl.free.length - 1;
      }, { rebuild: true });
      if (idx >= 0) this.selectFree(i, idx);
      this.toast('Картинка добавлена', 1800);
    } catch (e) {
      this.toast(`Не удалось добавить картинку: ${(e as Error).message}`, 5000, true);
    }
  }

  /** Точка экрана → координаты слайда 1280×720. */
  toSlide(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.host.stage().getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * 1280, y: ((clientY - r.top) / r.height) * 720 };
  }

  private dropTarget(e: DragEvent): Element | null {
    return (e.target as Element)?.closest?.('[data-edit-img]') ?? null;
  }

  private onDragOver(e: DragEvent): void {
    // HTML-файл — это импорт презентации (import-ui), не картинка
    if (!e.dataTransfer?.types.includes('Files') || draggingHtml(e)) return;
    e.preventDefault();
    const t = this.dropTarget(e);
    // В студии файл на пустом месте — новая картинка
    e.dataTransfer.dropEffect = t || this.studio ? 'copy' : 'none';
    this.host.stage().querySelectorAll('.ed-drop').forEach((x) => x !== t && x.classList.remove('ed-drop'));
    t?.classList.add('ed-drop');
  }

  private onDragLeave(e: DragEvent): void {
    const t = this.dropTarget(e);
    if (t && !t.contains(e.relatedTarget as Node)) t.classList.remove('ed-drop');
  }

  private onDrop(e: DragEvent): void {
    if (!e.dataTransfer?.files.length || /\.html?$/i.test(e.dataTransfer.files[0].name)) return;
    e.preventDefault();
    this.host.stage().querySelectorAll('.ed-drop').forEach((x) => x.classList.remove('ed-drop'));
    const file = e.dataTransfer.files[0];
    const media = mediaKind(file);
    if (media) {
      if (this.studio) void this.insertMediaFile(file, media, this.toSlide(e.clientX, e.clientY));
      else this.toast('Видео и 3D-модели добавляются в редакторе', 2500);
      return;
    }
    const t = this.dropTarget(e);
    if (!t && this.studio) {
      void this.insertImageFile(e.dataTransfer.files[0], this.toSlide(e.clientX, e.clientY));
      return;
    }
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
    const near = this.host.deck.slides[after];
    if (s.template === 'canvas' && near?.template === 'canvas') {
      // Фон соседнего слайда: цвет и фоновая вставка на весь слайд
      if (near.bg) s.bg = near.bg;
      const back = (Array.isArray(near.free) ? near.free : []).filter((b) => {
        const pl = (b as { place?: { x?: number; y?: number; w?: number; h?: number } }).place;
        return b.type === 'embed' && pl && !pl.x && !pl.y && pl.w === 1280 && pl.h === 720;
      });
      s.free = clone(back).map((b) => ({ ...b, enter: undefined, delay: undefined }));
    }
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
