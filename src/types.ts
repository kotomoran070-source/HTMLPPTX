/** Презентация как данные: то, что лежит в presentations/<имя>/deck.yaml. */
export interface Deck {
  title: string;
  lang?: string;
  brand?: {
    name?: string;
    /** Путь к логотипу относительно deck.yaml, например ./assets/logo.svg */
    logo?: string;
    /** Свой логотип для тёмной темы; без него в обеих темах — logo */
    logoDark?: string;
  };
  theme?: DeckTheme;
  /** Свои шрифты: файлы в assets/ — { name: Manrope, src: ./assets/Manrope.woff2 } */
  fonts?: { name: string; src: string; weight?: number; style?: 'italic'; from?: 'theme' }[];
  slides: SlideData[];
  /**
   * Свои эффекты появления (сохранены пользователем из импорта): enter: <id> у объекта.
   * Анимация — @keyframes <id> в стилях презентации (css).
   */
  effects?: Record<string, { name: string; ms?: number; ease?: string }>;
  /**
   * Стили вёрстки, вставленной из других презентаций: пространство (xp-…) → CSS исходной презентации.
   * Действуют только внутри html-блоков с ns: это пространство — и не задевают остальное.
   */
  scoped?: Record<string, string>;
}

/** Цвета слайдов для одной темы (светлой или тёмной): #RRGGBB. Нужны фон и текст, остальное выводится из них */
export interface ThemePalette {
  /** Фон слайда */
  bg?: string;
  /** Карточки и плашки */
  surf?: string;
  /** Подложки чуть темнее фона */
  alt?: string;
  /** Основной текст */
  tx?: string;
  /** Второстепенный текст */
  tx2?: string;
  /** Подписи */
  mu?: string;
  /** Линии и рамки */
  bd?: string;
  /** Линии заметнее */
  bd2?: string;
}

/** Оформление презентации (engine/deck-theme.ts) */
export interface DeckTheme {
  /** Тема из галереи студии, от которой взяты значения (только для подсветки в галерее) */
  preset?: string;
  /** Акцентный цвет, например "#2563EB". Оттенки для обеих тем строятся из него */
  accent?: string;
  /** Второй цвет акцента: акцентные заливки становятся градиентом от accent к accent2 */
  accent2?: string;
  /** Переливание: цвета градиента акцента плавно текут по акцентным элементам */
  accentFlow?: boolean;
  /** Шрифт всей презентации: имя одного из fonts */
  font?: string;
  /** Шрифт заголовков и крупных чисел: имя одного из fonts */
  head?: string;
  /** Насыщенность заголовков (100–900), заглавные буквы, межбуквенный интервал (em) */
  headWeight?: number;
  headCase?: 'upper';
  headSpacing?: number;
  /**
   * Поправка размера заголовков (0.7–1.3): широкий шрифт заголовков чуть меньше, узкий — крупнее,
   * чтобы строки занимали столько же места, сколько обычным шрифтом
   */
  headScale?: number;
  /** Слайды всегда светлые или всегда тёмные; без поля — как тема у зрителя */
  mode?: 'light' | 'dark';
  /** Цвета слайдов в светлой и тёмной теме */
  light?: ThemePalette;
  dark?: ThemePalette;
  /** Фон слайдов: dots, plain, grid, glow, mesh, paper, notebook, band, arc, spot, neon, halftone */
  bg?: string;
  /** Вид карточек: soft, flat, outline, raised, glass, poster */
  cards?: string;
  /** Скругление углов: множитель от 0 (прямые) до 2 (круглые), 1 — как обычно */
  radius?: number;
}

export interface SlideData {
  id?: string;
  /** Шаблон слайда: content (по умолчанию), cover, finale, space */
  template?: string;
  title?: string;
  /** Чип рядом с заголовком, например «демо-данные» */
  badge?: string;
  /** Заметки докладчика */
  notes?: string;
  /** Заметки правили в окне докладчика во время показа: в студии у слайда отметка ✎, пока их не поправят здесь */
  notesEdited?: boolean;
  /** Промежуточные величины для формул: «имя: =формула» (см. блок control) */
  vars?: Record<string, string | number>;
  /** Скрыт: при показе, в окне докладчика и в PDF пропускается (см. engine/hidden) */
  hidden?: boolean;
  /** Название в обзоре слайдов, если отличается от заголовка */
  label?: string;
  /** Переход к слайду: none, fade, push, cover, zoom, blur (без поля — стандартный) */
  transition?: string;
  /** Длительность перехода, мс (по умолчанию 600) */
  transitionMs?: number;
  /** Свои цвета слайда вместо цветов презентации: акцент и второй цвет градиента */
  theme?: { accent?: string; accent2?: string };
  /** Показывать логотип в углу (content-слайды, по умолчанию да) */
  logo?: boolean;
  body?: Block | Block[];
  /** Свободные объекты поверх раскладки: блоки с place: { x, y, w, h } */
  free?: Block[];
  /** Живой слайд: исходный HTML-файл со скриптами, показан слайд index (см. components/live) */
  live?: { src: string; index: number; selector?: string | null };
  [key: string]: unknown;
}

export interface Block {
  type: string;
  /** Необязательный CSS для корневого элемента блока */
  style?: string;
  /** Свободный объект закреплён: в редакторе не выделяется мышью, не двигается и не удаляется */
  locked?: boolean;
  [key: string]: unknown;
}

/** Чип: строка ("Go*" — звёздочка в конце выделяет чип) или объект. */
export type ChipData = string | { text: string; accent?: boolean };
