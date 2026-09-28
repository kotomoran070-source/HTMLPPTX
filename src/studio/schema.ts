/**
 * Описание полей блоков и шаблонов слайдов для панели свойств студии.
 * По этим описаниям строится форма (см. form.ts): поле схемы = поле в deck.yaml.
 * Новый компонент получает редактор свойств, если описать его здесь.
 */

export type Field =
  | { k: string; label: string; type: 'text' | 'textarea' | 'url'; placeholder?: string; hint?: string }
  | { k: string; label: string; type: 'number'; min?: number; max?: number; step?: number; placeholder?: string; hint?: string }
  | { k: string; label: string; type: 'select'; options: [string, string][]; hint?: string }
  | { k: string; label: string; type: 'bool'; default?: boolean; hint?: string }
  | { k: string; label: string; type: 'icon' }
  | { k: string; label: string; type: 'image'; hint?: string }
  /** Видео или 3D-модель: путь или ссылка текстом и кнопка выбора файла */
  | { k: string; label: string; type: 'media'; kind: 'video' | 'model'; placeholder?: string; hint?: string }
  /** Список строк (пункты, подписи) */
  | { k: string; label: string; type: 'strings'; item: string }
  /** Чипы: строка, звёздочка в конце — выделенный чип */
  | { k: string; label: string; type: 'chips' }
  /** Числа через пробел или запятую */
  | { k: string; label: string; type: 'numbers'; hint?: string }
  /** Словарь «ключ — значение» */
  | { k: string; label: string; type: 'kv' }
  /** Список объектов. Элемент-строка (если допустим) правится как поле asString */
  | { k: string; label: string; type: 'rows'; item: string; fields: Field[]; make: () => unknown; asString?: string }
  /** Вложенный объект (ссылка финального слайда) */
  | { k: string; label: string; type: 'group'; fields: Field[] }
  /** Цвет фигуры: роли темы или свой #RRGGBB; none — без цвета */
  | { k: string; label: string; type: 'color'; none?: boolean }
  /** Таблица: шапка header и строки rows (списки ячеек) — сеткой полей */
  | { k: string; label: string; type: 'grid' };

export interface Schema {
  /** Короткая подсказка, что это за блок */
  about?: string;
  fields: Field[];
}

const FIT: [string, string][] = [['', 'Заполнить (обрезать края)'], ['contain', 'Целиком']];
const ALIGN: [string, string][] = [['', 'Растянуть'], ['start', 'По верху'], ['center', 'По центру'], ['end', 'По низу']];

const frame: Field[] = [
  { k: 'fit', label: 'Кадр', type: 'select', options: FIT },
  { k: 'zoom', label: 'Увеличение', type: 'number', min: 1, max: 4, step: 0.1, placeholder: '1' },
  { k: 'position', label: 'Видимая часть', type: 'text', placeholder: '50% 50%', hint: 'Положение изображения в рамке' },
];

export const BLOCKS: Record<string, Schema> = {
  text: {
    fields: [
      { k: 'text', label: 'Текст', type: 'textarea', hint: '**жирный**, *курсив*, «- » в начале строки — список' },
      { k: 'size', label: 'Размер', type: 'select', options: [['', 'Обычный'], ['lead', 'Крупный'], ['small', 'Мелкий, серый']] },
    ],
  },
  note: { fields: [{ k: 'text', label: 'Текст', type: 'textarea' }] },
  list: { fields: [{ k: 'items', label: 'Пункты', type: 'strings', item: 'Пункт' }] },
  spacer: { fields: [{ k: 'size', label: 'Высота отступа, px', type: 'number', min: 0, max: 400, placeholder: '24' }] },
  image: {
    fields: [
      { k: 'src', label: 'Картинка', type: 'image' },
      { k: 'caption', label: 'Подпись', type: 'text' },
      { k: 'alt', label: 'Описание для незрячих', type: 'text' },
      { k: 'height', label: 'Высота, px', type: 'number', min: 40, max: 720, placeholder: 'по картинке' },
      ...frame,
    ],
  },
  tile: {
    fields: [
      { k: 'image', label: 'Фото', type: 'image', hint: 'Показывается поверх иллюстрации' },
      { k: 'illustration', label: 'Иллюстрация', type: 'select', options: [['', 'Нет'], ['assembly', 'Комплекс в сборке'], ['endpoints', 'Оконечные устройства'], ['station', 'Базовая станция']] },
      { k: 'caption', label: 'Подпись', type: 'text' },
      ...frame,
    ],
  },
  card: {
    fields: [
      { k: 'title', label: 'Заголовок', type: 'text' },
      { k: 'text', label: 'Текст', type: 'textarea' },
    ],
  },
  panel: {
    fields: [
      { k: 'title', label: 'Заголовок', type: 'text' },
      { k: 'columns', label: 'Колонок', type: 'number', min: 1, max: 6, placeholder: '2' },
      {
        k: 'cells', label: 'Ячейки', type: 'rows', item: 'Ячейка', asString: 'title',
        make: () => ({ title: 'Новая ячейка', sub: 'подпись' }),
        fields: [
          { k: 'title', label: 'Название', type: 'text' },
          { k: 'sub', label: 'Подпись', type: 'text' },
          { k: 'cols', label: 'Ширина, колонок', type: 'number', min: 1, max: 6, placeholder: '1' },
        ],
      },
    ],
  },
  kv: {
    fields: [
      { k: 'keyWidth', label: 'Ширина колонки ключей, px', type: 'number', min: 40, max: 600, placeholder: 'авто' },
      { k: 'rows', label: 'Строки', type: 'kv' },
    ],
  },
  chips: { fields: [{ k: 'items', label: 'Чипы', type: 'chips' }] },
  progress: {
    fields: [
      { k: 'label', label: 'Подпись', type: 'text' },
      { k: 'value', label: 'Значение', type: 'text' },
      { k: 'percent', label: 'Заполнение, %', type: 'number', min: 0, max: 100 },
    ],
  },
  sliders: {
    fields: [{
      k: 'rows', label: 'Ползунки', type: 'rows', item: 'Ползунок',
      make: () => ({ label: 'Параметр', value: '50 %', position: 0.5 }),
      fields: [
        { k: 'label', label: 'Название', type: 'text' },
        { k: 'value', label: 'Значение', type: 'text' },
        { k: 'position', label: 'Положение, 0–1', type: 'number', min: 0, max: 1, step: 0.05 },
      ],
    }],
  },
  grid: {
    about: 'Блоки в несколько колонок.',
    fields: [
      { k: 'columns', label: 'Колонки', type: 'text', placeholder: '1fr 1fr', hint: 'Число колонок (3) или доли: 1.6fr 1fr' },
      { k: 'rows', label: 'Строки', type: 'text', placeholder: 'по содержимому' },
      { k: 'gap', label: 'Промежуток, px', type: 'number', min: 0, max: 120, placeholder: '22' },
      { k: 'height', label: 'Высота, px', type: 'number', min: 40, max: 720, placeholder: 'по содержимому' },
      { k: 'align', label: 'Выравнивание', type: 'select', options: ALIGN },
    ],
  },
  stack: {
    about: 'Блоки друг под другом.',
    fields: [{ k: 'gap', label: 'Промежуток, px', type: 'number', min: 0, max: 120, placeholder: '16' }],
  },
  network: { fields: [{ k: 'nodes', label: 'Узлов вокруг центра', type: 'number', min: 2, max: 16, placeholder: '7' }] },
  hub: {
    fields: [
      { k: 'height', label: 'Высота, px', type: 'number', min: 200, max: 720, placeholder: 'авто' },
      {
        k: 'items', label: 'Пункты', type: 'rows', item: 'Пункт',
        make: () => ({ title: 'Новый пункт', text: 'Пояснение' }),
        fields: [
          { k: 'title', label: 'Пункт', type: 'text' },
          { k: 'text', label: 'Пояснение', type: 'text' },
          { k: 'node', label: 'Подпись узла', type: 'text', placeholder: 'как пункт' },
          { k: 'sub', label: 'Мелкая подпись узла', type: 'text' },
        ],
      },
    ],
  },
  pipeline: {
    fields: [
      { k: 'stepSeconds', label: 'Секунд на шаг', type: 'number', min: 0.3, max: 10, step: 0.1, placeholder: '1' },
      {
        k: 'steps', label: 'Шаги', type: 'rows', item: 'Шаг',
        make: () => ({ title: 'Шаг', sub: 'подпись' }),
        fields: [
          { k: 'title', label: 'Название', type: 'text' },
          { k: 'sub', label: 'Подпись', type: 'text' },
        ],
      },
    ],
  },
  'line-chart': {
    fields: [
      { k: 'values', label: 'Значения', type: 'numbers' },
      { k: 'start', label: 'Подпись слева', type: 'text' },
      { k: 'end', label: 'Подпись справа', type: 'text' },
      { k: 'unit', label: 'Единица оси', type: 'text', placeholder: 'тыс' },
      { k: 'scale', label: 'Делитель подписей оси', type: 'number', min: 1, placeholder: 'авто' },
      { k: 'min', label: 'Минимум оси', type: 'number', placeholder: 'авто' },
      { k: 'max', label: 'Максимум оси', type: 'number', placeholder: 'авто' },
    ],
  },
  uptime: {
    fields: [
      { k: 'values', label: 'Доступность по дням, %', type: 'numbers' },
      { k: 'threshold', label: 'Порог, %', type: 'number', min: 0, max: 100, step: 0.1, placeholder: '99.5', hint: 'Дни ниже порога бледнее' },
    ],
  },
  bars: {
    fields: [
      { k: 'values', label: 'Значения', type: 'numbers' },
      { k: 'labels', label: 'Подписи', type: 'strings', item: 'Подпись' },
      { k: 'highlight', label: 'Выделенный столбец', type: 'number', min: 0, placeholder: 'последний', hint: 'Номер с нуля' },
      { k: 'max', label: 'Значение для полной высоты', type: 'number', placeholder: 'максимум' },
      { k: 'height', label: 'Высота, px', type: 'number', min: 40, max: 600, placeholder: '100' },
    ],
  },
  shape: {
    fields: [
      { k: 'kind', label: 'Форма', type: 'select', options: [['', 'Скруглённый прямоугольник'], ['rect', 'Прямоугольник'], ['pill', 'Капсула'], ['ellipse', 'Овал'], ['line', 'Линия'], ['arrow', 'Стрелка']] },
      { k: 'text', label: 'Текст внутри', type: 'textarea' },
      { k: 'fill', label: 'Заливка', type: 'color', none: true },
      { k: 'stroke', label: 'Рамка / цвет линии', type: 'color', none: true },
      { k: 'width', label: 'Толщина рамки или линии, px', type: 'number', min: 0, max: 40, placeholder: '0' },
      { k: 'radius', label: 'Скругление, px', type: 'number', min: 0, max: 200, placeholder: '16' },
      { k: 'rotate', label: 'Поворот, °', type: 'number', min: -180, max: 180, step: 5, placeholder: '0' },
      { k: 'shadow', label: 'Тень', type: 'bool' },
    ],
  },
  table: {
    about: 'Таблицу из Excel можно вставить в любую ячейку.',
    fields: [
      { k: 'rows', label: 'Данные', type: 'grid' },
      { k: 'variant', label: 'Вид', type: 'select', options: [['', 'Линии'], ['stripes', 'Зебра'], ['boxed', 'Сетка'], ['accent', 'Акцентная шапка']] },
      { k: 'labels', label: 'Первый столбец — подписи (жирным)', type: 'bool' },
      { k: 'highlight', label: 'Выделенная строка', type: 'number', min: 0, placeholder: 'нет', hint: 'Номер с нуля' },
      { k: 'size', label: 'Размер текста, px', type: 'number', min: 10, max: 40, placeholder: '17' },
    ],
  },
  stat: {
    fields: [
      { k: 'value', label: 'Значение', type: 'text', placeholder: '3,4 млн' },
      { k: 'label', label: 'Подпись', type: 'text' },
      { k: 'delta', label: 'Изменение', type: 'text', placeholder: '+12 %', hint: 'Отрицательное значение выделяется красным' },
      { k: 'note', label: 'Мелкая подпись', type: 'text' },
    ],
  },
  quote: {
    fields: [
      { k: 'text', label: 'Цитата', type: 'textarea' },
      { k: 'author', label: 'Автор', type: 'text' },
      { k: 'role', label: 'Должность или источник', type: 'text' },
    ],
  },
  timeline: {
    fields: [{
      k: 'items', label: 'Этапы', type: 'rows', item: 'Этап',
      make: () => ({ date: 'Дата', title: 'Новый этап' }),
      fields: [
        { k: 'date', label: 'Дата', type: 'text' },
        { k: 'title', label: 'Название', type: 'text' },
        { k: 'text', label: 'Пояснение', type: 'text' },
        { k: 'done', label: 'Пройден', type: 'bool' },
      ],
    }],
  },
  system: {
    about: 'Структура схемы — в режиме кода.',
    fields: [],
  },
  html: {
    about: 'Импортированный фрагмент. Разметка — в режиме кода.',
    fields: [
      { k: 'texts', label: 'Тексты', type: 'strings', item: 'Текст' },
      { k: 'scale', label: 'Масштаб вёрстки', type: 'number', min: 0.1, max: 4, step: 0.05, placeholder: '1' },
    ],
  },
  embed: {
    about: 'Интерактивная HTML-вставка.',
    fields: [
      { k: 'poster', label: 'Заставка', type: 'image' },
      { k: 'theme', label: 'Цвета темы внутри вставки', type: 'bool' },
    ],
  },
  model: {
    about: 'Снимок нужен для печати, PDF, миниатюр и окна докладчика.',
    fields: [
      { k: 'src', label: 'Модель', type: 'media', kind: 'model', placeholder: 'Файл GLB' },
      { k: 'poster', label: 'Снимок', type: 'image' },
      { k: 'rotate', label: 'Вращается сама', type: 'bool', default: true },
      { k: 'controls', label: 'Вращать мышью при показе', type: 'bool', default: true },
      { k: 'exposure', label: 'Яркость', type: 'number', min: 0.2, max: 3, step: 0.1, placeholder: '1' },
      { k: 'caption', label: 'Подпись', type: 'text' },
    ],
  },
  video: {
    fields: [
      { k: 'src', label: 'Видео', type: 'media', kind: 'video', placeholder: 'Файл MP4 или ссылка на YouTube, Vimeo' },
      { k: 'poster', label: 'Обложка', type: 'image', hint: 'Видна до запуска и при печати' },
      { k: 'autoplay', label: 'Запускать при открытии слайда', type: 'bool', default: true },
      { k: 'muted', label: 'Без звука', type: 'bool', default: true },
      { k: 'loop', label: 'По кругу', type: 'bool' },
      { k: 'controls', label: 'Кнопки плеера', type: 'bool', default: true },
      { k: 'fit', label: 'Кадр', type: 'select', options: [['', 'Целиком'], ['cover', 'Заполнить рамку']] },
      { k: 'caption', label: 'Подпись', type: 'text' },
    ],
  },
};

const LINK: Field = {
  k: 'link', label: 'Ссылка и QR-код', type: 'group',
  fields: [
    { k: 'label', label: 'Надпись над ссылкой', type: 'text' },
    { k: 'url', label: 'Адрес', type: 'url', placeholder: 'https://…' },
    { k: 'text', label: 'Текст ссылки', type: 'text', placeholder: 'адрес без https://' },
    { k: 'qr', label: 'QR-код', type: 'bool', default: true },
  ],
};

const BUTTONS: Field = {
  k: 'buttons', label: 'Кнопки', type: 'rows', item: 'Кнопка',
  make: () => ({ icon: 'link', label: 'Кнопка' }),
  fields: [
    { k: 'icon', label: 'Иконка', type: 'icon' },
    { k: 'label', label: 'Подпись', type: 'text' },
    { k: 'url', label: 'Ссылка', type: 'url', placeholder: 'https://… или mailto:…' },
  ],
};

// Ссылка и кнопки финальных слайдов после разбора: те же поля, что у шаблона
BLOCKS['link-card'] = { fields: [LINK] };
BLOCKS['link-buttons'] = { fields: [BUTTONS] };
BLOCKS['link-plate'] = { fields: [LINK, BUTTONS] };

export const TEMPLATES: Record<string, Schema> = {
  content: {
    fields: [
      { k: 'title', label: 'Заголовок', type: 'text' },
      { k: 'badge', label: 'Чип у заголовка', type: 'text', placeholder: 'например, демо-данные' },
      { k: 'gap', label: 'Промежуток между блоками, px', type: 'number', min: 0, max: 120, placeholder: '22' },
      { k: 'logo', label: 'Логотип в углу', type: 'bool', default: true },
    ],
  },
  cover: {
    fields: [
      { k: 'title', label: 'Заголовок', type: 'textarea' },
      { k: 'lead', label: 'Подзаголовок', type: 'textarea' },
      { k: 'meta', label: 'Мелкая строка', type: 'text', placeholder: 'дата, команда' },
    ],
  },
  finale: {
    fields: [
      { k: 'caption', label: 'Надпись сверху', type: 'text' },
      { k: 'title', label: 'Заголовок', type: 'text' },
      { k: 'lead', label: 'Подзаголовок', type: 'text' },
      LINK,
      BUTTONS,
    ],
  },
  space: {
    fields: [
      { k: 'layout', label: 'Вариант', type: 'select', options: [['', 'Обычный'], ['orbit', 'Орбита']] },
      { k: 'badge', label: 'Надпись в пилюле', type: 'text' },
      { k: 'title', label: 'Заголовок', type: 'text' },
      { k: 'lead', label: 'Подзаголовок', type: 'text' },
      LINK,
      BUTTONS,
    ],
  },
  canvas: { fields: [] },
};

/** Поле «CSS блока» — запасной выход, есть у всех блоков. */
export const STYLE_FIELD: Field = { k: 'style', label: 'CSS блока', type: 'text', placeholder: 'margin-top: 12px', hint: 'Дополнительные стили блока' };
