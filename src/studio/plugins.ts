/**
 * Плагины в студии (docs/PLUGINS.md): список с сервера (server/integrations.ts), кнопки включённых в группе
 * «Плагины» на вкладке «Инструменты», строки в Ctrl+K, панель рядом со слайдом (plugin-pane.ts). Правка из
 * панели — операциями, как у скриптов и агентов: одним шагом отмены, с точками до и после и записью в журнал.
 * Список, включение с разрешениями и удаление — раздел «Файл → Интеграции → Плагины» (integrations-file.ts).
 */
import { icon } from '../components/icons';
import { replaceContents } from '../engine/data';
import type { Editor } from '../engine/editor/editor';
import { applyOps } from '../engine/ops';
import { permissionsOf, type PluginManifest } from '../engine/plugin-manifest';
import type { Deck } from '../types';
import { api, edits } from './integrations';
import { PluginPane, type PluginRef } from './plugin-pane';
import type { Entry } from './palette';

/** Плагин в списке: описание (или почему не включить), включён ли, что разрешили и чего ещё не хватает */
export interface PluginInfo {
  id: string; folder: string; builtin: boolean;
  manifest: PluginManifest | null; error?: string;
  enabled: boolean; granted: string[]; needs: string[];
}

export interface PluginsHost {
  deck: Deck;
  deckKey: string;
  editor: Editor;
  /** Номер текущего слайда, с 0 */
  index(): number;
  /** Лента поменялась (кнопки плагинов) — уложить её заново */
  fit(): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Работает: включён, разрешено всё нужное, есть панель */
const usable = (p: PluginInfo): p is PluginInfo & { manifest: PluginManifest } => p.enabled && !!p.manifest?.panel && !p.needs.length;
const ref = (p: PluginInfo & { manifest: PluginManifest }): PluginRef => ({ id: p.id, manifest: p.manifest, granted: p.granted });

export function startPlugins(h: PluginsHost) {
  let list: PluginInfo[] = [];
  const listeners = new Set<() => void>();
  const ed = h.editor;

  /** Номера выделенных свободных объектов текущего слайда (с 0) */
  const selection = () => {
    const at = h.index();
    return (ed.selection?.group ?? []).filter((p) => p[0] === 'slides' && p[1] === at && p[2] === 'free').map((p) => Number(p[3]));
  };

  /** Правка из панели: копия данных — операциями, итог — одним шагом отмены; в журнал — от имени плагина */
  async function apply(p: PluginRef, ops: unknown[], label?: string): Promise<{ changes: string[] }> {
    if (!ed.active) ed.toggle(true);
    ed.finishText();
    await ed.settle();
    const draft = JSON.parse(JSON.stringify(h.deck)) as Deck;
    const r = applyOps(draft, ops);
    if (!r.details.length) return { changes: [] };
    const before = await ed.files.checkpoint?.(h.deckKey, 'auto').catch(() => null);
    ed.commit((d) => replaceContents(d as unknown as Record<string, unknown>, r.deck as unknown as Record<string, unknown>), { rebuild: true });
    const name = p.manifest.name;
    void (async () => {
      await ed.settle();
      const after = before ? await ed.files.checkpoint?.(h.deckKey, 'auto').catch(() => null) : null;
      await api(`journal-add?deck=${encodeURIComponent(h.deckKey)}`, { name, kind: 'plugin', id: p.id, changes: r.details, ...(before && after ? { checkpoint: before.id, after: after.id } : {}) });
    })().catch(() => null);
    ed.toast(`${label ? `${name}: ${label}` : `Плагин «${name}»`} — ${edits(r.details.length)} · отменить — Ctrl+Z`, 3500);
    return { changes: r.changes };
  }

  const root = document.getElementById('st-ppane');
  const pane = root ? new PluginPane(root, {
    deck: h.deck,
    index: h.index,
    selection,
    apply,
    file: (id, rel) => api(`plugin-file?id=${encodeURIComponent(id)}&file=${encodeURIComponent(rel)}`),
    data: (id, set) => api(`plugin-data?id=${encodeURIComponent(id)}`, set),
    toast: (t, err) => ed.toast(t, err ? 5000 : 3000, err),
    changed: () => paint(),
  }) : null;

  /** Группа «Плагины» на «Инструментах»: кнопка на включённый плагин; открыт — горит */
  function paint(): void {
    const grp = document.getElementById('st-plug-group');
    const body = document.getElementById('st-plugs');
    if (!grp || !body) return;
    const on = list.filter(usable);
    const html = on.map((p) => `<button type="button" class="st-rb big${pane?.open === p.id ? ' active' : ''}" data-plugin="${esc(p.id)}" data-pal="skip" title="${esc(p.manifest.button.title)}" aria-pressed="${pane?.open === p.id}">${icon(p.manifest.icon)}<span>${esc(p.manifest.button.label)}</span></button>`).join('');
    // Пишем, только если поменялось: лента пересчитывается от каждой записи
    if (body.innerHTML === html && grp.hidden === !on.length) return;
    body.innerHTML = html;
    grp.hidden = !on.length;
    h.fit();
  }
  document.getElementById('st-plugs')?.addEventListener('click', (e) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-plugin]')?.dataset.plugin;
    if (id) toggle(id);
  });

  async function refresh(): Promise<PluginInfo[]> {
    try { list = await api<PluginInfo[]>('plugins'); } catch { /* файл с диска — плагинов нет */ }
    // Плагин выключили или удалили — его панель закрывается
    if (pane?.open && !list.some((p) => p.id === pane.open && usable(p))) pane.close();
    paint();
    listeners.forEach((f) => f());
    return list;
  }

  /** Открыть панель плагина (или закрыть, если открыта) */
  function toggle(id: string): void {
    const p = list.find((x) => x.id === id);
    if (!p || !usable(p) || !pane) return;
    if (pane.open === id) pane.close();
    else void pane.show(ref(p));
  }

  /** Включить с разрешениями, которые показали человеку, или выключить */
  async function setEnabled(id: string, on: boolean): Promise<void> {
    const p = list.find((x) => x.id === id);
    if (!p?.manifest) throw new Error(p?.error ?? 'Плагин не найден');
    await api(`plugin-set?id=${encodeURIComponent(id)}`, on ? { enabled: true, granted: permissionsOf(p.manifest) } : { enabled: false });
    await refresh();
  }

  async function remove(id: string): Promise<void> {
    if (pane?.open === id) pane.close();
    await api(`plugin-delete?id=${encodeURIComponent(id)}`);
    await refresh();
  }

  /** Включённые плагины в Ctrl+K: «Плагин: Фото и иконки» */
  const palette = (): Entry[] => list.filter(usable).map((p) => ({
    id: `plugin.${p.id}`, label: `Плагин: ${p.manifest.name}`, path: 'Инструменты · Плагины', words: `плагин панель ${p.manifest.description}`, key: '',
    ico: icon(p.manifest.icon), run: () => toggle(p.id), enabled: () => true,
  }));

  if (location.protocol.startsWith('http')) setTimeout(() => void refresh(), 1500);

  return {
    list: () => list,
    refresh, toggle, setEnabled, remove, palette,
    /** Открытая панель — какой плагин */
    openId: () => pane?.open ?? null,
    /** Слайд, выделение или правка — панели плагина (studio.ts, syncUi и refresh) */
    notify: (changed = false) => pane?.notify(changed),
    /** Подписка раздела «Плагины» на новый список */
    onChange: (f: () => void) => { listeners.add(f); return () => listeners.delete(f); },
  };
}

export type Plugins = ReturnType<typeof startPlugins>;
