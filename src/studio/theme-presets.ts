/**
 * Галерея тем студии: готовые темы (цвета слайдов для светлой и тёмной темы, шрифты, фон,
 * карточки, скругление) и шрифты к ним. При выборе темы её значения целиком пишутся в
 * deck.theme (engine/deck-theme.ts), а шрифты копируются в презентацию — собранный файл
 * не зависит ни от галереи, ни от этой программы.
 */
import type { DeckTheme, SlideData } from '../types';

/**
 * Шрифты тем: свободные (SIL Open Font License, src/fonts/OFL.txt), латиница и кириллица,
 * переменная насыщенность. Имя семейства → файл в src/fonts
 */
export const THEME_FONTS: Record<string, string> = {
  'Inter Tight': 'InterTight.woff2',
  Manrope: 'Manrope.woff2',
  Onest: 'Onest.woff2',
  'Golos Text': 'GolosText.woff2',
  Montserrat: 'Montserrat.woff2',
  Jost: 'Jost.woff2',
  Nunito: 'Nunito.woff2',
  Unbounded: 'Unbounded.woff2',
  Tektur: 'Tektur.woff2',
  'Dela Gothic One': 'DelaGothicOne.woff2',
  'Noto Serif Display': 'NotoSerifDisplay.woff2',
  Literata: 'Literata.woff2',
  'Cormorant Garamond': 'CormorantGaramond.woff2',
  Caveat: 'Caveat.woff2',
  'JetBrains Mono': 'JetBrainsMono.woff2',
};

/** Толщины шрифтов тем: все переменные (любая толщина в диапазоне), Dela Gothic One — одна */
const THEME_FONT_RANGE: Record<string, [number, number]> = {
  'Inter Tight': [100, 900], Manrope: [200, 800], Onest: [100, 900], 'Golos Text': [400, 900], Montserrat: [100, 900],
  Jost: [100, 900], Nunito: [200, 900], Unbounded: [200, 900], Tektur: [400, 900], 'Dela Gothic One': [400, 400],
  'Noto Serif Display': [100, 900], Literata: [200, 900], 'Cormorant Garamond': [300, 700], Caveat: [400, 700], 'JetBrains Mono': [100, 800],
};

/** Начертания шрифта темы — обычные ступени (100, 200…) внутри его диапазона */
export function themeFontWeights(name: string): number[] {
  const r = THEME_FONT_RANGE[name];
  return r ? [100, 200, 300, 400, 500, 600, 700, 800, 900].filter((w) => w >= r[0] && w <= r[1]) : [];
}

// Студия есть только в yarn dev и в приложении: в собранные файлы презентаций шрифты не попадают
const URLS = import.meta.glob('../fonts/*.woff2', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** Адрес и имя файла шрифта темы; null — такого шрифта у тем нет */
export function themeFont(name: string): { name: string; url: string; file: string } | null {
  const file = THEME_FONTS[name];
  const url = file ? URLS[`../fonts/${file}`] : undefined;
  return file && url ? { name, url, file } : null;
}

/** Шрифты тем — на страницу студии: плитки галереи и примерка темы пишут ими сразу */
export function registerThemeFonts(): void {
  if (document.getElementById('slideria-theme-fonts')) return;
  const el = document.createElement('style');
  el.id = 'slideria-theme-fonts';
  el.textContent = Object.keys(THEME_FONTS).map((n) => {
    const f = themeFont(n);
    const r = THEME_FONT_RANGE[n] ?? [100, 900];
    return f ? `@font-face{font-family:"${n}";src:url("${f.url}") format("woff2");font-weight:${r[0]} ${r[1]};font-display:swap}` : '';
  }).join('\n');
  document.head.appendChild(el);
}

export interface ThemePreset {
  id: string;
  name: string;
  theme: DeckTheme;
}

/**
 * Темы галереи. У каждой — палитры для светлых и тёмных слайдов; mode — с какими слайдами
 * тема задумана (без него — как тема у зрителя). Первая — стандартный вид без темы
 */
export const THEME_PRESETS: ThemePreset[] = [
  { id: 'standard', name: 'Стандартная', theme: {} },
  {
    id: 'graphite', name: 'Графит',
    theme: {
      accent: '#E11D48', font: 'Inter Tight', head: 'Inter Tight', headWeight: 800, headSpacing: -0.035,
      light: { bg: '#FFFFFF', tx: '#0A0A0A', surf: '#FFFFFF', alt: '#F4F4F5', mu: '#71717A', bd: '#E4E4E7', bd2: '#D4D4D8' },
      dark: { bg: '#0A0A0B', tx: '#FAFAFA', surf: '#141417', alt: '#050506', mu: '#A1A1AA', bd: '#27272A', bd2: '#3F3F46' },
      bg: 'plain', cards: 'outline', radius: 0.35,
    },
  },
  {
    id: 'midnight', name: 'Полночь',
    theme: {
      mode: 'dark', accent: '#22D3EE', accent2: '#A78BFA', accentFlow: true, font: 'Manrope', head: 'Unbounded', headWeight: 600, headSpacing: -0.02, headScale: 0.78,
      light: { bg: '#F4F6FD', tx: '#0B1020', mu: '#5B6478', bd: '#DFE3F0', bd2: '#CBD1E3' },
      dark: { bg: '#070B18', tx: '#E8ECFA', surf: '#0F1529', alt: '#050812', tx2: '#C3CAE0', mu: '#8A93AD', bd: '#1C2440', bd2: '#2A3456' },
      bg: 'glow', cards: 'glass', radius: 1.3,
    },
  },
  {
    id: 'aurora', name: 'Аврора',
    theme: {
      accent: '#7C3AED', accent2: '#EC4899', font: 'Onest', head: 'Onest', headWeight: 800, headSpacing: -0.03,
      light: { bg: '#FBF9FF', tx: '#1B1530', surf: '#FFFFFF', mu: '#6E6787', bd: '#ECE7F7', bd2: '#DCD4EE' },
      dark: { bg: '#0F0A1F', tx: '#EEE9FB', surf: '#18112E', alt: '#0A0616', mu: '#9C93B8', bd: '#2A2145', bd2: '#3A2F5E' },
      bg: 'mesh', cards: 'raised', radius: 1.7,
    },
  },
  {
    id: 'editorial', name: 'Редакция',
    theme: {
      accent: '#B4232C', font: 'Literata', head: 'Noto Serif Display', headWeight: 600, headSpacing: -0.01, headScale: 0.95,
      light: { bg: '#F7F3EA', tx: '#1C1917', surf: '#FFFDF8', alt: '#EFE9DC', tx2: '#3F3A35', mu: '#78716C', bd: '#E4DCCB', bd2: '#D3C9B4' },
      dark: { bg: '#171411', tx: '#EDE6DA', surf: '#211D19', alt: '#100E0C', mu: '#A8A096', bd: '#332D27', bd2: '#463E36' },
      bg: 'paper', cards: 'flat', radius: 0.15,
    },
  },
  {
    id: 'terminal', name: 'Терминал',
    theme: {
      mode: 'dark', accent: '#22C55E', accent2: '#A3E635', font: 'Golos Text', head: 'JetBrains Mono', headWeight: 700, headSpacing: -0.02, headScale: 0.93,
      light: { bg: '#F6FAF6', tx: '#0B1F10', mu: '#4D6B55', bd: '#D7E6DA', bd2: '#BFD6C4' },
      dark: { bg: '#050A06', tx: '#D6F5DD', surf: '#0B140D', alt: '#030603', tx2: '#A7D9B2', mu: '#5F8F6A', bd: '#163220', bd2: '#1F4A2C' },
      bg: 'grid', cards: 'outline', radius: 0.2,
    },
  },
  {
    id: 'pop', name: 'Поп',
    theme: {
      accent: '#FF4D00', accent2: '#FF2E93', font: 'Golos Text', head: 'Dela Gothic One', headWeight: 400, headSpacing: 0, headScale: 0.81,
      light: { bg: '#FFF4DE', tx: '#111111', surf: '#FFFFFF', alt: '#FCE7C2', mu: '#5C5346', bd: '#E8D7B5', bd2: '#D6C29B' },
      dark: { bg: '#141210', tx: '#FFF4DE', surf: '#1E1B17', alt: '#0C0B09', mu: '#B8AC98', bd: '#3A342B', bd2: '#51493D' },
      bg: 'halftone', cards: 'poster', radius: 0.9,
    },
  },
  {
    id: 'forest', name: 'Лес',
    theme: {
      accent: '#2F855A', accent2: '#A3B53B', font: 'Golos Text', head: 'Literata', headWeight: 600, headSpacing: -0.015, headScale: 0.96,
      light: { bg: '#F2F5EE', tx: '#14261B', surf: '#FFFFFF', alt: '#E7EDE1', mu: '#5E7064', bd: '#DCE4D6', bd2: '#C7D3BF' },
      dark: { bg: '#0C1611', tx: '#E2EEE5', surf: '#13211A', alt: '#08100C', mu: '#8FA897', bd: '#1F3428', bd2: '#2B4637' },
      bg: 'glow', cards: 'flat', radius: 1.4,
    },
  },
  {
    id: 'sand', name: 'Песок',
    theme: {
      accent: '#C2410C', accent2: '#E8A33D', font: 'Jost', head: 'Jost', headWeight: 500, headSpacing: -0.01,
      light: { bg: '#F6EFE5', tx: '#2A1D14', surf: '#FFFAF3', alt: '#EFE5D7', mu: '#85715F', bd: '#E6D8C5', bd2: '#D6C3AA' },
      dark: { bg: '#19130E', tx: '#F3E8DA', surf: '#231B14', alt: '#120D09', mu: '#B09A84', bd: '#372A1F', bd2: '#4A3929' },
      bg: 'arc', cards: 'soft', radius: 1.1,
    },
  },
  {
    id: 'ocean', name: 'Океан',
    theme: {
      accent: '#0369A1', accent2: '#14B8A6', font: 'Golos Text', head: 'Montserrat', headWeight: 700, headSpacing: -0.02, headScale: 0.92,
      light: { bg: '#FFFFFF', tx: '#0B1B2B', surf: '#FFFFFF', alt: '#F1F6FA', mu: '#5A6B7D', bd: '#E1E8EF', bd2: '#CBD6E1' },
      dark: { bg: '#06121F', tx: '#E3EEF8', surf: '#0C1B2D', alt: '#030A12', mu: '#8BA0B6', bd: '#18304A', bd2: '#22405F' },
      bg: 'band', cards: 'soft', radius: 0.75,
    },
  },
  {
    id: 'mint', name: 'Мята',
    theme: {
      accent: '#0D9488', accent2: '#34D399', font: 'Nunito', head: 'Nunito', headWeight: 800, headSpacing: -0.01,
      light: { bg: '#F1FAF7', tx: '#0F2A25', surf: '#FFFFFF', alt: '#E3F4EE', mu: '#557A70', bd: '#D3EBE3', bd2: '#B9DED2' },
      dark: { bg: '#08201B', tx: '#DDF6EF', surf: '#0E2B25', alt: '#051612', mu: '#86B5A8', bd: '#1A4038', bd2: '#24564B' },
      bg: 'dots', cards: 'raised', radius: 1.9,
    },
  },
  {
    id: 'notebook', name: 'Тетрадь',
    theme: {
      accent: '#1D4ED8', font: 'Nunito', head: 'Caveat', headWeight: 700, headSpacing: 0, headScale: 1.25,
      light: { bg: '#FDFDF8', tx: '#1E2A44', surf: '#FFFFFF', alt: '#F3F4EC', mu: '#5B6478', bd: '#DCE3EE', bd2: '#C3CEDF' },
      // Тёмная — школьная доска
      dark: { bg: '#1C2B24', tx: '#EEF1EA', surf: '#23352C', alt: '#15211B', mu: '#A9B8AE', bd: '#34493E', bd2: '#445C50' },
      bg: 'notebook', cards: 'outline', radius: 0.6,
    },
  },
  {
    id: 'luxe', name: 'Люкс',
    theme: {
      mode: 'dark', accent: '#C9A227', accent2: '#F3D98B', accentFlow: true, font: 'Manrope', head: 'Cormorant Garamond', headWeight: 600, headSpacing: 0, headScale: 1.18,
      light: { bg: '#FBF8F1', tx: '#1A1611', surf: '#FFFFFF', alt: '#F3EEE2', mu: '#7D7366', bd: '#E9E1D0', bd2: '#D9CCB2' },
      dark: { bg: '#0B0A08', tx: '#F2EBDD', surf: '#14120E', alt: '#070605', tx2: '#D9CFBD', mu: '#9C9282', bd: '#2A251C', bd2: '#4A3F2A' },
      bg: 'spot', cards: 'outline', radius: 0.1,
    },
  },
  {
    id: 'neon', name: 'Неон',
    theme: {
      mode: 'dark', accent: '#FF2BD6', accent2: '#00E5FF', accentFlow: true, font: 'Onest', head: 'Tektur', headWeight: 700, headSpacing: 0.01, headScale: 0.92,
      light: { bg: '#FCF7FF', tx: '#1A0B2E', mu: '#6F5E86', bd: '#EFE3FA', bd2: '#E0CCF3' },
      dark: { bg: '#0B0418', tx: '#F4E9FF', surf: '#150A2A', alt: '#070210', mu: '#A08BBE', bd: '#2B1650', bd2: '#3F2070' },
      bg: 'neon', cards: 'glass', radius: 0.6,
    },
  },
];

/**
 * Слайд-образец для плиток галереи: заголовок, подзаголовок, ключевые числа в карточках,
 * столбцы и метки — по нему видно цвета, шрифты, фон, карточки и скругление темы
 */
export const SPECIMEN: SlideData = {
  template: 'cover',
  logo: false,
  title: 'Растём быстрее рынка',
  lead: 'Выручка, клиенты и команда — главное за год',
  styles: { title: { size: 68 }, lead: { size: 26 } },
  visual: {
    type: 'stack', gap: 18,
    items: [
      {
        type: 'grid', columns: 2, gap: 18,
        items: [
          { type: 'card', body: { type: 'stat', value: '+38 %', label: 'выручка' } },
          { type: 'card', body: { type: 'stat', value: '12 400', label: 'клиентов' } },
        ],
      },
      { type: 'card', title: 'По кварталам', body: { type: 'bars', values: [42, 55, 61, 78], labels: ['I', 'II', 'III', 'IV'], height: 120 } },
      { type: 'chips', items: [{ text: 'Рост', accent: true }, 'Команда', 'Продукт'] },
    ],
  },
};
