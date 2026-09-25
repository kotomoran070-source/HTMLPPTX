import { defineTemplate } from '../../engine/component';
import { t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block, SlideData } from '../../types';
import { logoImg } from './content';
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
    const logo = ctx.logo ? `<div class="logo r">${logoImg(ctx.logo)}</div>` : '';
    return `<div class="cover-grid${s.visual ? '' : ' solo'}">`
      + `<div class="cover-text">${logo}`
      + `<h1 class="r"${ea(s, 'title')}>${t(s.title)}</h1>`
      + (s.lead ? `<p class="lead r"${ea(s, 'lead')}>${t(s.lead)}</p>` : '')
      + (s.meta ? `<p class="mu r"${ea(s, 'meta')}>${t(s.meta)}</p>` : '')
      + `</div>`
      + (s.visual ? `<div class="cover-visual r">${ctx.block(s.visual)}</div>` : '')
      + `</div>`;
  },
});
