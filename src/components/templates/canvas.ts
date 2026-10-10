import { defineTemplate } from '../../engine/component';
import type { SlideData } from '../../types';
import { bgOpacity } from '../../engine/backdrops';

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
    // Заметность фона (bgOpacity): сквозь него виден фон темы
    const op = bgOpacity(s);
    const bg = typeof s.bg === 'string' && safeBg(s.bg.trim()) ? `<div class="canvas-bg" style="background:${s.bg.trim()}${op < 1 ? `;opacity:${op}` : ''}"></div>` : '';
    return `${bg}${s.body ? `<div class="slide-body">${ctx.block(s.body)}</div>` : ''}`;
  },
});
