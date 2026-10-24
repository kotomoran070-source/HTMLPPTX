/**
 * Прогресс показа: вид полосы у зрителей (deck.progress) и план доклада у докладчика (deck.plan, минуты).
 * План — время на слайд одинаковое: план, делённый на число показываемых слайдов. Запас — насколько раньше
 * плана вы пришли на этот слайд; отставание — насколько дольше плана вы на нём (пока идёте в рамках
 * отведённого слайду времени — «по плану»).
 */

export type ProgressMode = 'line' | 'segments' | 'number' | 'none';

/** Ячеек больше — их не разглядеть: сегменты показываются линией */
export const MAX_SEGMENTS = 60;

/** Вид прогресса у зрителей: progress: false — нет, без поля — линия */
export function progressMode(progress: unknown, slides: number): ProgressMode {
  if (progress === false || progress === 'none') return 'none';
  if (progress === 'segments') return slides > MAX_SEGMENTS ? 'line' : 'segments';
  return progress === 'number' ? 'number' : 'line';
}

export interface PlanState {
  /** Метка «по плану»: где по времени вы должны быть, доля полосы */
  at: number;
  /** Сколько осталось по плану, мс (меньше нуля — перерасход) */
  left: number;
  /** Запас (больше нуля) или отставание (меньше нуля), мс; 0 — по плану */
  delta: number;
}

/** pos — номер показываемого слайда (с 1) из total; elapsed и plan — мс */
export function planState(pos: number, total: number, elapsed: number, plan: number): PlanState {
  const per = plan / Math.max(1, total);
  const ahead = (pos - 1) * per - elapsed;
  const behind = elapsed - pos * per;
  return {
    at: Math.max(0, Math.min(1, elapsed / plan)),
    left: plan - elapsed,
    delta: ahead > 0 ? ahead : behind > 0 ? -behind : 0,
  };
}

/** 15:30, 1:02:05 — без знака */
export function clock(ms: number): string {
  const sec = Math.round(Math.abs(ms) / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor(sec / 60) % 60;
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
