/**
 * Страница «Лицензии» (`/?licenses`): «Справка → Лицензии» в программе, когда открыта страница выбора (в студии
 * туда ведёт раздел «Файл → Лицензии»), и старый адрес /__slideria/licenses. Открывается в том же окне.
 *
 * Шапка — та же, что у страницы выбора (picker.css): в программе она и есть заголовок окна; в ней — «Все
 * презентации» (обратно) и тема. Ниже — лицензии «списком и текстом» (licenses-view.ts)
 */
import { icon } from '../components/icons';
import { brandMark, updateFavicon } from './brand';
import { esc } from './html';
import { loadLicenses, mountLicenses } from './licenses-view';
import { themeFade } from './motion';
import { toggleTheme } from './theme';
import './picker.css';
import './licenses-page.css';

export async function showLicenses(): Promise<void> {
  document.body.classList.add('picker-page', 'lc-page');
  document.title = 'Лицензии · Slideria';
  updateFavicon(undefined);
  document.body.innerHTML = `
<div class="pk lc" id="lc">
  <header class="pk-top" data-titlebar><div class="pk-bar pk-wide">
    <div class="pk-lead">
      <div class="pk-brand"><span class="pk-mark">${brandMark()}</span><span>Slideria</span></div>
      <span class="lc-where">Лицензии</span>
    </div>
    <span class="lc-gap"></span>
    <div class="pk-acts lc-acts">
      <a class="pk-btn" id="lc-home" href="./?all">${icon('arr-left')}<span>Все презентации</span></a>
      <button class="pk-btn pk-ibtn theme-btn" id="lc-theme" type="button" aria-label="Переключить тему (T)" title="Тема (T)">${icon('sun', 'ic sun')}${icon('moon', 'ic moon')}</button>
    </div>
  </div></header>
  <main class="lc-main" id="lc-main"></main>
</div>`;
  const host = document.getElementById('lc-main')!;
  const swap = () => themeFade(() => { toggleTheme(); });
  document.getElementById('lc-theme')!.onclick = swap;

  let view: { focusSearch(): void } | null = null;
  try {
    view = mountLicenses(host, await loadLicenses(), undefined, { summary: true });
  } catch (e) {
    host.innerHTML = `<div class="lc-fail"><h2>Список лицензий не загрузился</h2><p>${esc((e as Error).message)}. Откройте страницу ещё раз.</p></div>`;
  }
  addEventListener('keydown', (e) => {
    const typing = (e.target as Element).closest('input, textarea, select');
    if ((e.key === 't' || e.key === 'е') && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) swap();
    if (((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'л')) || (e.key === '/' && !typing)) { e.preventDefault(); view?.focusSearch(); }
  });
  // «Справка → Лицензии», пока страница открыта, — сюда же: к поиску
  addEventListener('slideria:licenses', (e) => { e.preventDefault(); view?.focusSearch(); });
}
