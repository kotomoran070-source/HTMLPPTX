import { icon } from '../components/icons';
import type { Deck } from '../types';
import { DeckView, staticSlide } from './deck-view';
import { esc } from './html';
import { slideLabel } from './render';
import { Sync } from './sync';
import { currentTheme, onThemeChange, setTheme, toggleTheme } from './theme';

const NAV_H = 56;

export function presenterUrl(): string {
  const u = new URL(location.href);
  u.searchParams.set('view', 'presenter');
  return u.toString();
}

/** Основное окно показа: сцена, навигация, обзор, связь с окном докладчика. */
export function startShow(deck: Deck, deckKey: string): void {
  const n = deck.slides.length;
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
    <button class="ibtn" id="ov" type="button" aria-label="Все слайды (O)" title="Все слайды (O)">${icon('grid')}</button>
    <button class="ibtn" id="pr" type="button" aria-label="Режим докладчика (P)" title="Режим докладчика (P)">${icon('presenter')}</button>
    <button class="ibtn" id="fs" type="button" aria-label="Во весь экран (F)" title="Во весь экран (F)">${icon('fullscreen')}</button>
  </div>
</nav>
<div class="ovbd" id="ovbd" role="dialog" aria-modal="true" aria-label="Все слайды">
  <div class="ovpanel">
    <div class="ovhead"><b>Все слайды</b><button class="ibtn small" id="ovx" type="button" aria-label="Закрыть">${icon('close')}</button></div>
    <div class="ovgrid" id="ovgrid"></div>
    <p class="mu ovkeys">← → пробел — листать · Home/End — в начало/конец · номер + Enter — перейти · O — обзор · P — докладчик · F — весь экран · T — тема · B — чёрный экран</p>
  </div>
</div>
<div class="blackout" id="blk"></div>`);

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const vp = $('vp');
  const view = new DeckView(deck, vp);
  const sync = new Sync(deckKey);
  let index = 0;
  let black = false;

  const fit = () => {
    const full = document.body.classList.contains('fs');
    const navH = full ? 0 : NAV_H;
    view.fit(innerWidth, innerHeight - navH, -navH / 2);
  };
  addEventListener('resize', fit);
  fit();

  const broadcast = () => sync.send({ type: 'state', index, theme: currentTheme(), black });

  function go(i: number, push = true): void {
    const next = Math.max(0, Math.min(n - 1, i));
    const changed = next !== index || view.index === -1;
    index = next;
    view.show(index);
    $('ct').textContent = `${index + 1} из ${n}`;
    $('nx').style.visibility = index === n - 1 ? 'hidden' : 'visible';
    $('pv').style.visibility = index ? 'visible' : 'hidden';
    $('pg').style.width = `${((index + 1) / n) * 100}%`;
    if (push && changed) history.replaceState(null, '', `#${index + 1}`);
    if (changed) broadcast();
  }

  // --- обзор ---
  const ovbd = $('ovbd');
  const ovgrid = $('ovgrid');
  let ovBuilt = false;
  const ovCards: HTMLElement[] = [];
  function ovShow(): void {
    if (!ovBuilt) {
      deck.slides.forEach((s, i) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'ovcard';
        card.appendChild(staticSlide(deck, i));
        card.insertAdjacentHTML('beforeend', `<span class="ovmeta"><span class="ovnum">${i + 1}</span><span class="ovttl">${esc(slideLabel(s, i))}</span></span>`);
        card.addEventListener('click', () => { go(i); ovHide(); });
        ovgrid.appendChild(card);
        ovCards.push(card);
      });
      ovBuilt = true;
    }
    ovCards.forEach((c, i) => c.classList.toggle('cur', i === index));
    ovbd.classList.add('on');
    ovCards[index]?.focus({ preventScroll: true });
    ovCards[index]?.scrollIntoView({ block: 'nearest' });
  }
  function ovHide(): void {
    ovbd.classList.remove('on');
  }
  const ovOpen = () => ovbd.classList.contains('on');

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
    const w = window.open(presenterUrl(), `htmlpptx-presenter-${deckKey}`, 'popup,width=1280,height=800');
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
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
      Home: () => go(0), End: () => go(n - 1),
    };
    // Буквенные клавиши работают и в русской раскладке
    const letters: Record<string, () => void> = {
      f: toggleFullscreen, 'а': toggleFullscreen,
      t: () => toggleTheme(), 'е': () => toggleTheme(),
      o: ovShow, 'щ': ovShow,
      p: openPresenter, 'з': openPresenter,
      b: () => setBlack(!black), 'и': () => setBlack(!black), '.': () => setBlack(!black),
    };
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
    if (ovOpen()) return;
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
  sync.on((m) => {
    if (m.type === 'goto') go(m.index);
    else if (m.type === 'hello') broadcast();
    else if (m.type === 'theme' && m.theme !== currentTheme()) setTheme(m.theme);
    else if (m.type === 'black' && m.value !== black) setBlack(m.value);
  });

  index = -1;
  go(fromHash(), false);
}
