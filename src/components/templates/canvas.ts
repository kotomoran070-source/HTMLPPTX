import { defineTemplate } from '../../engine/component';
import type { SlideData } from '../../types';

interface CanvasSlide extends SlideData {
  /** Цвет или CSS-фон слайда */
  bg?: string;
}

/** Цвет или слои фона (градиенты); без url() и символов, ломающих атрибут style */
const BG = /^[^;{}<>"\\]+$/;
const safeBg = (v: string) => BG.test(v) && !/url\s*\(|expression|javascript:/i.test(v);

/**
 * Пустой холст: всё содержимое — свободные объекты (free) на своих координатах.
 * Так устроены слайды, импортированные из Claude Design. body, если есть, — поверх фона.
 */
defineTemplate<CanvasSlide>('canvas', {
  className: 'canvas-slide',
  render(s, ctx) {
    const bg = typeof s.bg === 'string' && safeBg(s.bg.trim()) ? `<div class="canvas-bg" style="background:${s.bg.trim()}"></div>` : '';
    return `${bg}${s.body ? `<div class="slide-body">${ctx.block(s.body)}</div>` : ''}`;
  },
});
