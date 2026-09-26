import { icon } from '../components/icons';
import type { Deck } from '../types';
import { accentTokens, HEX_RE } from './accent';
import { staticSlide } from './deck-view';
import { esc } from './html';
import { currentTheme, toggleTheme } from './theme';
import './picker.css';

type Loaders = Record<string, () => Promise<Deck>>;

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

/** «5 минут назад», «вчера», «12 сентября» */
function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  const d = Math.round(h / 24);
  if (d === 1) return 'вчера';
  if (d < 7) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

async function mtimes(): Promise<Record<string, number>> {
  try {
    const res = await fetch('/__htmlpptx/list', { method: 'POST' });
    const list = (await res.json()) as { name: string; mtime: number }[];
    return Object.fromEntries(list.map((x) => [x.name, x.mtime]));
  } catch {
    return {};
  }
}

/** Цвета акцента презентации для её миниатюры (у каждой карточки свои). */
function accentVars(deck: Deck): string {
  const a = deck.theme?.accent;
  if (typeof a !== 'string' || !HEX_RE.test(a)) return '';
  const t = accentTokens(a)[currentTheme() === 'dark' ? 'dark' : 'light'];
  return Object.entries(t).map(([k, v]) => `${k}:${v}`).join(';');
}

/**
 * Страница выбора презентации (yarn dev): карточки с первым слайдом, импорт HTML,
 * подсказка про новую презентацию, переключатель темы.
 */
export async function showPicker(decks: Loaders, dev: boolean): Promise<void> {
  const names = Object.keys(decks);
  document.body.classList.add('picker-page');
  document.title = 'Презентации';
  document.body.innerHTML = `
<div class="pk">
  <header class="pk-top">
    <div class="pk-brand"><span class="pk-mark">${icon('layers')}</span><span>HTMLPPTX</span></div>
    <button class="ibtn theme-btn" id="pk-theme" type="button" aria-label="Переключить тему (T)" title="Тема (T)">${icon('sun', 'ic sun')}${icon('moon', 'ic moon')}</button>
  </header>
  <section class="pk-hero">
    <h1>Презентации</h1>
    <p>${names.length
      ? `${names.length} ${plural(names.length, 'презентация', 'презентации', 'презентаций')} в папке <code>presentations/</code>. Откройте, чтобы показать или править.`
      : 'Пока ни одной. Создайте новую или импортируйте HTML.'}</p>
  </section>
  <div class="pk-grid" id="pk-grid">
    ${names.map((n) => `<a class="pk-card" href="?deck=${encodeURIComponent(n)}" data-name="${esc(n)}">
      <div class="pk-thumb"><div class="pk-ph"></div></div>
      <div class="pk-info">
        <b class="pk-title">${esc(n)}</b>
        <span class="pk-meta"><code>${esc(n)}</code></span>
      </div>
    </a>`).join('')}
    ${dev ? `<button class="pk-card pk-action" id="pk-import" type="button">
      <span class="pk-icon">${icon('upload')}</span>
      <b>Импорт HTML</b>
      <span>Перетащите файл на страницу или нажмите.<br>Claude Design, свой HTML по правилам или собранный файл с правками.</span>
    </button>
    <div class="pk-card pk-action pk-new">
      <span class="pk-icon">${icon('plus')}</span>
      <b>Новая презентация</b>
      <span>В терминале, в папке проекта:</span>
      <span class="pk-cmd"><code>yarn new имя "Название"</code><button type="button" class="pk-copy" title="Скопировать" aria-label="Скопировать команду">${icon('copy')}</button></span>
    </div>` : ''}
  </div>
  <footer class="pk-foot">
    <span>${icon('terminal')} <code>yarn build имя</code> — один HTML-файл для показа и отправки: <code>dist/имя.html</code></span>
    <span>Правила своего HTML — <code>docs/HTML.md</code>, импорт из Claude Design — <code>docs/CLAUDE-DESIGN.md</code></span>
  </footer>
</div>`;

  const themeBtn = document.getElementById('pk-theme')!;
  const retheme = () => {
    // Миниатюры с акцентом презентации пересчитываются под новую тему
    document.querySelectorAll<HTMLElement>('.pk-card[data-name]').forEach((c) => {
      const d = loaded.get(c.dataset.name!);
      if (d) c.querySelector<HTMLElement>('.pk-thumb')!.setAttribute('style', accentVars(d));
    });
  };
  themeBtn.onclick = () => { toggleTheme(); retheme(); };
  addEventListener('keydown', (e) => {
    if ((e.key === 't' || e.key === 'е') && !e.ctrlKey && !e.metaKey && !(e.target as Element).closest('input, textarea')) {
      toggleTheme();
      retheme();
    }
  });

  const copy = document.querySelector<HTMLButtonElement>('.pk-copy');
  if (copy) {
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText('yarn new имя "Название"');
        copy.classList.add('ok');
        setTimeout(() => copy.classList.remove('ok'), 1200);
      } catch { /* буфер обмена недоступен */ }
    };
  }

  if (dev) {
    const m = await import('./import-ui');
    const ui = m.setupImport();
    document.getElementById('pk-import')!.onclick = ui.pick;
  }

  // Данные презентаций: название, число слайдов, миниатюра первого слайда
  const loaded = new Map<string, Deck>();
  const times = dev ? await mtimes() : {};
  const fill = async (card: HTMLElement) => {
    const name = card.dataset.name!;
    try {
      const deck = await decks[name]();
      const err = (deck as unknown as { __error?: string }).__error;
      const info = card.querySelector('.pk-info')!;
      if (err) {
        card.classList.add('pk-err');
        card.querySelector('.pk-thumb')!.innerHTML = `<div class="pk-ph pk-bad">Ошибка в deck.yaml</div>`;
        return;
      }
      loaded.set(name, deck);
      const n = deck.slides?.length ?? 0;
      const src = typeof (deck as { source?: unknown }).source === 'string' ? String((deck as { source?: unknown }).source) : '';
      const bits = [`${n} ${plural(n, 'слайд', 'слайда', 'слайдов')}`];
      if (times[name]) bits.push(ago(times[name]));
      info.innerHTML = `<b class="pk-title">${esc(deck.title || name)}</b>`
        + `<span class="pk-meta"><code>${esc(name)}</code><span>${bits.map(esc).join(' · ')}</span></span>`
        + (src ? `<span class="pk-badge">${esc(src)}</span>` : '');
      const thumb = card.querySelector<HTMLElement>('.pk-thumb')!;
      thumb.setAttribute('style', accentVars(deck));
      if (n) {
        thumb.innerHTML = '';
        thumb.appendChild(staticSlide(deck, 0));
      }
    } catch (e) {
      console.error(e);
    }
  };
  // Миниатюры строятся по мере прокрутки: презентаций может быть много
  const cards = [...document.querySelectorAll<HTMLElement>('.pk-card[data-name]')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      void fill(en.target as HTMLElement);
    }), { rootMargin: '200px' });
    cards.forEach((c) => io.observe(c));
  } else {
    cards.forEach((c) => void fill(c));
  }
}
