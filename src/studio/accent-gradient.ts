/**
 * Градиент акцента — у презентации («Дизайн» → «Цвета» → «Градиент») и у слайда со своими цветами:
 * от акцента (первая точка) ко второму цвету (последняя), между ними — до четырёх своих точек
 * (theme.accent, accent2, accentMid). Готовые сочетания меняют и акцент; «Без градиента» — ровный акцент.
 */
import { accentMid, DEFAULT_ACCENT, HEX_RE, previewAccent, type AccentStop } from '../engine/accent';
import { SHAPE_SWATCHES } from '../components/shape/shape';
import { gradientPanel, type GradValue } from '../engine/editor/gradient-edit';
import { showPopover } from './menu';

/** Готовые сочетания: акцент и второй цвет (null — ровный акцент), точки между, название */
export const PALETTES: [string, string | null, string, AccentStop[]?][] = [
  ['#2563EB', null, 'Синий'], ['#4F46E5', '#06B6D4', 'Индиго и бирюза'], ['#7C3AED', '#EC4899', 'Фиолетовый и розовый'],
  ['#0D9488', '#34D399', 'Бирюзовый'], ['#16A34A', '#A3E635', 'Зелёный'], ['#0369A1', '#14B8A6', 'Океан'],
  ['#E11D48', null, 'Красный'], ['#DB2777', '#F97316', 'Закат'], ['#EA580C', '#FACC15', 'Солнечный'],
  ['#C9A227', '#F3D98B', 'Золото'], ['#0EA5E9', '#6366F1', 'Небо'], ['#334155', null, 'Графит'],
  ['#4F46E5', '#F97316', 'Полярное сияние', [{ c: '#EC4899', at: 50 }]],
  ['#2563EB', '#F43F5E', 'Радуга', [{ c: '#14B8A6', at: 33 }, { c: '#FACC15', at: 66 }]],
];

/** Цвета акцента: что пишется в тему или в цвета слайда */
export interface AccentColors { accent?: string; accent2?: string; accentMid?: AccentStop[] }

const css = (a: string, a2: string | null, mid: AccentStop[] = []) =>
  a2 ? `linear-gradient(90deg, ${[a, ...mid.map((m) => `${m.c} ${m.at}%`), a2].join(', ')})` : a;

/** Плашка готового сочетания, как в прежних «Палитрах»: цвета ровными полосами наискось */
const bands = (a: string, a2: string | null, mid: AccentStop[] = []) => {
  const list = a2 ? [a, ...mid.map((m) => m.c), a2] : [a];
  if (list.length < 2) return a;
  const w = 100 / list.length;
  return `linear-gradient(135deg, ${list.map((c, i) => `${c} ${Math.round(i * w)}% ${Math.round((i + 1) * w)}%`).join(', ')})`;
};

/** Как выглядит градиент акцента — для кнопки «Градиент» на ленте и в панели слайда */
export function accentSwatch(t: unknown): string {
  const c = (t ?? {}) as AccentColors;
  const a = c.accent && HEX_RE.test(c.accent) ? c.accent : DEFAULT_ACCENT;
  return css(a, c.accent2 && HEX_RE.test(c.accent2) ? c.accent2 : null, accentMid(c.accentMid));
}

/**
 * Окно градиента акцента у кнопки at. cur — цвета сейчас; stage — сцена (примерка на открытом
 * слайде); own — цвета слайда, а не презентации; commit — записать новые цвета (одним шагом)
 */
export function openAccentGradient(at: HTMLElement, cur: AccentColors, stage: () => HTMLElement, own: boolean, commit: (c: AccentColors) => void, done: () => void): void {
  const a = cur.accent && HEX_RE.test(cur.accent) ? cur.accent.toUpperCase() : DEFAULT_ACCENT;
  const a2 = cur.accent2 && HEX_RE.test(cur.accent2) ? cur.accent2.toUpperCase() : null;
  const mid = accentMid(cur.accentMid);
  const val = (g: GradValue): AccentColors => ({ accent: g.from, accent2: g.to, accentMid: accentMid(g.mid) });
  const presets = PALETTES.map(([c1, c2, name, m]) => ({
    name, css: bands(c1, c2, m),
    g: c2 ? { from: c1, to: c2, mid: m ?? [] } : null,
    accent: c1,
    on: c1 === a && c2 === a2 && JSON.stringify(m ?? []) === JSON.stringify(mid),
  }));
  presets.unshift({ name: 'Без градиента — ровный акцент', css: a, g: null, accent: a, on: !a2 });
  const panel = gradientPanel({
    css: (c) => c,
    hex: (c) => (HEX_RE.test(c) ? c : DEFAULT_ACCENT),
    swatches: [{ label: 'Цвета', items: [...new Set([a, ...(a2 ? [a2] : []), ...mid.map((m) => m.c), ...SHAPE_SWATCHES.map((x) => x.toUpperCase())])].slice(0, 20).map((c) => [c, c, c]) }],
    presets,
    round: true,
    preview: (g) => previewAccent(g.from, stage(), { to: g.to, mid: accentMid(g.mid) }, own),
    commit: (g) => { commit(g ? val(g) : { accent: a }); done(); },
    // Готовое сочетание меняет и акцент; без второго цвета — ровный акцент
    choose: (k) => { const p = presets[k]; commit(p.g ? val(p.g) : { accent: p.accent }); done(); },
    tryPreset: (k) => {
      const p = k === null ? null : presets[k];
      if (!p) return previewAccent(null);
      previewAccent(p.accent, stage(), p.g ? { to: p.g.to, mid: accentMid(p.g.mid) } : null, own);
    },
  }, { from: a, to: a2 ?? a, mid });
  const el = showPopover(at, `<div class="st-plabel">Градиент акцента</div>${panel.html}`, panel.pick, 'st-palette st-grad');
  panel.bind(el);
  new MutationObserver((_m, o) => { if (!el.isConnected) { previewAccent(null); o.disconnect(); } }).observe(document.body, { childList: true });
}
