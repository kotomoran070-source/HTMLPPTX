import { css } from '@codemirror/lang-css';
import { yaml } from '@codemirror/lang-yaml';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { parse, stringify, YAMLParseError } from 'yaml';
import type { Editor } from '../engine/editor/editor';
import { currentTheme, onThemeChange } from '../engine/theme';
import type { Deck, SlideData } from '../types';
import { collectNodes, cssRules, highlightField, rulesFor, setHighlight, treeHtml, treeToggleIcon, YamlRanges, type CssRule, type TreeNode } from './code-tree';

type Mode = 'slide' | 'css';

export interface CodeHost {
  deck(): Deck;
  index(): number;
  editor(): Editor;
  stage(): HTMLElement;
}

const TREE_KEY = 'htmlpptx-code-tree';

const APPLY_MS = 700;

/**
 * Код текущего слайда (YAML, как в deck.yaml) и стили презентации (CSS) рядом со слайдом.
 * Правки применяются сами, когда текст снова корректен; ошибка — строкой состояния с номером строки.
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

  constructor(private root: HTMLElement, private host: CodeHost) {
    root.innerHTML = `<div class="st-code-bar">
  <div class="st-seg" role="tablist" aria-label="Что править">
    <button type="button" role="tab" data-mode="slide" aria-selected="true">Слайд · YAML</button>
    <button type="button" role="tab" data-mode="css" aria-selected="false">Стили · CSS</button>
  </div>
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
    this.rulesBtn.addEventListener('click', () => this.showRule(this.ruleAt + 1));
    let folded = false;
    try { folded = localStorage.getItem(TREE_KEY) === '0'; } catch { /* нет хранилища */ }
    this.fold(folded);
    this.view = new EditorView({
      parent: root.querySelector('.st-code-ed')!,
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          this.lang.of(yaml()),
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
        ],
      }),
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
    // Клавиши редактора кода не должны листать слайды и отменять правки слайда
    root.addEventListener('keydown', (e) => e.stopPropagation());
    onThemeChange((t) => this.view.dispatch({ effects: this.theme.reconfigure(t === 'dark' ? oneDark : []) }));
  }

  private setMode(m: Mode): void {
    this.apply();
    this.mode = m;
    this.root.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
    this.view.dispatch({ effects: this.lang.reconfigure(m === 'css' ? css() : yaml()) });
    this.rulesBtn.hidden = true;
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
    const s = deck.slides[this.host.index()];
    return s ? stringify(s, { lineWidth: 0 }) : '';
  }

  /** Данные изменились или сменился слайд: показать актуальный код, не затирая незаконченную правку. */
  update(force = false): void {
    if (this.root.hidden) return;
    this.drawTree();
    const text = this.source();
    const subject = `${this.mode}:${this.host.index()}`;
    const typing = this.view.hasFocus && this.view.state.doc.toString() !== this.synced;
    if (!force && subject === this.shownFor && (text === this.synced || typing)) return;
    this.shownFor = subject;
    this.synced = text;
    clearTimeout(this.timer);
    if (this.view.state.doc.toString() !== text) {
      this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
      clearTimeout(this.timer);
    }
    this.setStatus(this.mode === 'css' ? 'Стили всех слайдов-холстов' : `Слайд ${this.host.index() + 1}`, '');
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
    if (text === this.synced) return;
    const ed = this.host.editor();
    const i = this.host.index();
    if (this.mode === 'css') {
      ed.commit((d) => {
        const rec = d as unknown as Record<string, unknown>;
        if (text.trim()) rec.css = text;
        else delete rec.css;
      }, { rebuild: true, merge: 'code:css' });
      this.synced = text;
      this.setStatus('Применено', 'ok');
      return;
    }
    let data: unknown;
    try {
      data = parse(text);
    } catch (e) {
      const pos = e instanceof YAMLParseError ? e.linePos?.[0] : undefined;
      const msg = (e as Error).message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
      return this.setStatus(`${pos ? `Строка ${pos.line}: ` : ''}${msg}`, 'err');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return this.setStatus('Слайд — это набор полей «имя: значение»', 'err');
    const slide = data as SlideData;
    if (slide.template !== undefined && typeof slide.template !== 'string') return this.setStatus('template — строка: content, cover, finale, space, canvas', 'err');
    const ok = ed.commit((d) => { d.slides[i] = slide; }, { rebuild: true, merge: `code:${i}` });
    this.synced = text;
    this.setStatus(ok ? 'Применено' : 'Без изменений', 'ok');
  }

  private setStatus(text: string, cls: '' | 'ok' | 'err'): void {
    this.status.textContent = text;
    this.status.className = `st-code-status ${cls}`;
  }

  focus(): void {
    this.view.focus();
  }
}
