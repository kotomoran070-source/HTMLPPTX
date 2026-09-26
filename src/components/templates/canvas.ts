import { defineTemplate } from '../../engine/component';
import type { SlideData } from '../../types';

interface CanvasSlide extends SlideData {
  /** Цвет или CSS-фон слайда */
  bg?: string;
}

const BG = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|[a-z]+|var\(--[a-z0-9-]+\))$/i;

/**
 * Пустой холст: всё содержимое — свободные объекты (free) на своих координатах.
 * Так устроены слайды, импортированные из Claude Design. body, если есть, — поверх фона.
 */
defineTemplate<CanvasSlide>('canvas', {
  className: 'canvas-slide',
  render(s, ctx) {
    const bg = typeof s.bg === 'string' && BG.test(s.bg.trim()) ? `<div class="canvas-bg" style="background:${s.bg.trim()}"></div>` : '';
    return `${bg}${s.body ? `<div class="slide-body">${ctx.block(s.body)}</div>` : ''}`;
  },
});
