/**
 * Описание плагина — plugin.json в его папке (docs/PLUGINS.md). Проверка общая у сервера (список плагинов)
 * и студии: что плагину можно, видно до включения, и показывается ровно то, что он просит.
 */

/** Версия API плагинов: плагин для другой версии не включается, а не ломается молча */
export const PLUGIN_API = 1;

export interface PluginManifest {
  name: string;
  description: string;
  version: string;
  author: string;
  /** Значок студии (components/icons.ts); нет такого — общий значок плагина */
  icon: string;
  /** Своя панель рядом со слайдом: HTML-файл плагина и ширина, px */
  panel: { file: string; width: number } | null;
  /** Кнопка в группе «Плагины» на вкладке «Инструменты»: подпись и подсказка */
  button: { label: string; title: string };
  /** Править презентацию операциями (docs/OPS.md) */
  edit: boolean;
  /** Адреса, к которым можно ходить по сети (точные имена, только https) */
  network: string[];
}

/** Разрешение: правка, своя панель, сеть к одному адресу */
export type Permission = 'edit' | 'panel' | `net:${string}`;

/** Папка плагина: буквы, цифры, пробел, точка, дефис, подчёркивание — как имя файла скрипта */
export const PLUGIN_DIR = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,80}$/u;
/** Файл внутри папки плагина: относительный путь без «..» */
export const PLUGIN_PATH = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[\w.-]+(?:\/[\w.-]+){0,4}$/;
/** Адрес сети: имя с точкой, без порта и пути; свой компьютер и адреса по номеру — нельзя */
const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL = /(^|\.)(localhost|local|internal|lan|home|test|example|invalid)$/;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Разобрать plugin.json; ошибка — понятным текстом: почему плагин не включить */
export function readManifest(raw: unknown): { manifest: PluginManifest } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'plugin.json — не объект' };
  const o = raw as Record<string, unknown>;
  const name = str(o.name, 60);
  if (!name) return { error: 'В plugin.json нет названия (name)' };
  if (o.api !== PLUGIN_API) return { error: `Плагин для другой версии программы: api ${JSON.stringify(o.api ?? null)}, нужна ${PLUGIN_API}` };
  let panel: PluginManifest['panel'] = null;
  if (o.panel !== undefined) {
    const p = o.panel as Record<string, unknown> | null;
    const file = str(p?.file, 200);
    if (!p || typeof p !== 'object' || !PLUGIN_PATH.test(file) || !/\.html?$/i.test(file)) return { error: 'panel.file — HTML-файл в папке плагина' };
    const w = Number(p.width ?? 320);
    panel = { file, width: Number.isFinite(w) ? Math.round(Math.min(480, Math.max(260, w))) : 320 };
  }
  if (!panel) return { error: 'У плагина нет панели (panel): пока плагин — это панель рядом со слайдом' };
  const net = o.network === undefined ? [] : o.network;
  if (!Array.isArray(net) || net.length > 20) return { error: 'network — список адресов, не больше 20' };
  const network: string[] = [];
  for (const h of net) {
    const host = typeof h === 'string' ? h.trim().toLowerCase() : '';
    if (!HOST.test(host) || LOCAL.test(host)) return { error: `network: «${String(h).slice(0, 60)}» — нужно имя сайта, например api.example.org` };
    if (!network.includes(host)) network.push(host);
  }
  const b = (o.button ?? {}) as Record<string, unknown>;
  return {
    manifest: {
      name,
      description: str(o.description, 200),
      version: str(o.version, 20),
      author: str(o.author, 60),
      icon: /^[a-z0-9-]{1,30}$/.test(str(o.icon, 30)) ? str(o.icon, 30) : 'plug',
      panel,
      button: { label: str(b.label, 30) || name, title: str(b.title, 120) || str(o.description, 120) || name },
      edit: o.edit === true,
      network,
    },
  };
}

/** Что плагин просит: всё это показывается до включения */
export function permissionsOf(m: PluginManifest): Permission[] {
  return [...(m.edit ? ['edit' as const] : []), ...(m.panel ? ['panel' as const] : []), ...m.network.map((h) => `net:${h}` as const)];
}

/** Чего из нужного плагину ещё не разрешили (новый адрес в обновлении — снова вопрос) */
export function missing(m: PluginManifest, granted: readonly string[]): Permission[] {
  return permissionsOf(m).filter((p) => !granted.includes(p));
}
