import { defineTemplate } from '../../engine/component';
import { esc, styleAttr, t } from '../../engine/html';
import type { SlideData } from '../../types';

interface ContentSlide extends SlideData {
  /** Расстояние между блоками тела слайда, px */
  gap?: number;
}

export function cornerLogo(url: string | undefined): string {
  return url ? `<div class="logo corner-logo"><img src="${esc(url)}" alt=""></div>` : '';
}

/** Обычный слайд: заголовок, необязательный чип и тело из блоков. */
defineTemplate<ContentSlide>('content', {
  render(s, ctx) {
    const head = s.title
      ? `<div class="slide-head r"><h2>${t(s.title)}</h2>${s.badge ? `<span class="chip a">${t(s.badge)}</span>` : ''}</div>`
      : '';
    const logo = s.logo === false ? '' : cornerLogo(ctx.logo);
    return `${logo}${head}<div class="slide-body"${styleAttr(s.gap != null && `gap:${s.gap}px`)}>${ctx.block(s.body)}</div>`;
  },
});
