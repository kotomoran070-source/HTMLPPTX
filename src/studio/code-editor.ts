/**
 * Редактор HTML для окна «Код вставки» (code-dialog.ts): тот же CodeMirror, что у «Кода слайда» (code.ts), —
 * подсветка HTML, CSS и JS, отступы, поиск и замена (code-search.ts, Ctrl+F / Ctrl+H), тёмная тема с интерфейсом.
 * Загружается при первом открытии окна: редактор тяжёлый
 */
import { indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { currentTheme, onThemeChange } from '../engine/theme';
import { codeSearch } from './code-search';

export interface HtmlEditor {
  value(): string;
  set(text: string): void;
  focus(): void;
  destroy(): void;
}

export function htmlEditor(parent: HTMLElement, o: { doc: string; label: string; change(): void; submit(): void }): HtmlEditor {
  const theme = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: o.doc,
      extensions: [
        basicSetup,
        codeSearch(),
        html(),
        theme.of(currentTheme() === 'dark' ? oneDark : []),
        keymap.of([indentWithTab]),
        // Ctrl+Enter — применить (раньше, чем «новая строка» самого редактора)
        Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => { o.submit(); return true; } }])),
        EditorView.contentAttributes.of({ 'aria-label': o.label }),
        EditorView.updateListener.of((u) => { if (u.docChanged) o.change(); }),
      ],
    }),
  });
  const off = onThemeChange((t) => view.dispatch({ effects: theme.reconfigure(t === 'dark' ? oneDark : []) }));
  return {
    value: () => view.state.doc.toString(),
    set: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
    focus: () => view.focus(),
    destroy: () => { off(); view.destroy(); },
  };
}
