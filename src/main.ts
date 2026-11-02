import './engine/editor/snapshot';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './components';

import { decks, fixed } from 'virtual:decks';
import { esc } from './engine/html';
import { loadMath, usesMath } from './components/math/math';
import { startPresenter } from './engine/presenter';
import { startShow, updateFavicon } from './engine/show';
import { setupSelectMenus } from './engine/select-menu';
import { initTheme } from './engine/theme';
import type { Deck } from './types';

initTheme();
setupSelectMenus();

const params = new URLSearchParams(location.search);
const names = Object.keys(decks);
// ?all — страница выбора, даже если презентация одна
const name = fixed ?? params.get('deck') ?? (names.length === 1 && !params.has('all') ? names[0] : null);

function setMeta(deck: Deck): void {
  // Окно показа из студии подписано иначе, чем сама студия: в панели задач их не спутать.
  // Файл презентации, открытый сам по себе, называется просто её названием
  const fromStudio = window.name.startsWith('htmlpptx-show-') || params.has('present');
  document.title = fromStudio ? `Показ — ${deck.title}` : deck.title;
  document.documentElement.lang = deck.lang ?? 'ru';
  updateFavicon(deck.brand?.logo);
}

// Открытую презентацию удалили (в другом окне) — к списку презентаций
import.meta.hot?.on('slideria:deck-removed', (d: { name: string }) => { if (name && d.name === name) location.href = './?all'; });

// Метки времени для замеров (scripts/perf.mjs): от начала загрузки страницы
const mark = (n: string) => performance.mark(`slideria:${n}`);

async function boot(): Promise<void> {
  mark('boot');
  if (!name || !decks[name]) {
    // Страница выбора есть только в yarn dev: собранный файл всегда открывает свою презентацию
    if (import.meta.env.DEV) {
      const { showPicker } = await import('./engine/picker');
      await showPicker(decks, !fixed);
      mark('picker');
    }
    return;
  }
  const deck = await decks[name]();
  mark('deck');
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
  // Формулы рисуются сразу, без мигания исходником: набор формул — до первой отрисовки
  if (usesMath(deck)) await loadMath().catch(() => null);
  // Студия (редактор как в PowerPoint) есть только в yarn dev: в собранный файл её код не попадает
  if (import.meta.env.DEV && !fixed && params.has('studio')) {
    // Свои темы, шаблоны, эффекты и образы — с диска, до первой отрисовки ленты
    const [{ startStudio }, { loadUserLibrary }] = await Promise.all([import('./studio/studio'), import('./studio/user-library')]);
    await loadUserLibrary();
    mark('studio-code');
    startStudio(deck, name);
    mark('studio');
    return;
  }
  // Телефон-пульт по QR из окна показа — тот же режим докладчика (связь через сервер показа)
  if (params.get('view') === 'presenter' || params.has('remote')) startPresenter(deck, name);
  // В yarn dev правки пишутся в deck.yaml; в собранном файле — в копию HTML
  else startShow(deck, name, import.meta.env.DEV && !fixed);
  mark('show');
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<div class="picker"><h1>Не удалось открыть презентацию</h1><pre>${esc(e?.message ?? e)}</pre></div>`;
});
