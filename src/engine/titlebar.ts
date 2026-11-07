/**
 * Свой заголовок окна программы (desktop/main.mjs): системной полосы нет — её место занимает элемент страницы
 * с data-titlebar. На странице выбора это её шапка, в студии — тонкая полоса над шапкой (studio.css, .st-tbar).
 * Пустые места такого элемента перетаскивают окно (двойной щелчок — развернуть), кнопки, поля и ссылки —
 * нажимаются (styles/ui.css, .app-frame). Высота — его --tb-h.
 *
 * Кнопки окна в Windows и Linux рисует страница (.app-wc): цветом темы и вместе с ней, без системных «чужих»
 * кнопок поверх. На Mac — системный «светофор» слева; где он — из Window Controls Overlay (--tb-left).
 * --tb-right — место под кнопки справа. Страница без своего заголовка (ошибка) получает тонкую полосу сверху.
 * Каркас страницы (index.html) рисует те же кнопки с первого кадра — значки там те же (WC_GLYPHS)
 */
interface WinState { max: boolean; full: boolean }
type Control = 'min' | 'max' | 'close';
interface AppFrame {
  frame?: boolean;
  platform?: string;
  titleBar?(c: { height: number; bg?: string }): void;
  control?(a: Control): void;
  windowState?(): WinState | null;
  onWindowState?(cb: (s: WinState) => void): void;
}
import { onThemeChange } from './theme';

interface Overlay extends EventTarget { visible: boolean; getTitlebarAreaRect(): DOMRect }

const app = () => (window as { slideriaApp?: AppFrame }).slideriaApp;

/** Высота полосы без своего элемента заголовка (.app-drag-strip) */
const STRIP_H = 32;
/** Ширина кнопки окна — как у системных в Windows */
const WC_W = 46;
/** Значки кнопок окна, 10 × 10, линией в 1 px (те же — в каркасе, index.html) */
export const WC_GLYPHS = {
  min: '<path d="M0 5.5h10"/>',
  max: '<rect x=".5" y=".5" width="9" height="9" rx="1.5"/>',
  restore: '<rect x=".5" y="2.5" width="7" height="7" rx="1.5"/><path d="M2.5 2.5V2A1.5 1.5 0 0 1 4 .5h4A1.5 1.5 0 0 1 9.5 2v4A1.5 1.5 0 0 1 8 7.5h-.5"/>',
  close: '<path d="M.5.5l9 9m0-9l-9 9"/>',
};
const glyph = (k: keyof typeof WC_GLYPHS) => `<svg viewBox="0 0 10 10" aria-hidden="true">${WC_GLYPHS[k]}</svg>`;

let started = false;

/** Вызывается, когда страница нарисована (engine/boot.ts) */
export function initTitlebar(): void {
  const api = app();
  if (started || !api?.frame) return;
  started = true;
  const root = document.documentElement;
  root.classList.add('app-frame');
  if (api.platform) root.dataset.platform = api.platform;
  const mac = api.platform === 'darwin';

  // Высота заголовка — у элемента с data-titlebar; на Mac по ней ставится «светофор»
  const bar = document.querySelector<HTMLElement>('[data-titlebar]');
  const height = (bar && Math.round(parseFloat(getComputedStyle(bar).getPropertyValue('--tb-h')))) || STRIP_H;
  root.style.setProperty('--tb-h', `${height}px`);
  // Фон окна — как у страницы, и после смены темы (desktop/main.mjs: иначе при разворачивании мелькает чужой фон)
  const report = () => api.titleBar?.({ height, bg: getComputedStyle(document.body).backgroundColor });
  report();
  onThemeChange(() => requestAnimationFrame(report));

  // Нет своего заголовка — полоса для перетаскивания
  if (!bar) {
    const strip = document.createElement('div');
    strip.className = 'app-drag-strip';
    strip.setAttribute('aria-hidden', 'true');
    document.body.append(strip);
  }

  if (mac) {
    // Где «светофор»: свободная полоса заголовка — от x до x + width
    const wco = (navigator as { windowControlsOverlay?: Overlay }).windowControlsOverlay;
    const geometry = () => {
      if (!wco?.visible) return;
      const r = wco.getTitlebarAreaRect();
      root.style.setProperty('--tb-left', `${Math.round(r.x)}px`);
      root.style.setProperty('--tb-right', `${Math.max(0, Math.round(innerWidth - r.x - r.width))}px`);
    };
    wco?.addEventListener('geometrychange', geometry);
    addEventListener('resize', geometry);
    geometry();
    return;
  }

  // Windows, Linux: свои кнопки окна
  const box = document.createElement('div');
  box.className = 'app-wc';
  box.innerHTML = `<button type="button" data-wc="min" aria-label="Свернуть" title="Свернуть">${glyph('min')}</button>`
    + '<button type="button" data-wc="max"></button>'
    + `<button type="button" data-wc="close" aria-label="Закрыть" title="Закрыть">${glyph('close')}</button>`;
  const max = box.querySelector<HTMLButtonElement>('[data-wc="max"]')!;
  box.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-wc]');
    if (b) api.control?.(b.dataset.wc as Control);
  });
  // Кнопкам окна фокус не нужен: щелчок не уводит его из поля поиска или со слайда
  box.addEventListener('mousedown', (e) => e.preventDefault());
  const apply = (s: WinState | null | undefined) => {
    const label = s?.max ? 'Восстановить' : 'Развернуть';
    max.innerHTML = glyph(s?.max ? 'restore' : 'max');
    max.setAttribute('aria-label', label);
    max.title = label;
    root.classList.toggle('app-full', !!s?.full);
    root.style.setProperty('--tb-right', s?.full ? '0px' : `${3 * WC_W}px`);
  };
  apply(api.windowState?.());
  api.onWindowState?.(apply);
  // Окно не в фокусе — кнопки тише, как у системных
  const focus = () => root.classList.toggle('app-blur', !document.hasFocus());
  addEventListener('focus', focus);
  addEventListener('blur', focus);
  focus();
  document.body.append(box);
}
