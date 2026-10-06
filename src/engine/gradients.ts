/**
 * Градиенты: заливка и контур фигур, цвет текста. Без зависимостей — их берут и компоненты, и разметка текста.
 */
/**
 * Свой градиент заливки: цвета — роли темы (accent, soft, surface…, а также accent-light и accent-dark)
 * или #RRGGBB; angle — направление в градусах (как в CSS: 180 — сверху вниз); radial — от центра.
 */
export interface ShapeGradient {
  from: string;
  to: string;
  angle?: number;
  type?: 'linear' | 'radial';
}

/** Роли темы в градиентах: те же, что у цветов фигур (shape.ts), и светлый/тёмный акцент */
export const GRADIENT_ROLES: Record<string, string> = {
  surface: 'var(--surf)', bg: 'var(--bg)', alt: 'var(--alt)', soft: 'var(--acs)', accent: 'var(--ac)', accent2: 'var(--ac2)', text: 'var(--tx)',
  line: 'var(--bd)', border: 'var(--bd2)', muted: 'var(--mu)',
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

/** CSS градиента; без своего — градиент акцента */
export function gradientCss(g: unknown): string {
  if (!isGradient(g)) return ACCENT.css;
  if (g.type === 'radial') return `radial-gradient(circle at 50% 40%, ${gradColor(g.from)}, ${gradColor(g.to)})`;
  const a = Number.isFinite(Number(g.angle)) ? Number(g.angle) : 135;
  return `linear-gradient(${a}deg, ${gradColor(g.from)}, ${gradColor(g.to)})`;
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
  const a = lum(g.from);
  const b = lum(g.to);
  if (a === null || b === null) return GRADIENTS.find((x) => x.g.from === g.from)?.on ?? ROLE_ON[g.from] ?? 'var(--tx)';
  return (a + b) / 2 > 165 ? '#111827' : '#FFFFFF';
}

export function sameGradient(a: unknown, b: unknown): boolean {
  if (!isGradient(a) || !isGradient(b)) return false;
  return a.from.toLowerCase() === b.from.toLowerCase() && a.to.toLowerCase() === b.to.toLowerCase()
    && (a.type ?? 'linear') === (b.type ?? 'linear') && (a.type === 'radial' || (a.angle ?? 135) === (b.angle ?? 135));
}


/** Градиенты, которые годятся для текста: контрастные и на светлом, и на тёмном фоне */
export const TEXT_GRADIENTS = ['duo', 'accent', 'night', 'sunset', 'ocean', 'forest', 'violet', 'fire'];

/** Градиент текста по имени готового: {g:ocean|слова} в разметке */
export function textGradientCss(code: string): string | null {
  const id = /^g:([a-z-]+)$/i.exec(code)?.[1];
  const preset = id ? GRADIENTS.find((x) => x.id === id) : undefined;
  if (!preset) return null;
  // Текст идёт слева направо: у текста градиент всегда поперёк строки
  const g = preset.g.type === 'radial' ? { ...preset.g, type: undefined, angle: 90 } : { ...preset.g, angle: 90 };
  // color — запасной цвет (печать без фона, экспорт в PowerPoint)
  return `--g:${gradientCss(g)};color:${gradColor(preset.g.from)}`;
}
