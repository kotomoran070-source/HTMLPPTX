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

async function boot(): Promise<void> {
  if (!name || !decks[name]) {
    // Страница выбора есть только в yarn dev: собранный файл всегда открывает свою презентацию
    if (import.meta.env.DEV) {
      const { showPicker } = await import('./engine/picker');
      await showPicker(decks, !fixed);
    }
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
