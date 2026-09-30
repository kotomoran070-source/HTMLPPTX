import { icon } from '../components/icons';
import { CAMERA, type CameraState } from '../components/media/model';
import type { Deck } from '../types';
import { applyAccent, applyAccentFlow } from './accent';
import { replaceContents } from './data';
import { DeckView, staticSlide } from './deck-view';
import { esc, t } from './html';
import { slideLabel } from './render';
import { Ink, inkInput, type InkMsg, type InkTool, type StrokeStyle } from './ink';
import './presenter.css';
import { Sync } from './sync';
import { currentTheme, onThemeChange, setTheme, toggleTheme } from './theme';

const FONT_KEY = 'htmlpptx-notes-size';
const LAYOUT_KEY = 'htmlpptx-pres-layout';
/** Ширина текущего слайда и высота «Далее» по умолчанию, % */
const DEFAULT_LAYOUT = { pw: 64, nh: 40 };
const PEN_COLORS = ['#EF4444', '#F59E0B', '#2563EB', '#10B981', '#FFFFFF'];


/**
 * Окно докладчика: текущий слайд, следующий, заметки, таймер и часы.
 * Синхронизировано с основным окном в обе стороны.
 */
export function startPresenter(deck: Deck, deckKey: string): void {
  const count = () => deck.slides.length;
  document.title = `Докладчик — ${deck.title}`;
  document.body.classList.add('presenter');
  // Повтор мыши и живые 3D-модели для зрителей (кнопка в панели, M): до отрисовки слайдов —
  // модели решают при появлении, живые они здесь или снимок
  const MIRROR_KEY = 'htmlpptx-presenter-mirror';
  let mirror = true;
  try { mirror = localStorage.getItem(MIRROR_KEY) !== '0'; } catch { /* нет хранилища */ }
  document.body.classList.toggle('pres-live', mirror);
  document.body.innerHTML = `
<div class="pres">
  <header class="pres-top">
    <b class="pres-title">${esc(deck.title)}</b>
    <div class="pres-timer">
      <span class="pres-time" id="tm">00:00</span>
      <button class="ibtn small" id="tp" type="button" aria-label="Пауза" title="Пауза">${icon('pause')}</button>
      <button class="ibtn small" id="tr" type="button" aria-label="Сбросить таймер" title="Сбросить таймер">${icon('reset')}</button>
    </div>
    <div class="pres-right">
      <span class="pres-clock" id="clk"></span>
      <button class="ibtn theme-btn" id="thm" type="button" aria-label="Переключить тему" title="Тема (T)">${icon('sun', 'ic sun')}${icon('moon', 'ic moon')}</button>
    </div>
  </header>
  <main class="pres-main" id="pmain">
    <section class="pres-cur">
      <div class="pres-label" id="curl"></div>
      <div class="pres-vp" id="cur"></div>
      <div class="pres-dock" role="toolbar" aria-label="Инструменты показа">
        <button type="button" class="pd-btn" data-tool="laser" aria-pressed="false" title="Указка (L)">${icon('laser')}</button>
        <span class="pd-pen">
          <button type="button" class="pd-btn" data-tool="pen" aria-pressed="false" title="Перо (D)">${icon('pen')}<i class="pd-dot" id="pdot"></i></button>
          <span class="pd-colors" id="pcolors" role="radiogroup" aria-label="Цвет пера">${PEN_COLORS.map((c, k) =>
            `<button type="button" role="radio" aria-checked="${k === 0}" data-color="${c}" style="--c:${c}" title="Цвет пера" aria-label="Цвет ${k + 1}"></button>`).join('')}</span>
        </span>
        <button type="button" class="pd-btn" id="tcl" title="Стереть всё нарисованное (C)" aria-label="Стереть всё нарисованное">${icon('eraser')}</button>
        <i class="pd-sep" aria-hidden="true"></i>
        <button type="button" class="pd-btn" id="tgrid" title="Все слайды (G)" aria-label="Все слайды">${icon('grid')}</button>
        <button type="button" class="pd-btn" id="bk" aria-pressed="false" title="Чёрный экран у зрителей (B)" aria-label="Чёрный экран">${icon('screen-off')}</button>
        <button type="button" class="pd-btn" id="tmir" aria-pressed="true" title="Мышь и 3D у зрителей (M): курсор, наведение и поворот моделей повторяются в окне показа" aria-label="Мышь и 3D у зрителей">${icon('cursor')}</button>
      </div>
    </section>
    <div class="pres-split v" id="sv" role="separator" aria-orientation="vertical" aria-label="Размер текущего слайда" tabindex="0" title="Потяните, чтобы изменить размер. Двойной щелчок — сбросить"></div>
    <aside class="pres-side" id="pside">
      <section class="pres-nextbox">
        <div class="pres-label">Далее</div>
        <div class="pres-next" id="next"></div>
      </section>
      <div class="pres-split h" id="sh" role="separator" aria-orientation="horizontal" aria-label="Размер следующего слайда и заметок" tabindex="0" title="Потяните, чтобы изменить размер. Двойной щелчок — сбросить"></div>
      <section class="pres-notesbox">
        <div class="pres-label pres-notes-head">Заметки
          <span><button class="ibtn small" id="ned" type="button" aria-pressed="false" aria-label="Править заметки" title="Править заметки (E)">${icon('pencil')}</button><button class="ibtn small" id="fm" type="button" aria-label="Мельче">A−</button><button class="ibtn small" id="fp" type="button" aria-label="Крупнее">A+</button></span>
        </div>
        <div class="pres-notes" id="notes"></div>
        <textarea class="pres-notes pres-notes-ed" id="notesed" spellcheck="true" hidden aria-label="Заметки слайда"></textarea>
        <form class="pres-jot" id="jot" autocomplete="off">
          <input id="jotin" type="text" spellcheck="true" placeholder="Записать мысль или вопрос из зала — Enter  (N)" aria-label="Записать в заметки слайда">
          <span class="pres-jot-st" id="jotst" role="status" aria-live="polite"></span>
        </form>
      </section>
    </aside>
  </main>
  <footer class="pres-bottom">
    <button class="btn ghost" id="pv" type="button">${icon('prev')} Назад</button>
    <span class="counter" id="ct"></span>
    <button class="btn primary" id="nx" type="button">Далее ${icon('next')}</button>
    <span class="pres-link" id="link"></span>
  </footer>
</div>
<div class="pres-grid" id="pgrid" hidden role="dialog" aria-modal="true" aria-label="Все слайды">
  <div class="pres-grid-head"><b>Все слайды</b><span>Клик — перейти, Esc — закрыть</span><button class="ibtn small" id="pgx" type="button" aria-label="Закрыть">${icon('close')}</button></div>
  <div class="pres-grid-list" id="pglist"></div>
</div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const cur = $('cur');
  applyAccent(deck.theme?.accent, deck.theme?.accent2);
  applyAccentFlow(deck.theme?.accentFlow);
  const view = new DeckView(deck, cur);
  // У окна докладчика свой id (sessionStorage всплывающего окна копируется из основного)
  const sync = new Sync(deckKey, 'p-' + Math.random().toString(36).slice(2, 10));
  // Окно показа, за которым следует это окно; без параметра — первое ответившее
  let mainId = new URLSearchParams(location.search).get('main');
  const toMain = () => mainId ?? undefined;
  let index = -1;
  let black = false;

  // --- указка, перо и маркер: рисунок виден и здесь, и у зрителей ---
  const ink = new Ink(view.stage);
  let tool: InkTool = 'none';
  let penColor = PEN_COLORS[0];
  const sendInk = (m: InkMsg) => sync.send({ type: 'ink', ink: m }, toMain());
  // Повтор мыши и живые 3D-модели для зрителей: можно выключить, если на слайдах нет
  // наведений и моделей — тогда окна ничего лишнего не пересылают и не рисуют
  inkInput(cur, ink, () => tool, (): StrokeStyle => ({ color: penColor, width: 5 }), sendInk, () => mirror);
  window.addEventListener(CAMERA, (e) => {
    if (mirror) sync.send({ type: 'camera', ...(e as CustomEvent<CameraState>).detail }, toMain());
  });
  function setMirror(on: boolean): void {
    mirror = on;
    try { localStorage.setItem(MIRROR_KEY, on ? '1' : '0'); } catch { /* нет хранилища */ }
    $('tmir').setAttribute('aria-pressed', String(on));
    if (!on) sendInk({ op: 'cursor-off' });
    // Модели текущего слайда: живые или снимок — слайды перерисовываются
    document.body.classList.toggle('pres-live', on);
    view.build(deck);
    const i = index;
    index = -1;
    render(i);
  }
  const clearInk = () => { ink.apply({ op: 'clear' }); sendInk({ op: 'clear' }); };
  function setTool(t: InkTool): void {
    tool = tool === t ? 'none' : t;
    if (tool !== 'laser') { ink.apply({ op: 'laser-off' }); sendInk({ op: 'laser-off' }); }
    cur.dataset.tool = tool;
    document.querySelectorAll<HTMLElement>('.pres-dock [data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    $('pcolors').classList.toggle('on', tool === 'pen');
  }
  function setPenColor(c: string): void {
    penColor = c;
    $('pdot').style.background = c;
    document.querySelectorAll<HTMLElement>('#pcolors [data-color]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === c)));
    if (tool !== 'pen') setTool('pen');
  }
  setPenColor(penColor);
  setTool('none');
  document.querySelector('.pres-dock')!.addEventListener('click', (e) => {
    const t = e.target as Element;
    const color = t.closest<HTMLElement>('[data-color]')?.dataset.color;
    if (color) return setPenColor(color);
    const which = t.closest<HTMLElement>('[data-tool]')?.dataset.tool as InkTool | undefined;
    if (which) setTool(which);
  });

  const fit = () => view.fit(cur.clientWidth, cur.clientHeight);
  new ResizeObserver(fit).observe(cur);
  fit();

  // --- раскладка окна: перетаскиваемые границы, как в PowerPoint ---
  const pres = document.querySelector<HTMLElement>('.pres')!;
  let lay = { ...DEFAULT_LAYOUT };
  try { lay = { ...lay, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') }; } catch { /* нет сохранённой раскладки */ }
  const applyLayout = (save = true) => {
    lay.pw = Math.max(30, Math.min(82, lay.pw));
    lay.nh = Math.max(12, Math.min(80, lay.nh));
    pres.style.setProperty('--pw', `${lay.pw}%`);
    pres.style.setProperty('--nh', `${lay.nh}%`);
    $('sv').setAttribute('aria-valuenow', String(Math.round(lay.pw)));
    $('sh').setAttribute('aria-valuenow', String(Math.round(lay.nh)));
    if (save) try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(lay)); } catch { /* нет доступа */ }
  };
  applyLayout(false);
  function splitter(el: HTMLElement, axis: 'pw' | 'nh', box: () => DOMRect): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pres.classList.add('resizing');
      const move = (ev: PointerEvent) => {
        const r = box();
        lay[axis] = axis === 'pw' ? ((ev.clientX - r.left) / r.width) * 100 : ((ev.clientY - r.top) / r.height) * 100;
        applyLayout(false);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        pres.classList.remove('resizing');
        applyLayout();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => { lay[axis] = DEFAULT_LAYOUT[axis]; applyLayout(); });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -2, ArrowUp: -2, ArrowRight: 2, ArrowDown: 2 }[e.key];
      if (d === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      lay[axis] += d;
      applyLayout();
    });
  }
  splitter($('sv'), 'pw', () => $('pmain').getBoundingClientRect());
  splitter($('sh'), 'nh', () => $('pside').getBoundingClientRect());

  // Следующий слайд вписывается в свою область по ширине и высоте
  const fitNext = () => {
    const box = $('next');
    const th = box.querySelector<HTMLElement>('.thumb');
    if (!th) return;
    const cap = box.querySelector<HTMLElement>('.mu')?.offsetHeight ?? 0;
    // В одну колонку (узкое окно) высота области — по содержимому: слайд на всю ширину
    if (narrow.matches) { th.style.width = `${box.clientWidth}px`; return; }
    th.style.width = `${Math.max(80, Math.min(box.clientWidth, ((box.clientHeight - cap - 6) * 16) / 9))}px`;
  };
  const narrow = matchMedia('(max-width: 900px)');
  new ResizeObserver(fitNext).observe($('next'));
  narrow.addEventListener('change', fitNext);

  // --- все слайды ---
  const grid = $('pgrid');
  function openGrid(): void {
    const list = $('pglist');
    list.innerHTML = '';
    deck.slides.forEach((sl, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pres-grid-item' + (i === index ? ' cur' : '');
      b.appendChild(staticSlide(deck, i));
      b.insertAdjacentHTML('beforeend', `<span><b>${i + 1}</b>${esc(slideLabel(sl, i))}</span>`);
      b.onclick = () => { closeGrid(); go(i); };
      list.appendChild(b);
    });
    grid.hidden = false;
    list.querySelector<HTMLElement>('.cur')?.focus();
    list.querySelector<HTMLElement>('.cur')?.scrollIntoView({ block: 'center' });
  }
  function closeGrid(): void {
    grid.hidden = true;
  }
  $('tgrid').addEventListener('click', openGrid);
  $('pgx').addEventListener('click', closeGrid);
  grid.addEventListener('click', (e) => { if (e.target === grid) closeGrid(); });

  // --- заметки ---
  let fontSize = 20;
  try { fontSize = Number(localStorage.getItem(FONT_KEY)) || 20; } catch { /* нет доступа */ }
  const applyFont = () => {
    $('notes').style.fontSize = `${fontSize}px`;
    try { localStorage.setItem(FONT_KEY, String(fontSize)); } catch { /* нет доступа */ }
  };
  applyFont();
  $('fm').addEventListener('click', () => { fontSize = Math.max(12, fontSize - 2); applyFont(); });
  $('fp').addEventListener('click', () => { fontSize = Math.min(48, fontSize + 2); applyFont(); });

  function render(i: number): void {
    const was = index;
    index = Math.max(0, Math.min(count() - 1, i));
    if (index !== was) ink.apply({ op: 'clear' });
    view.show(index);
    const s = deck.slides[index];
    $('curl').textContent = `Слайд ${index + 1} из ${count()} · ${slideLabel(s, index)}`;
    $('ct').textContent = `${index + 1} / ${count()}`;
    const next = $('next');
    next.innerHTML = '';
    if (index + 1 < count()) {
      const box = staticSlide(deck, index + 1);
      next.appendChild(box);
      next.insertAdjacentHTML('beforeend', `<div class="mu">${esc(slideLabel(deck.slides[index + 1], index + 1))}</div>`);
      fitNext();
    } else {
      next.innerHTML = '<div class="pres-end">Конец презентации</div>';
    }
    $('notes').innerHTML = s.notes ? t(s.notes) : '<span class="mu">Заметок нет</span>';
    $('pv').toggleAttribute('disabled', index === 0);
    $('nx').toggleAttribute('disabled', index === count() - 1);
  }

  function go(i: number): void {
    const target = Math.max(0, Math.min(count() - 1, i));
    if (target === index) return;
    render(target);
    sync.send({ type: 'goto', index: target }, toMain());
  }

  function setBlack(v: boolean, send = true): void {
    black = v;
    $('bk').setAttribute('aria-pressed', String(v));
    if (send) sync.send({ type: 'black', value: v }, toMain());
  }

  // --- таймер и часы ---
  let started = Date.now();
  let pausedAt: number | null = null;
  const pad = (x: number) => String(x).padStart(2, '0');
  function tick(): void {
    const now = pausedAt ?? Date.now();
    const sec = Math.floor((now - started) / 1000);
    const h = Math.floor(sec / 3600);
    $('tm').textContent = (h ? `${h}:` : '') + `${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
    const d = new Date();
    $('clk').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  setInterval(tick, 500);
  tick();
  $('tp').addEventListener('click', () => {
    if (pausedAt == null) {
      pausedAt = Date.now();
      $('tp').innerHTML = icon('play');
      $('tm').classList.add('paused');
    } else {
      started += Date.now() - pausedAt;
      pausedAt = null;
      $('tp').innerHTML = icon('pause');
      $('tm').classList.remove('paused');
    }
    tick();
  });
  $('tr').addEventListener('click', () => {
    started = Date.now();
    if (pausedAt != null) pausedAt = started;
    tick();
  });

  // --- управление ---
  $('nx').addEventListener('click', () => go(index + 1));
  $('pv').addEventListener('click', () => go(index - 1));
  $('bk').addEventListener('click', () => setBlack(!black));
  $('tmir').addEventListener('click', () => setMirror(!mirror));
  $('tmir').setAttribute('aria-pressed', String(mirror));
  $('tcl').addEventListener('click', clearInk);
  $('thm').addEventListener('click', () => toggleTheme());
  let remoteTheme = false;
  onThemeChange((th) => { if (!remoteTheme) sync.send({ type: 'theme', theme: th }, toMain()); });

  // --- записи по ходу выступления: в заметки слайда, у зрителей ничего не меняется ---
  /** Отправленные, но ещё не подтверждённые окном показа: досылаются, пока связь не появится */
  const pending = new Map<number, { id: string; index: number; slide?: string; notes: string }>();
  const jotSt = $('jotst');
  const jotStatus = (text: string, cls = '') => { jotSt.textContent = text; jotSt.className = `pres-jot-st ${cls}`; };
  const flushNotes = () => pending.forEach((m) => sync.send({ type: 'notes', ...m }, toMain()));
  function setNotes(i: number, notes: string): void {
    const s = deck.slides[i];
    if (!s) return;
    if (notes.trim()) s.notes = notes;
    else delete s.notes;
    if (i === index) $('notes').innerHTML = s.notes ? t(s.notes) : '<span class="mu">Заметок нет</span>';
    const m = { id: Math.random().toString(36).slice(2, 10), index: i, slide: typeof s.id === 'string' ? s.id : undefined, notes: notes.trim() ? notes : '' };
    pending.set(i, m);
    jotStatus('Отправляю…');
    flushNotes();
    setTimeout(() => { if (pending.has(i)) jotStatus('Ждёт связи с окном показа — запись не потеряется', 'warn'); }, 1500);
  }
  $('jot').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $<HTMLInputElement>('jotin');
    const text = inp.value.trim();
    if (!text) return;
    const d = new Date();
    const line = `✎ ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} — ${text}`;
    const cur = String(deck.slides[index]?.notes ?? '').trimEnd();
    setNotes(index, cur ? `${cur}\n${line}` : line);
    inp.value = '';
  });
  // Заметки только для чтения; править — кнопкой ✎ или клавишей E. Ctrl+Enter, повторное нажатие
  // кнопки или уход фокуса — сохранить, Esc — отменить
  const notesEl = $('notes');
  const notesEd = $<HTMLTextAreaElement>('notesed');
  const edBtn = $('ned');
  let editing = -1;
  function editNotes(): void {
    if (editing >= 0) return;
    editing = index;
    notesEd.value = String(deck.slides[index]?.notes ?? '');
    notesEd.style.fontSize = notesEl.style.fontSize;
    notesEl.hidden = true;
    notesEd.hidden = false;
    edBtn.setAttribute('aria-pressed', 'true');
    edBtn.title = 'Сохранить заметки (Ctrl+Enter), отмена — Esc';
    notesEd.focus();
    notesEd.setSelectionRange(notesEd.value.length, notesEd.value.length);
  }
  function endEdit(save: boolean): void {
    if (editing < 0) return;
    const i = editing;
    editing = -1;
    notesEd.hidden = true;
    notesEl.hidden = false;
    edBtn.setAttribute('aria-pressed', 'false');
    edBtn.title = 'Править заметки (E)';
    if (save && notesEd.value !== String(deck.slides[i]?.notes ?? '')) setNotes(i, notesEd.value);
  }
  // Кнопка не забирает фокус у поля: иначе уход фокуса сохранил бы и сразу открыл правку снова
  edBtn.addEventListener('mousedown', (e) => e.preventDefault());
  edBtn.addEventListener('click', () => (editing >= 0 ? endEdit(true) : editNotes()));
  notesEd.addEventListener('blur', () => endEdit(true));
  notesEd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); endEdit(true); }
  });
  $('jotin').addEventListener('keydown', (e) => { if (e.key === 'Escape') (e.target as HTMLElement).blur(); });

  document.addEventListener('keydown', (e) => {
    // Пока набирают текст, клавиши не листают слайды и не включают инструменты
    if ((e.target as Element)?.closest?.('input, textarea, [contenteditable="true"]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const lower = k.toLowerCase();
    // Все слайды открыты: только закрыть или выбрать
    if (!grid.hidden) {
      if (k === 'Escape' || lower === 'g' || lower === 'п') { e.preventDefault(); closeGrid(); }
      return;
    }
    const map: Record<string, () => void> = {
      ArrowRight: () => go(index + 1), ArrowDown: () => go(index + 1), PageDown: () => go(index + 1), ' ': () => go(index + 1),
      ArrowLeft: () => go(index - 1), ArrowUp: () => go(index - 1), PageUp: () => go(index - 1), Backspace: () => go(index - 1),
      Home: () => go(0), End: () => go(count() - 1),
    };
    const letters: Record<string, () => void> = {
      b: () => setBlack(!black), 'и': () => setBlack(!black), '.': () => setBlack(!black),
      t: () => toggleTheme(), 'е': () => toggleTheme(),
      l: () => setTool('laser'), 'д': () => setTool('laser'),
      d: () => setTool('pen'), 'в': () => setTool('pen'),
      c: () => clearInk(), 'с': () => clearInk(),
      g: openGrid, 'п': openGrid,
      m: () => setMirror(!mirror), 'ь': () => setMirror(!mirror),
      n: () => $('jotin').focus(), 'т': () => $('jotin').focus(),
      e: editNotes, 'у': editNotes,
      escape: () => { if (tool !== 'none') setTool(tool); },
    };
    const fn = map[k] ?? letters[lower];
    if (fn) { e.preventDefault(); fn(); }
  });

  sync.on((m, from) => {
    if (m.type === 'notes-ok') {
      for (const [i, p] of pending) if (p.id === m.id) pending.delete(i);
      if (!pending.size) {
        jotStatus(m.saved === 'auto' ? 'Сохранено' : m.saved === 'file' ? 'Записано — сохраните файл после показа' : 'Записано до закрытия окна показа', m.saved === 'auto' ? 'ok' : 'warn');
      }
      return;
    }
    // Только своё окно показа: другие вкладки этой же презентации не мешают
    if (m.type !== 'deck' && m.type !== 'state') return;
    if (!mainId) mainId = from;
    if (from !== mainId) return;
    if (m.type === 'deck') {
      // Правки из режима правки основного окна
      const next = JSON.stringify(m.deck);
      if (next === JSON.stringify(deck)) return;
      replaceContents(deck as unknown as Record<string, unknown>, JSON.parse(next));
      // Записи, которые окно показа ещё не приняло, свежее пришедшей копии
      pending.forEach((pm) => {
        const ps = deck.slides[pm.index];
        if (!ps) return;
        if (pm.notes) ps.notes = pm.notes;
        else delete ps.notes;
      });
      applyAccent(deck.theme?.accent, deck.theme?.accent2);
      applyAccentFlow(deck.theme?.accentFlow);
      view.update(deck);
      const i = Math.min(index, deck.slides.length - 1);
      index = -1;
      render(i);
    } else if (m.type === 'state') {
      // Записи, которые окно показа ещё не подтвердило, — ещё раз
      if (pending.size) flushNotes();
      $('link').textContent = 'Связь с окном показа есть';
      $('link').classList.add('ok');
      if (m.index !== index) render(m.index);
      if (m.theme !== currentTheme()) { remoteTheme = true; setTheme(m.theme, false); remoteTheme = false; }
      if (m.black !== black) setBlack(m.black, false);
    }
  });

  $('link').textContent = 'Окно показа не отвечает: листайте здесь';
  const m = /^#(\d+)$/.exec(location.hash);
  render(m ? parseInt(m[1], 10) - 1 : 0);
  sync.send({ type: 'hello' }, toMain());
  // Если основное окно перезагрузили, оно снова найдёт это окно по регулярному «привет»
  setInterval(() => sync.send({ type: 'hello' }, toMain()), 3000);
}
