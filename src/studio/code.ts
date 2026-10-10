import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { yaml } from '@codemirror/lang-yaml';
import { diagnosticCount, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { getSearchQuery, searchPanelOpen } from '@codemirror/search';
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { parse, stringify } from 'yaml';
import { setEmbedSource, withTheme } from '../components/html/html';
import { getAt, setAt, type Path } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { writeAssetText } from '../engine/editor/persist';
import { withPointerBridge } from '../engine/frame-bridge';
import { currentTheme, onThemeChange } from '../engine/theme';
import type { Deck, SlideData } from '../types';
import { codeHints, cssProblems, readSlideYaml } from './code-hints';
import { codeSearch, reopenSearch } from './code-search';
import { slideYaml } from './find';
import { collectNodes, cssRules, highlightField, rulesFor, setHighlight, treeHtml, treeToggleIcon, YamlRanges, type CssRule, type TreeNode } from './code-tree';

type Mode = 'slide' | 'css' | 'anim';

/** Набранный YAML записывается ровно так, как его записала бы программа */
function sameYaml(typed: string, text: string): boolean {
  try {
    return stringify(parse(typed), { lineWidth: 0 }) === text;
  } catch {
    return false;
  }
}

export interface CodeHost {
  deck(): Deck;
  index(): number;
  editor(): Editor;
  stage(): HTMLElement;
  deckKey: string;
}

/** Живая вставка слайда (анимация на HTML/JS): где в данных и как назвать в списке */
interface EmbedRef { path: Path; label: string }
interface EmbedData { type?: string; src?: string; code?: string; theme?: boolean }

const TREE_KEY = 'htmlpptx-code-tree';

const APPLY_MS = 700;

/**
 * Код текущего слайда (YAML, как в deck.yaml), стили презентации (CSS) и код живых вставок
 * слайда (анимации на HTML/JS) рядом со слайдом. Правки применяются сами, когда текст снова
 * корректен; ошибка — строкой состояния с номером строки.
 */
export class CodeView {
  private view: EditorView;
  private lang = new Compartment();
  private theme = new Compartment();
  private mode: Mode = 'slide';
  /** Текст, который сейчас соответствует данным (после загрузки или применения) */
  private synced = '';
  private timer = 0;
  private status: HTMLElement;
  private shownFor = '';
  private tree: HTMLElement;
  private list: HTMLElement;
  private nodes: TreeNode[] = [];
  private ranges = new YamlRanges();
  /** Узел, выбранный на слайде или в дереве; peek — под курсором в коде */
  private active = -1;
  private peekEls: Element[] = [];
  private markEls: Element[] = [];
  private revealed = '';
  /** Блоки вёрстки, чьи тексты и картинки раскрыты в дереве */
  private open = new Set<number>();
  /** Путь текста, который сейчас правят на слайде: узел дерева следует за ним */
  private focusPath = '';
  /** Правила CSS выделенного объекта и какое из них показано */
  private rules: CssRule[] = [];
  private ruleAt = 0;
  private rulesBtn: HTMLButtonElement;
  private ro = new Compartment();
  /** Только чтение — пока код вставки грузится или вставок на слайде нет (вкладка «Анимации») */
  private readOnly = false;
  /** Живые вставки текущего слайда и какая открыта */
  private embeds: EmbedRef[] = [];
  private embedAt = 0;
  private embedsFor = -1;
  private picker: HTMLSelectElement;
  /** Код вставок из файлов (assets/*.htm): адрес → текст */
  private texts = new Map<string, string>();
  private loading = new Set<string>();

  constructor(private root: HTMLElement, private host: CodeHost) {
    root.innerHTML = `<div class="st-code-bar">
  <div class="st-seg" role="tablist" aria-label="Что править">
    <button type="button" role="tab" data-mode="slide" aria-selected="true">Слайд · YAML</button>
    <button type="button" role="tab" data-mode="css" aria-selected="false">Стили · CSS</button>
    <button type="button" role="tab" data-mode="anim" aria-selected="false" title="Код живых вставок слайда: анимации на HTML и JavaScript, в том числе спрятанные под другими объектами">Анимации · HTML/JS</button>
  </div>
  <select class="st-code-pick" hidden aria-label="Какая вставка"></select>
  <button type="button" class="st-code-rules" hidden title="Следующее правило"></button>
  <span class="st-code-status" role="status" aria-live="polite"></span>
</div>
<div class="st-code-tree">
  <button type="button" class="st-tree-head" aria-expanded="true">${treeToggleIcon()}<b>Объекты слайда</b><span class="st-tree-count"></span></button>
  <div class="st-tree-list" role="tree" aria-label="Объекты слайда"></div>
</div>
<div class="st-code-ed"></div>`;
    this.status = root.querySelector('.st-code-status')!;
    this.tree = root.querySelector('.st-code-tree')!;
    this.list = root.querySelector('.st-tree-list')!;
    this.rulesBtn = root.querySelector('.st-code-rules')!;
    this.picker = root.querySelector('.st-code-pick')!;
    this.picker.addEventListener('change', () => this.setEmbed(Number(this.picker.value)));
    this.rulesBtn.addEventListener('click', () => this.showRule(this.ruleAt + 1));
    let folded = false;
    try { folded = localStorage.getItem(TREE_KEY) === '0'; } catch { /* нет хранилища */ }
    this.fold(folded);
    this.view = new EditorView({
      parent: root.querySelector('.st-code-ed')!,
      state: EditorState.create({ doc: '', extensions: this.extensions() }),
    });
    root.querySelector('.st-seg')!.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-mode]');
      if (b) this.setMode(b.dataset.mode as Mode);
    });
    root.querySelector('.st-tree-head')!.addEventListener('click', () => this.fold(!this.tree.classList.contains('folded')));
    this.list.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('.st-tree-node');
      if (b) this.pick(Number(b.dataset.k));
    });
    this.list.addEventListener('keydown', (e) => {
      const items = [...this.list.querySelectorAll<HTMLElement>('.st-tree-node:not([hidden])')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : -2;
      if (next === -2 || !items.length) return;
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, next))].focus();
    });
    this.list.addEventListener('mouseover', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('.st-tree-node');
      this.peekSlide(b ? Number(b.dataset.k) : -1);
    });
    this.list.addEventListener('mouseleave', () => this.peekSlide(-1));
    // Правят текст на слайде — в дереве и коде его узел
    document.addEventListener('focusin', (e) => {
      const el = (e.target as Element).closest?.('[data-edit]');
      if (!el || !this.host.stage().contains(el)) return;
      this.focusPath = el.getAttribute('data-edit') ?? '';
      this.syncSelection();
    });
    document.addEventListener('focusout', (e) => {
      if (!(e.target as Element).closest?.('[data-edit]') || !this.focusPath) return;
      this.focusPath = '';
    });
    // Правка кода — один шаг отмены на заход в редактор
    root.addEventListener('focusout', (e) => {
      if (!root.contains(e.relatedTarget as Node | null)) host.editor().endMerge();
    });
    // Клавиши редактора кода не должны листать слайды и отменять правки слайда; Ctrl+Shift+F — поиск
    // по коду всей презентации — проходит к студии
    root.addEventListener('keydown', (e) => {
      if (!((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyF')) e.stopPropagation();
    });
    onThemeChange((t) => this.view.dispatch({ effects: this.theme.reconfigure(t === 'dark' ? oneDark : []) }));
  }

  /** Настройка редактора — по текущей вкладке, теме и «только чтению» (новое состояние берёт её целиком) */
  private extensions(): Extension[] {
    return [
      basicSetup,
      codeSearch(),
      codeHints({ mode: () => this.mode, slide: () => this.host.stage().querySelector('.slide.on') }),
      this.lang.of(this.mode === 'css' ? css() : this.mode === 'anim' ? html() : yaml()),
      this.ro.of(EditorState.readOnly.of(this.readOnly)),
      this.theme.of(currentTheme() === 'dark' ? oneDark : []),
      EditorView.lineWrapping,
      highlightField,
      keymap.of([{ key: 'Mod-Enter', run: () => { this.apply(); return true; } }]),
      EditorView.updateListener.of((u) => {
        // Курсор в коде — какой объект под ним
        if (u.selectionSet && !u.docChanged && u.view.hasFocus) this.peekAt(u.state.selection.main.head);
        if (!u.docChanged) return;
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.apply(), APPLY_MS);
      }),
    ];
  }

  /**
   * Код загружен заново (другой слайд, вкладка, вставка, правка не здесь): новое состояние —
   * с пустой историей. Иначе Ctrl+Z в коде откатывал саму загрузку: код пустел, а после смены
   * слайда возвращал текст прошлого слайда и применял его к этому. Открытый поиск остаётся
   */
  private reload(text: string): void {
    const searching = searchPanelOpen(this.view.state);
    const query = getSearchQuery(this.view.state);
    this.view.setState(EditorState.create({ doc: text, extensions: this.extensions() }));
    if (searching) reopenSearch(this.view, query);
  }

  private setReadOnly(on: boolean): void {
    if (on === this.readOnly) return;
    this.readOnly = on;
    this.view.dispatch({ effects: this.ro.reconfigure(EditorState.readOnly.of(on)) });
  }

  private setMode(m: Mode): void {
    this.apply();
    this.mode = m;
    this.root.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
    this.view.dispatch({ effects: this.lang.reconfigure(m === 'css' ? css() : m === 'anim' ? html() : yaml()) });
    this.rulesBtn.hidden = true;
    this.picker.hidden = m !== 'anim';
    // «Только чтение» вкладки «Анимации» не переходит на YAML и CSS
    if (m !== 'anim') this.setReadOnly(false);
    this.rules = [];
    if (m === 'css') this.mark(-1);
    this.shownFor = '';
    this.update(true);
  }

  private source(): string {
    const deck = this.host.deck();
    if (this.mode === 'css') {
      const c = (deck as { css?: unknown }).css;
      return typeof c === 'string' ? c : '';
    }
    if (this.mode === 'anim') {
      const e = this.embeds[this.embedAt];
      const b = e ? getAt(deck, e.path) as EmbedData | undefined : undefined;
      if (!b) return '';
      if (typeof b.code === 'string') return b.code;
      if (b.src) {
        const t = this.texts.get(b.src);
        if (t !== undefined) return t;
        this.load(b.src);
      }
      return '';
    }
    return slideYaml(deck.slides[this.host.index()]);
  }

  /** Данные изменились или сменился слайд: показать актуальный код, не затирая незаконченную правку. */
  update(force = false): void {
    if (this.root.hidden) return;
    this.drawTree();
    if (this.mode === 'anim') this.collectEmbeds();
    const text = this.source();
    const subject = `${this.mode}:${this.host.index()}:${this.mode === 'anim' ? this.embedAt : ''}`;
    const typing = this.view.hasFocus && this.view.state.doc.toString() !== this.synced;
    if (!force && subject === this.shownFor && (text === this.synced || typing)) return;
    const same = subject === this.shownFor;
    this.shownFor = subject;
    this.synced = text;
    clearTimeout(this.timer);
    const typed = this.view.state.doc.toString();
    if (typed !== text || !same) {
      // Тот же код, только что применённый (YAML записался чуть иначе), пока в нём печатают, — без
      // отдельного шага отмены; иначе — загрузка заново, с чистой историей
      if (same && !force && this.view.hasFocus) {
        // По смыслу то же самое («enter:» записалось бы «enter: null») — набранное остаётся как есть
        if (this.mode === 'slide' && sameYaml(typed, text)) this.synced = typed;
        else this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text }, annotations: Transaction.addToHistory.of(false) });
      } else this.reload(text);
      clearTimeout(this.timer);
    }
    this.idleStatus();
    this.revealed = '';
    this.syncSelection();
  }

  // ---------------- инспектор объектов ----------------

  private fold(folded: boolean): void {
    this.tree.classList.toggle('folded', folded);
    this.tree.querySelector('.st-tree-head')!.setAttribute('aria-expanded', String(!folded));
    try { localStorage.setItem(TREE_KEY, folded ? '0' : '1'); } catch { /* нет хранилища */ }
  }

  /** Дерево по текущим данным слайда: перерисовывается, только если состав изменился. */
  private drawTree(): void {
    this.tree.hidden = this.mode !== 'slide';
    if (this.tree.hidden) return;
    const nodes = collectNodes(this.host.deck().slides[this.host.index()]);
    const sig = JSON.stringify(nodes);
    if (sig !== JSON.stringify(this.nodes) || !this.list.childElementCount) {
      // Раскрытые блоки остаются раскрытыми, если состав не поменялся по сути (правка текста)
      const same = nodes.length === this.nodes.length && nodes.every((n, k) => JSON.stringify(n.path) === JSON.stringify(this.nodes[k].path));
      if (!same) this.open.clear();
      this.nodes = nodes;
      this.drawList();
      this.active = -1;
    }
    this.tree.querySelector('.st-tree-count')!.textContent = String(nodes.filter((n) => n.kind === 'block').length || '');
  }

  private drawList(): void {
    const top = this.list.scrollTop;
    this.list.innerHTML = treeHtml(this.nodes, this.open);
    this.list.scrollTop = top;
  }

  /** Раскрыть или свернуть части блока вёрстки */
  private expand(k: number, on: boolean): void {
    if (on === this.open.has(k)) return;
    if (on) this.open.add(k);
    else this.open.delete(k);
    const active = this.active;
    this.drawList();
    if (active >= 0) this.mark(active);
  }

  private absPath(k: number): (string | number)[] | null {
    const n = this.nodes[k];
    return n ? ['slides', this.host.index(), ...n.path] : null;
  }

  private elementOf(k: number): HTMLElement | null {
    const p = this.absPath(k);
    if (!p) return null;
    return this.host.stage().querySelector<HTMLElement>(`.slide.on [data-block="${CSS.escape(JSON.stringify(p))}"]`);
  }

  /** Элементы на слайде, в которых видно поле шаблона или часть вёрстки */
  private fieldEls(k: number): HTMLElement[] {
    const p = this.absPath(k);
    if (!p) return [];
    const key = JSON.stringify(p).slice(0, -1);
    return [...this.host.stage().querySelectorAll<HTMLElement>('.slide.on [data-edit], .slide.on [data-edit-img]')].filter((el) => {
      const v = el.getAttribute('data-edit') ?? el.getAttribute('data-edit-img') ?? '';
      return v === `${key}]` || v.startsWith(`${key},`);
    });
  }

  private elementsOf(k: number): HTMLElement[] {
    if (this.nodes[k]?.kind === 'block') {
      const el = this.elementOf(k);
      return el ? [el] : [];
    }
    return this.fieldEls(k);
  }

  /** Узел дерева → объект выделен на слайде, его строки подсвечены в коде. */
  private pick(k: number): void {
    const n = this.nodes[k];
    if (!n) return;
    // Повторный выбор раскрытого блока вёрстки сворачивает его части
    if (n.kind === 'block' && k === this.active && this.open.has(k)) {
      this.expand(k, false);
      return;
    }
    // Часть вёрстки: выделяется её блок, а узел части остаётся отмеченным
    const owner = n.kind === 'part' ? n.parent! : n.kind === 'block' ? k : -1;
    const el = owner >= 0 ? this.elementOf(owner) : null;
    this.pinned = n.kind === 'block' ? -1 : k;
    if (el) {
      const wrap = el.parentElement;
      this.host.editor().selectBlock(wrap?.hasAttribute('data-free') ? wrap : el);
    }
    if (n.kind === 'block' && this.nodes[k + 1]?.parent === k) this.expand(k, true);
    this.mark(k);
    this.reveal(k, true);
    // Поле или текст на слайде показывается рамкой, пока выбран его узел
    this.elementsOf(k)[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Узел поля или части, выбранный в дереве: выделение его блока на слайде его не сбрасывает */
  private pinned = -1;

  private mark(k: number): void {
    this.active = k;
    const parent = this.nodes[k]?.parent;
    if (parent !== undefined && !this.open.has(parent)) {
      this.open.add(parent);
      this.drawList();
    }
    this.list.querySelectorAll<HTMLElement>('.st-tree-node').forEach((b) => {
      const on = Number(b.dataset.k) === k;
      b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView({ block: 'nearest' });
    });
    this.markEls.forEach((x) => x.classList.remove('st-code-mark'));
    this.markEls = k >= 0 && this.nodes[k]?.kind !== 'block' ? this.elementsOf(k) : [];
    this.markEls.forEach((x) => x.classList.add('st-code-mark'));
  }

  /** Строки объекта в коде: курсор в начало, подсветка; фокус остаётся, где был. */
  private reveal(k: number, force = false): void {
    const n = this.nodes[k];
    const text = this.view.state.doc.toString();
    if (!n || text !== this.synced) return;
    const key = `${this.host.index()}:${JSON.stringify(n.path)}`;
    if (key === this.revealed && !force) return;
    this.revealed = key;
    const r = this.ranges.range(text, n.path);
    if (!r) return;
    this.view.dispatch({
      effects: [setHighlight.of(r), EditorView.scrollIntoView(r.from, { y: 'start', yMargin: 24 })],
      selection: this.view.hasFocus ? undefined : { anchor: r.from },
    });
  }

  /** Выделение на слайде изменилось: узел дерева и код следуют за ним. */
  syncSelection(): void {
    if (this.root.hidden) return;
    if (this.mode === 'css') return this.syncRules();
    if (this.mode === 'anim') {
      // Выделили вставку на слайде — открывается её код
      const sel = this.host.editor().selection;
      const k = sel ? this.embeds.findIndex((e) => JSON.stringify(e.path) === JSON.stringify(sel.block)) : -1;
      if (k >= 0 && k !== this.embedAt) this.setEmbed(k);
      return;
    }
    this.drawTree();
    const sel = this.host.editor().selection;
    const i = this.host.index();
    const own = (p: unknown[]) => p[0] === 'slides' && p[1] === i;
    // Что сейчас в работе: текст под правкой, иначе выделенный блок
    let target: unknown[] | null = null;
    try { target = this.focusPath ? JSON.parse(this.focusPath) as unknown[] : null; } catch { /* нет пути */ }
    if (!target || !own(target)) target = sel && own(sel.block) ? sel.block : null;
    let k = target ? this.deepest(target.slice(2)) : -1;
    // Выбранная в дереве часть остаётся, пока выделен её блок (или ничего, для полей шаблона)
    const pin = this.nodes[this.pinned];
    if (pin && !this.focusPath && (pin.kind === 'field' ? k < 0 || this.nodes[k].kind === 'field' : pin.parent === k)) k = this.pinned;
    else this.pinned = -1;
    if (k === this.active && k >= 0 && this.markEls.every((x) => x.isConnected)) return;
    this.mark(k);
    // Пока в коде печатают, код не прокручивается
    if (k >= 0 && !this.view.hasFocus) this.reveal(k);
    if (k < 0) {
      this.revealed = '';
      this.view.dispatch({ effects: setHighlight.of(null) });
    }
  }

  /** Узел с самым длинным путём, который начинает путь p */
  private deepest(p: unknown[]): number {
    let best = -1;
    this.nodes.forEach((n, k) => {
      if (n.path.length <= p.length && n.path.every((s, j) => s === p[j]) && (best < 0 || n.path.length > this.nodes[best].path.length)) best = k;
    });
    return best;
  }

  // ---------------- правила CSS выделенного объекта ----------------

  /** Элемент, чьи правила ищем: текст под правкой, выбранная в дереве часть или выделенный объект */
  private ruleTarget(): Element | null {
    const stage = this.host.stage();
    if (this.focusPath) {
      const el = [...stage.querySelectorAll('.slide.on [data-edit]')].find((x) => x.getAttribute('data-edit') === this.focusPath);
      if (el) return el;
    }
    const sel = this.host.editor().selection;
    // Текст или поле, выбранные в дереве: правила именно для них
    const pin = this.nodes[this.pinned];
    if (pin && (pin.kind === 'field' || (sel && JSON.stringify(this.absPath(pin.parent!)) === JSON.stringify(sel.block)))) {
      const el = this.elementsOf(this.pinned)[0];
      if (el) return el;
    }
    if (!sel || sel.block[1] !== this.host.index()) return null;
    return stage.querySelector(`.slide.on [data-block="${CSS.escape(JSON.stringify(sel.block))}"]`);
  }

  private syncRules(): void {
    const text = this.view.state.doc.toString();
    const el = text === this.synced ? this.ruleTarget() : null;
    const found = el ? rulesFor(cssRules(text), el) : [];
    const same = found.length === this.rules.length && found.every((r, j) => r.from === this.rules[j].from);
    this.rules = found;
    if (!el) {
      this.rulesBtn.hidden = true;
      this.view.dispatch({ effects: setHighlight.of(null) });
      return;
    }
    this.rulesBtn.hidden = false;
    this.rulesBtn.disabled = !found.length;
    if (!found.length) {
      this.rulesBtn.textContent = 'Своих правил у объекта нет';
      this.view.dispatch({ effects: setHighlight.of(null) });
      return;
    }
    if (!same) this.showRule(0);
  }

  /** Показать правило с номером j (по кругу), остальные правила объекта остаются подсвеченными */
  private showRule(j: number): void {
    if (!this.rules.length) return;
    this.ruleAt = (j + this.rules.length) % this.rules.length;
    const r = this.rules[this.ruleAt];
    const n = this.rules.length;
    this.rulesBtn.textContent = n > 1 ? `Правило ${this.ruleAt + 1} из ${n} ›` : 'Одно правило объекта';
    this.rulesBtn.disabled = n < 2;
    this.view.dispatch({
      effects: [setHighlight.of(this.rules), EditorView.scrollIntoView(r.from, { y: 'start', yMargin: 24 })],
      selection: this.view.hasFocus ? undefined : { anchor: r.from },
    });
  }

  /** Курсор в коде: подсветить объект под ним в дереве и на слайде (без выделения). */
  private peekAt(pos: number): void {
    const text = this.view.state.doc.toString();
    const k = this.ranges.nodeAt(text, this.nodes, pos);
    this.list.querySelectorAll<HTMLElement>('.st-tree-node').forEach((b) => b.classList.toggle('peek', Number(b.dataset.k) === k));
    this.peekSlide(k);
  }

  private peekSlide(k: number): void {
    this.peekEls.forEach((x) => x.classList.remove('st-code-peek'));
    this.peekEls = k >= 0 ? this.elementsOf(k) : [];
    this.peekEls.forEach((x) => x.classList.add('st-code-peek'));
  }

  /** Разобрать текст и записать в данные, если он корректен и изменился. */
  apply(): void {
    clearTimeout(this.timer);
    const text = this.view.state.doc.toString();
    if (text === this.synced) {
      // Вернули код к применённому (Ctrl+Z, исправили) — старых ошибок нет
      if (diagnosticCount(this.view.state) || this.status.classList.contains('err')) {
        this.problems([]);
        this.idleStatus();
      }
      return;
    }
    const ed = this.host.editor();
    const i = this.host.index();
    if (this.mode === 'anim') return this.applyEmbed(text);
    if (this.mode === 'css') {
      ed.commit((d) => {
        const rec = d as unknown as Record<string, unknown>;
        if (text.trim()) rec.css = text;
        else delete rec.css;
      }, { rebuild: true, merge: 'code:css', hold: true });
      this.synced = text;
      const bad = cssProblems(text, this.view.state.doc);
      this.problems(bad);
      const hint = bad.length ? `${this.where(bad[0])}похоже на ошибку` : this.cssHint();
      this.setStatus(hint ? `Применено · ${hint}` : 'Применено', hint ? '' : 'ok');
      return;
    }
    const { data, problems } = readSlideYaml(text, this.view.state.doc);
    this.problems(problems);
    if (problems[0]?.severity === 'error') {
      const msg = `${this.where(problems[0])}${problems[0].message}`;
      return this.setStatus(msg[0].toUpperCase() + msg.slice(1), 'err');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return this.setStatus('Слайд — это набор полей «имя: значение»', 'err');
    const slide = data as SlideData;
    if (slide.template !== undefined && typeof slide.template !== 'string') return this.setStatus('template — строка: content, cover, finale, space, canvas', 'err');
    const ok = ed.commit((d) => { d.slides[i] = slide; }, { rebuild: true, merge: `code:${i}`, hold: true });
    this.synced = text;
    if (problems.length) this.setStatus(`Применено · ${this.where(problems[0])}${problems[0].message}`, '');
    else this.setStatus(ok ? 'Применено' : 'Без изменений', 'ok');
  }

  /** Ошибки — волнистой чертой на строках (текст — при наведении) */
  private problems(list: Diagnostic[]): void {
    if (!list.length && !diagnosticCount(this.view.state)) return;
    this.view.dispatch(setDiagnostics(this.view.state, list));
  }

  private where(d: Diagnostic): string {
    return `строка ${this.view.state.doc.lineAt(d.from).number}: `;
  }

  /** Строка состояния без новостей: что открыто */
  private idleStatus(): void {
    if (this.mode === 'anim') this.animStatus();
    else this.setStatus(this.mode === 'css' ? this.cssHint() || 'Стили всех слайдов-холстов' : `Слайд ${this.host.index() + 1}`, '');
  }

  // ---------------- живые вставки (анимации на HTML/JS) ----------------

  /** Вставки текущего слайда — где бы они ни лежали (и под другими объектами) */
  private collectEmbeds(): void {
    const i = this.host.index();
    const slide = this.host.deck().slides[i];
    const found: EmbedRef[] = [];
    const walk = (v: unknown, p: Path) => {
      if (Array.isArray(v)) v.forEach((x, k) => walk(x, [...p, k]));
      else if (v && typeof v === 'object') {
        const b = v as EmbedData;
        if (b.type === 'embed') {
          const name = typeof b.code === 'string' ? 'код в данных' : b.src ? decodeURIComponent(b.src.split('?')[0].split('/').pop() ?? '') : 'пустая';
          found.push({ path: p, label: `${found.length + 1} · ${name}` });
          return;
        }
        for (const [k, x] of Object.entries(v)) walk(x, [...p, k]);
      }
    };
    walk(slide, ['slides', i]);
    if (this.embedsFor !== i) this.embedAt = 0;
    this.embedsFor = i;
    const sig = found.map((e) => e.label).join('|');
    if (sig !== this.embeds.map((e) => e.label).join('|')) {
      this.picker.innerHTML = found.map((e, k) => `<option value="${k}">${e.label.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}</option>`).join('');
    }
    this.embeds = found;
    if (this.embedAt >= found.length) this.embedAt = 0;
    this.picker.value = String(this.embedAt);
    this.picker.disabled = found.length < 2;
    this.picker.hidden = !found.length;
  }

  private setEmbed(k: number): void {
    this.apply();
    this.embedAt = k;
    this.picker.value = String(k);
    this.update(true);
  }

  private load(src: string): void {
    if (this.loading.has(src)) return;
    this.loading.add(src);
    fetch(src, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => { this.texts.set(src, t); })
      .catch(() => this.setStatus('Не удалось прочитать файл вставки', 'err'))
      .finally(() => {
        this.loading.delete(src);
        if (this.mode === 'anim') this.update(true);
      });
  }

  /**
   * Почему правка стилей может быть не видна на открытом слайде: стили презентации действуют
   * только на слайдах-холстах; в облегчённом режиме слайд без движения
   */
  private cssHint(): string {
    const s = this.host.deck().slides[this.host.index()];
    if (s && (s.template ?? 'content') !== 'canvas') return 'на этом слайде не видно: стили презентации действуют только на слайдах-холстах';
    if (this.host.stage().classList.contains('still') && /animation|@keyframes|transition/.test(this.view.state.doc.toString())) {
      return 'облегчённый режим: движение видно в «Просмотре» (Анимация → Просмотр)';
    }
    return '';
  }

  private animStatus(): void {
    const e = this.embeds[this.embedAt];
    const b = e ? getAt(this.host.deck(), e.path) as EmbedData | undefined : undefined;
    const waiting = !!b?.src && typeof b.code !== 'string' && !this.texts.has(b.src);
    this.setReadOnly(!e || waiting);
    if (!e) this.setStatus('На этом слайде нет анимаций на HTML/JS. Анимации на CSS (@keyframes) — во вкладке «Стили · CSS»', '');
    else if (waiting) this.setStatus('Загружаю код…', '');
    else this.setStatus(`Вставка ${e.label} · правки сразу на слайде`, '');
  }

  /** Код вставки на слайде сразу, без перестройки слайда */
  private refreshFrame(path: Path, code: string, theme: boolean): void {
    const el = this.host.stage().querySelector(`.slide.on [data-block="${CSS.escape(JSON.stringify(path))}"]`);
    const f = el?.querySelector<HTMLIFrameElement>('iframe.embed-frame');
    if (f) f.srcdoc = withPointerBridge(theme ? withTheme(code) : code);
  }

  private applyEmbed(text: string): void {
    const e = this.embeds[this.embedAt];
    const ed = this.host.editor();
    const b = e ? getAt(this.host.deck(), e.path) as EmbedData | undefined : undefined;
    if (!e || !b) return;
    const src = b.src;
    // Код в отдельном файле проекта — файл и правится (на месте); иначе код живёт в данных слайда
    if (typeof b.code !== 'string' && src && ed.mode === 'project' && !src.startsWith('data:')) {
      this.synced = text;
      this.texts.set(src, text);
      setEmbedSource(src, text);
      this.refreshFrame(e.path, text, !!b.theme);
      const name = e.label.replace(/^\d+ · /, '');
      writeAssetText(this.host.deckKey, src, text)
        .then(() => this.setStatus(`Сохранено в ${name}`, 'ok'))
        .catch((err: Error) => this.setStatus(`Не сохранилось: ${err.message}`, 'err'));
      return;
    }
    const key = JSON.stringify(e.path);
    ed.commit((d) => {
      setAt(d, [...e.path, 'code'], text);
      if (src && typeof b.code !== 'string') setAt(d, [...e.path, 'src'], undefined);
    }, { rebuild: true, merge: `code:anim:${key}`, hold: true });
    this.synced = text;
    this.setStatus('Применено', 'ok');
  }

  private setStatus(text: string, cls: '' | 'ok' | 'err'): void {
    this.status.textContent = text;
    this.status.className = `st-code-status ${cls}`;
  }

  focus(): void {
    this.view.focus();
  }

  /**
   * Совпадение поиска по презентации: нужная вкладка, найденное выделено, его строки подсвечены.
   * Фокус остаётся в поиске — Enter ведёт к следующему
   */
  showMatch(mode: 'slide' | 'css', from: number, to: number): void {
    if (this.mode !== mode) this.setMode(mode);
    else this.update();
    if (to > this.view.state.doc.length) return;
    this.view.dispatch({
      selection: { anchor: from, head: to },
      effects: [setHighlight.of({ from, to }), EditorView.scrollIntoView(from, { y: 'center' })],
    });
  }
}
