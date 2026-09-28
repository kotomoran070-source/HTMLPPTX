import { defineBlock } from '../../engine/component';
import { asArray } from '../../engine/html';
import { button, plateHtml, type FinaleButton, type FinaleLink } from './finale';
import { spaceCardHtml, spacePanelHtml } from './space';
import './contacts.css';

/**
 * Ссылка с QR и кнопки финальных слайдов отдельными объектами — после «Разобрать на объекты».
 * Рисуются тем же кодом, что и в шаблоне: адрес и подписи правятся в панели свойств,
 * QR строится заново из адреса. look — чей вид: space, orbit (космос-орбита), fin (финал).
 *   type: link-card     link: { label, url, text, qr }
 *   type: link-buttons  buttons: [{ icon, label, url }]
 *   type: link-plate    link, buttons — плашка «Финала» или широкая карточка «орбиты»
 */
interface Contacts {
  look?: string;
  link?: FinaleLink;
  buttons?: FinaleButton[];
}

/** Контекст шаблона без своей раскладки: его стили и анимации действуют как на исходном слайде */
function wrap(look: string | undefined, html: string): string {
  const tpl = look === 'fin' ? 'fin' : 'space';
  const inner = tpl === 'space' ? `<div class="sp-wrap${look === 'orbit' ? ' orbit' : ''}" style="display:contents">${html}</div>` : html;
  return `<div class="contacts-block"><div class="tpl-part ${tpl}" style="display:contents">${inner}</div></div>`;
}

const bts = (p: Contacts, cls: string) => asArray(p.buttons).map((b) => button(b, cls)).join('');

defineBlock<Contacts>('link-card', {
  render(p, ctx) {
    return wrap(p.look, spaceCardHtml(p.link, ctx.logo) || '<div class="contacts-empty">Укажите адрес ссылки</div>');
  },
});

defineBlock<Contacts>('link-buttons', {
  render(p) {
    const html = bts(p, 'sp-gbt');
    return wrap(p.look, html ? `<div class="sp-row">${html}</div>` : '<div class="contacts-empty">Добавьте кнопки</div>');
  },
});

defineBlock<Contacts>('link-plate', {
  render(p, ctx) {
    if (p.look === 'fin') return wrap('fin', plateHtml(p, ctx.logo) || '<div class="contacts-empty">Добавьте ссылку или кнопки</div>');
    const panel = spacePanelHtml(spaceCardHtml(p.link, ctx.logo), bts(p, 'sp-gbt'));
    return wrap('orbit', panel);
  },
});
