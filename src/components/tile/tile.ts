import { defineBlock } from '../../engine/component';
import { esc, styleAttr, t } from '../../engine/html';
import { ea, eimg, frameCss, themedSrc, type ImageFrame } from '../../engine/marks';
import type { Block } from '../../types';
import { imageLookCss, type ImageLook } from '../layout/image-look';
import './tile.css';

/** Встроенные иллюстрации оборудования. Мигающие индикаторы — SMIL-анимация. */
const ILLUSTRATIONS: Record<string, { viewBox: string; maxWidth?: number; svg: string }> = {
  assembly: {
    viewBox: '0 0 320 170',
    svg: '<rect x="70" y="56" width="180" height="86" rx="14" fill="var(--surf)" stroke="var(--acb)" stroke-width="2"/>'
      + '<rect x="88" y="74" width="60" height="50" rx="6" fill="var(--acs)"/>'
      + '<circle cx="230" cy="76" r="5" fill="var(--ac)"><animate attributeName="opacity" values="1;.2;1" dur="1.6s" repeatCount="indefinite"/></circle>'
      + '<path d="M110 56V22M110 22l-8 8M110 22l8 8" stroke="var(--ac)" stroke-width="2.5" fill="none" stroke-linecap="round"/>'
      + '<path d="M180 100h50M180 116h30" stroke="var(--bd2)" stroke-width="3" stroke-linecap="round"/>',
  },
  endpoints: {
    viewBox: '0 0 150 90',
    maxWidth: 230,
    svg: '<rect x="20" y="30" width="34" height="42" rx="6" fill="var(--surf)" stroke="var(--acb)" stroke-width="2"/>'
      + '<path d="M37 30V12" stroke="var(--ac)" stroke-width="2" stroke-linecap="round"/><circle cx="37" cy="50" r="4" fill="var(--ac)"/>'
      + '<rect x="72" y="30" width="34" height="42" rx="6" fill="var(--surf)" stroke="var(--acb)" stroke-width="2"/>'
      + '<path d="M89 30V12" stroke="var(--ac)" stroke-width="2" stroke-linecap="round"/><circle cx="89" cy="50" r="4" fill="var(--ac)"/>',
  },
  station: {
    viewBox: '0 0 150 90',
    maxWidth: 230,
    svg: '<rect x="25" y="34" width="100" height="38" rx="8" fill="var(--surf)" stroke="var(--acb)" stroke-width="2"/>'
      + '<path d="M45 34V10M105 34V10" stroke="var(--ac)" stroke-width="2" stroke-linecap="round"/>'
      + '<g fill="var(--ac)"><circle cx="45" cy="53" r="3"><animate attributeName="opacity" values="1;.2;1" dur="1.2s" repeatCount="indefinite"/></circle>'
      + '<circle cx="58" cy="53" r="3"/>'
      + '<circle cx="71" cy="53" r="3"><animate attributeName="opacity" values="1;.2;1" dur="1.9s" repeatCount="indefinite"/></circle></g>',
  },
};

interface TileProps extends Block, ImageFrame, ImageLook {
  /** Встроенная иллюстрация: assembly, endpoints, station */
  illustration?: string;
  /** Или своя картинка: ./assets/photo.jpg */
  image?: string;
  /** Свой вариант фото для тёмной темы */
  imageDark?: string;
  fit?: 'cover' | 'contain';
  caption?: string;
}

/** Плитка с иллюстрацией или фото и подписью. */
defineBlock<TileProps>('tile', {
  render(p) {
    let media = '';
    const il = p.illustration ? ILLUSTRATIONS[p.illustration] : undefined;
    if (p.image) {
      // Оформление фото — как у картинки (вкладка «Рисунок»): рамка, тень, скругление, цвет
      const look = imageLookCss(p);
      media = `<div class="imgbox${look.cls}"${look.box ? ` style="${look.box}"` : ''}><img${themedSrc(p.image, p.imageDark)} alt="${esc(p.caption ?? '')}" style="${frameCss(p)}${look.img ? `;${look.img}` : ''}"></div>`;
    } else if (il) {
      media = `<svg viewBox="${il.viewBox}"${styleAttr(il.maxWidth && `max-width:${il.maxWidth}px`)} aria-hidden="true">${il.svg}</svg>`;
    } else {
      media = `<div class="tile-empty">Нет картинки</div>`;
    }
    const cap = p.caption ? `<span class="mu"${ea(p, 'caption')}>${t(p.caption)}</span>` : '';
    const cls = p.image ? ' photo' : il ? '' : ' empty';
    return `<div class="tile r${cls}"${eimg(p, 'image')}${styleAttr(p.style)}>${media}${cap}</div>`;
  },
});
