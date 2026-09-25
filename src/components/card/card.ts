import { defineBlock } from '../../engine/component';
import { asArray, styleAttr, t } from '../../engine/html';
import { chips, ea, ekey, tx } from '../../engine/marks';
import type { Block, ChipData } from '../../types';
import './card.css';

interface CardProps extends Block {
  title?: string;
  text?: string;
  body?: Block | Block[];
}

/** Карточка: заголовок, текст и любые блоки внутри. */
defineBlock<CardProps>('card', {
  render(p, ctx) {
    return `<div class="card r"${styleAttr(p.style)}>`
      + (p.title ? `<h3${ea(p, 'title')}>${t(p.title)}</h3>` : '')
      + (p.text ? `<p${ea(p, 'text')}>${t(p.text)}</p>` : '')
      + ctx.block(p.body)
      + `</div>`;
  },
});

interface PanelCell { title: string; sub?: string; cols?: number }
interface PanelProps extends Block {
  title: string;
  cells: (PanelCell | string)[];
  columns?: number;
}

/** Выделенная панель с ячейками, например состав сервера. */
defineBlock<PanelProps>('panel', {
  render(p) {
    const list = asArray(p.cells);
    const cells = list.map((c, i) => {
      if (typeof c === 'string') return `<div${ea(list, i)}>${t(c)}</div>`;
      return `<div${styleAttr(c.cols && `grid-column:span ${c.cols}`)}>${tx(c, 'title')}${c.sub ? `<small${ea(c, 'sub')}>${t(c.sub)}</small>` : ''}</div>`;
    });
    return `<div class="panel r"${styleAttr(p.style)}><b${ea(p, 'title')}>${t(p.title)}</b>`
      + `<div class="cells" style="grid-template-columns:repeat(${p.columns ?? 2},1fr)">${cells.join('')}</div></div>`;
  },
});

interface KvProps extends Block {
  /** Пары «ключ — значение»: словарь или список [ключ, значение] */
  rows: Record<string, string> | [string, string][];
  keyWidth?: number;
}

/** Таблица «ключ — значение». */
defineBlock<KvProps>('kv', {
  render(p) {
    const w = p.keyWidth ?? 110;
    const row = (k: string, v: string, ka: string, va: string) =>
      `<div class="kv" style="grid-template-columns:${w}px 1fr"><b${ka}>${t(k)}</b><span${va}>${t(v)}</span></div>`;
    let rows: string[];
    if (Array.isArray(p.rows)) {
      rows = p.rows.map((r) => row(r[0], r[1], ea(r, 0), ea(r, 1)));
    } else {
      const map = p.rows ?? {};
      rows = Object.entries(map).map(([k, v]) => row(k, v, ekey(map, k), ea(map, k, { noStyle: true })));
    }
    return `<div class="kvs"${styleAttr(p.style)}>${rows.join('')}</div>`;
  },
});

interface ProgressProps extends Block {
  label?: string;
  value?: string;
  /** Заполнение, 0–100 */
  percent: number;
}

/** Прогресс-бар с подписями, заполняется при появлении слайда. */
defineBlock<ProgressProps>('progress', {
  render(p) {
    const pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
    return `<div class="progress"${styleAttr(p.style)}>`
      + `<div class="row"><span${ea(p, 'label')}>${t(p.label ?? '')}</span><span${ea(p, 'value')}>${t(p.value ?? '')}</span></div>`
      + `<div class="bar1"><div class="fill" style="--w:${pct}%"></div></div></div>`;
  },
});

interface SliderRow { label: string; value: string; /** Положение ползунка 0–1 */ position: number }
interface SlidersProps extends Block { rows: SliderRow[] }

/** Строки настроек с ползунками, которые сдвигаются при появлении слайда. */
defineBlock<SlidersProps>('sliders', {
  render(p) {
    return `<div class="sliders"${styleAttr(p.style)}>` + asArray(p.rows).map((r) => {
      const pos = Math.max(0, Math.min(1, Number(r.position) || 0));
      return `<div class="tg"><span${ea(r, 'label')}>${t(r.label)}</span><span class="trk" style="--p:${(pos * 94).toFixed(1)}px"></span><b${ea(r, 'value')}>${t(r.value)}</b></div>`;
    }).join('') + `</div>`;
  },
});

interface ChipsProps extends Block { items: ChipData[] }

/** Ряд чипов: сводка, технологии, метки. «Go*» — выделенный чип. */
defineBlock<ChipsProps>('chips', {
  render(p) {
    return `<div class="chips r"${styleAttr(p.style)}>${chips(p.items)}</div>`;
  },
});
