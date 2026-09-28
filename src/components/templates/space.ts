import { defineBlock, defineTemplate } from '../../engine/component';
import { asArray, esc, t } from '../../engine/html';
import { ea, eurl, tx } from '../../engine/marks';
import { qrSvg } from '../qr';
import { logoImg } from './content';
import { button, linkText, words, type FinaleSlide } from './finale';
import './space.css';

interface SpaceSlide extends FinaleSlide {
  /** Надпись в «пилюле» над логотипом */
  badge?: string;
  /** orbit — орбиты вокруг стеклянного логотипа, надпись в углу, кнопки внутри карточки */
  layout?: 'orbit';
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
    const orbit = s.layout === 'orbit';
    const logo = ctx.logo
      ? `<div class="sp-logow r"><div class="sp-halo"></div>${orbit ? '' : '<div class="sp-orbit"><i></i></div>'}<div class="sp-tile">${logoImg(ctx.logo)}</div></div>`
      : '';
    const l = s.link;
    const link = l
      ? `<a class="sp-card" href="${esc(l.url)}" target="_blank" rel="noopener"${eurl(l, 'url')}>`
        + (l.qr !== false ? `<div class="sp-qrbox">${qrSvg(l.url, ctx.logo, `QR-код: ${l.url}`)}</div>` : '')
        + `<div>${l.label ? `<small${ea(l, 'label')}>${t(l.label)}</small>` : ''}<b${ea(l, 'text')}>${t(linkText(l))}</b></div></a>`
      : '';
    const bts = asArray(s.buttons).map((b) => button(b, 'sp-gbt')).join('');
    // В варианте «орбита» ссылка и кнопки — одна широкая карточка
    const card = orbit && (link || bts)
      ? `<div class="sp-panel">${link}${link && bts ? '<i class="sp-sep"></i>' : ''}${bts ? `<div class="sp-row">${bts}</div>` : ''}</div>`
      : link;
    return skyHtml(orbit)
      + `<div class="sp-wrap${orbit ? ' orbit' : ''}">`
      + (s.badge ? `<div class="sp-badge r">${orbit ? '' : '<i class="sp-dot"></i>'}${tx(s, 'badge')}</div>` : '')
      + logo
      + `<h1 aria-label="${esc(s.title)}"${ea(s, 'title')}>${words(s.title, 'sp-w', 0.4, 0.3)}</h1>`
      + (orbit ? '' : `<div class="sp-rule"></div>`)
      + (s.lead ? `<p class="sp-lead"${ea(s, 'lead')}>${t(s.lead)}</p>` : '')
      + card
      + (!orbit && bts ? `<div class="sp-row">${bts}</div>` : '')
      + `</div>`;
  },
  mount(el, _p, ctx) {
    return mountSky(el, el, ctx.stage, ctx.reducedMotion);
  },
});

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
function mountSky(root: HTMLElement, slide: HTMLElement, stage: HTMLElement, still: boolean): (() => void) | undefined {
  const cv = root.querySelector<HTMLCanvasElement>('.sp-cv');
  const stopSky = cv ? cosmos(slide, cv, stage, still) : undefined;
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

const W = 1280;
const H = 720;
/** Центр логотипа в варианте «орбита»: отсюда расходятся импульсы */
const PULSE: [number, number] = [640, 232];
const NODE_COLORS = ['56, 189, 248', '129, 140, 248', '52, 211, 153', '96, 165, 250', '167, 139, 250'];

/**
 * Небо «орбиты»: мерцающие звёзды, немного медленно дрейфующих узлов со связями,
 * узлы расступаются от курсора, от логотипа раз в ~4 с расходится волна, клик — своя волна.
 * Анимация идёт только пока слайд показан.
 */
function cosmos(el: HTMLElement, cv: HTMLCanvasElement, stage: HTMLElement, still: boolean): () => void {
  const g = cv.getContext('2d');
  if (!g) return () => {};
  g.scale(cv.width / W, cv.height / H);
  const r = rng(7);
  const stars = Array.from({ length: 120 }, () => ({ x: r() * W, y: r() * H, rad: r() * 1.5 + 0.3, a: r() * 0.7 + 0.2, sp: r() * 0.03 + 0.01, ph: r() * 6.28 }));
  const nodes = Array.from({ length: 16 }, () => ({
    x: r() * W, y: r() * H, vx: (r() - 0.5) * 0.24, vy: (r() - 0.5) * 0.24,
    rad: r() * 1.6 + 1.3, c: NODE_COLORS[Math.floor(r() * NODE_COLORS.length)], glow: r() * 6 + 5,
  }));
  const waves: { x: number; y: number; rad: number; max: number; a: number }[] = [];
  const mouse = { x: 0, y: 0, on: false };
  let lastPulse = 0;
  let raf = 0;

  const frame = (now: number) => {
    g.clearRect(0, 0, W, H);
    for (const s of stars) {
      if (!still) s.ph += s.sp;
      g.beginPath();
      g.arc(s.x, s.y, s.rad, 0, 6.2832);
      g.fillStyle = `rgba(255,255,255,${s.a * (0.6 + 0.4 * Math.sin(s.ph))})`;
      g.fill();
    }
    if (!still && now - lastPulse > 3800) {
      lastPulse = now;
      waves.push({ x: PULSE[0], y: PULSE[1], rad: 20, max: 960, a: 0.75 });
    }
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i];
      w.rad += 2.8;
      w.a *= 0.972;
      g.lineWidth = 1.6;
      g.strokeStyle = `rgba(56,189,248,${w.a * 0.75})`;
      g.beginPath(); g.arc(w.x, w.y, w.rad, 0, 6.2832); g.stroke();
      if (w.rad > 40) {
        g.lineWidth = 0.9;
        g.strokeStyle = `rgba(129,140,248,${w.a * 0.35})`;
        g.beginPath(); g.arc(w.x, w.y, w.rad * 0.82, 0, 6.2832); g.stroke();
      }
      if (w.a < 0.015 || w.rad > w.max) waves.splice(i, 1);
    }
    nodes.forEach((p, i) => {
      if (!still) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10; else if (p.y > H + 10) p.y = -10;
        if (mouse.on) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < 150 && d > 1) { const f = (150 - d) / 150; p.x -= (dx / d) * f * 1.2; p.y -= (dy / d) * f * 1.2; }
        }
      }
      g.beginPath();
      g.arc(p.x, p.y, p.rad, 0, 6.2832);
      g.fillStyle = `rgba(${p.c},.95)`;
      g.shadowColor = `rgba(${p.c},.8)`;
      g.shadowBlur = p.glow;
      g.fill();
      g.shadowBlur = 0;
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 170) {
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y);
          g.strokeStyle = `rgba(96,165,250,${(1 - d / 170) * 0.24})`;
          g.lineWidth = 0.85;
          g.stroke();
        }
      }
    });
    raf = !still && el.classList.contains('on') ? requestAnimationFrame(frame) : 0;
  };
  frame(0);
  if (still) return () => {};

  const toSlide = (e: MouseEvent) => {
    const b = stage.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * W, y: ((e.clientY - b.top) / b.height) * H };
  };
  const onMove = (e: MouseEvent) => { Object.assign(mouse, toSlide(e), { on: true }); };
  const onLeave = () => { mouse.on = false; };
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('a, button, .sp-panel') || document.body.classList.contains('editing')) return;
    const p = toSlide(e);
    waves.push({ x: p.x, y: p.y, rad: 10, max: 380, a: 1 });
  };
  el.addEventListener('mousemove', onMove);
  el.addEventListener('mouseleave', onLeave);
  el.addEventListener('click', onClick);
  // Слайд показан — анимация идёт, скрыт — стоит
  const mo = new MutationObserver(() => { if (el.classList.contains('on') && !raf) raf = requestAnimationFrame(frame); });
  mo.observe(el, { attributes: true, attributeFilter: ['class'] });
  return () => {
    cancelAnimationFrame(raf);
    mo.disconnect();
    el.removeEventListener('mousemove', onMove);
    el.removeEventListener('mouseleave', onLeave);
    el.removeEventListener('click', onClick);
  };
}
