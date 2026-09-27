import { icon } from '../components/icons';
import { applyAccent, HEX_RE } from '../engine/accent';
import { getAt, setAt, type Path } from '../engine/data';
import { DeckView, H, W } from '../engine/deck-view';
import { Editor, SLIDE_PRESETS } from '../engine/editor/editor';
import { esc } from '../engine/html';
import { placeOf, slideLabel } from '../engine/render';
import { updateFavicon } from '../engine/show';
import { onThemeChange, toggleTheme } from '../engine/theme';
import type { Block, Deck } from '../types';
import { Inspector } from './inspector';
import { closeMenu, showMenu, type MenuEntry } from './menu';
import { SlidesPanel } from './slides-panel';
import './studio.css';

interface Command {
  run(): void;
  enabled?(): boolean;
  active?(): boolean;
}

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2];
const PAD = 40;
const NOTES_KEY = 'htmlpptx-studio-notes';

const readPath = (el: Element, attr: string): Path | null => {
  try {
    const v = JSON.parse(el.getAttribute(attr) ?? '');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

/** Кнопка ленты: большая (иконка над подписью) или малая (в строку). */
function rb(cmd: string, ic: string, label: string, opts: { big?: boolean; key?: string; menu?: boolean; title?: string } = {}): string {
  const tip = (opts.title ?? label) + (opts.key ? ` (${opts.key})` : '');
  return `<button type="button" class="st-rb${opts.big ? ' big' : ''}" data-cmd="${cmd}" title="${esc(tip)}"${opts.menu ? ' aria-haspopup="menu" aria-expanded="false"' : ''}>`
    + `${icon(ic)}<span>${esc(label)}${opts.menu ? ' ▾' : ''}</span></button>`;
}

function group(label: string, body: string): string {
  return `<div class="st-rgroup" role="group" aria-label="${esc(label)}"><div class="st-rgroup-body">${body}</div><div class="st-rgroup-label">${esc(label)}</div></div>`;
}

/**
 * Студия — редактор презентации как в PowerPoint: лента с вкладками, миниатюры слева,
 * слайд в центре, свойства справа, заметки снизу. Правка на слайде — тот же движок, что
 * в режиме правки (Editor), данные и сохранение — через него же (storage).
 */
export function startStudio(deck: Deck, deckKey: string): void {
  document.title = `${deck.title} — редактор`;
  document.body.classList.add('studio');
  document.body.innerHTML = `
<div class="studio-app">
  <header class="st-top" data-ed-keep>
    <a class="st-home" href="./?all" title="Все презентации" aria-label="Все презентации">${icon('layers')}</a>
    <input class="st-title" id="st-title" aria-label="Название презентации" spellcheck="false">
    <nav class="st-tabs" role="tablist" aria-label="Вкладки ленты">
      <button type="button" role="tab" data-tab="home" aria-selected="true">Главная</button>
      <button type="button" role="tab" data-tab="insert" aria-selected="false">Вставка</button>
      <button type="button" role="tab" data-tab="design" aria-selected="false">Дизайн</button>
      <button type="button" role="tab" data-tab="show" aria-selected="false">Показ</button>
    </nav>
    <div class="st-top-r">
      <button type="button" class="st-status" id="st-status" role="status" aria-live="polite"></button>
      <button class="ibtn small theme-btn" id="st-theme" type="button" aria-label="Тема интерфейса" title="Тема">${icon('sun', 'ic sun')}${icon('moon', 'ic moon')}</button>
      <button class="btn primary small" type="button" data-cmd="show.current" title="Показ с текущего слайда (Shift+F5)">${icon('play')}<span>Показ</span></button>
    </div>
  </header>
  <div class="st-ribbon" id="st-ribbon" data-ed-keep>
    <div class="st-rpanel" data-panel="home">
      ${group('Слайды', rb('slide.new', 'slide-add', 'Новый слайд', { big: true, key: 'Ctrl+M', menu: true }) + `<div class="st-rstack">${rb('slide.dup', 'copy', 'Дублировать')}${rb('slide.del', 'trash', 'Удалить')}</div>`)}
      ${group('Правка', `<div class="st-rstack">${rb('undo', 'undo', 'Отменить', { key: 'Ctrl+Z' })}${rb('redo', 'redo', 'Повторить', { key: 'Ctrl+Y' })}</div>`)}
      ${group('Вставка', rb('insert.text', 'text', 'Текст', { big: true }) + rb('insert.image', 'image', 'Картинка', { big: true }))}
      ${group('Упорядочить', `<div class="st-rstack">${rb('obj.front', 'front', 'Вперёд')}${rb('obj.back', 'back', 'Назад')}</div><div class="st-rstack">${rb('obj.dup', 'copy', 'Дублировать', { key: 'Ctrl+D' })}${rb('obj.del', 'trash', 'Удалить', { key: 'Delete' })}</div>`)}
      ${group('Выровнять', `<div class="st-rgrid">${rb('align.left', 'obj-left', 'Слева')}${rb('align.center', 'obj-center', 'По центру')}${rb('align.right', 'obj-right', 'Справа')}${rb('align.top', 'obj-top', 'Сверху')}${rb('align.middle', 'obj-middle', 'Посередине')}${rb('align.bottom', 'obj-bottom', 'Снизу')}</div>`)}
    </div>
    <div class="st-rpanel" data-panel="insert" hidden>
      ${group('Новый слайд', SLIDE_PRESETS.map((p, k) => rb(`slide.preset.${k}`, ['text', 'grid', 'image', 'frame'][k] ?? 'slide-add', p.name, { big: true })).join(''))}
      ${group('Объекты', rb('insert.text', 'text', 'Текст', { big: true }) + rb('insert.image', 'image', 'Картинка', { big: true }))}
    </div>
    <div class="st-rpanel" data-panel="design" hidden>
      ${group('Цвет', `<label class="st-accent" title="Акцентный цвет презентации"><input type="color" id="st-accent" aria-label="Акцентный цвет"><span>Акцент</span></label>${rb('design.accent-reset', 'reset', 'Стандартный')}`)}
      ${group('Тема', rb('design.theme', 'moon', 'Светлая / тёмная', { big: true, key: 'T' }))}
    </div>
    <div class="st-rpanel" data-panel="show" hidden>
      ${group('Показ', rb('show.start', 'play', 'С начала', { big: true, key: 'F5' }) + rb('show.current', 'presenter', 'С текущего слайда', { big: true, key: 'Shift+F5' }))}
      ${group('Анимация', rb('show.preview', 'sparkle', 'Просмотр слайда', { big: true, title: 'Проиграть появление объектов на текущем слайде' }))}
    </div>
  </div>
  <div class="st-body">
    <aside class="st-slides" id="st-slides" aria-label="Слайды"></aside>
    <main class="st-main">
      <div class="st-canvas" id="st-canvas"><div class="st-paper" id="st-paper"></div></div>
      <section class="st-notes" id="st-notes" data-ed-keep>
        <label for="st-notes-text" id="st-notes-label">Заметки докладчика</label>
        <textarea id="st-notes-text" spellcheck="true" placeholder="Что сказать на этом слайде. Видно только в окне докладчика."></textarea>
      </section>
    </main>
    <aside class="st-props" id="st-props" aria-label="Свойства" data-ed-keep></aside>
  </div>
  <footer class="st-foot" data-ed-keep>
    <span id="st-pos"></span>
    <span class="st-foot-r">
      <button type="button" class="st-fbtn" data-cmd="view.notes" title="Заметки докладчика">${icon('notes')}<span>Заметки</span></button>
      <span class="st-zoom" role="group" aria-label="Масштаб">
        <button type="button" class="st-fbtn" data-cmd="view.zoom-out" title="Уменьшить (Ctrl + колесо)" aria-label="Уменьшить">${icon('minus')}</button>
        <button type="button" class="st-fbtn st-zoom-val" id="st-zoom" data-cmd="view.zoom-menu" title="Масштаб" aria-haspopup="menu"></button>
        <button type="button" class="st-fbtn" data-cmd="view.zoom-in" title="Увеличить (Ctrl + колесо)" aria-label="Увеличить">${icon('plus')}</button>
        <button type="button" class="st-fbtn" data-cmd="view.fit" title="Вписать слайд в окно" aria-label="Вписать">${icon('fullscreen')}</button>
      </span>
    </span>
  </footer>
</div>
<div class="st-preview-shield" id="st-shield" title="Esc — остановить просмотр"></div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = $('st-canvas');
  const paper = $('st-paper');
  const notesText = $<HTMLTextAreaElement>('st-notes-text');
  const count = () => deck.slides.length;

  applyAccent(deck.theme?.accent);
  updateFavicon(deck.brand?.logo);
  const view = new DeckView(deck, paper);
  const hashIndex = () => {
    const m = /^#(\d+)$/.exec(location.hash);
    return m ? Math.max(0, Math.min(count() - 1, parseInt(m[1], 10) - 1)) : 0;
  };
  let index = hashIndex();
  view.show(index);

  // ---------------- масштаб ----------------
  let zoom: number | 'fit' = 'fit';
  let scale = 1;
  function fitScale(): number {
    return Math.max(0.1, Math.min((canvas.clientWidth - PAD * 2) / W, (canvas.clientHeight - PAD * 2) / H));
  }
  function layout(): void {
    scale = zoom === 'fit' ? fitScale() : zoom;
    paper.style.width = `${Math.round(W * scale)}px`;
    paper.style.height = `${Math.round(H * scale)}px`;
    canvas.classList.toggle('fit', zoom === 'fit');
    view.fit(W * scale, H * scale);
    $('st-zoom').textContent = `${Math.round(scale * 100)}%`;
    editor?.reposition();
  }
  function setZoom(z: number | 'fit'): void {
    zoom = z === 'fit' ? 'fit' : Math.max(0.1, Math.min(3, z));
    layout();
  }
  const stepZoom = (dir: 1 | -1) => {
    // Шаг к ближайшему «круглому» масштабу, заметно отличающемуся от текущего
    const next = dir > 0 ? ZOOMS.find((z) => z > scale + 0.02) : [...ZOOMS].reverse().find((z) => z < scale - 0.02);
    setZoom(next ?? (dir > 0 ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0]));
  };

  // ---------------- редактор ----------------
  let editor: Editor | null = null;
  let stateQueued = false;
  const queueState = () => {
    if (stateQueued) return;
    stateQueued = true;
    requestAnimationFrame(() => {
      stateQueued = false;
      syncUi();
    });
  };

  function go(i: number): void {
    const next = Math.max(0, Math.min(count() - 1, i));
    if (next === index && view.index === next) return;
    index = next;
    view.show(index);
    history.replaceState(null, '', `#${index + 1}`);
    editor?.onSlideChange();
    slides.mark();
    syncNotes();
    queueState();
  }

  editor = new Editor({
    deck,
    deckKey,
    stage: () => view.stage,
    index: () => index,
    go,
    refresh: (rebuild) => {
      if (rebuild) {
        view.build(deck);
        if (index > count() - 1) index = count() - 1;
        view.show(index);
      }
      applyAccent(deck.theme?.accent);
      updateFavicon(deck.brand?.logo);
      slides.update();
      queueState();
    },
    relayout: layout,
    state: queueState,
  }, true, { studio: true });
  const ed = editor;

  const slides = new SlidesPanel($('st-slides'), {
    deck: () => deck,
    index: () => index,
    go,
    move: (from, to) => ed.moveSlide(from, to),
    duplicate: (i) => ed.duplicateSlide(i),
    remove: (i) => ed.deleteSlide(i),
    add: (_after, anchor) => newSlideMenu(anchor),
    menu: (i, at) => showMenu(at, slideMenu(i)),
  });

  // ---------------- выделенный объект ----------------
  const freeEl = (free: Path) => [...view.stage.querySelectorAll<HTMLElement>('.slide.on [data-free]')]
    .find((x) => x.getAttribute('data-free') === JSON.stringify(free)) ?? null;
  function measure(free: Path): { w: number; h: number } | null {
    const el = freeEl(free);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width / scale), h: Math.round(r.height / scale) };
  }
  const selFree = () => ed.selection?.free ?? null;

  function align(kind: string): void {
    const free = selFree();
    if (!free) return;
    const b = getAt(deck, free) as Block;
    const pl = placeOf(b);
    const size = measure(free);
    const h = pl.h ?? size?.h ?? 0;
    const next = { ...pl };
    if (kind === 'left') next.x = 0;
    if (kind === 'center') next.x = Math.round((W - pl.w) / 2);
    if (kind === 'right') next.x = W - pl.w;
    if (kind === 'top') next.y = 0;
    if (kind === 'middle') next.y = Math.round((H - h) / 2);
    if (kind === 'bottom') next.y = H - h;
    if (next.h === undefined) delete next.h;
    ed.commit((d) => setAt(d, [...free, 'place'], next), { rebuild: true });
  }

  // ---------------- просмотр анимации ----------------
  let previewTimer = 0;
  function endPreview(): void {
    clearTimeout(previewTimer);
    if (!document.body.classList.contains('st-previewing')) return;
    document.body.classList.remove('st-previewing');
    document.body.classList.add('editing');
  }
  function preview(): void {
    endPreview();
    ed.clearSelection();
    const slide = view.slides[index];
    if (!slide) return;
    const free = (deck.slides[index].free ?? []) as Block[];
    const longest = Math.max(0, ...free.map((b) => (b.enter ? Number(b.delay) || 0 : 0)));
    document.body.classList.remove('editing');
    document.body.classList.add('st-previewing');
    // Перезапуск появления: слайд заново становится «показанным»
    slide.classList.remove('on');
    void slide.offsetWidth;
    slide.classList.add('on');
    previewTimer = window.setTimeout(endPreview, Math.min(8000, longest + 1600));
  }
  $('st-shield').addEventListener('click', endPreview);

  // ---------------- показ ----------------
  async function openShow(from: number): Promise<void> {
    await ed.settle();
    const u = new URL(location.href);
    u.searchParams.delete('studio');
    u.hash = `#${from + 1}`;
    window.open(u.toString(), `htmlpptx-show-${deckKey}`);
  }

  // ---------------- меню ----------------
  function newSlideMenu(anchor: HTMLElement): void {
    showMenu(anchor, SLIDE_PRESETS.map((p, k) => ({
      label: p.name, icon: ['text', 'grid', 'image', 'frame'][k] ?? 'slide-add', run: () => ed.addSlide(index, k),
    })));
  }
  function slideMenu(i: number): MenuEntry[] {
    const n = count();
    return [
      { label: 'Новый слайд после этого', icon: 'slide-add', hint: 'Ctrl+M', run: () => ed.addSlide(i, 0) },
      { label: 'Дублировать слайд', icon: 'copy', hint: 'Ctrl+D', run: () => ed.duplicateSlide(i) },
      null,
      { label: 'Переместить выше', icon: 'up', hint: 'Alt+↑', disabled: i === 0, run: () => ed.moveSlide(i, i - 1) },
      { label: 'Переместить ниже', icon: 'back', hint: 'Alt+↓', disabled: i === n - 1, run: () => ed.moveSlide(i, i + 1) },
      null,
      { label: 'Показ с этого слайда', icon: 'play', run: () => void openShow(i) },
      null,
      { label: 'Удалить слайд', icon: 'trash', danger: true, disabled: n <= 1, hint: 'Delete', run: () => ed.deleteSlide(i) },
    ];
  }
  function objectMenu(): MenuEntry[] {
    const sel = ed.selection;
    if (!sel) return slideMenu(index);
    if (!sel.free) {
      return [
        { label: 'Сделать свободным', icon: 'move', run: () => run('obj.free') },
        ...(sel.hasParent ? [{ label: 'Выделить внешний блок', icon: 'up', run: () => run('obj.parent') }] : []),
        null,
        { label: 'Удалить блок', icon: 'trash', danger: true, hint: 'Delete', run: () => run('obj.del') },
      ];
    }
    return [
      { label: 'Дублировать', icon: 'copy', hint: 'Ctrl+D', run: () => run('obj.dup') },
      { label: 'На передний план', icon: 'front', run: () => run('obj.front') },
      { label: 'На задний план', icon: 'back', run: () => run('obj.back') },
      null,
      { label: 'По центру слайда', icon: 'obj-center', run: () => { align('center'); align('middle'); } },
      null,
      { label: 'Удалить', icon: 'trash', danger: true, hint: 'Delete', run: () => run('obj.del') },
    ];
  }

  // ---------------- команды ----------------
  const hasFree = () => !!ed.selection?.free;
  const content = () => (deck.slides[index]?.template ?? 'content') === 'content';
  const cmds: Record<string, Command> = {
    undo: { run: () => ed.undo(), enabled: () => ed.canUndo },
    redo: { run: () => ed.redo(), enabled: () => ed.canRedo },
    'slide.new': { run: () => newSlideMenu(document.querySelector<HTMLElement>('[data-cmd="slide.new"]')!) },
    'slide.dup': { run: () => ed.duplicateSlide(index) },
    'slide.del': { run: () => ed.deleteSlide(index), enabled: () => count() > 1 },
    'insert.text': { run: () => ed.addBlock('text') },
    'insert.image': { run: () => ed.addBlock('image') },
    'obj.front': { run: () => ed.blockEditor.reorder(1), enabled: hasFree },
    'obj.back': { run: () => ed.blockEditor.reorder(-1), enabled: hasFree },
    'obj.dup': { run: () => ed.blockEditor.duplicate(), enabled: hasFree },
    'obj.del': { run: () => ed.blockEditor.remove(), enabled: () => !!ed.selection },
    'obj.free': { run: () => ed.blockEditor.detach(), enabled: () => !!ed.selection && !hasFree() },
    'obj.attach': { run: () => ed.blockEditor.attach(), enabled: () => hasFree() && content() },
    'obj.parent': { run: () => ed.blockEditor.selectParent(), enabled: () => !!ed.selection?.hasParent },
    'design.accent-reset': { run: () => ed.setAccent(null), enabled: () => !!deck.theme?.accent },
    'design.theme': { run: () => toggleTheme() },
    'show.start': { run: () => void openShow(0) },
    'show.current': { run: () => void openShow(index) },
    'show.preview': { run: preview },
    'view.notes': { run: () => setNotes(!notesOpen), active: () => notesOpen },
    'view.zoom-in': { run: () => stepZoom(1) },
    'view.zoom-out': { run: () => stepZoom(-1) },
    'view.fit': { run: () => setZoom('fit'), active: () => zoom === 'fit' },
    'view.zoom-menu': {
      run: () => showMenu($('st-zoom'), [
        { label: 'Вписать в окно', icon: 'fullscreen', run: () => setZoom('fit') },
        null,
        ...[0.5, 0.75, 1, 1.5, 2].map((z) => ({ label: `${Math.round(z * 100)}%`, run: () => setZoom(z) })),
      ]),
    },
  };
  for (const k of ['left', 'center', 'right', 'top', 'middle', 'bottom']) cmds[`align.${k}`] = { run: () => align(k), enabled: hasFree };
  SLIDE_PRESETS.forEach((_p, k) => { cmds[`slide.preset.${k}`] = { run: () => ed.addSlide(index, k) }; });

  function run(cmd: string): void {
    const c = cmds[cmd];
    if (!c || (c.enabled && !c.enabled())) return;
    c.run();
  }

  document.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.st-top [data-cmd], .st-ribbon [data-cmd], .st-foot [data-cmd]');
    if (b) run(b.dataset.cmd!);
  });

  // ---------------- вкладки ленты ----------------
  let tab = 'home';
  function setTab(name: string): void {
    tab = name;
    document.querySelectorAll<HTMLElement>('.st-tabs [data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.querySelectorAll<HTMLElement>('.st-rpanel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  }
  document.querySelector('.st-tabs')!.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-tab]');
    if (t) setTab(t.dataset.tab!);
  });
  document.querySelector('.st-tabs')!.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
    const tabs = [...document.querySelectorAll<HTMLElement>('.st-tabs [data-tab]')];
    const i = tabs.findIndex((t) => t.dataset.tab === tab);
    const next = tabs[(i + (k === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    setTab(next.dataset.tab!);
    next.focus();
  });

  // ---------------- шапка ----------------
  const title = $<HTMLInputElement>('st-title');
  title.addEventListener('change', () => {
    const v = title.value.trim();
    if (!v) { title.value = deck.title; return; }
    ed.commit((d) => { d.title = v; }, { rebuild: false, merge: 'title' });
    document.title = `${v} — редактор`;
  });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      if (e.key === 'Escape') title.value = deck.title;
      title.blur();
    }
  });
  $('st-status').addEventListener('click', () => ed.retrySave());
  $('st-theme').addEventListener('click', () => toggleTheme());
  const accent = $<HTMLInputElement>('st-accent');
  accent.addEventListener('input', () => ed.setAccent(accent.value));
  onThemeChange(() => { slides.update(); queueState(); });

  // ---------------- заметки ----------------
  let notesOpen = true;
  try { notesOpen = localStorage.getItem(NOTES_KEY) !== '0'; } catch { /* нет доступа */ }
  function setNotes(on: boolean): void {
    notesOpen = on;
    $('st-notes').hidden = !on;
    try { localStorage.setItem(NOTES_KEY, on ? '1' : '0'); } catch { /* нет доступа */ }
    layout();
    queueState();
  }
  function syncNotes(): void {
    const n = deck.slides[index]?.notes;
    if (document.activeElement !== notesText || notesText.dataset.slide !== String(index)) notesText.value = typeof n === 'string' ? n : '';
    notesText.dataset.slide = String(index);
    $('st-notes-label').textContent = `Заметки докладчика · слайд ${index + 1}`;
  }
  notesText.addEventListener('input', () => {
    const i = Number(notesText.dataset.slide);
    const v = notesText.value;
    ed.commit((d) => {
      if (v.trim()) d.slides[i].notes = v;
      else delete d.slides[i].notes;
    }, { merge: `notes:${i}`, rebuild: false });
  });
  notesText.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') notesText.blur();
  });

  // ---------------- состояние интерфейса ----------------
  const inspector = new Inspector($('st-props'), {
    deck: () => deck,
    index: () => index,
    editor: () => ed,
    run,
    measure,
  });

  function syncUi(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => {
      const c = cmds[b.dataset.cmd!];
      if (!c) return;
      b.disabled = !!c.enabled && !c.enabled();
      if (c.active) b.classList.toggle('active', c.active());
    });
    const st = ed.statusInfo;
    const status = $('st-status');
    status.textContent = st.text;
    status.className = `st-status ${st.cls}`;
    if (document.activeElement !== title) title.value = deck.title ?? '';
    const a = deck.theme?.accent;
    const av = typeof a === 'string' && HEX_RE.test(a) ? a : getComputedStyle(document.documentElement).getPropertyValue('--ac').trim();
    if (document.activeElement !== accent && HEX_RE.test(av)) accent.value = av.toLowerCase();
    $('st-pos').textContent = `Слайд ${index + 1} из ${count()} · ${slideLabel(deck.slides[index], index)}`;
    syncNotes();
    inspector.sync();
  }

  // ---------------- мышь на холсте ----------------
  canvas.addEventListener('scroll', () => ed.reposition(), { passive: true });
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    stepZoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  // Клик по серому полю вокруг слайда снимает выделение
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target === canvas || e.target === paper) ed.clearSelection();
  });
  canvas.addEventListener('contextmenu', (e) => {
    if ((e.target as Element).closest('[contenteditable="true"]')) return;
    e.preventDefault();
    const freeHost = (e.target as Element).closest('[data-free]');
    const path = freeHost ? readPath(freeHost, 'data-free') : null;
    if (path && JSON.stringify(ed.selection?.free) !== JSON.stringify(path)) ed.selectFree(Number(path[1]), Number(path[3]));
    showMenu({ x: e.clientX, y: e.clientY }, freeHost || ed.selection ? objectMenu() : slideMenu(index));
  });
  new ResizeObserver(() => { if (zoom === 'fit') layout(); else ed.reposition(); }).observe(canvas);

  // ---------------- клавиатура ----------------
  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    const typing = el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? '');
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (document.body.classList.contains('st-previewing') && e.key === 'Escape') {
      e.preventDefault();
      return endPreview();
    }
    if (mod && (k === 's' || k === 'ы')) {
      e.preventDefault();
      void ed.save();
      return;
    }
    if (e.key === 'F5') {
      e.preventDefault();
      return run(e.shiftKey ? 'show.current' : 'show.start');
    }
    if (typing) return;
    if (ed.handleKey(e)) return;
    if (mod && !e.shiftKey && (k === 'm' || k === 'ь')) {
      e.preventDefault();
      return ed.addSlide(index, 0);
    }
    if (mod && (k === 'd' || k === 'в') && !ed.selection) {
      e.preventDefault();
      return ed.duplicateSlide(index);
    }
    if (mod || e.altKey) return;
    if (ed.selection) return;
    const nav: Record<string, () => void> = {
      PageDown: () => go(index + 1), ArrowDown: () => go(index + 1), ArrowRight: () => go(index + 1),
      PageUp: () => go(index - 1), ArrowUp: () => go(index - 1), ArrowLeft: () => go(index - 1),
      Home: () => go(0), End: () => go(count() - 1),
    };
    const letters: Record<string, () => void> = { t: () => toggleTheme(), 'е': () => toggleTheme() };
    const fn = nav[e.key] ?? letters[k];
    if (fn) {
      e.preventDefault();
      closeMenu();
      fn();
    }
  });
  addEventListener('hashchange', () => go(hashIndex()));

  // ---------------- старт ----------------
  ed.toggle(true);
  setNotes(notesOpen);
  slides.update();
  history.replaceState(null, '', `#${index + 1}`);
  syncUi();
  requestAnimationFrame(layout);
  document.fonts?.ready.then(() => layout());
}
