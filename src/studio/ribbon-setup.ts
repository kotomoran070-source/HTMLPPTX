/**
 * «Настроить ленту»: какие вкладки и группы кнопок видны, подписи у кнопок. Готовые наборы —
 * «Простая» (самое нужное) и «Полная» (всё), или своя. Скрытое остаётся в поиске команд (Ctrl+K).
 * Запоминается на этом компьютере. Изменения видны на ленте сразу — панель её не закрывает.
 */
import { icon } from '../components/icons';
import './ribbon-setup.css';

export interface RibbonHost {
  /** Открытая вкладка и переход на другую */
  tab(): string;
  setTab(name: string): void;
  /** Лента пересчитывает, какие подписи помещаются */
  fit(): void;
}

interface Prefs {
  /** Скрытое: вкладка («tools») или группа («home/Выровнять») */
  hide: string[];
  /** Только значки, без подписей у кнопок */
  icons?: boolean;
  /** Без подписей групп под кнопками */
  noLabels?: boolean;
}

const KEY = 'slideria.ribbon';
/** Вкладки, которые появляются с выделением: скрываются только их группы */
const CONTEXT = new Set(['shape', 'table', 'image', 'video']);

/** «Простая»: привычное — слайды, текст, вставка, темы, переходы и показ */
const SIMPLE: string[] = ['tools', 'view', 'home/Упорядочить', 'home/Выровнять', 'insert/Все блоки', 'anim/Время и порядок', 'anim/Число'];
const PRESETS: [id: string, name: string, hint: string, title: string, prefs: Prefs][] = [
  ['simple', 'Простая', 'Самое нужное', 'Слайды, текст, вставка, темы, переходы и показ — без инструментов и тонких настроек', { hide: SIMPLE }],
  ['full', 'Полная', 'Все кнопки', 'Все вкладки и группы кнопок', { hide: [] }],
  ['compact', 'Компактная', 'Только значки', 'Все кнопки, но без подписей: подписи — во всплывающих подсказках', { hide: [], icons: true, noLabels: true }],
];

const same = (a: Prefs, b: Prefs) => [...a.hide].sort().join('|') === [...b.hide].sort().join('|') && !!a.icons === !!b.icons && !!a.noLabels === !!b.noLabels;

function load(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Prefs | null;
    if (v && Array.isArray(v.hide)) return { hide: v.hide.filter((x) => typeof x === 'string'), icons: !!v.icons, noLabels: !!v.noLabels };
  } catch { /* нет доступа или испорчено */ }
  return { hide: [] };
}

function save(p: Prefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* нет доступа */ }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Вкладки и группы ленты — из самой ленты */
function inventory(): { id: string; name: string; context: boolean; groups: string[] }[] {
  return [...document.querySelectorAll<HTMLElement>('.st-tabs [data-tab]')].map((t) => {
    const id = t.dataset.tab!;
    const panel = document.querySelector(`.st-rpanel[data-panel="${id}"]`);
    const groups = [...new Set([...(panel?.querySelectorAll<HTMLElement>('.st-rgroup') ?? [])].map((g) => g.getAttribute('aria-label') ?? '').filter(Boolean))];
    return { id, name: t.textContent?.trim() ?? id, context: CONTEXT.has(id), groups };
  });
}

/** Подключить настройку: применить сохранённое и вернуть «открыть панель» */
export function initRibbonSetup(host: RibbonHost): { open(anchor?: HTMLElement): void; apply(): void } {
  let prefs = load();

  const apply = () => {
    const hide = new Set(prefs.hide);
    for (const t of document.querySelectorAll<HTMLElement>('.st-tabs [data-tab]')) {
      const id = t.dataset.tab!;
      t.classList.toggle('st-cut', !CONTEXT.has(id) && hide.has(id));
      document.querySelector(`.st-rpanel[data-panel="${id}"]`)?.querySelectorAll<HTMLElement>('.st-rgroup').forEach((g) => {
        g.classList.toggle('st-cut', hide.has(`${id}/${g.getAttribute('aria-label') ?? ''}`));
      });
    }
    const rib = document.getElementById('st-ribbon');
    rib?.classList.toggle('icons', !!prefs.icons);
    rib?.classList.toggle('nolabels', !!prefs.noLabels);
    // Открытая вкладка скрыта — первая видимая
    const cur = document.querySelector<HTMLElement>(`.st-tabs [data-tab="${host.tab()}"]`);
    if (cur?.classList.contains('st-cut')) {
      const first = document.querySelector<HTMLElement>('.st-tabs [data-tab]:not(.st-cut):not([hidden])');
      if (first) host.setTab(first.dataset.tab!);
    }
    host.fit();
  };

  let box: HTMLElement | null = null;
  const close = () => {
    box?.remove();
    box = null;
    removeEventListener('keydown', onKey, true);
    removeEventListener('pointerdown', onOutside, true);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const onOutside = (e: PointerEvent) => {
    const t = e.target as Element;
    // Щелчки по ленте не закрывают панель: на ней видно, что получилось
    if (box && !box.contains(t) && !t.closest('#st-ribbon, .st-tabs, [data-cmd="ui.ribbon"]')) close();
  };
  const set = (p: Prefs) => {
    prefs = p;
    save(prefs);
    apply();
    draw();
  };
  let openTab = '';

  function draw(): void {
    if (!box) return;
    const hide = new Set(prefs.hide);
    const preset = PRESETS.find(([, , , , p]) => same(p, prefs))?.[0] ?? 'own';
    const tabs = inventory();
    box.innerHTML = `<header><b>Настроить ленту</b><button type="button" class="rs-x" data-a="close" aria-label="Закрыть" title="Закрыть (Esc)">${icon('close')}</button></header>
  <div class="rs-presets">${PRESETS.map(([id, name, hint, title]) => `<button type="button" data-preset="${id}" class="${preset === id ? 'on' : ''}" title="${esc(title)}"><b>${name}</b><small>${esc(hint)}</small></button>`).join('')}</div>
  <div class="rs-opts">
    <label><input type="checkbox" data-o="icons"${prefs.icons ? ' checked' : ''}><span>Только значки</span></label>
    <label><input type="checkbox" data-o="noLabels"${prefs.noLabels ? ' checked' : ''}><span>Без подписей групп</span></label>
  </div>
  <div class="rs-h">Вкладки и группы${preset === 'own' ? '<i>своя</i>' : ''}</div>
  <ul class="rs-tabs">${tabs.map((t) => {
    const off = !t.context && hide.has(t.id);
    const n = t.groups.filter((g) => !hide.has(`${t.id}/${g}`)).length;
    return `<li class="${off ? 'off' : ''}${openTab === t.id ? ' open' : ''}">
      <div class="rs-tab">${t.context ? `<span class="rs-ctx" title="Появляется, когда выделен подходящий объект">${icon('cursor')}</span>` : `<input type="checkbox" data-tab="${t.id}"${off ? '' : ' checked'} aria-label="${esc(t.name)}">`}
        <button type="button" class="rs-name" data-open="${t.id}"><span>${esc(t.name)}</span><small>${off ? 'скрыта' : `${n} из ${t.groups.length}`}</small><b class="rs-chev">${icon('next')}</b></button></div>
      <div class="rs-groups">${t.groups.map((g) => `<label><input type="checkbox" data-group="${esc(`${t.id}/${g}`)}"${hide.has(`${t.id}/${g}`) ? '' : ' checked'}${off ? ' disabled' : ''}><span>${esc(g)}</span></label>`).join('')}</div>
    </li>`;
  }).join('')}</ul>
  <p class="rs-note">Скрытое не пропадает: любую команду найдёт поиск — Ctrl+K</p>`;
  }

  const open = (anchor?: HTMLElement) => {
    if (box) { close(); return; }
    box = document.createElement('div');
    box.className = 'rs';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Настроить ленту');
    document.body.appendChild(box);
    const rib = document.getElementById('st-ribbon')?.getBoundingClientRect();
    box.style.top = `${Math.round((rib?.bottom ?? anchor?.getBoundingClientRect().bottom ?? 120) + 8)}px`;
    openTab = host.tab();
    draw();
    box.addEventListener('click', (e) => {
      const t = e.target as Element;
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'close') { close(); return; }
      const pr = t.closest<HTMLElement>('[data-preset]')?.dataset.preset;
      if (pr) { set(structuredClone(PRESETS.find(([id]) => id === pr)![4])); return; }
      const op = t.closest<HTMLElement>('[data-open]')?.dataset.open;
      if (op) {
        openTab = openTab === op ? '' : op;
        // Показать вкладку на ленте — видно, о каких кнопках речь (у вкладок по выделению — нет)
        if (openTab && !CONTEXT.has(op) && !prefs.hide.includes(op)) host.setTab(op);
        draw();
      }
    });
    box.addEventListener('change', (e) => {
      const inp = e.target as HTMLInputElement;
      const hide = new Set(prefs.hide);
      const key = inp.dataset.tab ?? inp.dataset.group;
      if (inp.dataset.o) { set({ ...prefs, [inp.dataset.o]: inp.checked }); return; }
      if (!key) return;
      if (inp.checked) hide.delete(key);
      else hide.add(key);
      // Хотя бы одна обычная вкладка остаётся
      if (!inventory().some((t) => !t.context && !hide.has(t.id))) { inp.checked = true; return; }
      set({ ...prefs, hide: [...hide] });
    });
    addEventListener('keydown', onKey, true);
    addEventListener('pointerdown', onOutside, true);
  };

  apply();
  return { open, apply };
}
