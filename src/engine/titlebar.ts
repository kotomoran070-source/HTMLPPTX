/**
 * Свой заголовок окна программы (desktop/main.mjs): системной полосы нет — её место занимает элемент страницы
 * с data-titlebar. На странице выбора это её шапка (в ней немного кнопок), в студии — тонкая полоса над шапкой
 * (studio.css, .st-tbar). Пустые места такого элемента перетаскивают окно (двойной щелчок — развернуть), кнопки,
 * поля и ссылки — нажимаются (styles/ui.css, .app-frame). Высота — его --tb-h.
 * Кнопки окна система рисует поверх, высотой с этот элемент и его цветом (и после смены темы); где они — из
 * Window Controls Overlay: --tb-left (место под «светофор» Mac) и --tb-right (под кнопки Windows и Linux).
 * Страница без такого элемента (ошибка) получает тонкую полосу для перетаскивания сверху.
 */
import { onThemeChange } from './theme';

interface TitleBar { color: string; symbol: string; height: number }
interface AppFrame { frame?: boolean; platform?: string; titleBar?(c: TitleBar): void }
interface Overlay extends EventTarget { visible: boolean; getTitlebarAreaRect(): DOMRect }

const app = () => (window as { slideriaApp?: AppFrame }).slideriaApp;

/** Высота полосы без своего элемента заголовка (.app-drag-strip) */
const STRIP_H = 32;

/** Цвет из getComputedStyle → #rrggbb; полупрозрачный — поверх фона страницы */
function hex(css: string, under = '#ffffff'): string {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return /^#[0-9a-f]{6}$/i.test(css.trim()) ? css.trim() : under;
  const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const u = parseInt(under.slice(1), 16);
  const mix = (c: number, k: number) => Math.round(c * a + ((u >> k) & 255) * (1 - a));
  return `#${[mix(r, 16), mix(g, 8), mix(b, 0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

let started = false;

/** Вызывается, когда страница нарисована (engine/boot.ts) */
export function initTitlebar(): void {
  const api = app();
  if (started || !api?.frame) return;
  started = true;
  const root = document.documentElement;
  root.classList.add('app-frame');
  if (api.platform) root.dataset.platform = api.platform;

  // Где кнопки окна: свободная полоса заголовка — от x до x + width
  const wco = (navigator as { windowControlsOverlay?: Overlay }).windowControlsOverlay;
  const geometry = () => {
    if (wco?.visible) {
      const r = wco.getTitlebarAreaRect();
      root.style.setProperty('--tb-left', `${Math.round(r.x)}px`);
      root.style.setProperty('--tb-right', `${Math.max(0, Math.round(innerWidth - r.x - r.width))}px`);
    }
  };
  wco?.addEventListener('geometrychange', geometry);
  addEventListener('resize', geometry);
  geometry();

  // Нет своего заголовка — полоса для перетаскивания
  if (!document.querySelector('[data-titlebar]')) {
    const strip = document.createElement('div');
    strip.className = 'app-drag-strip';
    strip.setAttribute('aria-hidden', 'true');
    document.body.append(strip);
  }

  // Кнопки окна — высотой и цветом заголовка
  const paint = () => {
    const bar = document.querySelector<HTMLElement>('[data-titlebar]');
    const cs = getComputedStyle(root);
    const page = hex(getComputedStyle(document.body).backgroundColor, hex(cs.getPropertyValue('--bg') || '#ffffff'));
    const color = bar ? hex(getComputedStyle(bar).backgroundColor, page) : page;
    const symbol = hex(cs.getPropertyValue('--tx2').trim() || '#374151');
    const height = (bar && Math.round(parseFloat(getComputedStyle(bar).getPropertyValue('--tb-h')))) || STRIP_H;
    api.titleBar?.({ color, symbol, height });
  };
  paint();
  onThemeChange(() => requestAnimationFrame(paint));
}
