/**
 * Лицензии «списком и текстом»: Slideria, Electron и Chromium, шрифты комплекта и все библиотеки с текстами
 * лицензий. Слева поиск, фильтр по лицензии и список по группам, справа текст выбранной и «Копировать текст»;
 * в широком месте рядом с текстом — где используется и что ещё под той же лицензией, в узком — один список,
 * текст открывается вместо него. Раскладка — по ширине самого блока, не окна.
 *
 * Общий для раздела «Файл → Лицензии» студии (studio/file-panel.ts) и страницы `/?licenses` (licenses-page.ts).
 * Данные — с сервера (server/http.ts, plugins/licenses.mjs → licensesData), один раз за страницу
 */
import { icon } from '../components/icons';
import type { LicenseItem, LicensesData } from '../../plugins/licenses.mjs';
import { esc } from './html';
import './licenses-view.css';

export type { LicensesData };
export type Family = 'mit' | 'bsd' | 'apache' | 'isc' | 'lgpl' | 'ofl' | 'other';
interface Item extends LicenseItem { f: Family }
/** Что выбрано: поиск, фильтр, запись (переживает перерисовку раздела) */
export interface LicensesState { q: string; f: Family | 'all'; sel: string }

const DATA = '/__slideria/licenses/data';
const FAMILIES: Family[] = ['mit', 'bsd', 'apache', 'isc', 'lgpl', 'ofl', 'other'];
const FAM: Record<Family, string> = { mit: 'MIT', bsd: 'BSD', apache: 'Apache', isc: 'ISC', lgpl: 'LGPL', ofl: 'OFL', other: 'Другие' };
/** Что разрешает лицензия — одной фразой (точные условия — в тексте ниже неё) */
const ABOUT: Partial<Record<Family, string>> = {
  mit: 'Свободная лицензия: библиотеку можно использовать, менять и распространять, в том числе в платных программах, сохраняя упоминание авторов и этот текст.',
  bsd: 'Свободная лицензия: можно использовать, менять и распространять, сохраняя упоминание авторов и этот текст.',
  apache: 'Свободная лицензия: можно использовать, менять и распространять, сохраняя этот текст и уведомления авторов; авторы дают и право на свои патенты.',
  isc: 'Свободная лицензия, по сути как MIT: можно использовать, менять и распространять, сохраняя упоминание авторов.',
  lgpl: 'Библиотека работает в программе отдельным файлом и не входит в экспортированные презентации; допускается замена собственной сборкой.',
  ofl: 'Шрифты можно встраивать в презентации и распространять вместе с ними; продавать сами шрифты отдельно нельзя.',
};
const WHERE: Record<string, string> = { srv: 'Сервер программы', pg: 'Студия и показ' };
const GROUPS: [string, Item['kind']][] = [['Программа', 'app'], ['Шрифты', 'fonts'], ['Библиотеки', 'lib']];
/** Уже этого — один список, текст вместо него */
const NARROW = 700;
/** Сколько ссылок «Та же лицензия» рядом с текстом */
const SAME = 8;

const family = (l: string): Family => (/^\(?MIT\b/.test(l) ? 'mit' : /^\(?BSD/.test(l) ? 'bsd' : /^\(?Apache/.test(l) ? 'apache' : /^\(?ISC\b/.test(l) ? 'isc'
  : /LGPL/.test(l) ? 'lgpl' : /OFL/.test(l) ? 'ofl' : 'other');
/** «(MIT OR GPL-3.0-or-later)» → «MIT или GPL-3.0+» */
const short = (l: string) => (l ? l.replace(/^\((.*)\)$/, '$1').replace(/ OR /g, ' или ').replace(/ AND /g, ' и ').replace(/-or-later/g, '+').replace(/-Clause/g, '') : 'много лицензий');
const where = (e: Item) => (e.kind === 'app' ? 'Программа' : e.kind === 'fonts' ? 'Темы и формулы' : (e.where ?? []).map((w) => WHERE[w] ?? w).join(' · '));
const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
/** Под названием: версия; у шрифтов — сколько их */
const sub = (e: Item) => (e.kind === 'fonts' ? `${e.fonts?.length ?? 0} ${plural(e.fonts?.length ?? 0, 'шрифт', 'шрифта', 'шрифтов')}` : e.version);
const pill = (e: Item) => `<span class="lc-pill" data-f="${e.f}">${esc(short(e.license))}</span>`;

let cache: Promise<LicensesData> | null = null;
/** Данные лицензий: один запрос за страницу; не вышло — следующий вызов спросит снова */
export function loadLicenses(): Promise<LicensesData> {
  cache ??= fetch(DATA, { cache: 'no-store' }).then(async (r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json() as LicensesData;
  });
  cache.catch(() => { cache = null; });
  return cache;
}

/** «83 компонента», «Slideria 0.1.0 · сборка от 07.11.2026» */
export function licensesSummary(d: LicensesData): [count: string, build: string] {
  const n = d.items.length;
  return [`${n} ${plural(n, 'компонент', 'компонента', 'компонентов')}`, `Slideria ${d.version}${d.date ? ` · сборка от ${d.date}` : ''}`];
}

export const newLicensesState = (): LicensesState => ({ q: '', f: 'all', sel: 'slideria' });

/** Нарисовать лицензии в el (вместо его содержимого); summary — сводка над поиском (у раздела «Файл» она в заголовке) */
export function mountLicenses(el: HTMLElement, data: LicensesData, st: LicensesState = newLicensesState(), o: { summary?: boolean } = {}): { focusSearch(): void } {
  const [count, build] = licensesSummary(data);
  el.innerHTML = `<div class="lc-view"><div class="lc-grid">
    <aside class="lc-side">
      <div class="lc-head">
        ${o.summary ? `<div class="lc-sum"><h1>${esc(count)}</h1><p>${esc(build)}</p></div>` : ''}
        <label class="lc-search">${icon('search')}<input class="lc-q" type="search" placeholder="Найти библиотеку или лицензию" aria-label="Найти библиотеку или лицензию" autocomplete="off" spellcheck="false"><button class="lc-clear" type="button" aria-label="Очистить поиск" title="Очистить (Esc)" hidden>${icon('close')}</button></label>
        <div class="lc-chips" role="group" aria-label="Лицензия"></div>
      </div>
      <div class="lc-list" role="listbox" aria-label="Компоненты"></div>
    </aside>
    <section class="lc-pane"></section>
  </div></div>`;
  const view = el.querySelector<HTMLElement>('.lc-view')!;
  const list = el.querySelector<HTMLElement>('.lc-list')!;
  const pane = el.querySelector<HTMLElement>('.lc-pane')!;
  const chips = el.querySelector<HTMLElement>('.lc-chips')!;
  const q = el.querySelector<HTMLInputElement>('.lc-q')!;
  const clear = el.querySelector<HTMLButtonElement>('.lc-clear')!;

  const items: Item[] = data.items.map((e) => ({ ...e, f: e.kind === 'fonts' ? 'ofl' : family(e.license) }));
  const byId = new Map(items.map((e) => [e.id, e]));
  if (!byId.has(st.sel)) st.sel = items[0]?.id ?? '';
  const counts = new Map<Family, number>();
  for (const e of items) counts.set(e.f, (counts.get(e.f) ?? 0) + 1);
  const narrow = () => view.clientWidth < NARROW;

  const renderChips = () => {
    chips.innerHTML = (['all', ...FAMILIES.filter((f) => counts.get(f))] as (Family | 'all')[]).map((f) => `<button class="lc-chip" type="button" data-f="${f}" aria-pressed="${st.f === f}">`
      + `${f === 'all' ? 'Все' : `<i></i>${FAM[f]}`} <small>${f === 'all' ? items.length : counts.get(f)}</small></button>`).join('');
  };
  const match = (e: Item) => (st.f === 'all' || e.f === st.f)
    && (!st.q || `${e.name} ${e.license} ${FAM[e.f]} ${(e.fonts ?? []).join(' ')}`.toLowerCase().includes(st.q));
  const renderList = () => {
    const html = GROUPS.map(([title, kind]) => {
      const m = items.filter((e) => e.kind === kind && match(e));
      return m.length ? `<div class="lc-grp" role="presentation"><span>${title}</span><span>${m.length}</span></div>`
        + m.map((e) => `<button class="lc-row" type="button" role="option" data-id="${esc(e.id)}" aria-selected="${e.id === st.sel}" tabindex="${e.id === st.sel ? 0 : -1}">`
          + `<span class="lc-nm">${esc(e.name)}${sub(e) ? `<span class="lc-ver">${esc(sub(e))}</span>` : ''}</span>${pill(e)}</button>`).join('')
        : '';
    }).join('');
    list.innerHTML = html || '<div class="lc-empty">Ничего не нашлось</div>';
    // Выбранной строки в списке нет (отфильтрована) — с клавиатуры в список попадаешь на первую
    if (!list.querySelector('[tabindex="0"]')) list.querySelector<HTMLElement>('.lc-row')?.setAttribute('tabindex', '0');
  };
  const renderDetail = () => {
    const e = byId.get(st.sel);
    if (!e) { pane.innerHTML = ''; return; }
    const same = e.kind === 'lib' ? items.filter((x) => x !== e && x.kind === 'lib' && x.f === e.f) : [];
    const body = e.link
      ? `<p class="lc-about">Движок, на котором работает окно программы. В нём сотни компонентов со своими лицензиями — они собраны на отдельной странице.</p>
        <div><a class="lc-btn" href="${esc(e.link)}" target="_blank">${icon('link')}<span>Открыть лицензии Chromium</span></a></div>`
      : `${e.fonts?.length ? `<div class="lc-fonts">${e.fonts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
        ${ABOUT[e.f] ? `<p class="lc-about">${ABOUT[e.f]}</p>` : ''}
        ${e.text ? `<pre class="lc-text">${esc(e.text)}</pre>` : '<p class="lc-about lc-none">В пакете указано только название лицензии, полный текст отсутствует.</p>'}`;
    pane.innerHTML = `<article class="lc-det">
      <div class="lc-doc">
        <div class="lc-back-row"><button class="lc-btn lc-back" type="button" data-back>${icon('prev')}<span>Все компоненты</span></button></div>
        <div class="lc-k">${esc(where(e))}</div>
        <h2 class="lc-name">${esc(e.name)}</h2>
        <div class="lc-meta">${e.version ? `<span class="lc-ver">${esc(e.version)}</span>` : ''}${pill(e)}${e.text ? `<button class="lc-btn lc-copy" type="button" data-copy>${icon('copy')}<span>Копировать текст</span></button>` : ''}</div>
        ${body}
      </div>
      <aside class="lc-aside">
        <h3>Где используется</h3><p>${esc(where(e))}</p>
        ${same.length ? `<h3>Та же лицензия · ${same.length + 1}</h3><ul>${same.slice(0, SAME).map((x) => `<li><button type="button" data-id="${esc(x.id)}">${esc(x.name)}</button></li>`).join('')}</ul>${same.length > SAME ? `<p class="lc-more">и ещё ${same.length - SAME}</p>` : ''}` : ''}
      </aside>
    </article>`;
    pane.scrollTop = 0;
  };

  const rows = () => [...list.querySelectorAll<HTMLElement>('.lc-row')];
  /** Выбрать запись: строка отмечена и видна, справа — её текст; open — в узком месте показать текст */
  const select = (id: string, open = true) => {
    if (!byId.has(id)) return;
    st.sel = id;
    for (const r of rows()) {
      const on = r.dataset.id === id;
      r.setAttribute('aria-selected', String(on));
      r.tabIndex = on ? 0 : -1;
    }
    list.querySelector<HTMLElement>(`.lc-row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
    renderDetail();
    if (open && narrow()) {
      view.classList.add('open');
      pane.querySelector<HTMLElement>('[data-back]')?.focus({ focusVisible: false } as FocusOptions);
    }
  };
  const back = () => {
    view.classList.remove('open');
    list.querySelector<HTMLElement>(`.lc-row[data-id="${CSS.escape(st.sel)}"]`)?.focus({ focusVisible: false } as FocusOptions);
  };
  // Место стало шире — список и текст снова рядом
  new ResizeObserver(() => { if (!narrow()) view.classList.remove('open'); }).observe(view);

  q.value = st.q;
  clear.hidden = !st.q;
  renderChips();
  renderList();
  renderDetail();

  chips.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-f]');
    if (!b) return;
    st.f = b.dataset.f as Family | 'all';
    // Отметка — на месте, без перерисовки: фокус остаётся на нажатой кнопке
    for (const c of chips.querySelectorAll('[data-f]')) c.setAttribute('aria-pressed', String(c === b));
    renderList();
  });
  list.addEventListener('click', (e) => {
    const r = (e.target as Element).closest<HTMLElement>('.lc-row');
    if (r) select(r.dataset.id!);
  });
  // Стрелки — по строкам списка; когда текст рядом, он сразу следует за выбором
  list.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const all = rows();
    if (!all.length) return;
    e.preventDefault();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    if (narrow()) { for (const r of all) r.tabIndex = r === all[to] ? 0 : -1; all[to].focus(); return; }
    select(all[to].dataset.id!, false);
    all[to].focus();
  });
  pane.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('button, a');
    if (!t) return;
    if (t.dataset.id) { select(t.dataset.id); return; }
    if (t.hasAttribute('data-back')) { back(); return; }
    if (t.hasAttribute('data-copy')) {
      const text = byId.get(st.sel)?.text ?? '';
      const label = t.querySelector('span')!;
      const done = () => { label.textContent = 'Скопировано'; setTimeout(() => { if (label.isConnected) label.textContent = 'Копировать текст'; }, 1400); };
      // Буфер обмена недоступен — текст выделен: Ctrl+C скопирует его
      navigator.clipboard.writeText(text).then(done, () => {
        const pre = pane.querySelector('.lc-text');
        if (pre) getSelection()?.selectAllChildren(pre);
      });
    }
  });

  // Поиск: свой крестик; Esc — очистить, стрелка вниз — в список
  const search = (v: string) => { st.q = v.trim().toLowerCase(); clear.hidden = !v; renderList(); };
  q.addEventListener('input', () => search(q.value));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && q.value) { e.preventDefault(); e.stopPropagation(); q.value = ''; search(''); }
    if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector<HTMLElement>('.lc-row')?.focus(); }
  });
  clear.addEventListener('click', (e) => { e.preventDefault(); q.value = ''; search(''); q.focus(); });
  // Esc, пока текст открыт вместо списка, — обратно к списку
  view.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && view.classList.contains('open')) { e.preventDefault(); e.stopPropagation(); back(); }
  });

  return { focusSearch: () => { q.focus(); q.select(); } };
}
