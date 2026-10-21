/**
 * Схемы-фигуры из тех же пунктов «заголовок + текст» (переключаются со всеми схемами в «Виде»):
 * шестерёнки, колонны, изометрические слои, ромбы, дуга-дорога, карта идей. У каждой своё появление
 * и подсветка под мышью; в миниатюрах и PDF — конечный вид.
 */
import { defineBlock } from '../../engine/component';
import { t } from '../../engine/html';
import { ea } from '../../engine/marks';
import { icon } from '../icons';
import { iconFor, pts, round, text, title, two, type ItemsProps } from './schemes';
import './figures.css';

interface CenterProps extends ItemsProps { center?: string }

const pc = (v: number, of: number) => round((v / of) * 100);
const mixOf = (k: number, n: number) => (n > 1 ? Math.round((k / (n - 1)) * 100) : 0);
const style = (p: { style?: string }, own: string) => ` style="${own}${p.style ? `;${p.style}` : ''}"`;

// ---------------- шестерёнки ----------------

const PITCH = 26;
const DEPTH = 11;

/** Контур колеса с зубьями: шаг зубьев у всех колёс одинаковый, phase — поворот первого зуба */
function gearPath(r: number, teeth: number, phase: number): string {
  const p = (Math.PI * 2) / teeth;
  const ri = r - DEPTH;
  const pt = (rad: number, a: number) => `${round(rad * Math.cos(a))} ${round(rad * Math.sin(a))}`;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = phase + i * p;
    d += `${i ? 'L' : 'M'}${pt(ri, a - 0.27 * p)}L${pt(r, a - 0.15 * p)}L${pt(r, a + 0.15 * p)}L${pt(ri, a + 0.27 * p)}`;
  }
  return `${d}Z`;
}

/**
 * Шестерёнки: колёса через одно большие и малые, зубья в зацеплении; при показе крутятся (соседние —
 * навстречу, малые быстрее). Заголовок — в середине колеса, пояснение — под колёсами на одной линии.
 * Под мышью колесо светлеет и подписи выделяются.
 */
defineBlock<ItemsProps>('gears', {
  render(p) {
    const items = pts(p);
    const n = Math.max(1, items.length);
    const R = (k: number) => (k % 2 ? 74 : 100);
    const teeth = (k: number) => Math.round((2 * Math.PI * R(k)) / PITCH);
    // Центры по горизонтали: зубья одного колеса входят во впадины соседнего
    const cx: number[] = [0];
    for (let k = 1; k < n; k++) cx.push(cx[k - 1] + R(k - 1) + R(k) - DEPTH + 3);
    // Фаза: где у соседа слева точка касания (угол 0) — зуб или впадина; у этого колеса там (угол π) — наоборот
    const phase: number[] = [0];
    for (let k = 1; k < n; k++) {
      const pl = (Math.PI * 2) / teeth(k - 1);
      const f = ((((0 - phase[k - 1]) / pl) % 1) + 1) % 1;
      phase.push(Math.PI - (f + 0.5) * ((Math.PI * 2) / teeth(k)));
    }
    const x0 = -R(0) - 6;
    const W = cx[n - 1] + R(n - 1) + 6 - x0;
    const notes = items.some((m) => m.text);
    const H = 212 + (notes ? 84 : 0);
    const cy = 106;
    const wheels = items.map((m, k) => {
      const r = R(k);
      const dur = round(teeth(k) * 0.8);
      const mix = mixOf(k, n);
      // Пояснение — у всех на одной высоте (под большим колесом), в долях своей рамки
      const noteTop = pc(cy + 100 + 16 - (cy - r), 2 * r);
      const noteW = pc(166, 2 * r);
      return `<div class="gr-w" style="left:${pc(cx[k] - r - x0, W)}%;top:${pc(cy - r, H)}%;width:${pc(2 * r, W)}%;--k:${k};--mix:${mix}%">`
        + `<svg class="gr-svg" viewBox="${-r} ${-r} ${2 * r} ${2 * r}" aria-hidden="true">`
        + `<path class="gr-gear" style="--dur:${dur}s;--dir:${k % 2 ? 'reverse' : 'normal'}" d="${gearPath(r, teeth(k), phase[k])}"/>`
        + `<circle class="gr-disc" r="${round(r * 0.66)}"/></svg>`
        + `<div class="gr-t">${title(m)}</div>`
        + (notes ? `<div class="gr-note" style="top:${noteTop}%;width:${noteW}%">${text(m, 'p')}</div>` : '')
        + `</div>`;
    }).join('');
    return `<div class="gears r"${style(p, `aspect-ratio:${round(W / H)} / 1;--ar:${round(W / H)};--n:${n}`)}>${wheels}</div>`;
  },
});

// ---------------- колонны ----------------

/**
 * Колонны: общая крыша (center) держится на опорах — по колонне на пункт, заголовок и пояснение
 * внутри колонны; снизу ступени. Колонны вырастают по очереди, крыша опускается на них последней.
 */
defineBlock<CenterProps>('pillars', {
  render(p) {
    const items = pts(p);
    const n = Math.max(1, items.length);
    const cols = items.map((m, k) =>
      `<div class="pl-col" style="--k:${k};--mix:${mixOf(k, n)}%"><i class="pl-cap"></i><div class="pl-shaft"><em>${two(k)}</em>${title(m)}${text(m)}</div><i class="pl-foot"></i></div>`).join('');
    return `<div class="pillars r"${style(p, `--n:${n}`)}>`
      // Крыша — треугольник SVG (не обрезка): в PowerPoint уходит картинкой как есть
      + `<div class="pl-roof"><svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polygon points="50,0 100,30 0,30"/><polygon class="pl-gable" points="50,6 88,27 12,27"/></svg>`
      + `<b${ea(p, 'center')}>${t(p.center ?? '')}</b></div><i class="pl-beam"></i>`
      + `<div class="pl-cols">${cols}</div><i class="pl-step"></i><i class="pl-step s2"></i></div>`;
  },
});

// ---------------- изометрические слои ----------------

/**
 * Слои: плиты в изометрии друг над другом, первый пункт — верхняя.
 * Справа — подписи, к ним линии. Под мышью слой приподнимается, остальные бледнеют.
 * Плиты опускаются на место снизу вверх.
 */
defineBlock<ItemsProps>('layers', {
  render(p) {
    const items = pts(p);
    const n = Math.max(1, items.length);
    // Единицы: плита 100 × 50 и толщина 12, шаг слоёв 22; подписи — с 116
    const T = 12;
    const S = 22;
    const W = 250;
    const H = 50 + T + (n - 1) * S;
    const layers = items.map((m, k) => {
      const mix = mixOf(k, n);
      return `<div class="ly-l" style="top:${pc(k * S, H)}%;height:${pc(50 + T, H)}%;z-index:${n - k};--k:${k};--up:${n - 1 - k};--mix:${mix}%">`
        + `<svg class="ly-plate" viewBox="0 0 112 ${50 + T}" style="width:${pc(112, W)}%" aria-hidden="true">`
        + `<polygon class="ly-l2" points="0,25 50,50 50,${50 + T} 0,${25 + T}"/><polygon class="ly-r" points="50,50 100,25 100,${25 + T} 50,${50 + T}"/>`
        + `<polygon class="ly-top" points="50,0 100,25 50,50 0,25"/>`
        + `<path class="ly-line" d="M100 25H112"/><circle class="ly-dot" cx="100" cy="25" r="2.2"/></svg>`
        + `<div class="ly-note" style="left:${pc(116, W)}%;top:${pc(25, 50 + T)}%">${title(m)}${text(m)}</div></div>`;
    }).join('');
    return `<div class="layers r"${style(p, `aspect-ratio:${round(W / H)} / 1;--ar:${round(W / H)};--n:${n}`)}>${layers}</div>`;
  },
});

// ---------------- ромбы ----------------

/**
 * Ромбы: в ряд вершина к вершине, в каждом — иконка по смыслу; подписи через одну сверху и снизу.
 * Под мышью ромб поворачивается на четверть и подрастает.
 */
defineBlock<ItemsProps>('diamonds', {
  render(p) {
    const items = pts(p);
    const n = Math.max(1, items.length);
    return `<div class="diamonds r"${style(p, `--n:${n}`)}>${items.map((m, k) => {
      const note = `<div class="dm-note">${title(m)}${text(m)}</div>`;
      return `<div class="dm-it${k % 2 ? ' odd' : ''}" style="--k:${k};--mix:${mixOf(k, n)}%">`
        + `<div class="dm-slot">${k % 2 ? '' : note}</div>`
        + `<div class="dm-shape"><i></i><span>${icon(iconFor(m, k))}</span></div>`
        + `<div class="dm-slot">${k % 2 ? note : ''}</div></div>`;
    }).join('')}</div>`;
  },
});

// ---------------- дуга ----------------

/**
 * Дуга: дорога полукругом слева направо, вехи — по пунктам, подписи снаружи; в середине — цель
 * (center). Дорога прорисовывается, вехи появляются по очереди, по ней едет огонёк.
 * Под мышью веха подрастает и подпись выделяется.
 */
defineBlock<CenterProps>('arc', {
  render(p) {
    const items = pts(p);
    const n = Math.max(1, items.length);
    const W = 1000;
    const H = 520;
    const cx = 500;
    const cy = 455;
    const R = 300;
    const road = `M${cx - R} ${cy} A${R} ${R} 0 0 1 ${cx + R} ${cy}`;
    const stops = items.map((m, k) => {
      const deg = 180 - ((k + 0.5) * 180) / n;
      const a = (deg * Math.PI) / 180;
      const c = Math.cos(a);
      const side = c < -0.25 ? 'l' : c > 0.25 ? 'r' : 't';
      return `<div class="ar-it ${side}" style="left:${pc(cx + R * c, W)}%;top:${pc(cy - R * Math.sin(a), H)}%;--k:${k};--mix:${mixOf(k, n)}%;--c:${round(c)};--s:${round(Math.sin(a))}">`
        + `<i class="ar-dot">${k + 1}</i><div class="ar-l">${title(m)}${text(m)}</div></div>`;
    }).join('');
    return `<div class="arc r"${style(p, `aspect-ratio:${W / H} / 1;--ar:${round(W / H)};--n:${n}`)}>`
      + `<svg class="ar-svg" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path class="ar-road" pathLength="1" d="${road}"/>`
      + `<path class="ar-mark" d="${road}"/><circle class="ar-run" r="7"><animateMotion dur="7s" repeatCount="indefinite" path="${road}"/></circle></svg>`
      + (p.center ? `<div class="ar-c" style="top:${pc(cy - 26, H)}%"><b${ea(p, 'center')}>${t(p.center)}</b></div>` : '')
      + `${stops}</div>`;
  },
});

// ---------------- карта идей ----------------

/**
 * Карта идей: главная мысль (center) в середине, пункты — карточками справа и слева (через один),
 * к каждой ведёт изогнутая ветвь. Ветви прорастают от центра, карточки выезжают следом.
 * Под мышью карточка и её ветвь выделяются.
 */
defineBlock<CenterProps>('mindmap', {
  render(p) {
    const items = pts(p);
    const n = Math.max(1, items.length);
    const right = items.map((_, k) => k).filter((k) => k % 2 === 0);
    const left = items.map((_, k) => k).filter((k) => k % 2 === 1);
    const rows = Math.max(right.length, left.length, 1);
    const W = 1000;
    const H = Math.max(340, rows * 112 + 36);
    const cy = H / 2;
    const branches = items.map((m, k) => {
      const side = k % 2 ? left : right;
      const j = side.indexOf(k);
      const y = (H * (j + 0.5)) / side.length;
      const r = k % 2 === 0;
      const sx = r ? 590 : 410;
      const ex = r ? 668 : 332;
      const mx = (sx + ex) / 2;
      return `<div class="mm-br ${r ? 'r' : 'l'}" style="--k:${k};--mix:${mixOf(k, n)}%">`
        + `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M${sx} ${round(cy)}C${mx} ${round(cy)} ${mx} ${round(y)} ${ex} ${round(y)}"/></svg>`
        + `<div class="mm-card" style="top:${pc(y, H)}%">${title(m)}${text(m)}</div></div>`;
    }).join('');
    return `<div class="mindmap r"${style(p, `aspect-ratio:${round(W / H)} / 1;--ar:${round(W / H)};--n:${n}`)}>${branches}`
      + `<div class="mm-c${p.center ? '' : ' dot'}">${p.center ? `<b${ea(p, 'center')}>${t(p.center)}</b>` : ''}</div></div>`;
  },
});
