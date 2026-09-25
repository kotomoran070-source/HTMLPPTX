import { defineBlock } from '../../engine/component';
import { asArray, styleAttr, t } from '../../engine/html';
import { chips, ea } from '../../engine/marks';
import type { Block, ChipData } from '../../types';
import { linkHighlight } from '../highlight';
import { icon } from '../icons';
import './system.css';

interface Item {
  icon?: string;
  title: string;
  text?: string;
  chips?: ChipData[];
}

interface Group { label: string; chips: ChipData[] }

interface SystemProps extends Block {
  hardware: {
    title: string;
    /** Цепочка, соединённая бегущим импульсом (устройства → станция) */
    flow: Item[];
    /** Компактные пункты под цепочкой (прошивки, ПО) */
    items?: Item[];
  };
  server: { title: string; text?: string; groups: Group[] };
  database: { title: string; text?: string; chips: ChipData[] };
  interfaces: { title: string; items: Item[] };
  host: { title: string; chips: ChipData[] };
}

function sub(it: Item, cls = ''): string {
  return `<div class="sub ic ${cls}"><i>${icon(it.icon)}</i><div><b${ea(it, 'title')}>${t(it.title)}</b>`
    + (it.text ? `<span${ea(it, 'text')}>${t(it.text)}</span>` : '')
    + (it.chips?.length ? `<div class="cp">${chips(it.chips)}</div>` : '')
    + `</div></div>`;
}

const wire = (cls: string, delay = 0) => `<div class="wire ${cls}" style="--d:${delay}s"></div>`;

/**
 * Схема «Из чего состоит система»: оборудование → сервер и БД → интерфейсы, внизу серверный ПК.
 * Наведение на блок подсвечивает связанные с ним блоки.
 */
defineBlock<SystemProps>('system', {
  render(p) {
    const hw = p.hardware;
    const flow = asArray(hw.flow).map((it) => sub(it)).join(wire('v'));
    const extra = asArray(hw.items).map((it) => sub(it, 'fx')).join('');
    const hardware = `<div class="bk hw r" data-k="hw"><h3${ea(hw, 'title')}>${t(hw.title)}</h3>${flow}${extra}</div>`;

    const sv = p.server;
    const groups = asArray(sv.groups).map((g) =>
      `<div class="sub sw rowc"><em${ea(g, 'label')}>${t(g.label)}</em><div>${chips(g.chips)}</div></div>`).join('');
    const server = `<div class="bk sv" data-k="sv" data-h="sv pc"><h3${ea(sv, 'title')}>${t(sv.title)}</h3>`
      + (sv.text ? `<p class="d"${ea(sv, 'text')}>${t(sv.text)}</p>` : '') + groups + `</div>`;

    const db = p.database;
    const database = `<div class="bk db" data-k="db" data-h="db pc"><h3${ea(db, 'title')}>${t(db.title)}</h3>`
      + (db.text ? `<p class="d"${ea(db, 'text')}>${t(db.text)}</p>` : '') + `<div>${chips(db.chips)}</div></div>`;

    const ui = `<div class="bk ui r" data-k="ui" data-h="ui pc"><h3${ea(p.interfaces, 'title')}>${t(p.interfaces.title)}</h3>`
      + asArray(p.interfaces.items).map((it) => sub(it)).join('') + `</div>`;

    const host = `<div class="bk pc r" data-k="pc" data-h="pc sv db ui"><h3${ea(p.host, 'title')}>${t(p.host.title)}</h3><div>${chips(p.host.chips)}</div></div>`;

    return `<div class="sysg"${styleAttr(p.style)}>${hardware}${wire('w1')}`
      + `<div class="colB r">${server}${wire('v', 0.4)}${database}</div>`
      + `${wire('w2', 0.5)}${ui}${host}</div>`;
  },
  mount(el) {
    return linkHighlight(el);
  },
});
