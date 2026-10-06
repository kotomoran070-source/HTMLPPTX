/**
 * Схемы и списки из пунктов «заголовок + текст» — все переключаются друг в друга («Вид» в свойствах):
 * цикл, воронка, пирамида, крупные номера, сравнение, матрица 2×2, иконки с подписями, цифры,
 * вопрос — ответ. У каждой своя анимация появления; в миниатюрах и PDF — конечный вид.
 */
import { defineBlock } from '../../engine/component';
import { asArray, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import { icon, iconNames } from '../icons';
import './schemes.css';

export interface Point { title: string; text?: string; icon?: string; accent?: boolean; [extra: string]: unknown }
interface ItemsProps extends Block { items: Point[] }

const pts = (p: ItemsProps): Point[] => asArray(p.items).filter((x): x is Point => !!x && typeof x === 'object');
const title = (m: Point, tag = 'b') => `<${tag}${ea(m, 'title')}>${t(m.title ?? '')}</${tag}>`;
const text = (m: Point, tag = 'span') => (m.text ? `<${tag}${ea(m, 'text')}>${t(m.text)}</${tag}>` : '');
const two = (k: number) => String(k + 1).padStart(2, '0');
const round = (v: number) => Math.round(v * 100) / 100;

// ---------------- цикл ----------------

interface CycleProps extends ItemsProps { center?: string }

/** Цикл: пункты по кольцу, стрелки прорисовываются по очереди, по кольцу бежит светящаяся точка. */
defineBlock<CycleProps>('cycle', {
  render(p) {
    const items = pts(p);
    const n = Math.max(1, items.length);
    const R = 150;
    const C = 200;
    const gap = Math.min(18, 120 / n);
    const at = (deg: number, r = R) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)];
    const angle = (k: number) => -90 + (k * 360) / n;
    const arcs = items.map((_, k) => {
      const [x1, y1] = at(angle(k) + gap);
      const [x2, y2] = at(angle(k + 1) - gap);
      const large = 360 / n - gap * 2 > 180 ? 1 : 0;
      return `<path class="cy-arc" style="--k:${k}" d="M${round(x1)} ${round(y1)} A${R} ${R} 0 ${large} 1 ${round(x2)} ${round(y2)}" marker-end="url(#cy-head)"/>`;
    }).join('');
    // Кольцо — квадрат по высоте блока (аспект 2.3:1): положения узлов и подписей — в процентах блока
    const ring = 100 / 2.3;
    const nodes = items.map((m, k) => {
      const a = (angle(k) * Math.PI) / 180;
      const x = 50 + Math.cos(a) * (R / 400) * ring;
      const y = 50 + Math.sin(a) * (R / 400) * 100;
      const lx = 50 + Math.cos(a) * ((R + 46) / 400) * ring;
      const ly = 50 + Math.sin(a) * ((R + 42) / 400) * 100;
      const side = Math.cos(a) > 0.3 ? 'r' : Math.cos(a) < -0.3 ? 'l' : Math.sin(a) < 0 ? 't' : 'b';
      return `<i class="cy-node" style="left:${round(x)}%;top:${round(y)}%;--k:${k}">${k + 1}</i>`
        + `<div class="cy-label ${side}" style="left:${round(lx)}%;top:${round(ly)}%;--k:${k}">${title(m)}${text(m)}</div>`;
    }).join('');
    return `<div class="cycle r"${styleAttr(p.style)}>`
      + `<svg class="cy-ring" viewBox="0 0 400 400" aria-hidden="true"><defs><marker id="cy-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 8 5 0 9z"/></marker></defs>`
      + `<circle class="cy-track" cx="${C}" cy="${C}" r="${R}"/>${arcs}</svg>`
      + `<div class="cy-orbit" aria-hidden="true"><i></i></div>`
      + (p.center ? `<div class="cy-center"><b${ea(p, 'center')}>${t(p.center)}</b></div>` : '')
      + nodes + `</div>`;
  },
});

// ---------------- воронка ----------------

/** Воронка: полосы сужаются и «наливаются» сверху вниз, сквозь горло падают капли. */
defineBlock<ItemsProps>('funnel', {
  render(p) {
    const items = pts(p);
    const n = Math.max(1, items.length);
    const top = 1;
    const bottom = 0.36;
    const w = (k: number) => top - ((top - bottom) * k) / n;
    const rows = items.map((m, k) => {
      const a = w(k);
      const b = w(k + 1);
      const clip = `polygon(${round(((1 - a) / 2) * 100)}% 0, ${round(((1 + a) / 2) * 100)}% 0, ${round(((1 + b) / 2) * 100)}% 100%, ${round(((1 - b) / 2) * 100)}% 100%)`;
      const mix = n > 1 ? Math.round((k / (n - 1)) * 100) : 0;
      return `<div class="fn-row" style="--k:${k}"><div class="fn-band" style="clip-path:${clip};--mix:${mix}%">${title(m)}</div>`
        + `<div class="fn-note"><i></i>${text(m) || '<span></span>'}</div></div>`;
    }).join('');
    return `<div class="funnel r" style="--n:${n}${p.style ? `;${p.style}` : ''}">${rows}<div class="fn-drops" aria-hidden="true"><i></i><i></i><i></i></div></div>`;
  },
});

// ---------------- пирамида ----------------

/** Пирамида: гранёные уровни (светлая и тёмная грань) растут снизу вверх; первый пункт — вершина. */
defineBlock<ItemsProps>('pyramid', {
  render(p) {
    const items = pts(p);
    const n = Math.max(1, items.length);
    const rows = items.map((m, k) => {
      const a = k / n;
      const b = (k + 1) / n;
      // Небольшой зазор между уровнями
      const clip = `polygon(${round(50 - a * 50)}% 0, ${round(50 + a * 50)}% 0, ${round(50 + b * 50)}% 100%, ${round(50 - b * 50)}% 100%)`;
      const tone = n > 1 ? Math.round((k / (n - 1)) * 70) : 0;
      return `<div class="py-row" style="--k:${k};--up:${n - 1 - k};--tone:${tone}%"><div class="py-band" style="clip-path:${clip}"><i>${k + 1}</i></div>`
        + `<div class="py-note">${title(m)}${text(m)}</div></div>`;
    }).join('');
    return `<div class="pyramid r" style="--n:${n}${p.style ? `;${p.style}` : ''}">${rows}</div>`;
  },
});

// ---------------- крупные номера ----------------

const cols = (n: number) => (n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4);

/** Крупные номера: контурные «01, 02…», которые заливаются цветом при появлении. */
defineBlock<ItemsProps>('numbers', {
  render(p) {
    const items = pts(p);
    return `<div class="numbers r" style="--c:${cols(items.length)}${p.style ? `;${p.style}` : ''}">${items.map((m, k) =>
      `<div class="nb-item" style="--k:${k}"><span class="nb-n" data-n="${two(k)}">${two(k)}</span>${title(m)}${text(m, 'p')}</div>`).join('')}</div>`;
  },
});

// ---------------- сравнение ----------------

/** Строки текста колонки: «+ есть» — галочка, «- нет» — крестик, остальное — обычная строка */
function points(s: string | undefined): string {
  if (!s) return '';
  return s.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const plus = /^\+\s*/.exec(line);
    const minus = /^[-−–]\s+/.exec(line);
    const body = t(line.slice((plus ?? minus)?.[0].length ?? 0));
    return `<li class="${plus ? 'yes' : minus ? 'no' : ''}">${plus ? icon('check') : minus ? icon('close') : '<i></i>'}<span>${body}</span></li>`;
  }).join('');
}

/** Сравнение: колонки-карточки; выбранная (accent) поднята, у двух колонок — «VS» между ними. */
defineBlock<ItemsProps>('compare', {
  render(p) {
    const items = pts(p);
    const n = Math.max(1, items.length);
    // Без отмеченной — у «было / стало» выделена вторая
    const featured = items.findIndex((m) => m.accent === true);
    const best = featured >= 0 ? featured : n === 2 ? 1 : -1;
    return `<div class="compare r${n === 2 ? ' duo' : ''}" style="--c:${n}${p.style ? `;${p.style}` : ''}">${items.map((m, k) =>
      `<div class="cmp-col${k === best ? ' best' : ''}" style="--k:${k}">${title(m, 'h4')}`
      + (m.text ? `<ul${ea(m, 'text')} data-points>${points(m.text)}</ul>` : '')
      + `</div>`).join('')}${n === 2 ? '<b class="cmp-vs" aria-hidden="true">VS</b>' : ''}</div>`;
  },
});

// ---------------- матрица 2×2 ----------------

interface MatrixProps extends ItemsProps { xAxis?: string; yAxis?: string }

/** Матрица 2×2: квадранты разной насыщенности, подписанные оси, пульсирующее перекрестье. */
defineBlock<MatrixProps>('matrix', {
  render(p) {
    const items = pts(p).slice(0, 4);
    const cells = Array.from({ length: 4 }, (_, k) => {
      const m = items[k];
      return `<div class="mx-cell q${k}${m ? '' : ' empty'}" style="--k:${k}">${m ? `<i>${k + 1}</i>${title(m)}${text(m)}` : ''}</div>`;
    }).join('');
    return `<div class="matrix r"${styleAttr(p.style)}>`
      + `<div class="mx-y">${p.yAxis ? `<span${ea(p, 'yAxis')}>${t(p.yAxis)}</span>` : ''}</div>`
      + `<div class="mx-grid">${cells}<i class="mx-cross" aria-hidden="true"></i></div>`
      + `<div class="mx-x">${p.xAxis ? `<span${ea(p, 'xAxis')}>${t(p.xAxis)}</span>` : ''}</div></div>`;
  },
});

// ---------------- иконки с подписями ----------------

/** Иконка по смыслу заголовка, если не задана своя */
const GUESS: [RegExp, string][] = [
  [/скорост|быстр|мгновен|производит|энерг/i, 'bolt'], [/безопас|защит|надёжн|надежн|гарант/i, 'shield'],
  [/команд|клиент|людей|пользоват|сообществ|партн/i, 'users'], [/врем|срок|час|минут|круглосут|24/i, 'clock'],
  [/цел|точн|фокус|результат/i, 'target'], [/рост|выручк|продаж|прибыл|динамик/i, 'trend'],
  [/деньг|цен|бюджет|экономи|стоим|оплат|тариф/i, 'wallet'], [/глоб|мир|страны|регион|международ/i, 'globe'],
  [/облак|сервер|хостинг/i, 'cloud'], [/данн|баз|хранил|аналит/i, 'database'], [/код|разработ|api|интеграц/i, 'code'],
  [/запуск|старт|быстрый рост/i, 'rocket'], [/иде|инновац|творч/i, 'bulb'], [/награ|лидер|побед|лучш/i, 'trophy'],
  [/эколог|зелён|зелен|природ/i, 'leaf'], [/настрой|автомат|процесс/i, 'gear'], [/поддерж|чат|общени|связ/i, 'chat'],
  [/забот|любов|здоров/i, 'heart'], [/качеств|отзыв|рейтинг/i, 'star'], [/календар|план|расписан/i, 'calendar'],
  [/покуп|магазин|корзин|заказ/i, 'cart'], [/адрес|мест|карт|офис|доставк/i, 'pin'], [/договор|сделк|сотруднич/i, 'handshake'],
  [/документ|отчёт|отчет/i, 'doc'], [/почт|рассыл|письм/i, 'mail'], [/телефон|звон/i, 'phone'],
];
const FALLBACK = ['bolt', 'shield', 'users', 'target', 'trend', 'star', 'globe', 'bulb'];
export function iconFor(m: Point, k: number): string {
  if (typeof m.icon === 'string' && iconNames.includes(m.icon)) return m.icon;
  const s = `${m.title ?? ''} ${m.text ?? ''}`;
  return GUESS.find(([re]) => re.test(s))?.[1] ?? FALLBACK[k % FALLBACK.length];
}

/** Иконки с подписями: плитка с иконкой по смыслу, вокруг неё при появлении пробегает свет. */
defineBlock<ItemsProps>('icons', {
  render(p) {
    const items = pts(p);
    return `<div class="icons r" style="--c:${Math.min(4, Math.max(1, items.length <= 4 ? items.length : items.length % 3 === 0 ? 3 : 4))}${p.style ? `;${p.style}` : ''}">${items.map((m, k) =>
      `<div class="ic-item" style="--k:${k}"><span class="ic-tile">${icon(iconFor(m, k))}</span>${title(m)}${text(m, 'p')}</div>`).join('')}</div>`;
  },
});

// ---------------- цифры ----------------

/** Цифры: число — в заголовке пункта («99,9 %»), подпись — в тексте; числа набегают при появлении. */
defineBlock<ItemsProps & { count?: boolean }>('stats', {
  render(p) {
    const items = pts(p);
    const count = p.count !== false;
    return `<div class="stats r" style="--c:${Math.max(1, items.length)}${p.style ? `;${p.style}` : ''}">${items.map((m, k) =>
      `<div class="st-item" style="--k:${k}"><b class="st-n"${ea(m, 'title')}${count ? ' data-count-num' : ''}>${t(m.title ?? '')}</b><i class="st-bar"></i>${text(m)}</div>`).join('')}</div>`;
  },
});

// ---------------- вопрос — ответ ----------------

/** Вопрос — ответ: при показе ответ раскрывается по щелчку; в правке, миниатюрах и PDF всё раскрыто. */
defineBlock<ItemsProps>('faq', {
  render(p) {
    const items = pts(p);
    return `<div class="faq r"${styleAttr(p.style)}>${items.map((m, k) =>
      `<div class="fq-item" style="--k:${k}"><div class="fq-q" data-nospot role="button" tabindex="0" aria-expanded="false"><em>${two(k)}</em>${title(m)}<i class="fq-plus" aria-hidden="true"></i></div>`
      + `<div class="fq-a"><div>${text(m, 'p')}</div></div></div>`).join('')}</div>`;
  },
  mount(el) {
    const toggle = (q: HTMLElement) => {
      if (document.body.classList.contains('editing') && !document.body.classList.contains('st-previewing')) return;
      const item = q.closest('.fq-item');
      const open = !item?.classList.contains('open');
      item?.classList.toggle('open', open);
      q.setAttribute('aria-expanded', String(open));
    };
    const onClick = (e: Event) => {
      const q = (e.target as Element).closest<HTMLElement>('.fq-q');
      if (q && el.contains(q)) toggle(q);
    };
    const onKey = (e: KeyboardEvent) => {
      const q = (e.target as Element).closest<HTMLElement>('.fq-q');
      if (q && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(q); }
    };
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey); };
  },
});

