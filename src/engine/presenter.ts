import { icon } from '../components/icons';
import type { Deck } from '../types';
import { applyAccent } from './accent';
import { replaceContents } from './data';
import { DeckView, staticSlide } from './deck-view';
import { esc, t } from './html';
import { slideLabel } from './render';
import { Sync } from './sync';
import { currentTheme, onThemeChange, setTheme, toggleTheme } from './theme';

const FONT_KEY = 'htmlpptx-notes-size';

/**
 * Окно докладчика: текущий слайд, следующий, заметки, таймер и часы.
 * Синхронизировано с основным окном в обе стороны.
 */
export function startPresenter(deck: Deck, deckKey: string): void {
  const count = () => deck.slides.length;
  document.title = `Докладчик — ${deck.title}`;
  document.body.classList.add('presenter');
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
  <main class="pres-main">
    <section class="pres-cur">
      <div class="pres-label" id="curl"></div>
      <div class="pres-vp" id="cur"></div>
    </section>
    <aside class="pres-side">
      <div class="pres-label">Далее</div>
      <div class="pres-next" id="next"></div>
      <div class="pres-label pres-notes-head">Заметки
        <span><button class="ibtn small" id="fm" type="button" aria-label="Мельче">A−</button><button class="ibtn small" id="fp" type="button" aria-label="Крупнее">A+</button></span>
      </div>
      <div class="pres-notes" id="notes"></div>
    </aside>
  </main>
  <footer class="pres-bottom">
    <button class="btn ghost" id="pv" type="button">${icon('prev')} Назад</button>
    <span class="counter" id="ct"></span>
    <button class="btn primary" id="nx" type="button">Далее ${icon('next')}</button>
    <button class="btn ghost" id="bk" type="button" title="Чёрный экран у зрителей (B)">Чёрный экран</button>
    <span class="pres-link" id="link"></span>
  </footer>
</div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const cur = $('cur');
  applyAccent(deck.theme?.accent);
  const view = new DeckView(deck, cur);
  const sync = new Sync(deckKey);
  let index = -1;
  let black = false;

  const fit = () => view.fit(cur.clientWidth, cur.clientHeight);
  new ResizeObserver(fit).observe(cur);
  fit();

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
    index = Math.max(0, Math.min(count() - 1, i));
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
    } else {
      next.innerHTML = '<div class="pres-end">Конец презентации</div>';
    }
    $('notes').innerHTML = s.notes ? t(s.notes) : '<span class="mu">Заметок к этому слайду нет. Добавьте поле notes в deck.yaml.</span>';
    $('pv').toggleAttribute('disabled', index === 0);
    $('nx').toggleAttribute('disabled', index === count() - 1);
  }

  function go(i: number): void {
    const target = Math.max(0, Math.min(count() - 1, i));
    if (target === index) return;
    render(target);
    sync.send({ type: 'goto', index: target });
  }

  function setBlack(v: boolean, send = true): void {
    black = v;
    $('bk').classList.toggle('active', v);
    if (send) sync.send({ type: 'black', value: v });
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
  $('thm').addEventListener('click', () => toggleTheme());
  let remoteTheme = false;
  onThemeChange((th) => { if (!remoteTheme) sync.send({ type: 'theme', theme: th }); });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const lower = k.toLowerCase();
    const map: Record<string, () => void> = {
      ArrowRight: () => go(index + 1), ArrowDown: () => go(index + 1), PageDown: () => go(index + 1), ' ': () => go(index + 1),
      ArrowLeft: () => go(index - 1), ArrowUp: () => go(index - 1), PageUp: () => go(index - 1), Backspace: () => go(index - 1),
      Home: () => go(0), End: () => go(count() - 1),
    };
    const letters: Record<string, () => void> = {
      b: () => setBlack(!black), 'и': () => setBlack(!black), '.': () => setBlack(!black),
      t: () => toggleTheme(), 'е': () => toggleTheme(),
    };
    const fn = map[k] ?? letters[lower];
    if (fn) { e.preventDefault(); fn(); }
  });

  sync.on((m) => {
    if (m.type === 'deck') {
      // Правки из режима правки основного окна
      const next = JSON.stringify(m.deck);
      if (next === JSON.stringify(deck)) return;
      replaceContents(deck as unknown as Record<string, unknown>, JSON.parse(next));
      applyAccent(deck.theme?.accent);
      view.build(deck);
      const i = Math.min(index, deck.slides.length - 1);
      index = -1;
      render(i);
    } else if (m.type === 'state') {
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
  sync.send({ type: 'hello' });
  // Если основное окно перезагрузили, оно снова найдёт это окно по регулярному «привет»
  setInterval(() => sync.send({ type: 'hello' }), 3000);
}
