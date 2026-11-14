/**
 * Плавная прокрутка колесом мыши — своя анимация вместо браузерной.
 *
 * Каждый щелчок колеса сдвигает цель, а путь к ней строится заново от того места и с той скоростью, что у области
 * сейчас (кривая Эрмита, к цели — с замедлением). Скорость не обрывается между щелчками, конец — вовремя.
 * scrollTo({ behavior: 'smooth' }) на каждый щелчок начинает движение с нуля: лента разгоняется и встаёт на каждом
 * щелчке, а `scrollLeft += deltaY` прыгает сразу на 100 px.
 *
 * - wheelStrip — лента, что листается вбок обычным колесом (вверх-вниз): на краю дальше листается то, что вокруг;
 *   жест вбок (тачпад, Shift+колесо) лента прокручивает сама;
 * - smoothWheel — всё остальное, что прокручивается вверх-вниз (страница выбора, панели студии, «Файл»), если
 *   включено в «Файл → Параметры» (SMOOTH_KEY). Мелкие шаги тачпада — как есть, у браузера.
 *
 * У лент с примагничиванием (scroll-snap) цель — край ближайшей плитки, а примагничивание на время движения
 * снимается: иначе браузер тянул бы ленту к плитке в каждом кадре
 */

type Axis = 'x' | 'y';
interface Scroller { go(d: number, step?: boolean): void; aim(): number; stop(): void }

const scrollers = new WeakMap<HTMLElement, Partial<Record<Axis, Scroller>>>();

/** Мелкий шаг (тачпад, колесо с плавным ходом) — меньше этого, px */
const FINE = 50;

/** Шаг события колеса в пикселях */
const pixels = (e: WheelEvent, d: number, page: number) => d * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? page : 1);

function scroller(el: HTMLElement, axis: Axis): Scroller {
  const own = scrollers.get(el) ?? {};
  if (own[axis]) return own[axis]!;
  const x = axis === 'x';
  const get = () => (x ? el.scrollLeft : el.scrollTop);
  const set = (v: number) => el.scrollTo(x ? { left: v, behavior: 'instant' } : { top: v, behavior: 'instant' });
  const max = () => (x ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight);
  /** Цель; -1 — область стоит */
  let target = -1;
  let p0 = 0;
  let v0 = 0;
  let t0 = 0;
  let dur = 1;
  /** Что поставлено в прошлом кадре: по нему видно, что область сдвинуло что-то другое */
  let shown = 0;
  let raf = 0;
  let snapOff = false;
  /** Где область и с какой скоростью (px/мс) в момент now */
  const at = (now: number): [number, number] => {
    const s = Math.min(1, Math.max(0, (now - t0) / dur));
    const s2 = s * s;
    const s3 = s2 * s;
    const p = (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * dur * v0 + (3 * s2 - 2 * s3) * target;
    const v = s >= 1 ? 0 : ((6 * s2 - 6 * s) * p0 + (3 * s2 - 4 * s + 1) * dur * v0 + (6 * s - 6 * s2) * target) / dur;
    return [p, v];
  };
  const snapping = () => {
    const t = getComputedStyle(el).scrollSnapType;
    return !!t && t !== 'none' && (t.includes('both') || t.includes(x ? 'x' : 'y') || t.includes(x ? 'inline' : 'block'));
  };
  /** Края плиток ленты с примагничиванием — куда ей можно встать */
  const snapPoints = (): number[] => {
    const box = el.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(el)[x ? 'scrollPaddingLeft' : 'scrollPaddingTop']) || 0;
    const m = max();
    const pts = [...el.children].map((c) => {
      const r = c.getBoundingClientRect();
      return Math.max(0, Math.min(m, (x ? r.left - box.left : r.top - box.top) + get() - pad));
    });
    return [...new Set([0, ...pts, m])].sort((a, b) => a - b);
  };
  const end = () => {
    raf = 0;
    target = -1;
    if (snapOff) { el.style.removeProperty('scroll-snap-type'); snapOff = false; }
  };
  const stop = () => { cancelAnimationFrame(raf); end(); };
  const tick = (now: number) => {
    // Область сдвинуло что-то другое (полоса прокрутки, клавиатура, жест) — уступаем
    if (Math.abs(get() - shown) > 2) { stop(); return; }
    shown = Math.max(0, Math.min(max(), at(now)[0]));
    set(shown);
    if (now - t0 >= dur) end(); else raf = requestAnimationFrame(tick);
  };
  const s: Scroller = {
    aim: () => (target >= 0 ? target : get()),
    stop,
    go(d, step = Math.abs(d) >= FINE) {
      const now = performance.now();
      const from = target;
      if (target < 0) { p0 = shown = get(); v0 = 0; target = p0; } else [p0, v0] = at(now);
      let to = Math.max(0, Math.min(max(), target + d));
      const snappy = snapOff || snapping();
      // Лента с примагничиванием: к краю ближайшей плитки, но хоть на одну дальше
      if (step && snappy) {
        const pts = snapPoints();
        const base = from >= 0 ? from : p0;
        const near = pts.reduce((a, b) => (Math.abs(b - to) < Math.abs(a - to) ? b : a), pts[0]);
        to = Math.abs(near - base) > 1 ? near : (d > 0 ? pts.find((p) => p > base + 1) : [...pts].reverse().find((p) => p < base - 1)) ?? near;
      }
      if (snappy && !snapOff) { el.style.setProperty('scroll-snap-type', 'none'); snapOff = true; }
      target = to;
      t0 = now;
      // Щелчок колеса — мягче и дольше, мелкие шаги — отзывчивее
      dur = step ? 280 : 140;
      // С места — сразу, с замедлением к концу (иначе первый щелчок трогается вяло)
      if (!raf) { v0 = (1.5 * (target - p0)) / dur; raf = requestAnimationFrame(tick); }
    },
  };
  own[axis] = s;
  scrollers.set(el, own);
  return s;
}

/**
 * Лента вбок: обычное колесо листает её влево-вправо (на краю — дальше листается то, что вокруг), жест вбок —
 * сама лента. step — шаг одного щелчка колеса (по умолчанию — как пришёл от колеса).
 * go(d) — сдвинуть на d тем же движением (кнопки-стрелки по краям)
 */
export function wheelStrip(strip: HTMLElement, o: { step?: () => number } = {}): { go(d: number): void } {
  strip.addEventListener('wheel', (e) => stripWheel(strip, e, o.step), { passive: false });
  return { go: (d) => scroller(strip, 'x').go(d, true) };
}

/** Событие колеса над лентой вбок (для своего обработчика: одна лента из многих) */
export function stripWheel(strip: HTMLElement, e: WheelEvent, step?: () => number): void {
  const sc = scroller(strip, 'x');
  if (e.ctrlKey || e.defaultPrevented) return;
  if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) { sc.stop(); return; }
  const aim = sc.aim();
  const max = strip.scrollWidth - strip.clientWidth;
  if (max <= 0 || (e.deltaY < 0 && aim <= 0) || (e.deltaY > 0 && aim >= max - 1)) return;
  e.preventDefault();
  const d = pixels(e, e.deltaY, strip.clientWidth);
  sc.go(step && Math.abs(d) >= FINE ? Math.sign(d) * step() : d);
}

/** Своя плавная прокрутка вверх-вниз во всей странице: включена, пока не выключили в «Параметрах» */
export const SMOOTH_KEY = 'slideria-smooth-wheel';
export function smoothWheelOn(): boolean {
  try { return localStorage.getItem(SMOOTH_KEY) !== '0'; } catch { return true; }
}
export function setSmoothWheel(on: boolean): void {
  try { localStorage.setItem(SMOOTH_KEY, on ? '1' : '0'); } catch { /* приватный режим */ }
}

/** Ближайшая к цели область, которая может прокрутиться по d; null — никто (или дальше не пускает overscroll) */
function scrollerFor(from: EventTarget | null, d: number): HTMLElement | null {
  const root = document.scrollingElement as HTMLElement | null;
  for (let n = from instanceof Element ? from : null; n; n = n.parentElement) {
    const el = n as HTMLElement;
    const isRoot = el === document.documentElement || el === document.body;
    const target = isRoot ? root : el;
    if (!target) continue;
    const cs = getComputedStyle(el);
    const scrolls = isRoot ? cs.overflowY !== 'hidden' && cs.overflowY !== 'clip' : /^(auto|scroll|overlay)$/.test(cs.overflowY);
    if (scrolls && target.scrollHeight > target.clientHeight + 1) {
      const aim = scroller(target, 'y').aim();
      const max = target.scrollHeight - target.clientHeight;
      if (d > 0 ? aim < max - 1 : aim > 0) return target;
      // На краю: дальше прокручивается то, что вокруг, — если область это пускает
      if (cs.overscrollBehaviorY === 'contain' || cs.overscrollBehaviorY === 'none') return null;
    }
    if (isRoot && el === document.documentElement) break;
  }
  return null;
}

let installed = false;
/** Подключить своё плавное колесо к странице (страница выбора, студия) */
export function smoothWheel(): void {
  if (installed) return;
  installed = true;
  addEventListener('wheel', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !smoothWheelOn()) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const d = pixels(e, e.deltaY, innerHeight);
    // Тачпад и колёса с плавным ходом шлют мелкие шаги — их браузер ведёт сам
    if (Math.abs(d) < FINE) return;
    const t = e.target as HTMLInputElement;
    // Число в поле меняется колесом, пока оно в фокусе
    if (t instanceof HTMLInputElement && t.type === 'number' && t === document.activeElement) return;
    const el = scrollerFor(e.target, d);
    if (!el) return;
    e.preventDefault();
    scroller(el, 'y').go(d);
  }, { passive: false });
}
