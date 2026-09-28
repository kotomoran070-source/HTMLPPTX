/** Презентация как данные: то, что лежит в presentations/<имя>/deck.yaml. */
export interface Deck {
  title: string;
  lang?: string;
  brand?: {
    name?: string;
    /** Путь к логотипу относительно deck.yaml, например ./assets/logo.svg */
    logo?: string;
  };
  theme?: {
    /** Акцентный цвет, например "#2563EB". Оттенки для обеих тем строятся из него */
    accent?: string;
  };
  slides: SlideData[];
  /**
   * Свои эффекты появления (сохранены пользователем из импорта): enter: <id> у объекта.
   * Анимация — @keyframes <id> в стилях презентации (css).
   */
  effects?: Record<string, { name: string; ms?: number; ease?: string }>;
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
  /** Название в обзоре слайдов, если отличается от заголовка */
  label?: string;
  /** Переход к слайду: none, fade, push, cover, zoom, blur (без поля — стандартный) */
  transition?: string;
  /** Длительность перехода, мс (по умолчанию 600) */
  transitionMs?: number;
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
