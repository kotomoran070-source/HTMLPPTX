/**
 * Панель быстрого доступа, как в PowerPoint: свои кнопки любых команд — в заголовке окна (программа), рядом с
 * «Файлом» (браузер) или под лентой.
 *
 * - «▾» у панели — частые команды галочками, «Другие команды…» (настройка в «Файл → Параметры») и место панели;
 * - правый щелчок по кнопке ленты — «Добавить на панель быстрого доступа», по кнопке панели — «Удалить…»;
 * - настройка (mount): все команды с поиском, порядок перетаскиванием или стрелками, место, «Сбросить».
 *
 * Команды — из самой ленты (значок, подпись, подсказка с клавишами), и свои записи поиска команд (palette.ts):
 * новая кнопка на ленте сразу доступна и здесь. Кнопка команды с обработчиком — с data-cmd: доступность и «вкл.»
 * обновляются вместе с лентой (studio.ts). Меню команды открывается у кнопки панели (menu.ts, setInvoker).
 * Запоминается на этом компьютере
 */
import { icon } from '../components/icons';
import { esc } from '../engine/html';
import type { Entry } from './palette';
import { setInvoker, showMenu, type MenuEntry, type MenuHead } from './menu';
import './qat.css';

export interface QatHost {
  /** Команда с обработчиком (кнопка с data-cmd) */
  known(cmd: string): boolean;
  /** Свои записи поиска команд, которых нет на ленте (Экспорт, Заменить, На передний план…) */
  extras(): Entry[];
  /** Где «над лентой»: в программе — заголовок окна, в браузере — строка вкладок перед «Файлом» */
  framed: boolean;
  /** «Другие команды…» — «Файл → Параметры», к настройке панели */
  customize(): void;
  /** Состояние кнопок обновить сразу (новая кнопка — недоступна, если команда сейчас недоступна) */
  sync(): void;
}

export interface QatItem {
  id: string;
  label: string;
  /** «Главная · Правка»; у своих записей — их место */
  path: string;
  key: string;
  ico: string;
  menu: boolean;
  toggle: boolean;
  /** Своя запись (не кнопка ленты): выполняется её run */
  run?: () => void;
  enabled?: () => boolean;
}

interface Prefs { cmds: string[]; below: boolean }

const KEY = 'slideria.qat';
/** С чего начинается панель */
export const QAT_DEFAULT = ['undo', 'redo', 'show.current', 'format.painter'];
/** Частые команды — галочками в меню «▾» */
const POPULAR = ['undo', 'redo', 'show.current', 'show.start', 'format.painter', 'color.pick', 'slide.new', 'slide.dup', 'insert.text', 'insert.image', 'obj.group', 'edit.find', 'file.save', 'file.export'];
/** Подписи на панели и в её меню — полнее, чем короткие на ленте («С начала» → «Показ с начала») */
/** Значки на панели, где у ленты они читаются иначе: показ с текущего — ▷ (как у кнопки «Показ»), с начала — ↺ */
const ICON: Record<string, string> = { 'show.current': 'play', 'show.start': 'reset' };
const LABEL: Record<string, string> = {
  'show.current': 'Показ с текущего слайда',
  'show.start': 'Показ с начала',
  'slide.new': 'Новый слайд',
  'slide.dup': 'Дублировать слайд',
  'insert.text': 'Вставить надпись',
  'insert.image': 'Вставить картинку',
};

function load(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null;
    if (v && Array.isArray(v.cmds)) return { cmds: [...new Set(v.cmds.filter((x) => typeof x === 'string'))], below: !!v.below };
  } catch { /* нет доступа или испорчено */ }
  return { cmds: [...QAT_DEFAULT], below: false };
}

function save(p: Prefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* нет доступа */ }
}

/** Все команды: верхняя строка, ленты всех вкладок (и тех, что появляются с выделением), свои записи */
function inventory(extras: Entry[]): QatItem[] {
  const out: QatItem[] = [];
  const seen = new Set<string>();
  const add = (b: HTMLElement, path: string) => {
    const id = b.dataset.cmd!;
    if (seen.has(id) || id.startsWith('tab.') || b.dataset.pal === 'skip' || b.closest('.st-qat')) return;
    const title = b.getAttribute('title') ?? '';
    const key = /\(([^()]*(?:Ctrl|Alt|Shift|F\d)[^()]*)\)\s*$/.exec(title)?.[1] ?? '';
    let label = (b.querySelector('span')?.textContent || b.getAttribute('aria-label') || title.replace(/\s*\(.*\)$/, '')).trim();
    if (!label) return;
    seen.add(id);
    label = LABEL[id] ?? label;
    // Флажок ленты (st-chk) — без своего значка: на панели он подписью
    const ico = ICON[id] ? icon(ICON[id]) : b.classList.contains('st-chk') ? '' : b.querySelector('svg.ic')?.outerHTML ?? '';
    out.push({ id, label, path, key, ico, menu: b.hasAttribute('aria-haspopup'), toggle: b.hasAttribute('aria-pressed') || b.classList.contains('st-chk') });
  };
  // Сначала лента — у команды её вкладка и группа; верхняя строка — для того, чего на ленте нет (Агент)
  for (const panel of document.querySelectorAll<HTMLElement>('.st-rpanel')) {
    const tab = document.querySelector<HTMLElement>(`.st-tabs [data-tab="${panel.dataset.panel}"]`)?.textContent?.trim() ?? '';
    for (const g of panel.querySelectorAll<HTMLElement>('.st-rgroup')) {
      const path = `${tab} · ${g.getAttribute('aria-label') ?? ''}`;
      g.querySelectorAll<HTMLElement>('[data-cmd]').forEach((b) => add(b, path));
    }
  }
  document.querySelectorAll<HTMLElement>('.st-top [data-cmd]').forEach((b) => add(b, 'Верхняя строка'));
  for (const e of extras) {
    // Своя запись с понятным названием заменяет кнопку ленты с той же командой
    const i = out.findIndex((x) => x.id === e.id);
    const item: QatItem = { id: e.id, label: e.label, path: e.path, key: e.key, ico: e.ico, menu: false, toggle: !!e.active, run: e.run, enabled: e.enabled };
    if (i >= 0) out[i] = { ...out[i], label: e.label, key: e.key || out[i].key, ico: out[i].ico || e.ico };
    else out.push(item);
  }
  return out;
}

export interface Qat {
  /** Панель: переезжает между местами (заголовок / строка вкладок / под лентой) */
  readonly el: HTMLElement;
  has(cmd: string): boolean;
  /** Команду можно поставить на панель */
  can(cmd: string): boolean;
  toggle(cmd: string): void;
  below(): boolean;
  setBelow(on: boolean): void;
  /** Меню правого щелчка по кнопке ленты или панели: пункты про панель */
  menuFor(cmd: string | null): (MenuEntry | MenuHead)[];
  /** Доступность своих записей (кнопки без data-cmd) */
  sync(): void;
  /** Настройка в «Файл → Параметры» */
  mount(box: HTMLElement): void;
}

export function initQat(host: QatHost, slots: { above: HTMLElement; below: HTMLElement }): Qat {
  let prefs = load();
  let items: QatItem[] = [];
  const refreshItems = () => { items = inventory(host.extras()); };
  const item = (id: string) => items.find((x) => x.id === id);

  const el = document.createElement('div');
  el.className = 'st-qat';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Панель быстрого доступа');
  el.dataset.edKeep = '';

  const button = (it: QatItem) => {
    const tip = it.label + (it.key ? ` (${it.key})` : '');
    // Команда с обработчиком — общим путём (доступность, «вкл.», меню у кнопки); своя запись без него — своим run
    const cmd = host.known(it.id) ? ` data-cmd="${esc(it.id)}"` : ` data-qat="${esc(it.id)}"`;
    const face = it.ico ? it.ico : `<span class="st-qa-t">${esc(it.label)}</span>`;
    return `<button type="button" class="st-qa${it.ico ? '' : ' txt'}"${cmd} title="${esc(tip)}" aria-label="${esc(it.label)}"`
      + `${it.menu ? ' aria-haspopup="menu" aria-expanded="false"' : ''}${it.toggle ? ' aria-pressed="false"' : ''}>${face}</button>`;
  };

  function render(): void {
    refreshItems();
    const shown = prefs.cmds.map(item).filter((x): x is QatItem => !!x);
    el.innerHTML = shown.map(button).join('')
      + `<button type="button" class="st-qa st-qat-more" data-qat-more aria-haspopup="menu" aria-expanded="false" title="Настроить панель быстрого доступа" aria-label="Настроить панель быстрого доступа">${icon('chev-down')}</button>`;
    const slot = prefs.below ? slots.below : slots.above;
    if (el.parentElement !== slot) slot.append(el);
    slots.below.hidden = !prefs.below;
    document.body.classList.toggle('st-qat-below', prefs.below);
    host.sync();
    sync();
    draw();
  }

  const set = (p: Prefs) => {
    prefs = p;
    save(prefs);
    render();
  };
  const has = (cmd: string) => prefs.cmds.includes(cmd);
  const toggle = (cmd: string) => set({ ...prefs, cmds: has(cmd) ? prefs.cmds.filter((x) => x !== cmd) : [...prefs.cmds, cmd] });
  const setBelow = (on: boolean) => set({ ...prefs, below: on });
  const placeName = (below: boolean) => (below ? 'под лентой' : host.framed ? 'над лентой' : 'рядом с «Файлом»');

  function sync(): void {
    el.querySelectorAll<HTMLButtonElement>('[data-qat]').forEach((b) => {
      const it = item(b.dataset.qat!);
      b.disabled = !!it?.enabled && !it.enabled();
    });
  }

  /** «▾»: частые команды галочками, другие команды, место */
  function moreMenu(anchor: HTMLElement): void {
    refreshItems();
    const rows: (MenuEntry | MenuHead)[] = [{ head: 'Панель быстрого доступа' }];
    for (const id of POPULAR) {
      const it = item(id);
      if (it) rows.push({ label: it.label, hint: it.key, checked: has(id), run: () => toggle(id) });
    }
    rows.push(null,
      { label: 'Другие команды…', run: () => host.customize() },
      { label: `Показывать ${placeName(!prefs.below)}`, run: () => setBelow(!prefs.below) });
    showMenu(anchor, rows);
  }

  el.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button');
    if (!b) return;
    if (b.hasAttribute('data-qat-more')) { moreMenu(b); return; }
    // Меню команды — у этой кнопки, а не у её двойника на скрытой вкладке ленты
    setInvoker(b);
    const own = b.dataset.qat ? item(b.dataset.qat) : undefined;
    if (own?.run && (!own.enabled || own.enabled())) own.run();
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const b = (e.target as Element).closest<HTMLElement>('[data-cmd], [data-qat]');
    showMenu({ x: e.clientX, y: e.clientY }, menuFor(b?.dataset.cmd ?? b?.dataset.qat ?? null));
  });

  function menuFor(cmd: string | null): (MenuEntry | MenuHead)[] {
    refreshItems();
    const rows: (MenuEntry | MenuHead)[] = [];
    if (cmd && item(cmd)) {
      rows.push(has(cmd)
        ? { label: 'Удалить с панели быстрого доступа', icon: 'minus', run: () => toggle(cmd) }
        : { label: 'Добавить на панель быстрого доступа', icon: 'plus', run: () => toggle(cmd) });
      rows.push(null);
    }
    rows.push({ label: 'Настроить панель быстрого доступа…', icon: 'sliders', run: () => host.customize() },
      { label: `Показывать панель быстрого доступа ${placeName(!prefs.below)}`, icon: prefs.below ? 'up' : 'chev-down', run: () => setBelow(!prefs.below) });
    return rows;
  }

  // ---------------- настройка в «Файл → Параметры» ----------------

  let box: HTMLElement | null = null;
  let query = '';

  function draw(): void {
    if (!box?.isConnected) return;
    const list = box.querySelector<HTMLElement>('.qe-all');
    const keepAll = list?.scrollTop ?? 0;
    const keepMine = box.querySelector<HTMLElement>('.qe-mine')?.scrollTop ?? 0;
    const focus = (document.activeElement as HTMLElement | null)?.closest?.('[data-qe]');
    const focusSel = focus ? `[data-qe="${CSS.escape((focus as HTMLElement).dataset.qe!)}"]` : '';
    const q = query.trim().toLocaleLowerCase('ru');
    const found = items.filter((it) => !q || `${it.label} ${it.path}`.toLocaleLowerCase('ru').includes(q));
    // Все команды — по вкладкам и группам ленты
    let path = '';
    const all = found.map((it) => {
      const head = it.path !== path ? `<li class="qe-h">${esc((path = it.path))}</li>` : '';
      const on = has(it.id);
      return `${head}<li><button type="button" class="qe-row${on ? ' on' : ''}" data-qe="add:${esc(it.id)}" ${on ? 'aria-disabled="true"' : ''} title="${on ? 'Уже на панели' : 'Добавить на панель'}">`
        + `<span class="qe-ic">${it.ico || icon('check')}</span><span class="qe-l">${esc(it.label)}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}<i class="qe-add">${icon(on ? 'check' : 'plus')}</i></button></li>`;
    }).join('');
    const mine = prefs.cmds.map(item).filter((x): x is QatItem => !!x);
    const rows = mine.map((it, k) => `<li class="qe-mrow" data-id="${esc(it.id)}">`
      + `<span class="qe-grip" data-grip title="Перетащите, чтобы поменять порядок" aria-hidden="true">${icon('drag')}</span>`
      + `<span class="qe-ic">${it.ico || icon('check')}</span><span class="qe-l">${esc(it.label)}<small>${esc(it.path)}</small></span>`
      + `<button type="button" class="qe-b" data-qe="up:${esc(it.id)}" aria-label="Выше: ${esc(it.label)}" title="Выше"${k ? '' : ' disabled'}>${icon('up')}</button>`
      + `<button type="button" class="qe-b" data-qe="down:${esc(it.id)}" aria-label="Ниже: ${esc(it.label)}" title="Ниже"${k < mine.length - 1 ? '' : ' disabled'}>${icon('down')}</button>`
      + `<button type="button" class="qe-b qe-x" data-qe="del:${esc(it.id)}" aria-label="Убрать: ${esc(it.label)}" title="Убрать с панели">${icon('close')}</button></li>`).join('');
    box.innerHTML = `<div class="qe-top">
      <div class="fp-field"><span>Место панели</span><div class="fp-seg" role="radiogroup" aria-label="Место панели быстрого доступа">
        <button type="button" role="radio" data-qe="place:above" aria-checked="${!prefs.below}">${host.framed ? 'В заголовке окна' : 'Рядом с «Файлом»'}</button>
        <button type="button" role="radio" data-qe="place:below" aria-checked="${prefs.below}">Под лентой</button></div></div>
      <button type="button" class="fp-btn" data-qe="reset" title="Отменить, повторить, показ с текущего слайда и формат по образцу">${icon('reset')}Сбросить</button>
    </div>
    <div class="qe-cols">
      <div class="fp-card qe-card">
        <div class="qe-ch"><b>Все команды</b><label class="qe-q">${icon('search')}<input type="search" data-qe="q" placeholder="Найти команду" aria-label="Найти команду" autocomplete="off" spellcheck="false" value="${esc(query)}"><button type="button" class="qe-clear" data-qe="clear" aria-label="Очистить поиск" title="Очистить (Esc)"${query ? '' : ' hidden'}>${icon('close')}</button></label></div>
        <ul class="qe-all" aria-label="Все команды">${all || `<li class="qe-none">Нет команды «${esc(query.trim())}»</li>`}</ul>
      </div>
      <div class="fp-card qe-card">
        <div class="qe-ch"><b>На панели</b><small>${mine.length ? `${mine.length} ${mine.length === 1 ? 'кнопка' : mine.length < 5 ? 'кнопки' : 'кнопок'}` : ''}</small></div>
        <ol class="qe-mine" aria-label="Кнопки панели по порядку">${rows || '<li class="qe-none">Пусто. Добавьте команды слева или правым щелчком по кнопке ленты</li>'}</ol>
      </div>
    </div>`;
    box.querySelector<HTMLElement>('.qe-all')!.scrollTop = keepAll;
    box.querySelector<HTMLElement>('.qe-mine')!.scrollTop = keepMine;
    if (focusSel) {
      const f = box.querySelector<HTMLElement>(focusSel);
      f?.focus({ preventScroll: true });
      if (f instanceof HTMLInputElement) f.setSelectionRange(f.value.length, f.value.length);
    }
  }

  const move = (id: string, to: number) => {
    const cmds = prefs.cmds.filter((x) => x !== id);
    cmds.splice(Math.max(0, Math.min(cmds.length, to)), 0, id);
    set({ ...prefs, cmds });
  };

  function mount(el2: HTMLElement): void {
    box = el2;
    el2.classList.add('qe');
    refreshItems();
    draw();
    // Esc в поиске — сначала очистить поиск, а не закрыть «Файл»
    el2.addEventListener('keydown', (e) => {
      const t = e.target as HTMLInputElement;
      if (e.key !== 'Escape' || t.dataset.qe !== 'q' || !query) return;
      e.preventDefault();
      e.stopPropagation();
      query = '';
      draw();
    });
    el2.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.qe !== 'q') return;
      query = t.value;
      draw();
    });
    el2.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-qe]');
      if (!b || b instanceof HTMLInputElement) return;
      const [op, id] = (b.dataset.qe ?? '').split(/:(.*)/s);
      if (op === 'clear') {
        e.preventDefault();
        query = '';
        draw();
        el2.querySelector<HTMLInputElement>('[data-qe="q"]')?.focus();
        return;
      }
      const at = prefs.cmds.indexOf(id);
      if (op === 'add' && !has(id)) set({ ...prefs, cmds: [...prefs.cmds, id] });
      else if (op === 'del') set({ ...prefs, cmds: prefs.cmds.filter((x) => x !== id) });
      else if (op === 'up') move(id, at - 1);
      else if (op === 'down') move(id, at + 1);
      else if (op === 'place') setBelow(id === 'below');
      else if (op === 'reset') set({ cmds: [...QAT_DEFAULT], below: false });
    });
    // Порядок — перетаскиванием за ручку: строка едет за мышью, остальные расступаются
    el2.addEventListener('pointerdown', (e) => {
      const grip = (e.target as Element).closest('[data-grip]');
      const row = grip?.closest<HTMLElement>('.qe-mrow');
      if (!row || e.button !== 0) return;
      e.preventDefault();
      const ol = row.parentElement!;
      const rows = [...ol.querySelectorAll<HTMLElement>('.qe-mrow')];
      const from = rows.indexOf(row);
      const h = row.offsetHeight;
      const y0 = e.clientY;
      let to = from;
      row.classList.add('drag');
      row.setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        const dy = ev.clientY - y0;
        to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / h)));
        row.style.transform = `translateY(${dy}px)`;
        rows.forEach((r, k) => {
          if (r === row) return;
          const shift = k > from && k <= to ? -h : k < from && k >= to ? h : 0;
          r.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      };
      const onUp = () => {
        row.removeEventListener('pointermove', onMove);
        row.removeEventListener('pointerup', onUp);
        row.removeEventListener('pointercancel', onUp);
        rows.forEach((r) => { r.style.transform = ''; });
        row.classList.remove('drag');
        if (to !== from) move(row.dataset.id!, to);
      };
      row.addEventListener('pointermove', onMove);
      row.addEventListener('pointerup', onUp);
      row.addEventListener('pointercancel', onUp);
    });
  }

  render();
  return {
    el,
    has,
    can: (cmd) => { refreshItems(); return !!item(cmd); },
    toggle,
    below: () => prefs.below,
    setBelow,
    menuFor,
    sync,
    mount,
  };
}
