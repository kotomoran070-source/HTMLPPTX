/**
 * Начальная камера 3D-модели из данных: ракурс (`orbit`: поворот и наклон в градусах, третьим — расстояние в %)
 * и масштаб в рамке (`zoom`, как у картинки: 1 — как есть, 0,8 — модель дальше и мельче). Отдельно от блока —
 * чистая функция, без библиотеки 3D: её проверяют unit-тесты
 */
export interface ModelCamera {
  /** Значение camera-orbit у model-viewer: «auto» там, где ничего не задано */
  orbit: string;
  /** Расстояние камеры, % от подобранного библиотекой (100 — как подобрано) */
  dist: number;
}

const ORBIT = /^-?\d+(\.\d+)?deg\s+-?\d+(\.\d+)?deg(\s+(auto|\d+(\.\d+)?%))?$/;

export function modelCamera(orbit: unknown, zoom: unknown): ModelCamera {
  // Только углы в градусах и расстояние в процентах — без произвольных строк
  const parts = typeof orbit === 'string' && ORBIT.test(orbit.trim()) ? orbit.trim().split(/\s+/) : [];
  const z = Number(zoom);
  const base = Number(/^(\d+(?:\.\d+)?)%$/.exec(parts[2] ?? '')?.[1]) || 100;
  const dist = Math.round(base / (z >= 0.3 && z <= 3 ? z : 1));
  return { orbit: `${parts[0] ?? 'auto'} ${parts[1] ?? 'auto'} ${dist === 100 ? 'auto' : `${dist}%`}`, dist };
}
