/**
 * Лента, которая листается вбок колесом мыши: обычное колесо (вверх-вниз) двигает её влево-вправо, на краю —
 * дальше листается страница; жест вбок (тачпад, Shift+колесо) лента прокручивает сама.
 *
 * Движение — своя анимация: каждый щелчок колеса сдвигает цель, а путь к ней строится заново от того места и с той
 * скоростью, что у ленты сейчас (кривая Эрмита, к цели — с замедлением). Скорость не обрывается, конец — вовремя.
 * scrollTo({ behavior: 'smooth' }) на каждый щелчок начинает движение с нуля: лента разгоняется и встаёт на каждом
 * щелчке колеса, а от мелких шагов тачпада дёргается.
 *
 * go(d) — сдвинуть на d пикселей тем же движением (кнопки-стрелки по краям)
 */
export function wheelStrip(strip: HTMLElement): { go(d: number): void } {
  const maxLeft = () => strip.scrollWidth - strip.clientWidth;
  /** Цель; -1 — лента стоит */
  let target = -1;
  let p0 = 0;
  let v0 = 0;
  let t0 = 0;
  let dur = 1;
  /** Что поставлено ленте в прошлом кадре: по нему видно, что её сдвинуло что-то другое */
  let shown = 0;
  let raf = 0;
  /** Где лента и с какой скоростью (px/мс) в момент now */
  const at = (now: number): [number, number] => {
    const s = Math.min(1, Math.max(0, (now - t0) / dur));
    const s2 = s * s;
    const s3 = s2 * s;
    const p = (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * dur * v0 + (3 * s2 - 2 * s3) * target;
    const v = s >= 1 ? 0 : ((6 * s2 - 6 * s) * p0 + (3 * s2 - 4 * s + 1) * dur * v0 + (6 * s - 6 * s2) * target) / dur;
    return [p, v];
  };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; target = -1; };
  const tick = (now: number) => {
    // Ленту сдвинуло что-то другое (полоса, клавиатура, жест вбок) — уступаем
    if (Math.abs(strip.scrollLeft - shown) > 2) { stop(); return; }
    strip.scrollLeft = shown = Math.max(0, Math.min(maxLeft(), at(now)[0]));
    if (now - t0 >= dur) { raf = 0; target = -1; } else raf = requestAnimationFrame(tick);
  };
  const go = (d: number) => {
    const now = performance.now();
    if (target < 0) { p0 = shown = strip.scrollLeft; v0 = 0; target = p0; } else [p0, v0] = at(now);
    target = Math.max(0, Math.min(maxLeft(), target + d));
    t0 = now;
    // Щелчок колеса — мягче и дольше, мелкие шаги тачпада — отзывчивее
    dur = Math.abs(d) >= 50 ? 280 : 140;
    // С места — сразу, с замедлением к концу (иначе первый щелчок трогается вяло)
    if (!raf) { v0 = (1.5 * (target - p0)) / dur; raf = requestAnimationFrame(tick); }
  };
  strip.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return;
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) { stop(); return; }
    const aim = target >= 0 ? target : strip.scrollLeft;
    const max = maxLeft();
    if (max <= 0 || (e.deltaY < 0 && aim <= 0) || (e.deltaY > 0 && aim >= max - 1)) return;
    e.preventDefault();
    go(e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? strip.clientWidth : 1));
  }, { passive: false });
  return { go };
}
