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

/** Подтверждение и удаление презентации (папка уходит в presentations/.trash). */
async function remove(name: string, item: HTMLElement): Promise<void> {
  const title = item.querySelector('.pk-title')?.textContent ?? name;
  const box = document.createElement('div');
  box.className = 'imp-bd';
  const meta = item.querySelector('.pk-meta span')?.textContent ?? '';
  box.innerHTML = `<div class="imp pk-confirm" role="alertdialog" aria-modal="true" aria-labelledby="del-h" aria-describedby="del-d">
    <div class="pk-confirm-head"><span class="pk-confirm-icon">${icon('trash')}</span><h2 id="del-h">Удалить презентацию?</h2></div>
    <div class="pk-confirm-deck"><div class="pk-confirm-thumb"></div><div><b>${esc(title)}</b><span><code>${esc(name)}</code>${meta ? ` · ${esc(meta)}` : ''}</span></div></div>
    <p class="pk-confirm-note" id="del-d">Папка переместится в <code>presentations/.trash/</code>. Передумаете — перенесите её обратно в <code>presentations/</code>.</p>
    <div class="imp-actions"><button type="button" class="btn pk-neutral" data-a="cancel">Отмена</button><button type="button" class="btn pk-danger" data-a="ok">${icon('trash')}Удалить</button></div>
  </div>`;
  // Миниатюра первого слайда — та же, что на карточке
  const thumb = item.querySelector('.pk-thumb .thumb');
  const holder = box.querySelector<HTMLElement>('.pk-confirm-thumb')!;
  if (thumb) holder.appendChild(thumb.cloneNode(true));
  document.body.append(box);
  await import('./import-ui.css');
  // Копия миниатюры не знает своего размера: масштаб под ширину окна
  const stage = holder.querySelector<HTMLElement>('.thumb-stage');
  if (stage) stage.style.transform = `scale(${holder.clientWidth / 1280})`;
  const ok = box.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
  const cancel = box.querySelector<HTMLButtonElement>('[data-a="cancel"]')!;
  const close = () => { box.remove(); removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();
  };
  addEventListener('keydown', onKey, true);
  cancel.onclick = close;
  box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
  cancel.focus();
  ok.onclick = async () => {
    ok.disabled = cancel.disabled = true;
    try {
      const res = await fetch(`/__htmlpptx/delete?deck=${encodeURIComponent(name)}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `ошибка ${res.status}`);
      close();
      item.classList.add('pk-gone');
      // Остаёмся на странице выбора, даже если осталась одна презентация
      setTimeout(() => { location.href = './?all'; }, 300);
    } catch (e) {
      box.querySelector('.imp-body')!.insertAdjacentHTML('beforeend', `<p class="imp-err">Не удалось: ${esc((e as Error).message)}</p>`);
      ok.disabled = cancel.disabled = false;
    }
  };
}

/** Новая презентация: название и старт — пустая или с примерами; после создания открывается редактор. */
async function create(): Promise<void> {
  const box = document.createElement('div');
  box.className = 'imp-bd';
  box.innerHTML = `<div class="imp pk-create" role="dialog" aria-modal="true" aria-labelledby="new-h">
    <h2 id="new-h">Новая презентация</h2>
    <label class="imp-name">Название <input spellcheck="false" autocomplete="off" maxlength="120" placeholder="Новая презентация"></label>
    <fieldset class="imp-mode"><legend>Начать</legend>
      <label><input type="radio" name="new-kind" value="empty" checked><span><b>Пустая</b><small>Один титульный слайд с названием.</small></span></label>
      <label><input type="radio" name="new-kind" value="sample"><span><b>С примерами</b><small>Титульный, карточки, диаграмма и финальный слайд — чтобы заменить своим.</small></span></label>
    </fieldset>
    <div class="imp-body"></div>
    <div class="imp-actions"><button type="button" class="btn ghost" data-a="cancel">Отмена</button><button type="button" class="btn primary" data-a="ok">Создать</button></div>
  </div>`;
  document.body.append(box);
  await import('./import-ui.css');
  const input = box.querySelector('input')!;
  const ok = box.querySelector<HTMLButtonElement>('[data-a="ok"]')!;
  const cancel = box.querySelector<HTMLButtonElement>('[data-a="cancel"]')!;
  const close = () => { box.remove(); removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && !ok.disabled) { e.preventDefault(); ok.click(); }
    e.stopPropagation();
  };
  addEventListener('keydown', onKey, true);
  cancel.onclick = close;
  box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
  input.focus();
  ok.onclick = async () => {
    ok.disabled = cancel.disabled = true;
    const sample = box.querySelector<HTMLInputElement>('input[value="sample"]')!.checked;
    try {
      const res = await fetch(`/__htmlpptx/create?title=${encodeURIComponent(input.value.trim())}&sample=${sample ? 1 : 0}`, { method: 'POST' });
      const data = await res.json().catch(() => ({})) as { name?: string; error?: string };
      if (!res.ok || !data.name) throw new Error(data.error ?? `ошибка ${res.status}`);
      close();
      location.href = `?deck=${encodeURIComponent(data.name)}&studio`;
    } catch (e) {
      box.querySelector('.imp-body')!.innerHTML = `<p class="imp-err">Не удалось: ${esc((e as Error).message)}</p>`;
      ok.disabled = cancel.disabled = false;
    }
  };
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
    ${names.map((n) => `<div class="pk-item"><a class="pk-card" href="?deck=${encodeURIComponent(n)}" data-name="${esc(n)}">
      <div class="pk-thumb"><div class="pk-ph"></div></div>
      <div class="pk-info">
        <b class="pk-title">${esc(n)}</b>
        <span class="pk-meta"><code>${esc(n)}</code></span>
      </div>
    </a>${dev ? `<a class="pk-edit" href="?deck=${encodeURIComponent(n)}&amp;studio" title="Открыть в редакторе" aria-label="Открыть в редакторе ${esc(n)}">${icon('pencil')}<span>Редактор</span></a>` : ''}${dev ? `<button type="button" class="pk-del" data-del="${esc(n)}" title="Удалить презентацию" aria-label="Удалить презентацию ${esc(n)}">${icon('trash')}</button>` : ''}</div>`).join('')}
    ${dev ? `<button class="pk-card pk-action" id="pk-import" type="button">
      <span class="pk-icon">${icon('upload')}</span>
      <b>Импорт HTML</b>
      <span>Перетащите файл на страницу или нажмите.<br>Claude Design, свой HTML по правилам или собранный файл с правками.</span>
    </button>
    <button class="pk-card pk-action pk-new" id="pk-new" type="button">
      <span class="pk-icon">${icon('plus')}</span>
      <b>Новая презентация</b>
      <span>Пустая — с титульного слайда, или с примерами слайдов для старта.</span>
    </button>` : ''}
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

  const newBtn = document.getElementById('pk-new');
  if (newBtn) newBtn.onclick = () => void create();

  document.querySelectorAll<HTMLButtonElement>('.pk-del').forEach((b) => {
    b.onclick = () => void remove(b.dataset.del!, b.closest<HTMLElement>('.pk-item')!);
  });

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
