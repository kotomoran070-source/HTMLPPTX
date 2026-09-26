import { icon } from '../components/icons';
import type { Deck } from '../types';
import { applyAccent } from './accent';
import { DeckView, staticSlide } from './deck-view';
import { decks as allDecks } from 'virtual:decks';
import { Editor, SLIDE_PRESETS } from './editor/editor';
import { canSaveFile } from './editor/persist';
import { esc } from './html';
import { slideLabel } from './render';
import { Sync } from './sync';
import { currentTheme, onThemeChange, setTheme, toggleTheme } from './theme';

const NAV_H = 56;

export function presenterUrl(mainId: string): string {
  const u = new URL(location.href);
  u.searchParams.set('view', 'presenter');
  // Окно докладчика привязано к этому окну показа
  u.searchParams.set('main', mainId);
  return u.toString();
}

export function updateFavicon(url: string | undefined): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!url) {
    link?.remove();
    return;
  }
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (link.href !== url) link.href = url;
}

/** Основное окно показа: сцена, навигация, обзор, режим правки, связь с окном докладчика. */
export function startShow(deck: Deck, deckKey: string, devServer: boolean): void {
  const count = () => deck.slides.length;
  const editable = devServer || canSaveFile();
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
    <button class="ibtn" id="ov" type="button" aria-label="Все слайды (O)" title="Все слайды (O)">${icon('grid')}</button>
    <button class="ibtn" id="pr" type="button" aria-label="Режим докладчика (P)" title="Режим докладчика (P)">${icon('presenter')}</button>
    <button class="ibtn" id="fs" type="button" aria-label="Во весь экран (F)" title="Во весь экран (F)">${icon('fullscreen')}</button>
  </div>
</nav>
<div class="ovbd" id="ovbd" role="dialog" aria-modal="true" aria-label="Все слайды">
  <div class="ovpanel">
    <div class="ovhead"><b>Все слайды</b>${import.meta.env.DEV && devServer ? `<span class="ovtools-dev">${Object.keys(allDecks).length > 1 ? `<a class="btn ghost small" href="./" title="Страница выбора презентации">Все презентации</a>` : ''}${deck.slides.some((x) => x.template === 'canvas') ? `<button class="btn ghost small" id="ovtheme" type="button" title="Цвета импортированной вёрстки → цвета темы: заработают тёмная тема и смена акцента">Цвета → тема…</button>` : ''}<button class="btn ghost small" id="ovimp" type="button" title="Импорт HTML: Claude Design, свой HTML по правилам или правки из собранного файла (можно перетащить файл на страницу)">Импорт HTML…</button></span>` : ''}<button class="ibtn small" id="ovx" type="button" aria-label="Закрыть">${icon('close')}</button></div>
    <p class="mu ovedit-hint">Перетащите слайд, чтобы поменять порядок. Кнопки на миниатюре: дублировать и удалить. С клавиатуры: Alt + ← → переставить, Delete — удалить.</p>
    <div class="ovgrid" id="ovgrid"></div>
    <p class="mu ovkeys">← → пробел — листать · Home/End — в начало/конец · номер + Enter — перейти · O — обзор · P — докладчик · F — весь экран · T — тема · B — чёрный экран${editable ? ' · E — правка' : ''}</p>
  </div>
</div>
<div class="blackout" id="blk"></div>`);

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const vp = $('vp');
  const view = new DeckView(deck, vp);
  const sync = new Sync(deckKey);
  let index = 0;
  let black = false;
  let editor: Editor | null = null;

  const fit = () => {
    const full = document.body.classList.contains('fs');
    const navH = full ? 0 : NAV_H;
    const ins = editor?.insets() ?? { top: 0, bottom: 0 };
    const h = innerHeight - navH - ins.top - ins.bottom;
    view.fit(innerWidth, h, ins.top / 2 - (navH + ins.bottom) / 2);
  };
  addEventListener('resize', fit);
  fit();

  const broadcast = () => sync.send({ type: 'state', index, theme: currentTheme(), black });
  let deckTimer = 0;
  const broadcastDeck = () => {
    clearTimeout(deckTimer);
    deckTimer = window.setTimeout(() => sync.send({ type: 'deck', deck: JSON.parse(JSON.stringify(deck)) }), 250);
  };

  function updateChrome(): void {
    const n = count();
    $('ct').textContent = `${index + 1} из ${n}`;
    $('nx').style.visibility = index >= n - 1 ? 'hidden' : 'visible';
    $('pv').style.visibility = index ? 'visible' : 'hidden';
    $('pg').style.width = `${((index + 1) / n) * 100}%`;
  }

  function go(i: number, push = true): void {
    const next = Math.max(0, Math.min(count() - 1, i));
    const changed = next !== index || view.index !== next;
    index = next;
    view.show(index);
    updateChrome();
    if (push && changed) history.replaceState(null, '', `#${index + 1}`);
    if (changed) {
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
      card.className = 'ovcard';
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
          view.build(deck);
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
    if (!document.body.classList.contains('fs')) return;
    if (e.clientY > innerHeight - 90) {
      document.body.classList.add('peek');
      clearTimeout(peekTimer);
      peekTimer = window.setTimeout(() => document.body.classList.remove('peek'), 2000);
    }
  });

  // --- окно докладчика ---
  function openPresenter(): void {
    const w = window.open(presenterUrl(sync.self), `htmlpptx-presenter-${deckKey}-${sync.self}`, 'popup,width=1280,height=800');
    sync.addPeer(w);
  }

  // --- кнопки ---
  $('nx').addEventListener('click', () => go(index + 1));
  $('pv').addEventListener('click', () => go(index - 1));
  $('thm').addEventListener('click', () => toggleTheme());
  $('ov').addEventListener('click', ovShow);
  $('ovx').addEventListener('click', ovHide);
  ovbd.addEventListener('click', (e) => { if (e.target === ovbd) ovHide(); });
  $('pr').addEventListener('click', openPresenter);
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
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (ovOpen()) {
      if (k === 'Escape' || k === 'o' || k === 'O' || k === 'щ' || k === 'Щ') { e.preventDefault(); ovHide(); }
      return;
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
    };
    // Буквенные клавиши работают и в русской раскладке
    const letters: Record<string, () => void> = {
      f: toggleFullscreen, 'а': toggleFullscreen,
      t: () => toggleTheme(), 'е': () => toggleTheme(),
      o: ovShow, 'щ': ovShow,
      p: openPresenter, 'з': openPresenter,
      b: () => setBlack(!black), 'и': () => setBlack(!black), '.': () => setBlack(!black),
    };
    if (editor) {
      letters.e = () => editor!.toggle();
      letters['у'] = () => editor!.toggle();
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
  sync.on((m, from) => {
    if (m.type === 'goto') go(m.index);
    else if (m.type === 'hello') {
      // Новому окну докладчика — актуальные данные (с несохранёнными правками) и положение
      if (editor?.touched) sync.send({ type: 'deck', deck: JSON.parse(JSON.stringify(deck)) }, from);
      sync.send({ type: 'state', index, theme: currentTheme(), black }, from);
    } else if (m.type === 'theme' && m.theme !== currentTheme()) setTheme(m.theme);
    else if (m.type === 'black' && m.value !== black) setBlack(m.value);
  });

  applyAccent(deck.theme?.accent);
  index = -1;
  go(fromHash(), false);
}
