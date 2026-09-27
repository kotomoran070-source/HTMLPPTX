import { defineBlock } from '../../engine/component';
import { asArray, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import './facts.css';

interface StatProps extends Block {
  /** Число или короткое значение: «3,4 млн», «99,7 %» */
  value: string | number;
  /** Что это за число */
  label?: string;
  /** Изменение: «+12 %» — зелёное со стрелкой вверх, «−5 %» — красное вниз */
  delta?: string;
  /** Мелкая подпись снизу */
  note?: string;
}

/** Ключевое число: крупное значение, подпись и изменение со стрелкой. */
defineBlock<StatProps>('stat', {
  render(p) {
    const d = typeof p.delta === 'string' ? p.delta.trim() : '';
    const dir = /^[-−–]/.test(d) ? 'down' : d ? 'up' : '';
    return `<div class="stat r"${styleAttr(p.style)}>`
      + `<b class="stat-v"${ea(p, 'value')}>${t(p.value)}</b>`
      + (p.label ? `<span class="stat-l"${ea(p, 'label')}>${t(p.label)}</span>` : '')
      + (d ? `<span class="stat-d ${dir}"><i aria-hidden="true">${dir === 'down' ? '↓' : '↑'}</i><span${ea(p, 'delta')}>${t(d)}</span></span>` : '')
      + (p.note ? `<small class="stat-n"${ea(p, 'note')}>${t(p.note)}</small>` : '')
      + `</div>`;
  },
});

interface QuoteProps extends Block {
  text: string;
  /** Кто сказал */
  author?: string;
  /** Должность, источник */
  role?: string;
}

/** Цитата: крупный текст с акцентной кавычкой и подписью. */
defineBlock<QuoteProps>('quote', {
  render(p) {
    return `<figure class="quote r"${styleAttr(p.style)}><span class="quote-mark" aria-hidden="true">“</span>`
      + `<blockquote${ea(p, 'text')}>${t(p.text)}</blockquote>`
      + (p.author || p.role ? `<figcaption>${p.author ? `<b${ea(p, 'author')}>${t(p.author)}</b>` : ''}${p.role ? `<span${ea(p, 'role')}>${t(p.role)}</span>` : ''}</figcaption>` : '')
      + `</figure>`;
  },
});

interface Milestone { date?: string; title: string; text?: string; done?: boolean }
interface TimelineProps extends Block {
  items: Milestone[];
}

/** Хронология: этапы на линии, пройденные — закрашены, линия прорисовывается слева направо. */
defineBlock<TimelineProps>('timeline', {
  render(p) {
    const items = asArray(p.items);
    const reached = items.filter((m) => m?.done).length;
    const progress = items.length > 1 ? Math.max(0, reached - 1) / (items.length - 1) : 0;
    return `<div class="timeline r" style="--n:${items.length};--done:${progress.toFixed(3)}${p.style ? `;${p.style}` : ''}">`
      + `<div class="tl-line"><i></i></div>`
      + items.map((m, k) => `<div class="tl-item${m?.done ? ' done' : ''}" style="--k:${k}"><span class="tl-dot"></span>`
        + (m?.date ? `<small${ea(m, 'date')}>${t(m.date)}</small>` : '')
        + `<b${ea(m, 'title')}>${t(m?.title ?? '')}</b>`
        + (m?.text ? `<span${ea(m, 'text')}>${t(m.text)}</span>` : '')
        + `</div>`).join('')
      + `</div>`;
  },
});
