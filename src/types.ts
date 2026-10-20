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
    /**
     * Плашка под логотипом в цветах логотипа (без поля — в цветах темы): фон, рамка и свечение,
     * подобранные студией по файлу src (если логотип сменили — снова цвета темы)
     */
    plate?: { from: 'logo'; src: string; bg: string; border: string; glow: string };
    /** Логотип в углу обычных слайдов: угол (tl, tr, bl, br; по умолчанию tr) и размер (s, l) */
    corner?: { pos?: 'tl' | 'tr' | 'bl' | 'br'; size?: 's' | 'l' };
    /**
     * Знак в цветах темы: логотип (одноцветный, с прозрачным фоном) перекрашивается градиентом
     * акцента, плашка под ним — цвета карточки темы, светлая и тёмная
     */
    tint?: boolean;
    /** Размер знака в плашке, доля её стороны: 0.3–0.95, по умолчанию 0.7. Плашка своего размера не меняет */
    mark?: number;
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
  /**
   * Оформление исходного файла (импорт из PowerPoint). Цвета файла записаны в слайдах как есть;
   * пока тема — «Как в файле», они и показываются. Другая тема перекрашивает их в свои цвета
   * (engine/recolor.ts): серые — по оси «фон — текст» темы, цветные — в её акценты, светлота сохраняется
   */
  origin?: DeckOrigin;
}

/** Палитра исходного файла: по ней цвета слайдов следуют за темой */
export interface DeckOrigin {
  /** Фон и текст файла */
  bg: string;
  tx: string;
  /** Акценты файла по частоте: семейства цветных оттенков → accent, accent2, … темы */
  accents?: string[];
  /** Цвета слайдов, которые следуют за темой (#RRGGBB) */
  colors: string[];
  /** Тема «Как в файле»: её цвета, шрифты и фон */
  theme?: DeckTheme;
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
  /** Точки градиента между accent и accent2: цвет и место в процентах — [{ c: "#22D3EE", at: 40 }] */
  accentMid?: { c: string; at: number }[];
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
  /**
   * Фон слайдов: dots, plain, grid, glow, mesh, paper, notebook, band, arc, spot, neon, halftone —
   * или свой: цвет (#RRGGBB) или картинка (файл в assets/, на весь слайд)
   */
  bg?: string;
  /** Заметность своей картинки фона, 0,1–1: сквозь фон темы (текст читается) */
  bgOpacity?: number;
  /** Вид карточек: soft, flat, outline, raised, glass, poster */
  cards?: string;
  /** Скругление углов: множитель от 0 (прямые) до 2 (круглые), 1 — как обычно */
  radius?: number;
  /** Анимированный фон всех слайдов (engine/backdrops.ts); у слайда backdrop: none — без него */
  backdrop?: string;
  /** Заметность анимированного фона, 0,1–1 (у слайда — своя, поле с тем же именем) */
  backdropOpacity?: number;
  /** Скорость анимированного фона, 0,25–3 */
  backdropSpeed?: number;
  /** false — фон не отвечает на мышь и щелчки (у тех фонов, что отвечают; у слайда — своё, поле с тем же именем) */
  backdropTouch?: boolean;
  /**
   * Своё у тёмных слайдов — поверх общего: узор фона, вид карточек, анимированный фон, его заметность
   * и скорость (backdrop: none — у тёмных без анимации). Чего нет — как у светлых
   */
  darkLook?: DarkLook;
}

/** Поля оформления, которые у тёмных слайдов могут быть своими */
export interface DarkLook {
  bg?: string;
  bgOpacity?: number;
  cards?: string;
  backdrop?: string;
  backdropOpacity?: number;
  backdropSpeed?: number;
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
  /** false — цвета слайда не следуют за темой (картинка фоном из исходного файла, deck.origin) */
  recolor?: boolean;
  /** Заметки правили в окне докладчика во время показа: в студии у слайда отметка ✎, пока их не поправят здесь */
  notesEdited?: boolean;
  /** Промежуточные величины для формул: «имя: =формула» (см. блок control) */
  vars?: Record<string, string | number>;
  /** Скрыт: при показе, в окне докладчика и в PDF пропускается (см. engine/hidden) */
  hidden?: boolean;
  /** Название в обзоре слайдов, если отличается от заголовка */
  label?: string;
  /** Переход к слайду (engine/transitions): none, fade, push, cover, uncover, wipe, split, circle, clock, flash, zoom, blur, morph (без поля — стандартный) */
  transition?: string;
  /** Длительность перехода, мс (по умолчанию 600) */
  transitionMs?: number;
  /** Откуда идёт переход (Сдвиг, Наплыв, Открывание, Шторка): right, left, top, bottom */
  transitionDir?: string;
  /** Свои цвета слайда вместо цветов презентации: акцент, второй цвет градиента и точки между ними */
  theme?: { accent?: string; accent2?: string; accentMid?: { c: string; at: number }[] };
  /** Логотип в углу: у обычного слайда есть, пока не false; у холста — только с true */
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
  /** Картинка фоном из импортированного файла: видна только в теме «Как в файле» */
  fileBg?: boolean;
  [key: string]: unknown;
}

/** Чип: строка ("Go*" — звёздочка в конце выделяет чип) или объект. */
export type ChipData = string | { text: string; accent?: boolean };
