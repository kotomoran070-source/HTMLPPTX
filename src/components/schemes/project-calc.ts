/**
 * Расчёты проектных схем (project.ts) без вёрстки: сроки Ганта, уровень риска, итоги матрицы решений
 */
import { asArray } from '../../engine/html';
import type { Point } from './schemes';

/** Число из поля: 3, «3,5», «4 »; нет числа — NaN */
export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : NaN;
};

export interface GanttPoint extends Point {
  /** Первый и последний период задачи (с единицы, можно дробно: 2,5 — с середины второго) */
  from?: number | string;
  to?: number | string;
  /** Готовность, %: 0–100; true — готово */
  done?: number | boolean | string;
  /** Веха: ромб в периоде from */
  milestone?: boolean;
  /** Строка-раздел: название этапа во всю ширину */
  section?: boolean;
}

/** Строка Ганта: s и e — начало и конец полосы на шкале (период c занимает [c − 1, c]); у вехи s = e */
export interface GanttRow { kind: 'task' | 'milestone' | 'section'; k: number; s: number; e: number; done: number; late: boolean }

/** Начало: «с 2» — с начала второго периода, «с 2,5» — с его середины */
const startOf = (v: number) => v - 1;
/** Конец: «по 2» — до конца второго периода, «по 2,5» — до его середины */
const endOf = (v: number) => (Number.isInteger(v) ? v : v - 1);

/**
 * Строки Ганта: задача без своих сроков (пришла из другой схемы) встаёт сразу за предыдущей на один период.
 * n — число периодов: по подписям шкалы или по самой поздней задаче. «Сегодня» — как начало: 3,5 — середина третьего
 */
export function ganttRows(items: GanttPoint[], scale: unknown[] | null, today?: unknown): { rows: GanttRow[]; n: number } {
  let end = 0;
  const rows: GanttRow[] = items.map((m, k) => {
    if (m.section) return { kind: 'section', k, s: 0, e: 0, done: 0, late: false };
    const from = num(m.from);
    const s = Number.isFinite(from) ? Math.max(0, startOf(from)) : end;
    const done = m.done === true ? 100 : Math.max(0, Math.min(100, num(m.done) || 0));
    if (m.milestone) {
      // Веха — в точке: в периоде «с 3» — посередине третьего, дробно — там, где указано
      const at = Number.isFinite(from) && Number.isInteger(from) ? s + 0.5 : s;
      end = Math.max(end, at);
      return { kind: 'milestone', k, s: at, e: at, done, late: false };
    }
    const to = num(m.to);
    let e = Number.isFinite(to) ? endOf(to) : s + 1;
    // Конец раньше начала — один период
    if (e <= s) e = s + 1;
    end = Math.max(end, e);
    return { kind: 'task', k, s, e, done, late: false };
  });
  const n = Math.max(1, scale?.length || Math.ceil(end));
  const now = num(today);
  // Не готова, а срок прошёл — отстаёт (красным)
  if (Number.isFinite(now)) for (const r of rows) if (r.kind === 'task' && r.done < 100 && r.e <= startOf(now)) r.late = true;
  return { rows, n };
}

export interface RiskPoint extends Point {
  /** Вероятность и последствия: 1 — низкие, size — высокие */
  p?: number | string;
  i?: number | string;
}

export const RISK_LEVELS = ['Низкий', 'Средний', 'Высокий', 'Критический'] as const;

/** Уровень риска по произведению вероятности и последствий: доля от наибольшего (5 × 5 = 25) */
export function riskLevel(p: number, i: number, n: number): number {
  const s = (p * i) / (n * n);
  return s < 0.2 ? 0 : s < 0.4 ? 1 : s < 0.7 ? 2 : 3;
}

export interface Criterion { title?: string; weight?: number | string; scores?: (number | string | null)[]; [extra: string]: unknown }

/**
 * Итог каждого варианта — среднее оценок, взвешенное весами критериев (веса могут быть любыми: 30/25/…,
 * 3/2/1 — считаются долями). Лучшие — с наибольшим итогом (ничья — несколько)
 */
export function decisionTotals(criteria: Criterion[], options: number): { totals: number[]; shares: number[]; best: number[] } {
  const ws = criteria.map((c) => Math.max(0, num(c.weight) || 0));
  const sum = ws.reduce((a, b) => a + b, 0);
  // Без весов — все критерии поровну
  const shares = ws.map((w) => (sum > 0 ? w / sum : 1 / Math.max(1, criteria.length)));
  const totals = Array.from({ length: options }, (_, j) => criteria.reduce((a, c, r) => a + shares[r] * (num(asArray(c.scores)[j]) || 0), 0));
  const top = Math.max(...totals.map((v) => Math.round(v * 100)));
  const best = totals.length && top > 0 ? totals.map((v, j) => (Math.round(v * 100) === top ? j : -1)).filter((j) => j >= 0) : [];
  return { totals, shares, best };
}
