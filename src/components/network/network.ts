import { defineBlock } from '../../engine/component';
import { styleAttr } from '../../engine/html';
import type { Block } from '../../types';
import './network.css';

interface NetworkProps extends Block {
  /** Количество оконечных устройств вокруг станции */
  nodes?: number;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Живая схема сети: станция в центре, устройства по кругу, импульсы бегут к станции. */
defineBlock<NetworkProps>('network', {
  render(p) {
    const n = Math.max(1, Math.min(24, p.nodes ?? 7));
    const cx = 210;
    const cy = 180;
    const pulses = !reducedMotion();
    let o = '';
    for (let k = 0; k < 3; k++) o += `<circle class="ring" cx="${cx}" cy="${cy}" r="18" style="--d:${(k * 1.05).toFixed(2)}s"/>`;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.283 + 0.4;
      const x = +(cx + Math.cos(a) * 160).toFixed(2);
      const y = +(cy + Math.sin(a) * 130).toFixed(2);
      o += `<line class="ln" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`
        + `<rect class="ndv" x="${x - 14}" y="${y - 14}" width="28" height="28" rx="7"/>`
        + `<circle class="sta" cx="${x}" cy="${y}" r="3.5"/>`;
      if (pulses) {
        o += `<circle class="pk" r="3.5"><animateMotion dur="2.6s" begin="${(k * 0.37).toFixed(2)}s" repeatCount="indefinite" path="M${x} ${y} L${cx} ${cy}"/></circle>`;
      }
    }
    o += `<rect class="sta" x="${cx - 18}" y="${cy - 18}" width="36" height="36" rx="9"/>`
      + `<path d="M${cx} ${cy - 18}v-14" stroke="var(--ac)" stroke-width="3" stroke-linecap="round"/>`;
    return `<svg class="network" viewBox="0 0 420 360"${styleAttr(p.style)} role="img" aria-label="Схема сети">${o}</svg>`;
  },
});
