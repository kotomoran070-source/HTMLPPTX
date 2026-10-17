/**
 * «Мои образы» панели «Цвет+»: своя коррекция плиткой рядом с готовыми — во всех презентациях
 * (своя библиотека студии, user-library.ts). LUT в образ не входит: его файл лежит в папке одной презентации
 */
import { compact, type Grade } from '../../engine/color/grade';
import { stableJson } from '../same';
import { libList, libPut, libRemove } from '../user-library';

export interface MyLook { id: string; name: string; grade: Grade; created?: number }

export function listMyLooks(): MyLook[] {
  return libList<MyLook>('looks').filter((x) => typeof x.name === 'string' && x.grade && typeof x.grade === 'object');
}

/**
 * Новый образ — первым. Та же коррекция (под любым именем) второй раз не сохраняется — same;
 * то же имя у другой коррекции — образ заменяется (updated). null — не хватило места в браузере
 */
export function addMyLook(name: string, g: Grade): { look: MyLook; status: 'added' | 'updated' | 'same' } | null {
  const grade = compact({ ...g, src: undefined, lut: undefined, lutName: undefined, lutMix: undefined });
  const list = listMyLooks();
  const key = stableJson(grade);
  const twin = list.find((l) => stableJson(compact(l.grade)) === key);
  if (twin) return { look: twin, status: 'same' };
  const title = name.trim().slice(0, 40) || 'Мой образ';
  const named = list.find((l) => l.name === title);
  const look = { id: named?.id ?? Math.random().toString(36).slice(2, 10), name: title, grade, created: Date.now() };
  return libPut('looks', look) ? { look, status: named ? 'updated' : 'added' } : null;
}

export function removeMyLook(id: string): void {
  libRemove('looks', id);
}
