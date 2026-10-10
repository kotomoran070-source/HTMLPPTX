import { icon } from '../components/icons';
import { isHidden, landOn, stepVisible, visiblePos } from './hidden';
import type { Deck } from '../types';
import { applyAccent, applyAccentFlow } from './accent';
import { updateFavicon } from './brand';
import { DeckView, staticSlide } from './deck-view';
import { Editor, SLIDE_PRESETS } from './editor/editor';
import { canSaveFile } from './editor/persist';
import { esc } from './html';
import { actionTarget, slideLabel } from './render';
import { Ink } from './ink';
import { RemoteHover } from './remote-hover';
import { forwardCovered } from './frame-bridge';
import { CAMERA_SET } from '../components/media/model';
import { printDeck, setupPrint } from './print';
import { fullscreenOn, planScreens, popupOn, screensGranted } from './screens';
import { Sync } from './sync';
import { currentTheme, onThemeChange, setTheme, toggleTheme } from './theme';
import { themeMode } from './deck-theme';

const NAV_H = 56;

export function presenterUrl(mainId: string): string {
  const u = new URL(location.href);
  u.searchParams.set('view', 'presenter');
  // Окно докладчика привязано к этому окну показа
  u.searchParams.set('main', mainId);
  return u.toString();
}

export { updateFavicon };

/** Основное окно показа: сцена, навигация, обзор, режим правки, связь с окном докладчика. */
export function startShow(deck: Deck, deckKey: string, devServer: boolean): void {
  const count = () => deck.slides.length;
  const editable = __EDITABLE__ && (devServer || canSaveFile());
  document.body.classList.add('show');
  document.body.insertAdjacentHTML('beforeend', `
<div class="progress-top" id="pg"></div>
<div class="viewport" id="vp"></div>
<nav class="navbar" id="nav">
  <div class="navside">
    <button class="ibtn theme-btn" id="thm" type="button" aria-label="Переключить тему (T)" title="Тема (T)">${icon('sun', 'ic sun')}${icon('moon', 'ic moon')}</button>
  </div>
  <div class="navc">
    <button class="btn ghost" id="pv" type="button">Назад</button>
    <span class="mu counter" id="ct"></span>
    <button class="btn primary" id="nx" type="button">Далее</button>
  </div>
  <div class="navside r">
    ${editable ? `<button class="ibtn" id="ed-btn" type="button" aria-pressed="false" aria-label="Режим правки (E)" title="Режим правки (E)">${icon('pencil')}</button>` : ''}
    ${import.meta.env.DEV && devServer ? `<a class="ibtn" id="studio-btn" href="?deck=${encodeURIComponent(deckKey)}&amp;studio" aria-label="Открыть в редакторе (S)" title="Открыть в редакторе (S)">${icon('layers')}</a>` : ''}
    <button class="ibtn" id="ov" type="button" aria-label="Все слайды (O)" title="Все слайды (O)">${icon('grid')}</button>
    <button class="ibtn" id="pr" type="button" aria-label="Режим докладчика (P)" title="Режим докладчика (P)">${icon('presenter')}</button>
    <button class="ibtn" id="fs" type="button" aria-label="Во весь экран (F)" title="Во весь экран (F)">${icon('fullscreen')}</button>
  </div>
</nav>
<div class="ovbd" id="ovbd" role="dialog" aria-modal="true" aria-label="Все слайды">
  <div class="ovpanel">
    <div class="ovhead"><b>Все слайды</b>${import.meta.env.DEV && devServer ? `<span class="ovtools-dev"><a class="btn ghost small" href="./?all" title="Все презентации">Все презентации</a>${deck.slides.some((x) => x.template === 'canvas') ? `<button class="btn ghost small" id="ovtheme" type="button" title="Привязать цвета к теме">Цвета → тема…</button>` : ''}<button class="btn ghost small" id="ovimp" type="button" title="Импорт HTML или PowerPoint (.pptx)">Импорт…</button></span>` : ''}<button class="ibtn small" id="ovx" type="button" aria-label="Закрыть">${icon('close')}</button></div>
    <p class="mu ovedit-hint">Перетащите слайд, чтобы поменять порядок. Кнопки на миниатюре: дублировать и удалить. С клавиатуры: Alt + ← → переставить, Delete — удалить.</p>
    <div class="ovgrid" id="ovgrid"></div>
    <p class="mu ovkeys">← → пробел — листать · Home/End — в начало/конец · номер + Enter — перейти · O — обзор · P — докладчик · R — пульт с телефона · F — весь экран · T — тема · B — чёрный экран · + − — крупнее / мельче, 0 — как было${editable ? ' · E — правка' : ''}${import.meta.env.DEV && devServer ? ' · S — в редактор' : ''}</p>
  </div>
</div>
<div class="zoom-pill" id="zpill" aria-live="polite"></div>
<div class="blackout" id="blk"></div>
<div class="show-note" id="snote" role="status"><p></p><button class="btn primary small show-note-go" type="button" hidden></button><button class="ibtn small show-note-x" type="button" aria-label="Закрыть">${icon('close')}</button></div>`);

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const vp = $('vp');
  const view = new DeckView(deck, vp);
  const sync = new Sync(deckKey);
  // Пульт с телефона: окно показа слушает свою комнату и после перезагрузки
  const phones: (() => void)[] = [];
  // Комната пульта: создаётся по первой просьбе (кнопка здесь или в окне докладчика), окно начинает её слушать
  const startRemote = (m: typeof import('./remote')) => {
    const room = m.remoteRoom(deckKey, true)!;
    sync.relay(room);
    return room;
  };
  const openRemote = () => void import('./remote').then((m) => m.openRemoteDialog({ deckKey, main: sync.self, room: () => startRemote(m), onPhone: (cb) => phones.push(cb) }));
  const seenPhones = new Set<string>();
  if (location.protocol !== 'file:') {
    void import('./remote').then((m) => {
      const room = m.remoteRoom(deckKey);
      if (room) sync.relay(room);
    });
  }
  const ink = new Ink(view.stage);
  // Мышь докладчика над слайдом: курсор и наведение у зрителей
  const hover = new RemoteHover(view.stage);
  // Своя мышь — и во вставку под другими объектами (фон-анимация под текстом)
  forwardCovered(view.stage, () => document.body.classList.contains('editing'));
  let index = 0;
  let black = false;
  let editor: Editor | null = null;
  // «Крупнее» (+ − 0, Ctrl + − 0): на каждом слайде содержимое крупнее, но целиком в окне —
  // за край уходят только пустые поля. cap — насколько крупнее можно (1 — как на слайде).
  // Запоминается в этом браузере: зал и экран те же — и в следующий раз так же
  const BIG_KEY = 'slideria.show.big';
  const CAPS = [1, 1.1, 1.2, 1.3, 1.4, 1.5];
  let cap = 1;
  try { cap = CAPS.find((c) => c === Number(localStorage.getItem(BIG_KEY))) ?? 1; } catch { /* без хранилища */ }
  /** Масштаб для текущего слайда; в режиме правки слайд целиком */
  function applyBig(smooth = false): void {
    if (cap > 1 && !editor?.active) view.fitContent(index, cap, smooth);
    else view.resetZoom(smooth);
  }

  const fit = () => {
    const full = document.body.classList.contains('fs');
    const navH = full ? 0 : NAV_H;
    const ins = editor?.insets() ?? { top: 0, bottom: 0 };
    const h = innerHeight - navH - ins.top - ins.bottom;
    view.fit(innerWidth, h, ins.top / 2 - (navH + ins.bottom) / 2);
    // Окно другое (или включили правку) — содержимое вписывается заново
    applyBig();
  };
  addEventListener('resize', fit);
  fit();

  const broadcast = () => sync.send({ type: 'state', index, theme: currentTheme(), black });
  let deckTimer = 0;
  const broadcastDeck = () => {
    clearTimeout(deckTimer);
    deckTimer = window.setTimeout(() => sync.send({ type: 'deck', deck: JSON.parse(JSON.stringify(deck)) }), 250);
  };

  /** Скрытые слайды пропускаются при показе; в правке видны все */
  const skip = () => !editor?.active;
  function updateChrome(): void {
    const { pos, total } = skip() ? visiblePos(deck, index) : { pos: index + 1, total: count() };
    $('ct').textContent = `${pos} из ${total}`;
    const more = (dir: 1 | -1) => (skip() ? stepVisible(deck, index, dir) >= 0 : dir > 0 ? index < count() - 1 : index > 0);
    $('nx').style.visibility = more(1) ? 'visible' : 'hidden';
    $('pv').style.visibility = more(-1) ? 'visible' : 'hidden';
    $('pg').style.width = `${(pos / total) * 100}%`;
  }

  function go(i: number, push = true): void {
    const at = Math.max(0, Math.min(count() - 1, i));
    const next = skip() ? landOn(deck, at, view.index) : at;
    const changed = next !== index || view.index !== next;
    index = next;
    view.show(index);
    updateChrome();
    // Просили скрытый слайд — в адресе тот, что на самом деле показан
    if ((push || next !== at) && changed) history.replaceState(null, '', `#${index + 1}`);
    if (changed) {
      ink.apply({ op: 'clear' });
      hover.off();
      // «Крупнее» — по содержимому нового слайда
      if (cap > 1) {
        applyBig();
        refitSoon();
      }
      broadcast();
      editor?.onSlideChange();
      if (ovOpen()) markCurrent();
    }
  }

  // --- обзор ---
  const ovbd = $('ovbd');
  const ovgrid = $('ovgrid');
  let ovBuilt = false;
  let ovCards: HTMLElement[] = [];
  let dragFrom = -1;

  function buildOverview(): void {
    ovgrid.innerHTML = '';
    ovCards = deck.slides.map((s, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `ovcard${isHidden(deck, i) ? ' is-hidden' : ''}`;
      card.appendChild(staticSlide(deck, i));
      card.insertAdjacentHTML('beforeend', `<span class="ovmeta"><span class="ovnum">${i + 1}</span><span class="ovttl">${esc(slideLabel(s, i))}</span></span>`
        + `<span class="ovtools"><span data-a="dup" title="Дублировать слайд" role="button" aria-label="Дублировать слайд">${icon('copy')}</span>`
        + `<span data-a="del" class="danger" title="Удалить слайд" role="button" aria-label="Удалить слайд">${icon('trash')}</span></span>`);
      card.addEventListener('click', (e) => {
        const a = (e.target as Element).closest<HTMLElement>('[data-a]')?.dataset.a;
        if (a === 'dup' && editor?.active) return editor.duplicateSlide(i);
        if (a === 'del' && editor?.active) return editor.deleteSlide(i);
        go(i);
        ovHide();
      });
      card.addEventListener('keydown', (e) => {
        if (!editor?.active) return;
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          e.stopPropagation();
          const to = i + (e.key === 'ArrowLeft' ? -1 : 1);
          editor.moveSlide(i, to);
          ovCards[Math.max(0, Math.min(count() - 1, to))]?.focus();
        } else if (e.key === 'Delete') {
          e.preventDefault();
          e.stopPropagation();
          editor.deleteSlide(i);
          ovCards[Math.min(i, count() - 1)]?.focus();
        }
      });
      // Перетаскивание для смены порядка
      card.draggable = !!editor?.active;
      card.addEventListener('dragstart', (e) => {
        dragFrom = i;
        card.classList.add('dragging');
        e.dataTransfer?.setData('text/plain', String(i));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        dragFrom = -1;
        ovCards.forEach((c) => c.classList.remove('dragging', 'drop-before', 'drop-after'));
      });
      card.addEventListener('dragover', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        const r = card.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        ovCards.forEach((c) => c.classList.remove('drop-before', 'drop-after'));
        card.classList.add(after ? 'drop-after' : 'drop-before');
      });
      card.addEventListener('drop', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        const r = card.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        let to = i + (after ? 1 : 0);
        if (dragFrom < to) to -= 1;
        const from = dragFrom;
        dragFrom = -1;
        editor?.moveSlide(from, to);
      });
      ovgrid.appendChild(card);
      return card;
    });
    if (editor?.active) {
      const add = document.createElement('div');
      add.className = 'ovadd';
      add.innerHTML = `<b>Новый слайд после текущего</b>` + SLIDE_PRESETS.map((p, k) =>
        `<button type="button" data-p="${k}">${icon('plus')}${esc(p.name)}</button>`).join('');
      add.addEventListener('click', (e) => {
        const k = (e.target as Element).closest<HTMLElement>('[data-p]')?.dataset.p;
        if (k === undefined) return;
        editor?.addSlide(index, Number(k));
        ovHide();
      });
      ovgrid.appendChild(add);
    }
    ovBuilt = true;
  }

  function markCurrent(): void {
    ovCards.forEach((c, i) => c.classList.toggle('cur', i === index));
  }

  function ovShow(): void {
    if (!ovBuilt) buildOverview();
    markCurrent();
    ovbd.classList.add('on');
    ovCards[index]?.focus({ preventScroll: true });
    ovCards[index]?.scrollIntoView({ block: 'nearest' });
  }
  function ovHide(): void {
    ovbd.classList.remove('on');
  }
  const ovOpen = () => ovbd.classList.contains('on');

  // --- режим правки ---
  if (editable) {
    editor = new Editor({
      deck,
      deckKey,
      stage: () => view.stage,
      index: () => index,
      go: (i) => go(i),
      refresh: (rebuild) => {
        if (rebuild) {
          view.update(deck);
          if (index > count() - 1) index = count() - 1;
          view.show(index);
          updateChrome();
          ovBuilt = false;
          if (ovOpen()) {
            const focused = ovCards.indexOf(document.activeElement as HTMLElement);
            buildOverview();
            markCurrent();
            if (focused >= 0) ovCards[Math.min(focused, ovCards.length - 1)]?.focus();
          }
        }
        updateFavicon(deck.brand?.logo);
        broadcastDeck();
      },
      relayout: () => {
        fit();
        ovBuilt = false;
        if (ovOpen()) { buildOverview(); markCurrent(); }
      },
    }, devServer);
    $('ed-btn').addEventListener('click', () => editor!.toggle());
  }
  // Перетащенный HTML-файл презентации — импорт правок в проект (только yarn dev)
  if (import.meta.env.DEV && devServer) {
    void import('./import-ui').then((m) => {
      const ui = m.setupImport({ current: deckKey, beforeImport: () => editor?.settle() });
      $('ovimp').onclick = () => { ovHide(); ui.pick(); };
      const th = document.getElementById('ovtheme');
      if (th) th.onclick = () => { ovHide(); void m.bindThemeDialog(deckKey, () => editor?.settle()); };
    });
  }

  // --- чёрный экран ---
  function setBlack(v: boolean): void {
    black = v;
    $('blk').classList.toggle('on', v);
    broadcast();
  }

  // --- полноэкранный режим ---
  function toggleFullscreen(): void {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => {
    document.body.classList.toggle('fs', !!document.fullscreenElement);
    fit();
  });
  let peekTimer = 0;
  addEventListener('mousemove', (e) => {
    // Мышь докладчика, повторённая здесь (RemoteHover), панель показа не выдвигает
    if (!e.isTrusted || !document.body.classList.contains('fs')) return;
    if (e.clientY > innerHeight - 90) {
      document.body.classList.add('peek');
      clearTimeout(peekTimer);
      peekTimer = window.setTimeout(() => document.body.classList.remove('peek'), 2000);
    }
  });

  // --- окно докладчика ---
  /**
   * Два экрана: это окно уходит во весь экран на проектор, окно докладчика открывается
   * на весь экран здесь. Один экран — окно докладчика рядом и подсказка, что сделать.
   */
  let opening = false;
  async function openPresenter(): Promise<void> {
    if (opening) return;
    opening = true;
    try {
      hideNote();
      const url = presenterUrl(sync.self);
      const name = `htmlpptx-presenter-${deckKey}-${sync.self}`;
      const asked = !(await screensGranted());
      const plan = await planScreens();
      if (plan.kind === 'two') {
        try {
          await fullscreenOn(plan.audience);
        } catch {
          // После вопроса о разрешении браузер уже не считает это нажатием пользователя: нужен ещё один клик
          if (asked) return showNote('Разрешение получено.', 'Начать показ', () => void openPresenter());
          return showNote('Не удалось открыть показ на втором экране. Перенесите окно на проектор и нажмите F.');
        }
        const w = window.open(url, name, popupOn(plan.here));
        if (w) sync.addPeer(w);
        else showNote('Браузер заблокировал окно докладчика. Разрешите всплывающие окна и нажмите P.');
        return;
      }
      const w = window.open(url, name, 'popup,width=1280,height=800');
      if (w) sync.addPeer(w);
      if (plan.kind === 'single') {
        showNote('Второй экран не найден. Включите режим «Расширить» (Win+P), чтобы показ открылся на проекторе.');
      } else {
        showNote('Перенесите окно показа на проектор и нажмите F.');
      }
    } finally {
      opening = false;
    }
  }

  // --- подсказка внизу экрана ---
  let noteTimer = 0;
  function showNote(text: string, action?: string, run?: () => void): void {
    const el = $('snote');
    el.querySelector('p')!.textContent = text;
    const b = el.querySelector<HTMLButtonElement>('.show-note-go')!;
    b.hidden = !action;
    b.textContent = action ?? '';
    b.onclick = run ? () => { hideNote(); run(); } : null;
    el.classList.add('on');
    clearTimeout(noteTimer);
    if (!action) noteTimer = window.setTimeout(hideNote, 12000);
  }
  function hideNote(): void {
    $('snote').classList.remove('on');
  }
  $('snote').querySelector('.show-note-x')!.addEventListener('click', hideNote);
  // Из редактора: «Экспорт → PDF» — окно печати, когда слайды и шрифты готовы
  setupPrint(() => deck);
  if (new URLSearchParams(location.search).has('print')) {
    const u = new URL(location.href);
    u.searchParams.delete('print');
    history.replaceState(history.state, '', u);
    void printDeck(deck);
  }
  // Из редактора: «Режим докладчика» — показ ждёт одного нажатия, чтобы занять второй экран
  if (new URLSearchParams(location.search).has('present')) {
    const u = new URL(location.href);
    u.searchParams.delete('present');
    history.replaceState(history.state, '', u);
    showNote('Показ откроется на втором экране, заметки — на этом.', 'Начать показ', () => void openPresenter());
  }

  // --- кнопки ---
  const studioBtn = document.getElementById('studio-btn');
  /**
   * В редактор на этом слайде. Показ открыт из редактора и в нём ничего не правили — окно
   * показа закрывается, редактор переходит к слайду; иначе редактор открывается здесь.
   */
  async function openStudio(): Promise<void> {
    await editor?.settle();
    const studio = window.opener as Window | null;
    try {
      const q = studio && !studio.closed ? new URLSearchParams(studio.location.search) : null;
      if (q?.has('studio') && q.get('deck') === new URLSearchParams(location.search).get('deck') && !editor?.touched) {
        studio!.location.hash = `#${index + 1}`;
        studio!.focus();
        window.close();
        if (window.closed) return;
      }
    } catch { /* окно с другого адреса */ }
    location.href = `?deck=${encodeURIComponent(deckKey)}&studio#${index + 1}`;
  }
  studioBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    void openStudio();
  });

  // --- «Крупнее» ---
  let pillTimer = 0;
  function pill(text: string): void {
    const el = $('zpill');
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(pillTimer);
    pillTimer = window.setTimeout(() => el.classList.remove('on'), 1400);
  }
  let refitTimer = 0;
  /** Шрифты и картинки догружаются — содержимое могло вырасти: ещё раз чуть позже */
  function refitSoon(): void {
    clearTimeout(refitTimer);
    const at = index;
    refitTimer = window.setTimeout(() => { if (cap > 1 && at === index) applyBig(true); }, 700);
  }
  void document.fonts?.ready.then(() => { if (cap > 1) applyBig(); });
  /** Крупнее (1), мельче (-1), как на слайде (0) */
  function bigStep(step: 1 | -1 | 0, note = true): void {
    if (editor?.active) return;
    const k = CAPS.indexOf(cap);
    cap = step === 0 ? 1 : CAPS[Math.max(0, Math.min(CAPS.length - 1, k + step))];
    try { localStorage.setItem(BIG_KEY, String(cap)); } catch { /* без хранилища */ }
    applyBig(true);
    if (!note) return;
    if (cap === 1) return pill('Как на слайде');
    // Слайд и так заполнен до краёв — так и сказать, а то кажется, что не сработало
    pill(`Крупнее · ${Math.round(cap * 100)} %${view.zoom === 1 ? ' · этот слайд и так во всё окно' : ''}`);
  }
  // Ctrl + колесо и щипок на тачпаде — тоже крупнее / мельче
  let wheelSum = 0;
  vp.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || editor?.active || ovOpen()) return;
    e.preventDefault();
    wheelSum += e.deltaMode ? e.deltaY * 40 : e.deltaY;
    if (Math.abs(wheelSum) < 80) return;
    bigStep(wheelSum < 0 ? 1 : -1);
    wheelSum = 0;
  }, { passive: false });
  $('nx').addEventListener('click', () => go(index + 1));
  $('pv').addEventListener('click', () => go(index - 1));
  $('thm').addEventListener('click', () => toggleTheme());
  // Тема презентации со слайдами всегда светлыми или всегда тёмными: страница показа — в тон им,
  // переключать нечего (выбор зрителя не запоминается)
  const fixedMode = themeMode(deck.theme);
  if (fixedMode) {
    setTheme(fixedMode, false);
    // У кнопки свой display: hidden её бы не спрятал
    $('thm').style.display = 'none';
  }
  $('ov').addEventListener('click', ovShow);
  $('ovx').addEventListener('click', ovHide);
  ovbd.addEventListener('click', (e) => { if (e.target === ovbd) ovHide(); });
  $('pr').addEventListener('click', () => void openPresenter());
  $('fs').addEventListener('click', toggleFullscreen);
  $('blk').addEventListener('click', () => setBlack(false));
  onThemeChange(() => broadcast());

  // --- клавиатура ---
  let digits = '';
  let digitsTimer = 0;
  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    const typing = el?.isContentEditable || el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT';
    // Esc сначала закрывает обзор, и только потом — режим правки
    if (!typing && !(ovOpen() && e.key === 'Escape') && editor?.handleKey(e)) return;
    // Ctrl + = − 0, как масштаб страницы в браузере, — «Крупнее»
    if (!typing && !editor?.active && !ovOpen() && (e.ctrlKey || e.metaKey) && !e.altKey) {
      const c = e.code;
      const s = c === 'Equal' || c === 'NumpadAdd' ? 1 : c === 'Minus' || c === 'NumpadSubtract' ? -1 : c === 'Digit0' || c === 'Numpad0' ? 0 : null;
      if (s !== null) {
        e.preventDefault();
        return bigStep(s);
      }
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    // Esc сначала гасит прожектор
    if (k === 'Escape' && view.spotted && !ovOpen()) {
      e.preventDefault();
      view.spot(null);
      sync.send({ type: 'spot', index, key: null });
      return;
    }
    if (ovOpen()) {
      if (k === 'Escape' || k === 'o' || k === 'O' || k === 'щ' || k === 'Щ') { e.preventDefault(); ovHide(); }
      return;
    }
    // 0 сам по себе слайд не набирает — им «Крупнее» выключается
    if (k === '0' && !digits && cap > 1) {
      e.preventDefault();
      return bigStep(0);
    }
    if (/^[0-9]$/.test(k)) {
      digits += k;
      clearTimeout(digitsTimer);
      digitsTimer = window.setTimeout(() => (digits = ''), 1500);
      return;
    }
    if (k === 'Enter' && digits) {
      e.preventDefault();
      go(parseInt(digits, 10) - 1);
      digits = '';
      return;
    }
    const lower = k.toLowerCase();
    const act: Record<string, () => void> = {
      ArrowRight: () => go(index + 1), ArrowDown: () => go(index + 1), PageDown: () => go(index + 1), ' ': () => go(index + 1),
      ArrowLeft: () => go(index - 1), ArrowUp: () => go(index - 1), PageUp: () => go(index - 1), Backspace: () => go(index - 1),
      Home: () => go(0), End: () => go(count() - 1),
      '+': () => bigStep(1), '=': () => bigStep(1), '-': () => bigStep(-1),
    };
    // Буквенные клавиши работают и в русской раскладке
    const letters: Record<string, () => void> = {
      f: toggleFullscreen, 'а': toggleFullscreen,
      t: () => { if (!fixedMode) toggleTheme(); }, 'е': () => { if (!fixedMode) toggleTheme(); },
      o: ovShow, 'щ': ovShow,
      p: () => void openPresenter(), 'з': () => void openPresenter(),
      r: openRemote, 'к': openRemote,
      b: () => setBlack(!black), 'и': () => setBlack(!black), '.': () => setBlack(!black),
    };
    if (editor) {
      letters.e = () => editor!.toggle();
      letters['у'] = () => editor!.toggle();
    }
    if (studioBtn) {
      letters.s = () => void openStudio();
      letters['ы'] = () => void openStudio();
    }
    const fn = act[k] ?? letters[lower];
    if (fn) {
      e.preventDefault();
      fn();
    }
  });

  // --- свайпы ---
  let tx = 0;
  let ty = 0;
  addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchend', (e) => {
    if (ovOpen() || editor?.active) return;
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) go(index + (dx < 0 ? 1 : -1));
  });

  // --- ссылка на слайд в адресе: #3 ---
  const fromHash = () => {
    const m = /^#(\d+)$/.exec(location.hash);
    return m ? parseInt(m[1], 10) - 1 : 0;
  };
  addEventListener('hashchange', () => go(fromHash(), false));

  // --- сообщения от окна докладчика ---
  // Команды принимаются только адресованные этому окну (Sync отсеивает чужие по полю to)
  // Объекты-кнопки: щелчок при показе — переход к слайду или ссылка (в режиме правки — обычный объект)
  view.stage.addEventListener('click', (e) => {
    if (document.body.classList.contains('editing')) return;
    const t = e.target as Element;
    const el = t.closest<HTMLElement>('.slide.on > .free[data-action]');
    if (!el || t.closest('input, textarea, button, a, video, model-viewer')) {
      // Прожектор: щелчок по блоку — он в светлом окне, остальное приглушено; ещё раз или мимо — снять
      const slide = t.closest<HTMLElement>('.slide.on');
      const key = slide ? DeckView.spotKey(t, slide) : null;
      if (key === null || (!key && !view.spotted)) return;
      const next = key && key !== view.spotted ? key : null;
      view.spot(next);
      sync.send({ type: 'spot', index, key: next });
      return;
    }
    // Показать / скрыть объекты слайда — здесь и во втором окне
    if (view.trigger(index, el.dataset.action!)) {
      e.stopPropagation();
      sync.send({ type: 'trigger', index, action: el.dataset.action! });
      return;
    }
    const to = actionTarget(el.dataset.action!, deck, index);
    if (!to) return;
    e.preventDefault();
    e.stopPropagation();
    if ('slide' in to) go(to.slide);
    else window.open(to.url, '_blank', 'noopener');
  });
  // Песочница: код правят здесь — докладчику
  view.stage.addEventListener('slideria:code', (e) => {
    const el = e.target as HTMLElement;
    const i = Number(el.closest<HTMLElement>('.slide')?.dataset.index);
    const { code, run } = (e as CustomEvent<{ code: string; run?: boolean }>).detail ?? {};
    if (Number.isInteger(i) && el.dataset.block && typeof code === 'string') sync.send({ type: 'code', index: i, block: el.dataset.block, code, ...(run ? { run } : {}) });
  });
  // Ползунки: здесь сдвинули — докладчику; от докладчика — сюда
  addEventListener('slideria:vars', (e) => {
    const d = (e as CustomEvent<{ index: number; vars: Record<string, number> }>).detail;
    sync.send({ type: 'vars', index: d.index, vars: d.vars });
  });
  sync.on((m, from) => {
    if (m.type === 'goto') go(m.index);
    else if (m.type === 'spot') { if (m.index === index) view.spot(m.key); }
    else if (m.type === 'zoom') bigStep(m.step, false);
    else if (m.type === 'vars') view.setVars(m.index, m.vars);
    else if (m.type === 'trigger') view.trigger(m.index, m.action);
    else if (m.type === 'code') view.setCode(m.index, m.block, m.code, m.run);
    else if (m.type === 'notes') {
      // Запись из окна докладчика: в заметки слайда, без перерисовки — у зрителей ничего не меняется
      let k = m.index;
      if (m.slide && deck.slides[k]?.id !== m.slide) k = deck.slides.findIndex((s) => s.id === m.slide);
      if (k < 0 || !deck.slides[k]) return;
      const apply = (d: Deck) => {
        if (m.notes.trim()) d.slides[k].notes = m.notes;
        else delete d.slides[k].notes;
        d.slides[k].notesEdited = true;
      };
      if (editor) editor.commit(apply, { rebuild: false, merge: `jot:${k}` });
      else apply(deck);
      sync.send({ type: 'notes-ok', id: m.id, saved: editor ? (editor.mode === 'project' ? 'auto' : 'file') : 'memory' }, from);
    } else if (m.type === 'camera') {
      const { type: _t, ...detail } = m;
      window.dispatchEvent(new CustomEvent(CAMERA_SET, { detail }));
    } else if (m.type === 'ink') {
      ink.apply(m.ink);
      if (m.ink.op === 'cursor') hover.move(m.ink.x, m.ink.y);
      else if (m.ink.op === 'cursor-off') hover.off();
      else if (m.ink.op === 'click') hover.click(m.ink.x, m.ink.y);
    }
    else if (m.type === 'hello') {
      // Подключился телефон-пульт: окно с QR сообщает и закрывается
      if (from.startsWith('r-')) {
        phones.splice(0).forEach((cb) => cb());
        // Окну докладчика, которое показывает QR, — тоже (один раз на телефон)
        if (!seenPhones.has(from)) {
          seenPhones.add(from);
          sync.send({ type: 'remote-phone' });
        }
      }
      // Новому окну докладчика — актуальные данные (с несохранёнными правками) и положение
      if (editor?.touched) sync.send({ type: 'deck', deck: JSON.parse(JSON.stringify(deck)) }, from);
      sync.send({ type: 'state', index, theme: currentTheme(), black }, from);
    } else if (m.type === 'remote-start') {
      if (location.protocol !== 'file:') void import('./remote').then((r) => sync.send({ type: 'remote-room', room: startRemote(r) }, from));
    } else if (m.type === 'theme' && !fixedMode && m.theme !== currentTheme()) setTheme(m.theme);
    else if (m.type === 'black' && m.value !== black) setBlack(m.value);
  });

  applyAccent(deck.theme?.accent, deck.theme?.accent2);

  applyAccentFlow(deck.theme?.accentFlow);
  index = -1;
  go(fromHash(), false);
}
