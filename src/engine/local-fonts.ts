/**
 * Шрифты, установленные на компьютере (Local Font Access API: Chrome, Edge, приложение Slideria).
 * В приложении доступ разрешён заранее и список приходит сам; в браузере — после явного согласия:
 * пункт «Шрифты компьютера…» в списке шрифтов, браузер спрашивает разрешение.
 * Выбранный шрифт копируется в презентацию (см. editor.ensureFont) — на другом компьютере он тот же.
 */
import { fontNameOk } from './fonts';

interface FontData {
  family: string;
  style: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}
type Query = () => Promise<FontData[]>;

/** Начертание шрифта компьютера; style — с учётом отдельного «семейства» вроде «Segoe UI Semibold» */
export interface LocalFace {
  style: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}

/** Толщина в конце имени семейства: «Arial Black», «Segoe UI Semibold» — начертания «Arial», «Segoe UI» */
const WEIGHT_TAIL = / (thin|hairline|extra ?light|ultra ?light|semi ?light|demi ?light|light|book|regular|medium|semi ?bold|demi ?bold|extra ?bold|ultra ?bold|bold|black|heavy)$/i;

let families: Map<string, LocalFace[]> | null = null;
let denied = false;
const listeners = new Set<() => void>();

const query = (): Query | null => (window as unknown as { queryLocalFonts?: Query }).queryLocalFonts ?? null;

/** none — API нет или отказали; ask — можно спросить; ready — список есть */
export function localFontsState(): 'none' | 'ask' | 'ready' {
  if (families) return 'ready';
  return query() && !denied ? 'ask' : 'none';
}

/** Семейства по алфавиту; пусто, пока доступа нет */
export function localFamilies(): string[] {
  return families ? [...families.keys()] : [];
}

export function localFaces(family: string): LocalFace[] {
  return families?.get(family) ?? [];
}

/** Список обновился — перерисовать выпадающие списки */
export function onLocalFonts(fn: () => void): void {
  listeners.add(fn);
}

/**
 * Загрузить список. ask=false — только если доступ уже есть (без запроса);
 * ask=true — по действию пользователя, браузер покажет запрос разрешения.
 */
export async function loadLocalFonts(ask: boolean): Promise<boolean> {
  if (families) return true;
  const q = query();
  if (!q) return false;
  if (!ask) {
    try {
      const st = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
      if (st.state !== 'granted') {
        denied = st.state === 'denied';
        return false;
      }
    } catch { return false; }
  }
  try {
    const all = await q.call(window);
    const map = new Map<string, LocalFace[]>();
    const add = (name: string, face: LocalFace) => {
      const list = map.get(name);
      if (list) list.push(face);
      else map.set(name, [face]);
    };
    for (const f of all) {
      const name = f.family.trim();
      // Имя попадёт в CSS и в deck.yaml: только безопасные символы
      if (!fontNameOk(name) || name.startsWith('.')) continue;
      add(name, { style: f.style, postscriptName: f.postscriptName, blob: () => f.blob() });
    }
    // Начертания, которые система показывает отдельными семействами, — к основному шрифту
    for (const [name, faces] of [...map]) {
      const tail = WEIGHT_TAIL.exec(name);
      const base = tail ? name.slice(0, tail.index) : '';
      if (!base || !map.has(base)) continue;
      for (const f of faces) add(base, { ...f, style: `${tail![1]} ${/regular/i.test(f.style) ? '' : f.style}`.trim() });
      map.delete(name);
    }
    families = new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'ru')));
    listeners.forEach((fn) => fn());
    return true;
  } catch {
    denied = true;
    return false;
  }
}

/** Толщина и наклон по названию начертания: «Bold Italic», «SemiBold», «Light»… */
export function faceStyle(style: string): { weight: number; italic: boolean } {
  const s = style.toLowerCase().replace(/[\s_-]/g, '');
  const italic = /italic|oblique|kursiv/.test(s);
  const weight =
    /thin|hairline/.test(s) ? 100
      : /(extra|ultra)light/.test(s) ? 200
        : /semilight|demilight/.test(s) ? 350
          : /light/.test(s) ? 300
            : /(semi|demi)bold/.test(s) ? 600
              : /(extra|ultra)bold/.test(s) ? 800
                : /black|heavy/.test(s) ? 900
                  : /bold/.test(s) ? 700
                    : /medium/.test(s) ? 500
                      : 400;
  return { weight, italic };
}

/** Толщины шрифта компьютера по возрастанию (прямые начертания; если их нет — все) */
export function localWeights(family: string): number[] {
  const all = localFaces(family).map((f) => faceStyle(f.style));
  const upright = all.filter((f) => !f.italic);
  return [...new Set((upright.length ? upright : all).map((f) => f.weight))].sort((a, b) => a - b);
}

/**
 * Начертания для презентации: обычное, жирное (им пишется **жирный** текст) и выбранные толщины,
 * к каждому — курсив, если он есть. Остальные толщины не копируются, пока их не выберут.
 */
export function pickFaces(family: string, extra: number[] = []): { face: LocalFace; weight: number; italic: boolean }[] {
  const all = localFaces(family).map((face) => ({ face, ...faceStyle(face.style) }));
  const out: typeof all = [];
  for (const italic of [false, true]) {
    const pool = all.filter((f) => f.italic === italic);
    if (!pool.length) continue;
    for (const want of [400, 700, ...extra]) {
      const best = pool.reduce((a, b) => (Math.abs(b.weight - want) < Math.abs(a.weight - want) ? b : a));
      // Жирного нет — браузер сделает его из обычного; повторять тот же файл не нужно
      if (want === 700 && best.weight < 600) continue;
      if (!out.includes(best)) out.push(best);
    }
  }
  return out;
}

/**
 * Можно ли встроить файл: формат (одиночный TTF/OTF, не коллекция TTC) и разрешение автора
 * (OS/2 fsType: бит 1 — «встраивать нельзя»). Возвращает расширение файла или причину отказа.
 */
export function embeddable(buf: ArrayBuffer): { ext: 'ttf' | 'otf' } | { reason: string } {
  const v = new DataView(buf);
  if (buf.byteLength < 12) return { reason: 'файл не читается' };
  const tag = v.getUint32(0);
  if (tag === 0x74746366) return { reason: 'шрифт хранится в коллекции и не встраивается' }; // 'ttcf'
  const ext = tag === 0x4f54544f ? 'otf' : 'ttf'; // 'OTTO'
  const n = v.getUint16(4);
  for (let i = 0; i < n; i++) {
    const at = 12 + i * 16;
    if (at + 16 > buf.byteLength) break;
    if (v.getUint32(at) !== 0x4f532f32) continue; // 'OS/2'
    const off = v.getUint32(at + 8);
    if (off + 10 > buf.byteLength) break;
    const fsType = v.getUint16(off + 8);
    // Только бит 1 без битов 2–3 (просмотр/правка) означает полный запрет
    if ((fsType & 0x000f) === 0x0002) return { reason: 'автор шрифта запретил его встраивать' };
    break;
  }
  return { ext };
}

