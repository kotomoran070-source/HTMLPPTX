/**
 * Вид фигуры и рисунка прямо на слайде, без записи и пересборки: так примеряют варианты с ленты
 * и показывают ручки «Свойств», пока их тянут. Разметка — тем же кодом, что на слайде.
 */
import { imageLookCss, type ImageLook } from '../components/layout/image-look';
import { getBlock } from '../engine/component';
import { frameCss } from '../engine/marks';
import type { Block } from '../types';

/** Разметка блока тем же кодом, что на слайде */
export const blockEl = (type: string, b: Block): Element | null => {
  const t = document.createElement('div');
  t.innerHTML = getBlock(type)?.render(b, {} as never) ?? '';
  return t.firstElementChild;
};

export const putStyle = (el: Element | null, v: string | null) => {
  if (!el) return;
  if (v === null) el.removeAttribute('style');
  else el.setAttribute('style', v);
};

/** Элемент фигуры внутри корня блока на слайде */
export const shapeEl = (root: HTMLElement): HTMLElement | null => (root.matches('.shape') ? root : root.querySelector('.shape'));

/** Фигура с видом блока b */
export function applyShapeLook(el: HTMLElement, b: Block): void {
  const n = blockEl('shape', b);
  if (!n) return;
  // Классы правки (выделение и т. п.) остаются, классы фигуры — новые
  el.className = [...[...el.classList].filter((c) => !c.startsWith('shape')), ...n.classList].join(' ');
  putStyle(el, n.getAttribute('style'));
  // Фигура PowerPoint: слои заливки и контура — новые, текст и его правка остаются
  el.querySelectorAll(':scope > :is(.shape-f, .shape-o)').forEach((x) => x.remove());
  el.prepend(...n.querySelectorAll(':scope > :is(.shape-f, .shape-o)'));
  const prst = n.getAttribute('data-prst');
  if (prst) el.setAttribute('data-prst', prst);
  else el.removeAttribute('data-prst');
}

/** Рамка снимка внутри корня блока (картинки или плитки с фото) */
export const imageEl = (root: HTMLElement): HTMLElement | null => root.querySelector('.imgbox');

/** Рисунок с видом блока: оформление — на рамке .imgbox и самом снимке */
export function applyImageLook(bx: HTMLElement, blk: Block): void {
  const b = blk as ImageLook & Parameters<typeof frameCss>[0];
  const look = imageLookCss(b);
  bx.className = `${bx.className.replace(/\s*\bimg-(fx|tint|round|crop)\b/g, '')}${look.cls}`;
  putStyle(bx, look.box || null);
  // Тень и свечение обрезанного по фигуре — на обёртке, снаружи маски
  if (bx.parentElement?.classList.contains('imgfit')) putStyle(bx.parentElement, look.wrap || null);
  const img = bx.querySelector('img');
  if (img) putStyle(img, `${frameCss(b)}${look.img ? `;${look.img}` : ''}`);
}
