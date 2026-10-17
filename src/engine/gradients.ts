/**
 * Градиенты: заливка и контур фигур, цвет текста. Без зависимостей — их берут и компоненты, и разметка текста.
 */
/**
 * Свой градиент заливки: цвета — роли темы (accent, soft, surface…, а также accent-light и accent-dark)
 * или #RRGGBB; mid — точки между началом и концом (место 1–99 %); angle — направление в градусах
 * (как в CSS: 180 — сверху вниз); radial — от центра.
 */
export interface ShapeGradient {
  from: string;
  to: string;
  mid?: GradientStop[];
  angle?: number;
  type?: 'linear' | 'radial';
}
/** Точка градиента между началом и концом: цвет и место, 1–99 % */
export interface GradientStop { c: string; at: number }

/** Точки между началом и концом в порядке: цвет есть, место 1–99 %, по возрастанию, не больше четырёх */
export function gradientMid(v: unknown): GradientStop[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is GradientStop => !!x && typeof x.c === 'string' && Number.isFinite(Number(x.at)))
    .map((x) => ({ c: x.c, at: Math.max(1, Math.min(99, Math.round(Number(x.at)))) }))
    .sort((a, b) => a.at - b.at).slice(0, 4);
}

/** Роли темы в градиентах: те же, что у цветов фигур (shape.ts), и светлый/тёмный акцент */
export const GRADIENT_ROLES: Record<string, string> = {
  surface: 'var(--surf)', bg: 'var(--bg)', alt: 'var(--alt)', soft: 'var(--acs)', accent: 'var(--ac)', accent2: 'var(--ac2)', text: 'var(--tx)',
  text2: 'var(--tx2)', line: 'var(--bd)', border: 'var(--bd2)', muted: 'var(--mu)',
  'accent-light': 'color-mix(in srgb, var(--ac) 72%, #fff)',
  'accent-dark': 'color-mix(in srgb, var(--ac) 78%, #000)',
};
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const ACCENT = { css: 'linear-gradient(135deg, color-mix(in srgb, var(--ac) 72%, #fff), color-mix(in srgb, var(--ac) 78%, #000))', on: 'var(--on-ac)' };
/** Цвет текста на заливке роли темы */
const ROLE_ON: Record<string, string> = { accent: 'var(--on-ac)', text: 'var(--bg)', muted: 'var(--bg)', soft: 'var(--ach)' };

/** Готовые градиенты: первые — от цветов темы (меняются с темой и акцентом), дальше — постоянные */
export const GRADIENTS: { id: string; name: string; g: ShapeGradient; on?: string }[] = [
  { id: 'accent', name: 'Акцент', g: { from: 'accent-light', to: 'accent-dark', angle: 135 }, on: 'var(--on-ac)' },
  { id: 'duo', name: 'Градиент акцента (Дизайн → Цвета)', g: { from: 'accent', to: 'accent2', angle: 135 }, on: 'var(--on-ac)' },
  { id: 'glow', name: 'Сияние акцента', g: { from: 'accent-light', to: 'accent-dark', type: 'radial' }, on: 'var(--on-ac)' },
  { id: 'soft', name: 'Мягкий', g: { from: 'soft', to: 'surface', angle: 135 }, on: 'var(--ach)' },
  { id: 'mist', name: 'Туман', g: { from: 'surface', to: 'alt', angle: 180 }, on: 'var(--tx)' },
  { id: 'night', name: 'Ночь', g: { from: 'text', to: 'accent', angle: 135 }, on: 'var(--bg)' },
  { id: 'sunset', name: 'Закат', g: { from: '#F97316', to: '#DB2777', angle: 135 } },
  { id: 'ocean', name: 'Океан', g: { from: '#06B6D4', to: '#2563EB', angle: 135 } },
  { id: 'forest', name: 'Лес', g: { from: '#22C55E', to: '#0D9488', angle: 135 } },
  { id: 'violet', name: 'Фиолетовый', g: { from: '#8B5CF6', to: '#EC4899', angle: 135 } },
  { id: 'graphite', name: 'Графит', g: { from: '#475569', to: '#0F172A', angle: 160 } },
  { id: 'fire', name: 'Огонь', g: { from: '#FBBF24', to: '#DC2626', angle: 135 } },
  { id: 'peach', name: 'Персик', g: { from: '#FED7AA', to: '#FBCFE8', angle: 135 } },
  { id: 'mint', name: 'Мята', g: { from: '#A7F3D0', to: '#BFDBFE', angle: 135 } },
];

export const gradColor = (c: unknown): string => (typeof c === 'string' ? GRADIENT_ROLES[c] ?? (HEX.test(c) ? c : 'var(--ac)') : 'var(--ac)');

/** Градиент в порядке? (иначе — градиент акцента по умолчанию) */
export function isGradient(g: unknown): g is ShapeGradient {
  return !!g && typeof g === 'object' && typeof (g as ShapeGradient).from === 'string' && typeof (g as ShapeGradient).to === 'string';
}

/** Цвета градиента через запятую: начало, точки между, конец. От акцента ко второму цвету — все точки темы */
function stopsCss(g: ShapeGradient): string {
  const mid = gradientMid(g.mid);
  if (!mid.length && g.from === 'accent' && g.to === 'accent2') return 'var(--ac-stops, var(--ac), var(--ac2))';
  return [gradColor(g.from), ...mid.map((m) => `${gradColor(m.c)} ${m.at}%`), gradColor(g.to)].join(', ');
}

/** CSS градиента; без своего — градиент акцента */
export function gradientCss(g: unknown): string {
  if (!isGradient(g)) return ACCENT.css;
  if (g.type === 'radial') return `radial-gradient(circle at 50% 40%, ${stopsCss(g)})`;
  const a = Number.isFinite(Number(g.angle)) ? Number(g.angle) : 135;
  return `linear-gradient(${a}deg, ${stopsCss(g)})`;
}

/** Цвет текста поверх градиента: у готовых — свой, у постоянных цветов — по яркости середины */
export function gradientOn(g: unknown): string {
  if (!isGradient(g)) return ACCENT.on;
  const preset = GRADIENTS.find((x) => sameGradient(x.g, g));
  if (preset?.on) return preset.on;
  const lum = (c: string) => {
    if (!HEX.test(c)) return null;
    const h = c.length === 4 ? c.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : c;
    const [r, gr, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return 0.299 * r + 0.587 * gr + 0.114 * b;
  };
  const all = [g.from, ...gradientMid(g.mid).map((m) => m.c), g.to].map(lum);
  if (all.some((x) => x === null)) return GRADIENTS.find((x) => x.g.from === g.from)?.on ?? ROLE_ON[g.from] ?? 'var(--tx)';
  return (all as number[]).reduce((s, x) => s + x, 0) / all.length > 165 ? '#111827' : '#FFFFFF';
}

export function sameGradient(a: unknown, b: unknown): boolean {
  if (!isGradient(a) || !isGradient(b)) return false;
  const mid = (g: ShapeGradient) => gradientMid(g.mid).map((m) => `${m.c.toLowerCase()}@${m.at}`).join(',');
  return a.from.toLowerCase() === b.from.toLowerCase() && a.to.toLowerCase() === b.to.toLowerCase() && mid(a) === mid(b)
    && (a.type ?? 'linear') === (b.type ?? 'linear') && (a.type === 'radial' || (a.angle ?? 135) === (b.angle ?? 135));
}


/** Градиенты, которые годятся для текста: контрастные и на светлом, и на тёмном фоне */
export const TEXT_GRADIENTS = ['duo', 'accent', 'night', 'sunset', 'ocean', 'forest', 'violet', 'fire'];

/** Код градиента текста в разметке: имя готового или свои цвета (см. parseTextGradient) */
export const TEXT_GRADIENT_RE = 'g:[#a-z0-9@,-]+';

/**
 * Свой градиент текста в разметке: {g:#F97316,#EC4899@40,#7C3AED|слова} — цвета через запятую
 * (#RRGGBB или цвета темы: accent, accent2, text…), у точек между — место в % после @; первым может
 * идти направление: {g:180deg,#FFD700,#B8860B|…} (без него — слева направо). Готовые — по имени: {g:ocean|…}
 */
export function parseTextGradient(code: string): ShapeGradient | null {
  const id = /^g:([a-z-]+)$/i.exec(code)?.[1];
  if (id) {
    const preset = GRADIENTS.find((x) => x.id === id);
    // Текст идёт слева направо: у готового градиента — всегда поперёк строки
    return preset ? { ...preset.g, type: undefined, angle: 90 } : null;
  }
  const parts = /^g:(.+)$/i.exec(code)?.[1].split(',');
  if (!parts) return null;
  const deg = /^(\d{1,3})deg$/i.exec(parts[0]);
  if (deg) parts.shift();
  if (parts.length < 2 || parts.length > 6) return null;
  const pts = parts.map((x) => /^(#[0-9a-f]{6}|#[0-9a-f]{3}|[a-z][a-z0-9-]*)(?:@(\d{1,2}))?$/i.exec(x.trim()));
  if (pts.some((m) => !m || (!m[1].startsWith('#') && !GRADIENT_ROLES[m[1]]))) return null;
  const n = pts.length - 1;
  const mid = pts.slice(1, -1).map((m, i) => ({ c: m![1], at: m![2] ? Number(m![2]) : Math.round(((i + 1) / n) * 100) }));
  return { from: pts[0]![1], to: pts[n]![1], ...(mid.length ? { mid: gradientMid(mid) } : {}), angle: deg ? Number(deg[1]) % 360 : 90 };
}

/** Градиент → код для разметки текста ({g:…|слова}); готовый — своим именем */
export function textGradientCode(g: ShapeGradient): string {
  const preset = GRADIENTS.find((x) => TEXT_GRADIENTS.includes(x.id) && sameGradient({ ...x.g, type: undefined, angle: 90 }, g));
  if (preset) return `g:${preset.id}`;
  const a = g.type === 'radial' ? 90 : Math.round(Number(g.angle ?? 90)) % 360;
  return `g:${a === 90 ? '' : `${a}deg,`}${[g.from, ...gradientMid(g.mid).map((m) => `${m.c}@${m.at}`), g.to].join(',')}`;
}

/** Градиент текста по коду: {g:ocean|слова} или свои цвета {g:#F97316,#EC4899@40,#7C3AED|слова} */
export function textGradientCss(code: string): string | null {
  const g = parseTextGradient(code);
  if (!g) return null;
  // color — запасной цвет (печать без фона, экспорт в PowerPoint)
  return `--g:${gradientCss(g)};color:${gradColor(g.from)}`;
}
