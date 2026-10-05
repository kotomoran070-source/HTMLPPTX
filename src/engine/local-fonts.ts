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

/** Пункт списка, который просит разрешение (в браузере) */
export const ASK_LOCAL = '?local-fonts'; // не может быть именем шрифта (см. fontNameOk)

let families: Map<string, FontData[]> | null = null;
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

export function localFaces(family: string): FontData[] {
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
    const map = new Map<string, FontData[]>();
    for (const f of all) {
      const name = f.family.trim();
      // Имя попадёт в CSS и в deck.yaml: только безопасные символы
      if (!fontNameOk(name) || name.startsWith('.')) continue;
      const list = map.get(name);
      if (list) list.push(f);
      else map.set(name, [f]);
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

/** Начертания для презентации: обычное, жирное и курсивы к ним — их и использует редактор */
export function pickFaces(family: string): { face: FontData; weight: number; italic: boolean }[] {
  const all = localFaces(family).map((face) => ({ face, ...faceStyle(face.style) }));
  const out: typeof all = [];
  for (const italic of [false, true]) {
    for (const want of [400, 700]) {
      const pool = all.filter((f) => f.italic === italic);
      if (!pool.length) continue;
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

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Группы выпадающего списка после шрифтов темы: «Шрифты презентации» (свои и библиотека),
 * затем «Шрифты компьютера»; в браузере без доступа — пункт, который спрашивает разрешение.
 */
export function fontGroupsHtml(choices: { name: string; sys?: boolean }[], cur: string, stack: (n: string) => string): string {
  const opt = (n: string) => `<option value="${escHtml(n)}"${n === cur ? ' selected' : ''} style="font-family:${escHtml(stack(n))}">${escHtml(n)}</option>`;
  const own = choices.filter((f) => !f.sys).map((f) => f.name);
  const sys = choices.filter((f) => f.sys).map((f) => f.name);
  // Выбранный шрифт компьютера, который не встроен, а список ещё не загружен, — остаётся видимым
  if (cur && !own.includes(cur) && !sys.includes(cur)) own.push(cur);
  let out = own.length ? `<optgroup label="Шрифты презентации">${own.map(opt).join('')}</optgroup>` : '';
  if (sys.length) out += `<optgroup label="Шрифты компьютера">${sys.map(opt).join('')}</optgroup>`;
  else if (localFontsState() === 'ask') out += `<optgroup label="Шрифты компьютера"><option value="${escHtml(ASK_LOCAL)}">Показать шрифты компьютера…</option></optgroup>`;
  return out;
}
