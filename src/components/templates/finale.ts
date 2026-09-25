import { defineTemplate } from '../../engine/component';
import { asArray, esc, t } from '../../engine/html';
import { ea, eurl } from '../../engine/marks';
import type { SlideData } from '../../types';
import { icon } from '../icons';
import { qrSvg } from '../qr';
import { logoImg } from './content';
import './finale.css';

export interface FinaleLink {
  /** Подпись над ссылкой: «Сайт проекта» */
  label?: string;
  url: string;
  /** Текст ссылки (по умолчанию url без https://) */
  text?: string;
  /** Показывать QR-код этой ссылки (по умолчанию да) */
  qr?: boolean;
}

export interface FinaleButton {
  icon?: string;
  label: string;
  url?: string;
}

export interface FinaleSlide extends SlideData {
  title: string;
  lead?: string;
  caption?: string;
  link?: FinaleLink;
  buttons?: FinaleButton[];
}

/** Заголовок, в котором слова по одному выплывают из размытия. */
export function words(title: string, cls: string, first = 0.5, step = 0.35): string {
  return title.split(/\s+/).filter(Boolean)
    .map((w, k) => `<span class="${cls}" style="--w:${(first + k * step).toFixed(2)}s">${t(w)}</span>`).join(' ');
}

export function linkText(l: FinaleLink): string {
  return l.text ?? l.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Кнопка-иконка, у которой при наведении выезжает подпись. */
export function button(b: FinaleButton, cls: string): string {
  const inner = `<i>${icon(b.icon)}</i><span${ea(b, 'label')}>${t(b.label)}</span>`;
  return b.url
    ? `<a class="${cls}" href="${esc(b.url)}" target="_blank" rel="noopener" aria-label="${esc(b.label)}"${eurl(b, 'url')}>${inner}</a>`
    : `<div class="${cls}" tabindex="0" aria-label="${esc(b.label)}"${eurl(b, 'url')}>${inner}</div>`;
}

/** Финальный слайд: кольца, световой луч, анимированный заголовок и плашка с QR и контактами. */
defineTemplate<FinaleSlide>('finale', {
  className: 'fin',
  render(s, ctx) {
    const rings = [0, 1.5, 3, 4.5].map((d) => `<circle cx="640" cy="200" r="54" style="--d:${d}s"/>`).join('');
    const logo = ctx.logo ? `<div class="logo fin-logo">${logoImg(ctx.logo)}</div>` : '';
    let plate = '';
    if (s.link || s.buttons?.length) {
      const l = s.link;
      const qr = l && l.qr !== false ? `<div class="qr">${qrSvg(l.url, ctx.logo, `QR-код: ${l.url}`)}</div>` : '';
      const primary = l
        ? `<a class="it primary" href="${esc(l.url)}" target="_blank" rel="noopener"${eurl(l, 'url')}><i>${icon('browser')}</i><div>`
          + (l.label ? `<small${ea(l, 'label')}>${t(l.label)}</small>` : '') + `<b${ea(l, 'text')}>${t(linkText(l))}</b></div></a>`
        : '';
      const bts = asArray(s.buttons).map((b) => button(b, 'bt neutral')).join('');
      plate = `<div class="plate${qr ? '' : ' noqr'}">${qr}<div class="pl">${primary}${bts ? `<div class="bts">${bts}</div>` : ''}</div></div>`;
    }
    return `<svg class="rg" viewBox="0 0 1280 720" aria-hidden="true">${rings}</svg><div class="beam"></div>`
      + (s.caption ? `<div class="cap"${ea(s, 'caption')}>${t(s.caption)}</div>` : '')
      + logo
      + `<h1 aria-label="${esc(s.title)}"${ea(s, 'title')}>${words(s.title, 'w')}</h1>`
      + `<div class="ln2"></div>`
      + (s.lead ? `<p class="lead"${ea(s, 'lead')}>${t(s.lead)}</p>` : '')
      + plate;
  },
});
