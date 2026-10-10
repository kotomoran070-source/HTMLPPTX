/**
 * Поиск и замена в редакторе кода (Ctrl+F, Ctrl+H): компактная панель над кодом по-русски —
 * сколько найдено («3 из 12»), переходы, регистр, регулярное выражение, замена одного и всех.
 * Совпадение ищется сразу, пока печатают, начиная с места курсора.
 */
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, searchPanelOpen, SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type Panel, type ViewUpdate } from '@codemirror/view';

/** Панель редактора: открыть строку замены (Ctrl+H при открытой панели) */
const panels = new WeakMap<EditorView, { replace(on: boolean): void }>();
/** Ctrl+H, пока панель ещё закрыта: открыть сразу со строкой замены */
let wantReplace = false;
/** Панель открывается заново после загрузки кода: фокус остаётся, где был */
let quiet = false;

const MAX = 9999;

function panel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'st-cs';
  dom.innerHTML = `<div class="st-cs-row">
  <input class="st-cs-q" main-field="true" placeholder="Найти в коде" aria-label="Найти в коде" spellcheck="false" autocomplete="off">
  <span class="st-cs-n" aria-live="polite"></span>
  <button type="button" data-a="prev" title="Предыдущее · Shift+Enter" aria-label="Предыдущее">↑</button>
  <button type="button" data-a="next" title="Следующее · Enter" aria-label="Следующее">↓</button>
  <button type="button" data-a="case" class="tg" title="С учётом регистра" aria-pressed="false">Aa</button>
  <button type="button" data-a="re" class="tg" title="Регулярное выражение" aria-pressed="false">.*</button>
  <button type="button" data-a="rep" class="tg" title="Заменить · Ctrl+H" aria-pressed="false">⇄</button>
  <button type="button" data-a="close" title="Закрыть · Esc" aria-label="Закрыть">×</button>
</div>
<div class="st-cs-row st-cs-rep" hidden>
  <input class="st-cs-r" placeholder="Заменить на" aria-label="Заменить на" spellcheck="false" autocomplete="off">
  <button type="button" data-a="one" title="Заменить это совпадение · Enter">Заменить</button>
  <button type="button" data-a="all" title="Заменить все · Ctrl+Enter">Все</button>
</div>`;
  const q = dom.querySelector<HTMLInputElement>('.st-cs-q')!;
  const r = dom.querySelector<HTMLInputElement>('.st-cs-r')!;
  const n = dom.querySelector<HTMLElement>('.st-cs-n')!;
  const rep = dom.querySelector<HTMLElement>('.st-cs-rep')!;
  const btn = (a: string) => dom.querySelector<HTMLButtonElement>(`[data-a="${a}"]`)!;
  const on = (a: string) => btn(a).getAttribute('aria-pressed') === 'true';
  const press = (a: string, v: boolean) => btn(a).setAttribute('aria-pressed', String(v));

  const fromQuery = () => {
    const s = getSearchQuery(view.state);
    if (document.activeElement !== q) q.value = s.search;
    if (document.activeElement !== r) r.value = s.replace;
    press('case', s.caseSensitive);
    press('re', s.regexp);
  };
  const query = () => new SearchQuery({ search: q.value, caseSensitive: on('case'), regexp: on('re'), replace: r.value });

  /** Сколько совпадений и какое из них выделено */
  const count = () => {
    const s = getSearchQuery(view.state);
    if (!s.search) { n.textContent = ''; n.className = 'st-cs-n'; return; }
    if (!s.valid) { n.textContent = 'ошибка в выражении'; n.className = 'st-cs-n err'; return; }
    const sel = view.state.selection.main;
    const it = s.getCursor(view.state);
    let total = 0;
    let cur = 0;
    for (let m = it.next(); !m.done && total < MAX; m = it.next()) {
      total++;
      if (m.value.from === sel.from && m.value.to === sel.to) cur = total;
    }
    n.textContent = total ? `${cur ? `${cur} из ` : ''}${total}${total >= MAX ? '+' : ''}` : 'нет';
    n.className = `st-cs-n${total ? '' : ' err'}`;
  };

  /** Новый запрос: подсветка совпадений и переход к ближайшему от курсора — сразу, пока печатают */
  const commit = (jump: boolean) => {
    const s = query();
    if (!s.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(s) });
    if (jump && s.valid && s.search) {
      const it = s.getCursor(view.state, view.state.selection.main.from).next();
      const m = it.done ? s.getCursor(view.state).next() : it;
      if (!m.done) view.dispatch({ selection: { anchor: m.value.from, head: m.value.to }, effects: EditorView.scrollIntoView(m.value.from, { y: 'center' }) });
    }
    count();
  };

  const showReplace = (v: boolean) => {
    rep.hidden = !v;
    press('rep', v);
    if (v) (q.value ? r : q).focus();
  };
  panels.set(view, { replace: showReplace });

  q.addEventListener('input', () => commit(true));
  r.addEventListener('input', () => commit(false));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); (e.shiftKey ? findPrevious : findNext)(view); count(); }
  });
  r.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); (e.ctrlKey || e.metaKey ? replaceAll : replaceNext)(view); count(); }
  });
  dom.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearchPanel(view); view.focus(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyH') { e.preventDefault(); showReplace(rep.hidden); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') { e.preventDefault(); q.select(); }
  });
  // Кнопки не уводят фокус из поля
  dom.addEventListener('mousedown', (e) => { if ((e.target as Element).closest('button')) e.preventDefault(); });
  dom.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'next' || a === 'prev') { (a === 'next' ? findNext : findPrevious)(view); count(); }
    else if (a === 'case' || a === 're') { press(a, !on(a)); commit(true); }
    else if (a === 'rep') showReplace(rep.hidden);
    else if (a === 'one') { replaceNext(view); count(); }
    else if (a === 'all') { replaceAll(view); count(); }
    else if (a === 'close') { closeSearchPanel(view); view.focus(); }
  });

  return {
    dom,
    top: true,
    mount() {
      fromQuery();
      if (wantReplace) showReplace(true);
      else if (!quiet) q.select();
      wantReplace = false;
      count();
    },
    update(u: ViewUpdate) {
      if (u.transactions.some((t) => t.effects.some((x) => x.is(setSearchQuery)))) fromQuery();
      if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((x) => x.is(setSearchQuery)))) count();
    },
    destroy() { panels.delete(view); },
  };
}

/** Снова открыть поиск с тем же запросом (код загружен заново), не забирая фокус */
export function reopenSearch(view: EditorView, s: SearchQuery): void {
  quiet = true;
  try {
    openSearchPanel(view);
  } finally {
    quiet = false;
  }
  view.dispatch({ effects: setSearchQuery.of(s) });
}

/** Поиск по-русски для редактора кода: своя панель, Ctrl+H — сразу с заменой */
export function codeSearch(): Extension {
  return [
    search({ top: true, createPanel: panel }),
    keymap.of([{
      key: 'Mod-h',
      run: (view) => {
        if (searchPanelOpen(view.state)) panels.get(view)?.replace(true);
        else { wantReplace = true; openSearchPanel(view); }
        return true;
      },
    }]),
    EditorState.phrases.of({ 'Go to line': 'Перейти к строке', go: 'Перейти', 'Control character': 'Служебный знак', 'Folded lines': 'Свёрнутые строки', 'Unfolded lines': 'Развёрнутые строки', 'Fold line': 'Свернуть', 'Unfold line': 'Развернуть', 'folded code': 'свёрнутый код', unfold: 'развернуть' }),
  ];
}
