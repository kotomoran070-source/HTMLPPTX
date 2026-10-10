/**
 * «Мои образы» панели «Цвет+»: своя коррекция плиткой рядом с готовыми — во всех презентациях
 * (хранится в браузере). LUT в образ не входит: его файл лежит в папке одной презентации
 */
import { compact, type Grade } from '../../engine/color/grade';

export interface MyLook { id: string; name: string; grade: Grade }

const KEY = 'slideria-looks';

export function listMyLooks(): MyLook[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string' && x.grade && typeof x.grade === 'object') : [];
  } catch {
    return [];
  }
}

function store(list: MyLook[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** Новый образ — первым; null — не хватило места в браузере */
export function addMyLook(name: string, g: Grade): MyLook | null {
  const grade = compact({ ...g, src: undefined, lut: undefined, lutName: undefined, lutMix: undefined });
  const look = { id: Math.random().toString(36).slice(2, 10), name: name.trim().slice(0, 40) || 'Мой образ', grade };
  return store([look, ...listMyLooks()]) ? look : null;
}

export function removeMyLook(id: string): void {
  store(listMyLooks().filter((l) => l.id !== id));
}
