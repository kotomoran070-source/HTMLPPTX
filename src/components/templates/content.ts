import { defineTemplate } from '../../engine/component';
import { styleAttr, t } from '../../engine/html';
import { ea, eimgPath, themedSrc } from '../../engine/marks';
import type { SlideData } from '../../types';

interface ContentSlide extends SlideData {
  /** Расстояние между блоками тела слайда, px */
  gap?: number;
}

/** Логотип презентации: все логотипы правятся как один — brand.logo. */
export function logoImg(url: string, dark?: string): string {
  return `<img${themedSrc(url, dark)} alt=""${eimgPath(['brand', 'logo'])}>`;
}

/**
 * Класс плашки логотипа: есть свой вариант для тёмной темы — в тёмной теме плашка тёмная
 * (белая нужна, чтобы любой логотип читался; вариант для тёмной темы рисуют под тёмный фон)
 */
export function logoCls(dark?: string): string {
  return dark ? ' has-dark' : '';
}

export function cornerLogo(url: string | undefined, dark?: string): string {
  return url ? `<div class="logo corner-logo${logoCls(dark)}">${logoImg(url, dark)}</div>` : '';
}

/** Обычный слайд: заголовок, необязательный чип и тело из блоков. */
defineTemplate<ContentSlide>('content', {
  render(s, ctx) {
    const head = s.title
      ? `<div class="slide-head r"><h2${ea(s, 'title')}>${t(s.title)}</h2>${s.badge ? `<span class="chip a"${ea(s, 'badge')}>${t(s.badge)}</span>` : ''}</div>`
      : '';
    const logo = s.logo === false ? '' : cornerLogo(ctx.logo, ctx.logoDark);
    return `${logo}${head}<div class="slide-body"${styleAttr(s.gap != null && `gap:${s.gap}px`)}>${ctx.block(s.body)}</div>`;
  },
});
