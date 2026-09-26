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
  /** Показывать логотип в углу (content-слайды, по умолчанию да) */
  logo?: boolean;
  body?: Block | Block[];
  /** Свободные объекты поверх раскладки: блоки с place: { x, y, w, h } */
  free?: Block[];
  [key: string]: unknown;
}

export interface Block {
  type: string;
  /** Необязательный CSS для корневого элемента блока */
  style?: string;
  [key: string]: unknown;
}

/** Чип: строка ("Go*" — звёздочка в конце выделяет чип) или объект. */
export type ChipData = string | { text: string; accent?: boolean };
