import { icon } from '../components/icons';
import { landOn, stepVisible, visiblePos } from './hidden';
import { frameAt, postPointer } from './frame-bridge';
import { CAMERA, type CameraState } from '../components/media/model';
import type { Deck } from '../types';
import { applyAccent, applyAccentFlow } from './accent';
import { replaceContents } from './data';
import { DeckView, staticSlide } from './deck-view';
import { esc, t } from './html';
import { actionTarget, slideLabel } from './render';
import { Ink, inkInput, type InkMsg, type InkTool, type StrokeStyle } from './ink';
import './presenter.css';
import { RELAY, Sync } from './sync';
import { currentTheme, onThemeChange, setTheme, toggleTheme } from './theme';

const FONT_KEY = 'htmlpptx-notes-size';
const LAYOUT_KEY = 'htmlpptx-pres-layout';
/** Ширина текущего слайда и высота «Далее» по умолчанию, % */
/** pw, nh — доли окна на компьютере; ph — ширина слайда на телефоне, % */
const DEFAULT_LAYOUT = { pw: 64, nh: 40, ph: 100 };
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
  // Стрелка курсора у зрителей (наведение и щелчки повторяются и без неё)
  const ARROW_KEY = 'htmlpptx-presenter-arrow';
  let arrow = true;
  try { arrow = localStorage.getItem(ARROW_KEY) !== '0'; } catch { /* нет хранилища */ }
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
      ${new URLSearchParams(location.search).get('remote') ? `<button class="ibtn" id="wake" type="button" aria-pressed="false" aria-label="Не гасить экран" title="Не гасить экран телефона, пока открыт пульт">${icon('eye')}</button>` : ''}
      ${new URLSearchParams(location.search).get('remote') && document.fullscreenEnabled ? `<button class="ibtn" id="pfs" type="button" aria-pressed="false" aria-label="Во весь экран" title="Во весь экран: без адресной строки браузера">${icon('fullscreen')}</button>` : ''}
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
        ${new URLSearchParams(location.search).get('remote') ? `<button type="button" class="pd-btn" id="eco" aria-pressed="true" title="Экономный режим: слайд на паузе, касание — оживить" aria-label="Экономный режим">${icon('pause')}</button>` : ''}
        <span class="pd-mir">
          <button type="button" class="pd-btn pd-more" id="tmir" aria-pressed="true" aria-haspopup="menu" title="Мышь и 3D у зрителей (M): курсор, наведение и поворот моделей повторяются в окне показа. Удерживайте — настройки" aria-label="Мышь и 3D у зрителей">${icon('cursor')}</button>
          <span class="pd-menu" id="mirmenu" role="menu" hidden>
            <button type="button" role="menuitemcheckbox" data-mir="all">Мышь и 3D у зрителей<small>наведение, щелчки, поворот моделей</small></button>
            <button type="button" role="menuitemcheckbox" data-mir="arrow">Показывать курсор<small>без него наведение работает, стрелки не видно (K)</small></button>
          </span>
        </span>
        ${new URLSearchParams(location.search).get('remote') ? '' : `<button type="button" class="pd-btn" id="trmt" title="Пульт с телефона (R): QR здесь, у докладчика — зал его не видит" aria-label="Пульт с телефона">${icon('phone')}</button>`}
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
          <span class="pres-jot-st" id="jotst" role="status" aria-live="polite"></span>
          <span><button class="ibtn small" id="ned" type="button" aria-pressed="false" aria-label="Править заметки" title="Править заметки (E)">${icon('pencil')}</button><button class="ibtn small" id="fm" type="button" aria-label="Мельче">A−</button><button class="ibtn small" id="fp" type="button" aria-label="Крупнее">A+</button></span>
        </div>
        <div class="pres-notes" id="notes"></div>
        <textarea class="pres-notes pres-notes-ed" id="notesed" spellcheck="true" hidden aria-label="Заметки слайда"></textarea>
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
  // Телефон-пульт (по QR из окна показа): то же окно докладчика, связь — через сервер показа
  const room = new URLSearchParams(location.search).get('remote');
  if (room) document.body.classList.add('pres-phone');
  const sync = new Sync(deckKey, (room ? 'r-' : 'p-') + Math.random().toString(36).slice(2, 10));
  // Окно показа, за которым следует это окно; без параметра — первое ответившее
  let mainId = new URLSearchParams(location.search).get('main');
  const toMain = () => mainId ?? undefined;
  let index = -1;
  let black = false;
  /** Когда окно показа последний раз ответило */
  let lastState = 0;

  // --- указка, перо и маркер: рисунок виден и здесь, и у зрителей ---
  const ink = new Ink(view.stage);
  let tool: InkTool = 'none';
  let penColor = PEN_COLORS[0];
  const sendInk = (m: InkMsg) => sync.send({ type: 'ink', ink: m }, toMain());
  // «Крупнее» у зрителей (+ − 0)
  const zoom = (step: 1 | -1 | 0) => sync.send({ type: 'zoom', step }, toMain());
  // Повтор мыши и живые 3D-модели для зрителей: можно выключить, если на слайдах нет
  // наведений и моделей — тогда окна ничего лишнего не пересылают и не рисуют
  inkInput(cur, ink, () => tool, (): StrokeStyle => ({ color: penColor, width: 5 }), sendInk, () => mirror, () => arrow);
  // Вставки и песочница при повторе не забирают мышь и палец себе (иначе зрители их не видят):
  // окно докладчика получает их само и передаёт документу в рамке — здесь и у зрителей
  let ptrFrame: HTMLIFrameElement | null = null;
  // Как у зрителей: движение — всегда, нажатие — только щелчком (ведение пальцем ничего не жмёт)
  const toFrame = (e: MouseEvent, click = false) => {
    if (!mirror || tool !== 'none') return;
    const f = frameAt(cur, e.clientX, e.clientY);
    if (ptrFrame && ptrFrame !== f && ptrFrame.isConnected) postPointer(ptrFrame, 'leave');
    ptrFrame = f;
    if (!f) return;
    if (click) {
      postPointer(f, 'down', e.clientX, e.clientY, 1);
      postPointer(f, 'up', e.clientX, e.clientY);
    } else postPointer(f, 'move', e.clientX, e.clientY, e.buttons);
  };
  cur.addEventListener('pointermove', (e) => toFrame(e));
  cur.addEventListener('click', (e) => toFrame(e, true));
  cur.addEventListener('pointerleave', () => {
    if (ptrFrame?.isConnected) postPointer(ptrFrame, 'leave');
    ptrFrame = null;
  });
  window.addEventListener(CAMERA, (e) => {
    if (mirror) sync.send({ type: 'camera', ...(e as CustomEvent<CameraState>).detail }, toMain());
  });
  function syncMirUi(): void {
    $('tmir').classList.toggle('pd-noarrow', mirror && !arrow);
    cur.toggleAttribute('data-mirror', mirror);
    document.querySelectorAll<HTMLElement>('#mirmenu [data-mir]').forEach((b) =>
      b.setAttribute('aria-checked', String(b.dataset.mir === 'all' ? mirror : arrow)));
  }
  function setArrow(on: boolean): void {
    arrow = on;
    try { localStorage.setItem(ARROW_KEY, on ? '1' : '0'); } catch { /* нет хранилища */ }
    if (!on) sendInk({ op: 'cursor-off' });
    // Включили стрелку при выключенном повторе — включается и повтор: иначе её некому показывать
    if (on && !mirror) setMirror(true);
    else syncMirUi();
  }
  function setMirror(on: boolean): void {
    mirror = on;
    try { localStorage.setItem(MIRROR_KEY, on ? '1' : '0'); } catch { /* нет хранилища */ }
    $('tmir').setAttribute('aria-pressed', String(on));
    syncMirUi();
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
    if (tool !== 'none') sendInk({ op: 'cursor-off' });
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

  // --- экономный режим (телефон-пульт): слайд на паузе, касание оживляет на несколько секунд ---
  const ECO_KEY = 'slideria-remote-eco';
  let eco = false;
  if (room) {
    eco = true;
    try { eco = localStorage.getItem(ECO_KEY) !== '0'; } catch { /* нет хранилища */ }
  }
  let ecoTimer = 0;
  function settle(ms: number): void {
    clearTimeout(ecoTimer);
    view.setPaused(false);
    if (eco) ecoTimer = window.setTimeout(() => view.setPaused(true), ms);
  }
  const ecoBtn = document.getElementById('eco');
  const setEco = (on: boolean) => {
    eco = on;
    ecoBtn?.setAttribute('aria-pressed', String(on));
    try { localStorage.setItem(ECO_KEY, on ? '1' : '0'); } catch { /* нет хранилища */ }
    settle(on ? 1500 : 0);
  };
  ecoBtn?.addEventListener('click', () => setEco(!eco));
  // Коснулись слайда (кнопка, вкладка, ползунок, код) — он живой ещё 8 секунд после последнего касания
  ['pointerdown', 'input', 'keydown'].forEach((t) => cur.addEventListener(t, () => { if (eco) settle(8000); }, true));

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
    lay.ph = Math.max(40, Math.min(100, lay.ph));
    pres.style.setProperty('--pw', `${lay.pw}%`);
    pres.style.setProperty('--ph', `${lay.ph}%`);
    pres.style.setProperty('--nh', `${lay.nh}%`);
    $('sv').setAttribute('aria-valuenow', String(Math.round(lay.pw)));
    $('sh').setAttribute('aria-valuenow', String(Math.round(lay.nh)));
    if (save) try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(lay)); } catch { /* нет доступа */ }
  };
  applyLayout(false);
  // На телефоне граница под слайдом горизонтальная: тянут вверх — слайд меньше, заметкам больше места
  const phone = matchMedia('(max-width: 640px)');
  function splitter(el: HTMLElement, axis: 'pw' | 'nh', box: () => DOMRect): void {
    const ax = () => (axis === 'pw' && phone.matches ? 'ph' : axis);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pres.classList.add('resizing');
      let last = e.clientY;
      const move = (ev: PointerEvent) => {
        const r = box();
        if (ax() === 'ph') {
          // Слайд меняет высоту вслед за пальцем, ширина — по 16:9
          lay.ph += (((ev.clientY - last) * 16) / 9 / r.width) * 100;
          last = ev.clientY;
        } else lay[axis] = axis === 'pw' ? ((ev.clientX - r.left) / r.width) * 100 : ((ev.clientY - r.top) / r.height) * 100;
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
    el.addEventListener('dblclick', () => {
      lay[ax()] = DEFAULT_LAYOUT[ax()];
      applyLayout();
    });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -2, ArrowUp: -2, ArrowRight: 2, ArrowDown: 2 }[e.key];
      if (d === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      lay[ax()] += d;
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

  // Пульт с телефона: QR — здесь, у докладчика. Телефон управляет окном показа, поэтому
  // комнату пульта открывает оно (remote-start → remote-room), а сюда приходит её код
  const phoneCbs: (() => void)[] = [];
  let roomWait: ((room: string | null) => void) | null = null;
  const askRoom = () => new Promise<string | null>((resolve) => {
    if (!mainId) return resolve(null);
    const t = window.setTimeout(() => { roomWait = null; resolve(null); }, 3000);
    roomWait = (r) => { clearTimeout(t); roomWait = null; resolve(r); };
    sync.send({ type: 'remote-start' }, toMain());
  });
  const openRemote = () => {
    if (room) return;
    void import('./remote').then((m) => m.openRemoteDialog({ deckKey, main: mainId ?? '', room: askRoom, onPhone: (cb) => phoneCbs.push(cb) }));
  };
  document.getElementById('trmt')?.addEventListener('click', openRemote);
  $('pgx').addEventListener('click', closeGrid);
  grid.addEventListener('click', (e) => { if (e.target === grid) closeGrid(); });

  // --- заметки ---
  // На телефоне-пульте заметки на ступень мельче, и размер запоминается отдельно от компьютера
  const fontKey = room ? `${FONT_KEY}-phone` : FONT_KEY;
  const fontDef = room ? 18 : 20;
  let fontSize = fontDef;
  try { fontSize = Number(localStorage.getItem(fontKey)) || fontDef; } catch { /* нет доступа */ }
  const applyFont = () => {
    $('notes').style.fontSize = `${fontSize}px`;
    try { localStorage.setItem(fontKey, String(fontSize)); } catch { /* нет доступа */ }
  };
  applyFont();
  $('fm').addEventListener('click', () => { fontSize = Math.max(12, fontSize - 2); applyFont(); });
  $('fp').addEventListener('click', () => { fontSize = Math.min(48, fontSize + 2); applyFont(); });

  function render(i: number): void {
    const was = index;
    index = Math.max(0, Math.min(count() - 1, i));
    if (index !== was) ink.apply({ op: 'clear' });
    view.show(index);
    // Экономный режим: появление слайда доигрывает, потом сцена замирает
    settle(1800);
    const s = deck.slides[index];
    // Скрытые слайды пропускаются: счёт, «следующий» и стрелки — по видимым
    const { pos, total } = visiblePos(deck, index);
    $('curl').textContent = `Слайд ${pos} из ${total} · ${slideLabel(s, index)}`;
    $('ct').textContent = `${pos} / ${total}`;
    const next = $('next');
    next.innerHTML = '';
    const after = stepVisible(deck, index, 1);
    if (after >= 0) {
      const box = staticSlide(deck, after);
      next.appendChild(box);
      next.insertAdjacentHTML('beforeend', `<div class="mu">${esc(slideLabel(deck.slides[after], after))}</div>`);
      fitNext();
    } else {
      next.innerHTML = '<div class="pres-end">Конец презентации</div>';
    }
    $('notes').innerHTML = s.notes ? t(s.notes) : '<span class="mu">Заметок нет</span>';
    $('pv').toggleAttribute('disabled', stepVisible(deck, index, -1) < 0);
    $('nx').toggleAttribute('disabled', after < 0);
  }

  function go(i: number): void {
    const target = landOn(deck, i, index);
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

  // --- свайп по заметкам (телефон): содержимое едет за пальцем, дальше трети или резкий взмах —
  // соседний слайд, иначе пружинит назад; на первом и последнем — «резиновый» упор.
  // Слайд и инструменты свайпом не листаются: там указка, перо и живые объекты
  const side = $('pside');
  if (room || matchMedia('(pointer: coarse)').matches) {
    side.classList.add('pres-swipe');
    let sx = 0, sy = 0, dx = 0, id = -1;
    // Последние точки жеста: скорость взмаха — по ним, а не по всему жесту
    let trail: { x: number; t: number }[] = [];
    let mode: 'wait' | 'drag' | 'off' = 'off';
    const move = (x: number, ms = 0, ease = 'cubic-bezier(.2, .8, .2, 1)') => {
      side.style.transition = ms ? `transform ${ms}ms ${ease}, opacity ${ms}ms ${ease}` : 'none';
      side.style.transform = x ? `translateX(${x}px)` : '';
    };
    side.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || editing >= 0 || (e.target as Element).closest('button, textarea, input')) return;
      sx = e.clientX; sy = e.clientY; dx = 0; id = e.pointerId; mode = 'wait';
      trail = [{ x: e.clientX, t: performance.now() }];
    });
    side.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id || mode === 'off') return;
      const mx = e.clientX - sx;
      const my = e.clientY - sy;
      if (mode === 'wait') {
        // Только явно горизонтальный жест: вертикальная прокрутка заметок остаётся прокруткой
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { mode = 'off'; return; }
        if (Math.abs(mx) < 10) return;
        mode = 'drag';
        side.setPointerCapture(e.pointerId);
      }
      const now = performance.now();
      trail.push({ x: e.clientX, t: now });
      while (trail.length > 2 && now - trail[0].t > 80) trail.shift();
      const edge = (mx > 0 && index === 0) || (mx < 0 && index === count() - 1);
      dx = edge ? mx * 0.25 : mx;
      move(dx);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (mode !== 'drag') { mode = 'off'; return; }
      mode = 'off';
      const w = side.clientWidth || 1;
      const a = trail[0];
      const z = trail[trail.length - 1];
      // Взмах: последние ~80 мс палец шёл быстрее 0,4 px/мс в ту же сторону
      const v = (z.x - a.x) / Math.max(1, z.t - a.t);
      const dir = dx < 0 ? 1 : -1;
      const flick = Math.sign(v) === -dir && Math.abs(v) > 0.4 && Math.abs(dx) > 30;
      const can = dir > 0 ? index < count() - 1 : index > 0;
      if (can && (Math.abs(dx) > w / 3 || flick)) {
        // Уезжает в сторону свайпа, новый слайд въезжает с противоположной
        move(-dir * w, 170, 'ease-in');
        side.style.opacity = '0';
        setTimeout(() => {
          go(index + dir);
          move(dir * w * 0.35);
          void side.offsetWidth;
          side.style.opacity = '1';
          move(0, 220);
        }, 170);
      } else {
        move(0, 260);
      }
    };
    side.addEventListener('pointerup', release);
    side.addEventListener('pointercancel', release);
  }
  $('bk').addEventListener('click', () => setBlack(!black));
  $('tmir').setAttribute('aria-pressed', String(mirror));
  syncMirUi();
  // Нажатие — повтор целиком вкл/выкл; удержание (или правая кнопка) — меню: показывать ли стрелку
  const mirMenu = $('mirmenu');
  const openMir = (open: boolean) => { mirMenu.hidden = !open; $('tmir').setAttribute('aria-expanded', String(open)); };
  let holdTimer = 0;
  let held = false;
  $('tmir').addEventListener('pointerdown', () => {
    held = false;
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => { held = true; openMir(true); }, 450);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('tmir').addEventListener(ev, () => clearTimeout(holdTimer));
  $('tmir').addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(holdTimer); held = true; openMir(true); });
  $('tmir').addEventListener('click', () => {
    if (held) { held = false; return; }
    setMirror(!mirror);
  });
  mirMenu.addEventListener('click', (e) => {
    const which = (e.target as Element).closest<HTMLElement>('[data-mir]')?.dataset.mir;
    if (which === 'all') setMirror(!mirror);
    else if (which === 'arrow') setArrow(!arrow);
    openMir(false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!mirMenu.hidden && !(e.target as Element).closest('.pd-mir')) openMir(false);
  }, true);
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
    if (k === 'Escape' && view.spotted) {
      e.preventDefault();
      view.spot(null);
      sync.send({ type: 'spot', index, key: null }, toMain());
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
      k: () => setArrow(!arrow), 'л': () => setArrow(!arrow),
      d: () => setTool('pen'), 'в': () => setTool('pen'),
      c: () => clearInk(), 'с': () => clearInk(),
      g: openGrid, 'п': openGrid,
      r: openRemote, 'к': openRemote,
      m: () => setMirror(!mirror), 'ь': () => setMirror(!mirror),
      e: editNotes, 'у': editNotes,
      '+': () => zoom(1), '=': () => zoom(1), '-': () => zoom(-1), '0': () => zoom(0),
      escape: () => { if (!mirMenu.hidden) openMir(false); else if (tool !== 'none') setTool(tool); },
    };
    const fn = map[k] ?? letters[lower];
    if (fn) { e.preventDefault(); fn(); }
  });

  // Объекты-кнопки: щелчок при показе — переход к слайду или ссылка (в режиме правки — обычный объект)
  view.stage.addEventListener('click', (e) => {
    // Указка или перо: щелчок рисует, а не нажимает
    if (tool !== 'none') return;
    const t = e.target as Element;
    const el = t.closest<HTMLElement>('.slide.on > .free[data-action]');
    if (!el || t.closest('input, textarea, button, a, video, model-viewer')) {
      // Прожектор: щелчок по блоку здесь — и у зрителей
      const slide = t.closest<HTMLElement>('.slide.on');
      const key = slide ? DeckView.spotKey(t, slide) : null;
      if (key === null || (!key && !view.spotted)) return;
      const next = key && key !== view.spotted ? key : null;
      view.spot(next);
      sync.send({ type: 'spot', index, key: next }, toMain());
      return;
    }
    // Показать / скрыть объекты слайда — здесь и во втором окне
    if (view.trigger(index, el.dataset.action!)) {
      e.stopPropagation();
      sync.send({ type: 'trigger', index, action: el.dataset.action! }, toMain());
      return;
    }
    const to = actionTarget(el.dataset.action!, deck, index);
    if (!to) return;
    e.preventDefault();
    e.stopPropagation();
    if ('slide' in to) go(to.slide);
    else window.open(to.url, '_blank', 'noopener');
  });
  view.stage.addEventListener('slideria:code', (e) => {
    const el = e.target as HTMLElement;
    const i = Number(el.closest<HTMLElement>('.slide')?.dataset.index);
    const { code, run } = (e as CustomEvent<{ code: string; run?: boolean }>).detail ?? {};
    if (Number.isInteger(i) && el.dataset.block && typeof code === 'string') sync.send({ type: 'code', index: i, block: el.dataset.block, code, ...(run ? { run } : {}) }, toMain());
  });
  addEventListener('slideria:vars', (e) => {
    const d = (e as CustomEvent<{ index: number; vars: Record<string, number> }>).detail;
    sync.send({ type: 'vars', index: d.index, vars: d.vars }, toMain());
  });
  sync.on((m, from) => {
    if (m.type === 'vars') {
      if (!mainId || from === mainId) view.setVars(m.index, m.vars);
      return;
    }
    if (m.type === 'remote-room') {
      if (from === mainId) roomWait?.(m.room);
      return;
    }
    if (m.type === 'remote-phone') {
      phoneCbs.splice(0).forEach((cb) => cb());
      return;
    }
    if (m.type === 'trigger') {
      if (!mainId || from === mainId) view.trigger(m.index, m.action);
      return;
    }
    if (m.type === 'spot') {
      if ((!mainId || from === mainId) && m.index === index) view.spot(m.key);
      return;
    }
    if (m.type === 'code') {
      if (!mainId || from === mainId) view.setCode(m.index, m.block, m.code, m.run);
      return;
    }
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
      lastState = Date.now();
      $('link').textContent = 'Связь с окном показа есть';
      $('link').classList.add('ok');
      if (m.index !== index) render(m.index);
      if (m.theme !== currentTheme()) { remoteTheme = true; setTheme(m.theme, false); remoteTheme = false; }
      if (m.black !== black) setBlack(m.black, false);
    }
  });

  const lost = room
    ? 'Нет связи с показом: отсканируйте QR заново (клавиша R в окне показа)'
    : 'Окно показа не отвечает: листайте здесь';
  $('link').textContent = lost;
  const m = /^#(\d+)$/.exec(location.hash);
  render(m ? parseInt(m[1], 10) - 1 : 0);
  if (room) {
    const onLink = (ok: boolean | 'revoked') => {
      if (ok === 'revoked') return phoneEnded();
      if (ok) sync.send({ type: 'hello' }, toMain());
      phoneLink(ok);
    };
    sync.relay(room, onLink);
    retryLink = () => { phoneLink(false, true); sync.reconnect(room, onLink); sync.send({ type: 'hello' }, toMain()); };
    setupWake();
    setupFullscreen();
  }
  sync.send({ type: 'hello' }, toMain());
  // Если основное окно перезагрузили, оно снова найдёт это окно по регулярному «привет»;
  // ответа нет дольше трёх «привет» — связь потеряна, и это видно
  // В экономном режиме «привет» реже: телефон меньше просыпается ради сети
  const beat = () => {
    sync.send({ type: 'hello' }, toMain());
    if (lastState && Date.now() - lastState > (eco ? 25000 : 10000)) {
      $('link').textContent = lost;
      $('link').classList.remove('ok');
      if (room) phoneLink(false);
    } else if (room && lastState) phoneLink(true);
    setTimeout(beat, eco ? 10000 : 3000);
  };
  setTimeout(beat, 3000);
}

// ------------------------------------------------------------------ телефон-пульт: связь и экран

let lostTimer = 0;
/** «Подключиться сейчас»: переподключение потока событий (задаёт окно докладчика на телефоне) */
let retryLink: (() => void) | null = null;
/**
 * Связь телефона с показом. Пропала — через несколько секунд (не мигать на каждом сбое Wi-Fi)
 * плашка поверх кнопок: что происходит и «Подключиться сейчас». Заметки при этом остаются видны.
 */
function phoneLink(ok: boolean, retrying = false): void {
  let el = document.getElementById('plost');
  if (ok) {
    clearTimeout(lostTimer);
    lostTimer = 0;
    el?.remove();
    return;
  }
  const show = () => {
    el = document.getElementById('plost');
    if (!el) {
      el = document.createElement('div');
      el.id = 'plost';
      el.className = 'pres-lost';
      el.setAttribute('role', 'alert');
      el.innerHTML = `<b>Связь с показом пропала</b><span class="pl-try">Пробуем подключиться снова…</span>
        <ul><li>Телефон в той же Wi-Fi, что и компьютер?</li><li>Показ открыт, компьютер не уснул?</li></ul>
        <button type="button" class="btn primary" id="plost-go">${icon('reset')} Подключиться сейчас</button>`;
      document.body.appendChild(el);
      el.querySelector('#plost-go')!.addEventListener('click', () => retryLink?.());
    }
    if (retrying) el.querySelector('.pl-try')!.textContent = 'Подключаюсь…';
  };
  if (retrying || document.getElementById('plost')) show();
  else if (!lostTimer) lostTimer = window.setTimeout(show, 4000);
}

/**
 * Телефон отключили на компьютере (или показ закрыт): уходим на страницу-объяснение сервера —
 * скрипт пульта останавливается, заметки и слайды с этого телефона больше не видны
 */
function phoneEnded(): void {
  clearTimeout(lostTimer);
  location.replace(`${RELAY}ended`);
}

/** «Не гасить экран»: телефон не засыпает, пока открыт пульт. Включается кнопкой в шапке */
function setupWake(): void {
  const btn = document.getElementById('wake');
  if (!btn) return;
  let ns: { enable(): Promise<void>; disable(): void; isEnabled: boolean } | null = null;
  btn.addEventListener('click', async () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    try {
      // Нужен именно щелчок: браузер разрешает это только по действию человека
      if (!ns) ns = new (await import('nosleep.js')).default();
      if (on) await ns.enable();
      else ns.disable();
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? 'Экран не гаснет — нажмите, чтобы снова гас как обычно' : 'Не гасить экран телефона, пока открыт пульт';
    } catch {
      btn.title = 'Этот браузер не дал удержать экран — увеличьте время отключения экрана в настройках телефона';
    }
  });
}

/**
 * «Во весь экран» на телефоне: без адресной строки, как F11. Значок есть только там, где браузер
 * это умеет (Android, iPad); на iPhone страницу так развернуть нельзя — значка нет
 */
function setupFullscreen(): void {
  const btn = document.getElementById('pfs');
  if (!btn) return;
  const sync = () => btn.setAttribute('aria-pressed', String(!!document.fullscreenElement));
  document.addEventListener('fullscreenchange', sync);
  btn.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  });
}
