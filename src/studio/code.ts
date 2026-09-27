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

type Mode = 'slide' | 'css';

export interface CodeHost {
  deck(): Deck;
  index(): number;
  editor(): Editor;
}

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

  constructor(private root: HTMLElement, private host: CodeHost) {
    root.innerHTML = `<div class="st-code-bar">
  <div class="st-seg" role="tablist" aria-label="Что править">
    <button type="button" role="tab" data-mode="slide" aria-selected="true">Слайд · YAML</button>
    <button type="button" role="tab" data-mode="css" aria-selected="false">Стили · CSS</button>
  </div>
  <span class="st-code-status" role="status" aria-live="polite"></span>
</div>
<div class="st-code-ed"></div>`;
    this.status = root.querySelector('.st-code-status')!;
    this.view = new EditorView({
      parent: root.querySelector('.st-code-ed')!,
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          this.lang.of(yaml()),
          this.theme.of(currentTheme() === 'dark' ? oneDark : []),
          EditorView.lineWrapping,
          keymap.of([{ key: 'Mod-Enter', run: () => { this.apply(); return true; } }]),
          EditorView.updateListener.of((u) => {
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
    // Клавиши редактора кода не должны листать слайды и отменять правки слайда
    root.addEventListener('keydown', (e) => e.stopPropagation());
    onThemeChange((t) => this.view.dispatch({ effects: this.theme.reconfigure(t === 'dark' ? oneDark : []) }));
  }

  private setMode(m: Mode): void {
    this.apply();
    this.mode = m;
    this.root.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
    this.view.dispatch({ effects: this.lang.reconfigure(m === 'css' ? css() : yaml()) });
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
