import { defineBlock, defineTemplate } from '../../engine/component';
import { asArray, esc, t } from '../../engine/html';
import { ea, eurl, tx } from '../../engine/marks';
import { currentTheme } from '../../engine/theme';
import { qrSvg } from '../qr';
import { cosmos, rng } from './cosmos';
import { logoImg } from './content';
import { button, linkText, words, type FinaleLink, type FinaleSlide } from './finale';
import './space.css';

interface SpaceSlide extends FinaleSlide {
  /** Надпись в «пилюле» над логотипом */
  badge?: string;
  /** orbit — орбиты вокруг стеклянного логотипа, надпись в углу, кнопки внутри карточки */
  layout?: 'orbit';
  /** theme — в светлой теме презентации слайд светлый (в тёмной — как обычно); без него всегда тёмный */
  tone?: 'theme';
}

const HUBS: [number, number][] = [[120, 90], [980, 60], [1150, 230], [80, 340], [300, 540], [1050, 560], [640, 120], [520, 610], [880, 400]];
const HUB_COLORS = ['#67E8F9', '#C4B5FD', '#6EE7B7'];
const LINKS: [number, number][] = [[0, 6], [1, 2], [3, 4], [5, 8], [6, 8]];

/**
 * «Космический» финальный слайд: всегда тёмный, звёзды, метеоры, пульсирующие узлы,
 * сияние и орбита вокруг логотипа, параллакс звёзд за мышью.
 */
defineTemplate<SpaceSlide>('space', {
  className: 'space',
  render(s, ctx) {
    const orbit = s.layout === 'orbit';
    const logo = ctx.logo
      ? `<div class="sp-logow r"><div class="sp-halo"></div>${orbit ? '' : '<div class="sp-orbit"><i></i></div>'}<div class="sp-tile">${logoImg(ctx.logo, ctx.logoDark, ctx.logoTint)}</div></div>`
      : '';
    const link = spaceCardHtml(s.link, ctx.logo);
    const bts = asArray(s.buttons).map((b) => button(b, 'sp-gbt')).join('');
    // В варианте «орбита» ссылка и кнопки — одна широкая карточка
    const card = orbit && (link || bts) ? spacePanelHtml(link, bts) : link;
    return skyHtml(orbit)
      + `<div class="sp-wrap${orbit ? ' orbit' : ''}${s.tone === 'theme' ? ' tone-theme' : ''}">`
      + (s.badge ? `<div class="sp-badge r">${orbit ? '' : '<i class="sp-dot"></i>'}${tx(s, 'badge')}</div>` : '')
      + logo
      + `<h1 aria-label="${esc(s.title)}"${ea(s, 'title')}>${words(s.title, 'sp-w', 0.4, 0.3)}</h1>`
      + (orbit ? '' : `<div class="sp-rule"></div>`)
      + (s.lead ? `<p class="sp-lead"${ea(s, 'lead')}>${t(s.lead)}</p>` : '')
      + card
      + (!orbit && bts ? `<div class="sp-row">${bts}</div>` : '')
      + `</div>`;
  },
  mount(el, p, ctx) {
    return mountSky(el, el, ctx.stage, ctx.reducedMotion, p.tone === 'theme');
  },
});

/** Карточка ссылки с QR «Космоса» (шаблон и блок «Ссылка с QR» после разбора) */
export function spaceCardHtml(l: FinaleLink | undefined, logo?: string): string {
  return l
    ? `<a class="sp-card" href="${esc(l.url)}" target="_blank" rel="noopener"${eurl(l, 'url')}>`
      + (l.qr !== false ? `<div class="sp-qrbox">${qrSvg(l.url, logo, `QR-код: ${l.url}`)}</div>` : '')
      + `<div>${l.label ? `<small${ea(l, 'label')}>${t(l.label)}</small>` : ''}<b${ea(l, 'text')}>${t(linkText(l))}</b></div></a>`
    : '';
}

/** Широкая карточка «орбиты»: ссылка и кнопки вместе */
export function spacePanelHtml(link: string, bts: string): string {
  return `<div class="sp-panel">${link}${link && bts ? '<i class="sp-sep"></i>' : ''}${bts ? `<div class="sp-row">${bts}</div>` : ''}</div>`;
}

/** Звёздное небо «Космоса»: звёзды, связи, метеоры; у «орбиты» — небо на canvas и кольца */
function skyHtml(orbit: boolean): string {
  const r = rng(42);
  let stars = '';
  for (let i = 0; i < 110; i++) {
    const x = r() * 100;
    const y = r() * 100;
    const sz = (0.6 + r() * 1.6).toFixed(1);
    const d = (r() * 4).toFixed(2);
    stars += `<i style="--x:${x.toFixed(1)}%;--y:${y.toFixed(1)}%;--s:${sz}px;--d:${d}s"></i>`;
  }
  const hubs = HUBS.map((p, k) => {
    const c = HUB_COLORS[k % 3];
    return `<div class="sp-hub" style="left:${p[0]}px;top:${p[1]}px;background:${c};box-shadow:0 0 10px 3px ${c}88;animation-delay:${(k * 0.4).toFixed(1)}s"></div>`;
  }).join('');
  const lines = LINKS.map(([a, b], k) =>
    `<path pathLength="1" d="M${HUBS[a][0]} ${HUBS[a][1]}L${HUBS[b][0]} ${HUBS[b][1]}" style="animation-delay:${(0.3 + k * 0.25).toFixed(2)}s"/>`).join('');
  const rings = orbit
    ? `<div class="sp-rings" aria-hidden="true"><div class="sp-r r1"><i></i></div><div class="sp-r r2"><i></i></div></div>`
    : '';
  // «Орбита»: небо рисуется на canvas (звёзды, дрейфующие узлы-созвездия, импульсы от логотипа)
  const sky = orbit
    ? `<div class="sp-sky neb"></div><canvas class="sp-cv" width="2560" height="1440" aria-hidden="true"></canvas>`
    : `<div class="sp-sky"></div><div class="sp-stars">${stars}</div>`
      + `<svg class="sp-lines" viewBox="0 0 1280 720" aria-hidden="true">${lines}</svg>`
      + `<div class="sp-hubs">${hubs}</div>`
      + `<div class="sp-shoot a"></div><div class="sp-shoot b" style="--sx:70%;--sy:8%"></div>`;
  return sky + rings;
}

/** Движение неба: canvas «орбиты» и параллакс за мышью, пока слайд показан */
function mountSky(root: HTMLElement, slide: HTMLElement, stage: HTMLElement, still: boolean, themed = false): (() => void) | undefined {
  const cv = root.querySelector<HTMLCanvasElement>('.sp-cv');
  const stopSky = cv ? cosmos(slide, cv, stage, still, () => themed && currentTheme() === 'light') : undefined;
  if (still) return stopSky;
  const hubs = root.querySelector<HTMLElement>('.sp-hubs');
  const stars = root.querySelector<HTMLElement>('.sp-stars');
  const rings = root.querySelector<HTMLElement>('.sp-rings');
  const onMove = (e: MouseEvent) => {
    if (!slide.classList.contains('on')) return;
    const r = stage.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    if (hubs) hubs.style.transform = `translate(${px * -14}px,${py * -14}px)`;
    if (rings) rings.style.transform = `translate(${px * 8}px,${py * 8}px)`;
    if (stars) stars.style.transform = `translate(${px * -6}px,${py * -6}px)`;
  };
  stage.addEventListener('mousemove', onMove);
  return () => { stage.removeEventListener('mousemove', onMove); stopSky?.(); };
}

/**
 * Небо «Космоса» отдельным блоком — фон слайда после «Разобрать на объекты».
 * Стили неба те же, что у шаблона: блок обёрнут в «слайд космоса» без своей раскладки.
 *   type: space-sky   layout: orbit (необязательно)
 */
defineBlock<{ layout?: string }>('space-sky', {
  render(p) {
    return `<div class="space-sky"><div class="tpl-part space" style="display:contents">${skyHtml(p.layout === 'orbit')}</div></div>`;
  },
  mount(el, _p, ctx) {
    return mountSky(el, ctx.slide, ctx.stage, ctx.reducedMotion);
  },
});
