/**
 * Схемы для проектных докладов: диаграмма Ганта, матрица рисков «вероятность × последствия»,
 * «рыбья кость» причин и следствий, матрица решений с весами критериев.
 * Ганта, риски и «рыбья кость» строятся из пунктов «заголовок + текст» и переключаются в другие схемы:
 * свои поля пунктов (сроки, вероятность, последствия) остаются и вернутся при обратной смене.
 * Матрица решений — своя сетка: критерии с весами, варианты и оценки; итог считается сам.
 */
import { defineBlock } from '../../engine/component';
import { asArray, esc, styleAttr, t } from '../../engine/html';
import { ea } from '../../engine/marks';
import type { Block } from '../../types';
import { pts, round, text, title, type ItemsProps } from './schemes';
import { decisionTotals, ganttRows, num, RISK_LEVELS, riskLevel, type Criterion, type GanttPoint, type RiskPoint } from './project-calc';
import './project.css';

/** Дробь по-русски, половина — вверх (3,85 → 3,9: без поправки двоичная дробь даёт 3,8): 4,2 */
const ru = (v: number) => (Math.round(v * 10 + 1e-9) / 10).toFixed(1).replace('.', ',');

// ---------------- диаграмма Ганта ----------------

interface GanttProps extends ItemsProps {
  /** Подписи периодов: месяцы, недели, кварталы. Без них — номера */
  scale?: (string | number)[];
  /** Где «сегодня»: в тех же периодах (3,5 — середина третьего) */
  today?: number | string;
}

/** Диаграмма Ганта: задачи полосами по периодам, готовность — заливкой, вехи — ромбами, «сегодня» — линией. */
defineBlock<GanttProps>('gantt', {
  render(p) {
    const items = pts(p) as GanttPoint[];
    const scale = Array.isArray(p.scale) && p.scale.length ? p.scale : null;
    const { rows, n } = ganttRows(items, scale, p.today);
    const x = (v: number) => round((v / n) * 100);
    const head = Array.from({ length: n }, (_, c) => `<span${scale ? ea(scale, c) : ''}>${t(scale ? scale[c] : c + 1)}</span>`).join('');
    const body = rows.map((r) => {
      const m = items[r.k];
      if (r.kind === 'section') return `<div class="gt-sec" style="--k:${r.k}">${title(m)}</div>`;
      const label = `<div class="gt-label">${title(m)}${text(m)}</div>`;
      if (r.kind === 'milestone') {
        return `<div class="gt-row ms" style="--k:${r.k}">${label}<div class="gt-track"><svg class="gt-ms" style="left:${x(r.s)}%" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5 22.5 12 12 22.5 1.5 12z"/></svg></div></div>`;
      }
      const cls = r.done >= 100 ? ' full' : r.late ? ' late' : '';
      const pct = r.done > 0 ? `<em>${Math.round(r.done)} %</em>` : '';
      return `<div class="gt-row" style="--k:${r.k}">${label}<div class="gt-track">`
        + `<div class="gt-bar${cls}" style="left:${x(r.s)}%;width:${round(((r.e - r.s) / n) * 100)}%"><i style="width:${r.done}%"></i>${pct}</div></div></div>`;
    }).join('');
    const now = num(p.today);
    const today = Number.isFinite(now) && now >= 1 && now <= n + 1
      ? `<div class="gt-today" style="left:${x(now - 1)}%"><span>Сегодня</span></div>` : '';
    return `<div class="gantt r" style="--n:${n}${p.style ? `;${p.style}` : ''}">`
      + `<div class="gt-head"><span></span><div class="gt-scale">${head}</div></div>`
      + `<div class="gt-body"><div class="gt-cols" aria-hidden="true">${today}</div>${body}</div></div>`;
  },
});

// ---------------- матрица рисков ----------------

interface RisksProps extends ItemsProps { size?: number | string; xAxis?: string; yAxis?: string }

const sizeOf = (v: unknown) => { const n = Math.round(num(v)); return n >= 3 && n <= 5 ? n : 5; };
const clampTo = (v: unknown, n: number, def: number) => { const x = Math.round(num(v)); return Number.isFinite(x) ? Math.max(1, Math.min(n, x)) : def; };

/**
 * Матрица рисков: клетки от зелёного к красному по «вероятность × последствия», риски — номерами в клетках,
 * справа — список с уровнем и мерой. Наведение на риск в списке подсвечивает его в матрице и наоборот.
 */
defineBlock<RisksProps>('risks', {
  render(p) {
    const items = pts(p) as RiskPoint[];
    const n = sizeOf(p.size);
    const mid = Math.ceil(n / 2);
    const at = items.map((m) => ({ p: clampTo(m.p, n, mid), i: clampTo(m.i, n, mid) }));
    const cells: string[] = [];
    for (let row = 0; row < n; row++) {
      const pv = n - row;
      for (let iv = 1; iv <= n; iv++) {
        const dots = at.map((a, k) => (a.p === pv && a.i === iv ? `<i class="rk-dot" data-n="${k + 1}" style="--k:${k}">${k + 1}</i>` : '')).join('');
        cells.push(`<div class="rk-cell lv${riskLevel(pv, iv, n)}" style="--d:${row + iv}">${dots}</div>`);
      }
    }
    const ticks = (k: number) => `<span>${k}</span>`;
    const list = items.map((m, k) => {
      const lv = riskLevel(at[k].p, at[k].i, n);
      return `<li class="rk-li lv${lv}" data-n="${k + 1}" style="--k:${k}"><i>${k + 1}</i><div>${title(m)}${text(m)}</div>`
        + `<em><b>${RISK_LEVELS[lv]}</b><small>${at[k].p} × ${at[k].i}</small></em></li>`;
    }).join('');
    return `<div class="risks r" style="--n:${n}${p.style ? `;${p.style}` : ''}">`
      + `<div class="rk-mx"><div class="rk-y"><span${ea(p, 'yAxis')}>${t(p.yAxis ?? 'Вероятность')}</span></div>`
      + `<div class="rk-ty">${Array.from({ length: n }, (_, k) => ticks(n - k)).join('')}</div>`
      + `<div class="rk-grid">${cells.join('')}</div>`
      + `<div class="rk-tx">${Array.from({ length: n }, (_, k) => ticks(k + 1)).join('')}</div>`
      + `<div class="rk-x"><span${ea(p, 'xAxis')}>${t(p.xAxis ?? 'Последствия')}</span></div></div>`
      + `<ol class="rk-list">${list}</ol></div>`;
  },
  mount(el) {
    // Риск под мышью — в списке и в матрице сразу
    const mark = (n: string | null) => el.querySelectorAll<HTMLElement>('[data-n]').forEach((x) => x.classList.toggle('hl', x.dataset.n === n));
    const over = (e: Event) => mark((e.target as Element).closest<HTMLElement>('[data-n]')?.dataset.n ?? null);
    const leave = () => mark(null);
    el.addEventListener('pointerover', over);
    el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointerover', over); el.removeEventListener('pointerleave', leave); };
  },
});

// ---------------- «рыбья кость» ----------------

interface FishProps extends ItemsProps { effect?: string }

/**
 * «Рыбья кость» (диаграмма Исикавы): справа — проблема, к хребту сходятся кости-категории, сверху и снизу
 * по очереди; причины — строками текста категории, лесенкой вдоль кости
 */
defineBlock<FishProps>('fishbone', {
  render(p) {
    const items = pts(p);
    const cols = Math.max(1, Math.ceil(items.length / 2));
    // Всё — в процентах блока: хребет посередине, голова справа
    const S0 = 2;
    const S1 = 75;
    const cw = (S1 - S0) / cols;
    const dx = Math.min(cw * 0.42, 11);
    const bones: string[] = [];
    const parts = items.map((m, k) => {
      const top = k % 2 === 0;
      const col = Math.floor(k / 2);
      const xs = S0 + (col + 1) * cw - 1.5;
      const xe = xs - dx;
      const ye = top ? 15 : 85;
      bones.push(`<path class="fb-bone ${top ? 't' : 'b'}" style="--k:${k}" d="M${round(xs * 10)} 200L${round(xe * 10)} ${ye * 4}"/>`);
      const lines = (m.text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      // Причины — слева от кости, до соседней: строка кончается у кости (отступ справа — по наклону на её высоте)
      const w = cw - 2;
      const li = lines.map((s, j) => {
        const f = (j + 0.5) / lines.length;
        const off = round(((top ? dx * (1 - f) : dx * f) / w) * 100);
        return `<li style="padding-right:${off}%">${t(s)}</li>`;
      }).join('');
      return `<div class="fb-cat ${top ? 't' : 'b'}" style="left:${round(xe)}%;--k:${k}">${title(m)}</div>`
        + (lines.length ? `<ul class="fb-causes ${top ? 't' : 'b'}" style="left:${round(xs - 0.8 - w)}%;width:${round(w)}%;--k:${k}"${ea(m, 'text')}>${li}</ul>` : '');
    }).join('');
    return `<div class="fishbone r"${styleAttr(p.style)}>`
      // Линии — в единицах 1000 × 400 (растягиваются по блоку): так же их видит и экспорт в PowerPoint
      + `<svg viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true"><path class="fb-tail" d="M0 152 32 200 0 248 10 200z"/>`
      + `<path class="fb-spine" d="M${S0 * 10 + 10} 200H${(S1 + 1) * 10}"/>${bones.join('')}</svg>${parts}`
      + `<div class="fb-head"><b${ea(p, 'effect')}>${t(p.effect ?? 'Проблема')}</b></div></div>`;
  },
});

// ---------------- матрица решений ----------------

interface DecisionProps extends Block {
  /** Варианты — столбцы */
  options?: string[];
  /** Критерии — строки: название, вес и оценки вариантов по порядку */
  criteria?: Criterion[];
  /** Наибольшая оценка (по умолчанию 5) */
  scale?: number | string;
}

/**
 * Матрица решений: критерии с весами — строками, варианты — столбцами; оценки — числом и шкалой,
 * итог (взвешенная оценка) считается сам и набегает при показе, лучший вариант выделен
 */
defineBlock<DecisionProps>('decision', {
  render(p) {
    const options = asArray(p.options).map((o) => String(o ?? ''));
    const criteria = asArray(p.criteria).filter((c): c is Criterion => !!c && typeof c === 'object');
    const scale = Math.max(1, Math.round(num(p.scale)) || 5);
    const n = Math.max(1, options.length);
    const { totals, shares, best } = decisionTotals(criteria, n);
    const isBest = (j: number) => best.includes(j);
    const col = (j: number) => ` style="--j:${j}"`;
    const pips = (v: number) => (scale <= 5
      ? `<i class="dm-pips" aria-hidden="true">${Array.from({ length: scale }, (_, s) => `<b${s < v ? ' class="on"' : ''}></b>`).join('')}</i>`
      : `<i class="dm-bar" aria-hidden="true"><b style="width:${round((Math.max(0, Math.min(scale, v)) / scale) * 100)}%"></b></i>`);
    const head = `<div class="dm-h dm-hc">Критерий</div><div class="dm-h dm-hw">Вес</div>`
      + options.map((o, j) => `<div class="dm-h dm-opt${isBest(j) ? ' best' : ''}"${col(j)}>${isBest(j) ? '<em>Лучший</em>' : ''}<b${ea(p.options, j)}>${t(o)}</b></div>`).join('');
    const rows = criteria.map((c, r) => {
      const scores = asArray(c.scores);
      const sum100 = Math.abs(criteria.reduce((a, x) => a + (num(x.weight) || 0), 0) - 100) < 0.5;
      return `<div class="dm-c" style="--k:${r}"><b${ea(c, 'title')}>${t(c.title ?? '')}</b></div>`
        + `<div class="dm-w" style="--k:${r};--w:${round(shares[r] * 100)}%"><span><b${ea(c, 'weight')}>${t(c.weight ?? '')}</b>${sum100 ? ' %' : ''}</span><i aria-hidden="true"></i></div>`
        + Array.from({ length: n }, (_, j) => {
          const v = num(scores[j]);
          const has = Number.isFinite(v);
          return `<div class="dm-s${isBest(j) ? ' best' : ''}" style="--k:${r};--j:${j}"><b${Array.isArray(c.scores) ? ea(c.scores, j) : ''}>${has ? t(scores[j]) : '—'}</b>${pips(has ? v : 0)}</div>`;
        }).join('');
    }).join('');
    const foot = `<div class="dm-tl">Итог</div><div class="dm-tw">из ${scale}</div>`
      + Array.from({ length: n }, (_, j) => `<div class="dm-t${isBest(j) ? ' best' : ''}"${col(j)}><b data-count-num>${ru(totals[j] ?? 0)}</b>`
        + `<i class="dm-bar" aria-hidden="true"><b style="width:${round(((totals[j] ?? 0) / scale) * 100)}%"></b></i></div>`).join('');
    return `<div class="decision r" style="--n:${n}${p.style ? `;${p.style}` : ''}"${criteria.length ? '' : ` data-empty="${esc('Добавьте критерии в свойствах')}"`}>${head}${rows}${foot}</div>`;
  },
});
