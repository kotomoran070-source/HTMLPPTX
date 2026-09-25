import { defineTemplate } from '../../engine/component';
import { asArray, esc, t } from '../../engine/html';
import { qrSvg } from '../qr';
import { button, linkText, words, type FinaleSlide } from './finale';
import './space.css';

interface SpaceSlide extends FinaleSlide {
  /** Надпись в «пилюле» над логотипом */
  badge?: string;
}

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
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

    const logo = ctx.logo
      ? `<div class="sp-logow r"><div class="sp-halo"></div><div class="sp-orbit"><i></i></div><div class="sp-tile"><img src="${esc(ctx.logo)}" alt=""></div></div>`
      : '';
    const l = s.link;
    const card = l
      ? `<a class="sp-card" href="${esc(l.url)}" target="_blank" rel="noopener">`
        + (l.qr !== false ? `<div class="sp-qrbox">${qrSvg(l.url, ctx.logo, `QR-код: ${l.url}`)}</div>` : '')
        + `<div>${l.label ? `<small>${t(l.label)}</small>` : ''}<b>${t(linkText(l))}</b></div></a>`
      : '';
    const bts = asArray(s.buttons).map((b) => button(b, 'sp-gbt')).join('');

    return `<div class="sp-sky"></div><div class="sp-stars">${stars}</div>`
      + `<svg class="sp-lines" viewBox="0 0 1280 720" aria-hidden="true">${lines}</svg>`
      + `<div class="sp-hubs">${hubs}</div>`
      + `<div class="sp-shoot a"></div><div class="sp-shoot b" style="--sx:70%;--sy:8%"></div>`
      + `<div class="sp-wrap">`
      + (s.badge ? `<div class="sp-badge r"><i class="sp-dot"></i>${t(s.badge)}</div>` : '')
      + logo
      + `<h1 aria-label="${esc(s.title)}">${words(s.title, 'sp-w', 0.4, 0.3)}</h1>`
      + `<div class="sp-rule"></div>`
      + (s.lead ? `<p class="sp-lead">${t(s.lead)}</p>` : '')
      + card
      + (bts ? `<div class="sp-row">${bts}</div>` : '')
      + `</div>`;
  },
  mount(el, _p, ctx) {
    if (ctx.reducedMotion) return;
    const hubs = el.querySelector<HTMLElement>('.sp-hubs');
    const stars = el.querySelector<HTMLElement>('.sp-stars');
    const onMove = (e: MouseEvent) => {
      if (!el.classList.contains('on')) return;
      const r = ctx.stage.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      if (hubs) hubs.style.transform = `translate(${px * -14}px,${py * -14}px)`;
      if (stars) stars.style.transform = `translate(${px * -6}px,${py * -6}px)`;
    };
    ctx.stage.addEventListener('mousemove', onMove);
    return () => ctx.stage.removeEventListener('mousemove', onMove);
  },
});
