import { defineTemplate } from '../../engine/component';
import { esc, t } from '../../engine/html';
import type { Block, SlideData } from '../../types';
import './cover.css';

interface CoverSlide extends SlideData {
  title: string;
  lead?: string;
  meta?: string;
  /** Блок справа, например { type: network } */
  visual?: Block;
}

/** Титульный слайд: логотип, заголовок, подзаголовок и живая графика справа. */
defineTemplate<CoverSlide>('cover', {
  className: 'cover',
  render(s, ctx) {
    const logo = ctx.logo ? `<div class="logo r"><img src="${esc(ctx.logo)}" alt=""></div>` : '';
    return `<div class="cover-grid${s.visual ? '' : ' solo'}">`
      + `<div class="cover-text">${logo}`
      + `<h1 class="r">${t(s.title)}</h1>`
      + (s.lead ? `<p class="lead r">${t(s.lead)}</p>` : '')
      + (s.meta ? `<p class="mu r">${t(s.meta)}</p>` : '')
      + `</div>`
      + (s.visual ? `<div class="cover-visual r">${ctx.block(s.visual)}</div>` : '')
      + `</div>`;
  },
});
