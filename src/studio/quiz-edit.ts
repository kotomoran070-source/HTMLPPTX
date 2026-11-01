/**
 * Тест в правке (components/quiz): щелчок по букве варианта у выделенного теста — этот вариант верный
 * (у теста с одним верным ответом отметка переходит на него), Shift+щелчок — ещё один верный или снять.
 * Текст вопроса и вариантов правится на слайде как обычный текст
 */
import { getAt } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import type { Deck } from '../types';

type Path = (string | number)[];
interface Opt { correct?: boolean }

export function quizEdit(h: { deck: Deck; editor: Editor; stage(): HTMLElement }): { sync(): void } {
  /** Выделенный тест под элементом: путь блока и номер варианта */
  const hit = (t: Element | null): { path: Path; k: number } | null => {
    const m = t?.closest?.<HTMLElement>('.qz-m');
    const o = m?.closest<HTMLElement>('.qz-o');
    const box = o?.closest<HTMLElement>('[data-block]');
    const sel = h.editor.selection;
    if (!m || !o || !box || !h.stage().contains(box) || h.editor.editingField || document.body.classList.contains('st-previewing')) return null;
    if (!sel || sel.group.length > 1 || JSON.stringify(sel.block) !== box.dataset.block) return null;
    return { path: sel.block, k: Number(o.dataset.k) };
  };
  addEventListener('pointerdown', (e) => {
    const t = e.button === 0 ? hit(e.target as Element) : null;
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    h.editor.commit((d) => {
      const opts = getAt(d, [...t.path, 'options']) as Opt[] | undefined;
      if (!Array.isArray(opts) || !opts[t.k]) return;
      const right = opts.filter((o) => o?.correct === true).length;
      if (e.shiftKey || right > 1) {
        // Несколько верных: щелчок отмечает или снимает этот (последний верный не снимается)
        if (opts[t.k].correct && right > 1) delete opts[t.k].correct;
        else opts[t.k].correct = true;
      } else {
        // Один верный: отметка переходит на этот вариант
        opts.forEach((o, k) => { if (k === t.k) o.correct = true; else if (o) delete o.correct; });
      }
    }, { rebuild: true });
  }, true);
  // Подсказка у букв выделенного теста
  function sync(): void {
    const sel = h.editor.selection;
    const key = sel && sel.group.length <= 1 ? JSON.stringify(sel.block) : '';
    h.stage().querySelectorAll<HTMLElement>('.slide.on [data-block] .qz-m').forEach((m) => {
      const own = m.closest<HTMLElement>('[data-block]')?.dataset.block === key;
      if (own) m.title = 'Щелчок — верный ответ; Shift+щелчок — ещё один верный';
      else m.removeAttribute('title');
    });
  }
  return { sync };
}
