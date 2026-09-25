import './engine/editor/snapshot';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './components';

import { decks, fixed } from 'virtual:decks';
import { esc } from './engine/html';
import { startPresenter } from './engine/presenter';
import { startShow, updateFavicon } from './engine/show';
import { initTheme } from './engine/theme';
import type { Deck } from './types';

initTheme();

const params = new URLSearchParams(location.search);
const names = Object.keys(decks);
const name = fixed ?? params.get('deck') ?? (names.length === 1 ? names[0] : null);

function setMeta(deck: Deck): void {
  document.title = deck.title;
  document.documentElement.lang = deck.lang ?? 'ru';
  updateFavicon(deck.brand?.logo);
}

function picker(): void {
  document.body.classList.add('picker-page');
  const items = names.map((n) => `<a href="?deck=${encodeURIComponent(n)}"><b>${esc(n)}</b><span class="mu">presentations/${esc(n)}/deck.yaml</span></a>`).join('');
  document.body.innerHTML = `<div class="picker"><h1>Презентации</h1>`
    + `<p class="mu">Откройте презентацию или создайте новую: <code>yarn new имя</code>. Файл для отправки: <code>yarn build имя</code>.</p>`
    + (items ? `<div class="picker-grid">${items}</div>` : '<p>В папке presentations пока нет ни одной презентации.</p>')
    + `</div>`;
}

async function boot(): Promise<void> {
  if (!name || !decks[name]) {
    picker();
    return;
  }
  const deck = await decks[name]();
  const err = (deck as unknown as { __error?: string }).__error;
  if (err) {
    document.body.classList.add('picker-page');
    document.body.innerHTML = `<div class="picker"><h1>Ошибка в данных презентации</h1><pre class="yaml-error">${esc(err)}</pre>`
      + `<p class="mu">Исправьте файл и сохраните — страница обновится сама.</p></div>`;
    return;
  }
  if (!deck?.slides?.length) {
    document.body.innerHTML = `<div class="picker"><h1>${esc(name)}</h1><p>В deck.yaml нет слайдов (список slides пуст).</p></div>`;
    return;
  }
  setMeta(deck);
  if (params.get('view') === 'presenter') startPresenter(deck, name);
  // В yarn dev правки пишутся в deck.yaml; в собранном файле — в копию HTML
  else startShow(deck, name, import.meta.env.DEV && !fixed);
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div class="picker"><h1>Не удалось открыть презентацию</h1><pre>${esc(e?.message ?? e)}</pre></div>`;
});
