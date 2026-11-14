import './engine/editor/snapshot';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import './components';

import { bootDone } from './engine/boot';
import { DeckMissing, embeddedDeck, fetchDeck, fetchList, loadedRev, serverLoaders } from './engine/deck-source';
import { onServer } from './engine/events';
import { esc } from './engine/html';
import { loadMath, usesMath } from './components/math/math';
import { startPresenter } from './engine/presenter';
import { shotDeck } from './engine/print';
import { widthOf } from './engine/slide-size';
import { startShow, updateFavicon } from './engine/show';
import { setupSelectMenus } from './engine/select-menu';
import { initTheme } from './engine/theme';
import type { Deck } from './types';

initTheme();
setupSelectMenus();

const params = new URLSearchParams(location.search);
// Собранный файл: своя презентация из самого HTML. С сервером — та, что в адресе (?deck=…)
const own = __SERVED__ ? null : embeddedDeck();

function setMeta(deck: Deck): void {
  // Окно показа из студии подписано иначе, чем сама студия: в панели задач их не спутать.
  // Файл презентации, открытый сам по себе, называется просто её названием
  const fromStudio = window.name.startsWith('htmlpptx-show-') || params.has('present');
  document.title = fromStudio ? `Показ — ${deck.title}` : deck.title;
  document.documentElement.lang = deck.lang ?? 'ru';
  updateFavicon(deck.brand?.logo);
}

// Метки времени для замеров (scripts/perf.mjs): от начала загрузки страницы
const mark = (n: string) => performance.mark(`slideria:${n}`);

/** Данные презентации с сервера; её нет (удалили, опечатка в адресе) — null */
async function fromServer(name: string): Promise<Deck | null> {
  try {
    return await fetchDeck(name);
  } catch (e) {
    if (e instanceof DeckMissing) return null;
    throw e;
  }
}

/**
 * Какую презентацию открыть: собранный файл — свою; с сервером — из адреса (?deck=…), а без него —
 * единственную, если она одна (?all — всё равно страница выбора). Нечего открыть — страница выбора, null
 */
async function choose(): Promise<{ name: string; deck: Deck } | null> {
  if (own) return { name: own.name, deck: await own.load() };
  const asked = params.get('deck');
  const deck = asked ? await fromServer(asked) : null;
  if (asked && deck) return { name: asked, deck };
  const list = await fetchList();
  const names = list.map((d) => d.name);
  if (!asked && names.length === 1 && !params.has('all')) {
    const only = await fromServer(names[0]);
    if (only) return { name: names[0], deck: only };
  }
  // Страница выбора — только с сервером: в собранный файл презентации её код (и шрифты) не попадает
  if (__SERVED__) {
    const { showPicker } = await import('./engine/picker');
    await showPicker(serverLoaders(names), true, list);
    mark('picker');
  }
  return null;
}

async function boot(): Promise<void> {
  mark('boot');
  // «Лицензии» (вкладка «Инструменты», «Справка → Лицензии» в программе) — своя страница, только с сервером
  if (__SERVED__ && params.has('licenses')) {
    const { showLicenses } = await import('./engine/licenses-page');
    await showLicenses();
    return bootDone();
  }
  const open = await choose();
  if (!open) return bootDone();
  const { name, deck } = open;
  mark('deck');
  if (__SERVED__) {
    // Открытую презентацию удалили или поправили её файл со стороны (текстовый редактор, git) — заново.
    // Страница, открытая уже после правки, показывает свежую версию: её не перезагружаем
    onServer('deck-removed', (d) => { if (d.name === name) location.href = './?all'; });
    onServer('deck-changed', (d) => { if (d.name === name && d.rev !== loadedRev(name)) location.reload(); });
  }
  const err = (deck as unknown as { __error?: string }).__error;
  if (err) {
    document.body.classList.add('picker-page');
    document.body.innerHTML = `<div class="picker"><h1>Ошибка в данных презентации</h1><pre class="yaml-error">${esc(err)}</pre>`
      + `<p class="mu">Исправьте файл и сохраните — страница обновится сама.</p></div>`;
    return bootDone();
  }
  if (!deck?.slides?.length) {
    document.body.innerHTML = `<div class="picker"><h1>${esc(name)}</h1><p>В deck.yaml нет слайдов (список slides пуст).</p></div>`;
    return bootDone();
  }
  setMeta(deck);
  // Формулы рисуются сразу, без мигания исходником: набор формул — до первой отрисовки
  if (usesMath(deck)) await loadMath().catch(() => null);
  // Снимок слайдов для агента (MCP view_slides): ?shot=3,5 — без показа, только эти слайды
  const shot = params.get('shot');
  if (shot) {
    const w = Number(params.get('w'));
    await shotDeck(deck, shot.split(',').map((n) => Number(n) - 1), w >= 160 && w <= 3840 ? w : widthOf(deck));
    return bootDone();
  }
  // Студия (редактор как в PowerPoint) — только с сервером: в собранный файл её код не попадает
  if (__SERVED__ && params.has('studio')) {
    // Свои темы, шаблоны, эффекты и образы — с диска, до первой отрисовки ленты
    const [{ startStudio }, { loadUserLibrary }] = await Promise.all([import('./studio/studio'), import('./studio/user-library')]);
    await loadUserLibrary();
    mark('studio-code');
    startStudio(deck, name);
    mark('studio');
    return bootDone();
  }
  // Телефон-пульт по QR из окна показа — тот же режим докладчика (связь через сервер показа)
  if (params.get('view') === 'presenter' || params.has('remote')) startPresenter(deck, name);
  // С сервером правки пишутся в deck.yaml; в собранном файле — в копию HTML
  else startShow(deck, name, __SERVED__);
  mark('show');
  bootDone();
}

boot().catch((e) => {
  console.error(e);
  bootDone();
  document.body.innerHTML = `<div class="picker"><h1>Не удалось открыть презентацию</h1><pre>${esc(e?.message ?? e)}</pre></div>`;
});
