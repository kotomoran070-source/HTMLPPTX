import { defineBlock } from '../../engine/component';
import { asArray, styleAttr } from '../../engine/html';
import { angleOf, placeOf } from '../../engine/render';
import type { Block } from '../../types';
import './group.css';

interface GroupProps extends Block {
  /**
   * Объекты группы. У каждого place — от левого верхнего угла группы, в пикселях размера base.
   * Если группу растянуть, объекты растягиваются вместе с ней (текст остаётся своего размера).
   */
  items: Block[];
  /** Размер группы в момент группировки: от него считаются места объектов */
  base?: { w: number; h: number };
}

const pct = (v: number, of: number) => `${Math.round((v / of) * 100000) / 1000}%`;

/** Группа: несколько объектов, которые двигаются и растягиваются как один. */
defineBlock<GroupProps>('group', {
  render(p, ctx) {
    const items = asArray(p.items).filter((b): b is Block => !!b && typeof b === 'object');
    const bw = Math.max(1, Number(p.base?.w) || Math.max(1, ...items.map((b) => placeOf(b).x + placeOf(b).w)));
    const bh = Math.max(1, Number(p.base?.h) || Math.max(1, ...items.map((b) => placeOf(b).y + (placeOf(b).h ?? 0))));
    return `<div class="grp"${styleAttr(p.style)}>${items.map((b) => {
      const pl = placeOf(b);
      const ang = angleOf(b);
      const css = `left:${pct(pl.x, bw)};top:${pct(pl.y, bh)};width:${pct(pl.w, bw)};${pl.h ? `height:${pct(pl.h, bh)};` : ''}${ang ? `rotate:${ang}deg;` : ''}`;
      return `<div class="grp-item${pl.h ? '' : ' auto-h'}" style="${css}">${ctx.block(b)}</div>`;
    }).join('')}</div>`;
  },
});
