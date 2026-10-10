/**
 * Описание полей блоков и шаблонов слайдов для панели свойств студии.
 * По этим описаниям строится форма (см. form.ts): поле схемы = поле в deck.yaml.
 * Новый компонент получает редактор свойств, если описать его здесь.
 */

export type Field =
  | { k: string; label: string; type: 'text' | 'textarea' | 'url'; placeholder?: string; hint?: string }
  | { k: string; label: string; type: 'number'; min?: number; max?: number; step?: number; placeholder?: string; hint?: string }
  /** Видимая часть картинки (position: "X% Y%") — два ползунка */
  | { k: string; label: string; type: 'framepos'; hint?: string }
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
  // Как ползунок «Масштаб» на панели картинки: 0,3–3 (30–300 %)
  { k: 'zoom', label: 'Масштаб', type: 'number', min: 0.3, max: 3, step: 0.05, placeholder: '1', hint: '1 — как есть; 0,9 — 90 %, 1,5 — 150 %' },
  { k: 'position', label: 'Видимая часть', type: 'framepos', hint: 'Какая часть снимка видна в рамке. На слайде — «Кадр» и тянуть картинку' },
];

/** Ряды диаграммы: название и значения */
const series: Field = {
  k: 'series', label: 'Ряды', type: 'rows', item: 'Ряд',
  make: () => ({ name: 'Ряд', values: [10, 20, 30] }),
  fields: [
    { k: 'name', label: 'Название', type: 'text' },
    { k: 'values', label: 'Значения', type: 'numbers' },
  ],
};

/** Пункты «заголовок + текст» — общие для схем и списков */
const points = (label: string, item: string, textLabel = 'Пояснение') => ({
  k: 'items', label, type: 'rows' as const, item,
  make: () => ({ title: item, text: 'Пояснение' }),
  fields: [
    { k: 'title', label: 'Заголовок', type: 'text' as const },
    { k: 'text', label: textLabel, type: 'text' as const },
  ],
});
/** Пиктограммы для блока «Иконки с подписями» */
const PICTOS: [string, string][] = [
  ['bolt', 'Молния'], ['shield', 'Щит'], ['users', 'Люди'], ['clock', 'Часы'], ['target', 'Цель'], ['trend', 'Рост'],
  ['wallet', 'Кошелёк'], ['globe', 'Глобус'], ['cloud', 'Облако'], ['database', 'Данные'], ['code', 'Код'], ['rocket', 'Ракета'],
  ['bulb', 'Идея'], ['trophy', 'Кубок'], ['leaf', 'Лист'], ['gear', 'Шестерёнка'], ['chat', 'Чат'], ['heart', 'Сердце'],
  ['star', 'Звезда'], ['calendar', 'Календарь'], ['cart', 'Корзина'], ['pin', 'Место'], ['handshake', 'Сделка'], ['doc', 'Документ'],
  ['mail', 'Почта'], ['phone', 'Телефон'], ['lock', 'Замок'], ['chart', 'График'], ['home', 'Дом'], ['sensor', 'Датчик'],
];

export const BLOCKS: Record<string, Schema> = {
  text: {
    fields: [
      // Размер, шрифт и начертание — на панели текста; старые size: lead | small по-прежнему работают
      { k: 'text', label: 'Текст', type: 'textarea' },
    ],
  },
  note: { fields: [{ k: 'text', label: 'Текст', type: 'textarea' }] },
  plot: {
    about: 'График функции. Ползунки слайда — по имени: двигаете ползунок, кривая меняется',
    fields: [
      { k: 'fn', label: 'Функция y =', type: 'text', placeholder: 'sin(x)', hint: 'Через x: * / ^, sqrt, sin, ln, pi; ползунки — по имени (a*sin(x))' },
      { k: 'x', label: 'По x: от и до', type: 'numbers', hint: 'Например −6,28 6,28' },
      { k: 'y', label: 'По y: от и до', type: 'numbers', hint: 'Пусто — по самой кривой' },
      { k: 'color', label: 'Цвет кривой', type: 'color' },
    ],
  },
  math: {
    about: 'Формула. Двойной щелчок по ней на слайде — правка с подсказками',
    fields: [
      { k: 'tex', label: 'Формула', type: 'textarea', hint: 'x^2, a/b, sqrt(x), alpha, sum_(i=1)^n, <=, +- · {{x}} — число с ползунка · есть «\\» — LaTeX' },
      { k: 'size', label: 'Размер, px', type: 'number', min: 12, max: 200, placeholder: '40' },
      { k: 'align', label: 'Выравнивание', type: 'select', options: [['', 'По центру'], ['left', 'По левому краю'], ['right', 'По правому краю']] },
      { k: 'font', label: 'Шрифт', type: 'select', options: [['', 'Современный'], ['classic', 'Классический (как в PowerPoint)']] },
      { k: 'steps', label: 'При показе', type: 'select', options: [['', 'Сразу целиком'], ['lines', 'По щелчку — строка за строкой'], ['morph', 'По щелчку — превращение']], hint: 'Каждая строка формулы — шаг. Превращение: строка — формула целиком, одинаковые части перелетают; строка с «=» в начале продолжает первую' },
      { k: 'color', label: 'Цвет', type: 'color' },
    ],
  },
  list: { fields: [{ k: 'items', label: 'Пункты', type: 'strings', item: 'Пункт' }] },
  spacer: { fields: [{ k: 'size', label: 'Высота отступа, px', type: 'number', min: 0, max: 400, placeholder: '24' }] },
  image: {
    fields: [
      { k: 'src', label: 'Картинка', type: 'image' },
      { k: 'srcDark', label: 'Для тёмной темы', type: 'image', hint: 'Необязательно: без неё в обеих темах — основная' },
      { k: 'caption', label: 'Подпись', type: 'text' },
      { k: 'alt', label: 'Описание для незрячих', type: 'text' },
      { k: 'height', label: 'Высота, px', type: 'number', min: 40, max: 720, placeholder: 'по картинке' },
      ...frame,
    ],
  },
  tile: {
    fields: [
      { k: 'image', label: 'Фото', type: 'image', hint: 'Показывается поверх иллюстрации' },
      { k: 'imageDark', label: 'Фото для тёмной темы', type: 'image', hint: 'Необязательно: без него в обеих темах — основное' },
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
  control: {
    fields: [
      { k: 'name', label: 'Имя переменной', type: 'text', placeholder: 'x', hint: 'Используйте в других блоках: «=x*2» в значениях графика, {{x}} в тексте' },
      { k: 'label', label: 'Подпись', type: 'text' },
      { k: 'min', label: 'Минимум', type: 'number', placeholder: '0' },
      { k: 'max', label: 'Максимум', type: 'number', placeholder: '100' },
      { k: 'step', label: 'Шаг', type: 'number', min: 0, placeholder: '1' },
      { k: 'value', label: 'Начальное значение', type: 'number' },
      { k: 'unit', label: 'Единица', type: 'text', placeholder: ' ₽, %, шт' },
      { k: 'steps', label: 'Варианты вместо min…max', type: 'numbers', hint: 'Например: 125 250 500 — ползунок щёлкает по ним' },
      { k: 'labels', label: 'Подписи вариантов', type: 'strings', item: 'Подпись' },
    ],
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
  donut: {
    fields: [
      { k: 'values', label: 'Значения', type: 'numbers' },
      { k: 'labels', label: 'Подписи', type: 'strings', item: 'Подпись' },
      { k: 'center', label: 'В центре', type: 'text', placeholder: 'сумма' },
      { k: 'sub', label: 'Подпись в центре', type: 'text' },
      { k: 'unit', label: 'Единица у значений', type: 'text', placeholder: ' млн' },
      { k: 'hole', label: 'Отверстие', type: 'number', min: 0, max: 0.9, step: 0.05, placeholder: '0.62', hint: '0 — круговая диаграмма' },
      { k: 'legend', label: 'Легенда', type: 'select', options: [['', 'Справа'], ['bottom', 'Снизу'], ['none', 'Без легенды']] },
    ],
  },
  hbars: {
    fields: [
      { k: 'values', label: 'Значения', type: 'numbers' },
      { k: 'labels', label: 'Подписи', type: 'strings', item: 'Подпись' },
      { k: 'unit', label: 'Единица у значений', type: 'text', placeholder: ' %' },
      { k: 'highlight', label: 'Выделенная полоса', type: 'number', min: 0, placeholder: 'первая', hint: 'Номер с нуля' },
      { k: 'max', label: 'Значение для полной длины', type: 'number', placeholder: 'максимум' },
    ],
  },
  gauge: {
    fields: [
      { k: 'value', label: 'Значение', type: 'number' },
      { k: 'unit', label: 'Единица', type: 'text', placeholder: ' %' },
      { k: 'label', label: 'Подпись', type: 'text' },
      { k: 'min', label: 'Начало шкалы', type: 'number', placeholder: '0' },
      { k: 'max', label: 'Конец шкалы', type: 'number', placeholder: '100' },
      { k: 'target', label: 'Цель', type: 'number', hint: 'Отметка на шкале' },
    ],
  },
  rings: {
    fields: [
      { k: 'values', label: 'Выполнение, %', type: 'numbers', hint: 'До четырёх колец' },
      { k: 'labels', label: 'Подписи', type: 'strings', item: 'Цель' },
    ],
  },
  columns: {
    fields: [
      { k: 'labels', label: 'Подписи групп', type: 'strings', item: 'Подпись' },
      series,
      { k: 'stacked', label: 'Друг на друге', type: 'bool' },
      { k: 'unit', label: 'Единица оси', type: 'text' },
      { k: 'max', label: 'Максимум оси', type: 'number', placeholder: 'авто' },
    ],
  },
  lines: {
    fields: [
      { k: 'labels', label: 'Подписи по оси', type: 'strings', item: 'Подпись' },
      series,
      { k: 'unit', label: 'Единица', type: 'text' },
      { k: 'min', label: 'Минимум оси', type: 'number', placeholder: '0' },
      { k: 'max', label: 'Максимум оси', type: 'number', placeholder: 'авто' },
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
      { k: 'variant', label: 'Вид', type: 'select', options: [['', 'Линии'], ['stripes', 'Зебра'], ['boxed', 'Сетка'], ['accent', 'Акцентная шапка'], ['soft', 'Мягкая'], ['dark', 'Тёмная шапка'], ['plan', 'План с приоритетами']] },
      { k: 'labels', label: 'Первый столбец — подписи (жирным)', type: 'bool' },
      { k: 'highlight', label: 'Выделенная строка', type: 'number', min: 0, placeholder: 'нет', hint: 'Номер с нуля' },
      { k: 'size', label: 'Размер текста, px', type: 'number', min: 10, max: 40, placeholder: '17' },
      { k: 'badge', label: 'Столбец меток', type: 'number', min: 0, placeholder: 'нет', hint: 'Номер с нуля. Ячейки — метки с точкой: «Высокий», «Готово» или {#16A34A|свой цвет}' },
      { k: 'footer', label: 'Итог под таблицей', type: 'text', placeholder: 'Всего позиций: {rows}', hint: '{rows} — число строк' },
      { k: 'footnote', label: 'Подпись справа', type: 'text' },
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
  // Схемы и списки из пунктов «заголовок + текст» (components/schemes)
  cycle: {
    fields: [{ k: 'center', label: 'В центре кольца', type: 'text' }, points('Этапы', 'Этап')],
  },
  funnel: { fields: [points('Ступени', 'Ступень', 'Справа от полосы')] },
  pyramid: { about: 'Первый пункт — вершина.', fields: [points('Уровни', 'Уровень')] },
  numbers: { fields: [points('Пункты', 'Пункт')] },
  compare: {
    about: 'Строки пояснения: «+ » — галочка, «- » — крестик.',
    fields: [{
      k: 'items', label: 'Колонки', type: 'rows', item: 'Колонка',
      make: () => ({ title: 'Вариант', text: '+ Плюс\n- Минус' }),
      fields: [
        { k: 'title', label: 'Заголовок', type: 'text' },
        { k: 'text', label: 'Строки', type: 'textarea' },
        { k: 'accent', label: 'Выделить колонку', type: 'bool' },
      ],
    }],
  },
  matrix: {
    fields: [
      { k: 'yAxis', label: 'Ось слева (снизу вверх)', type: 'text' },
      { k: 'xAxis', label: 'Ось снизу (слева направо)', type: 'text' },
      points('Квадранты (до 4)', 'Квадрант'),
    ],
  },
  icons: {
    fields: [{
      k: 'items', label: 'Пункты', type: 'rows', item: 'Пункт',
      make: () => ({ title: 'Преимущество', text: 'Пояснение' }),
      fields: [
        { k: 'icon', label: 'Иконка', type: 'select', options: [['', 'По смыслу заголовка'], ...PICTOS] },
        { k: 'title', label: 'Заголовок', type: 'text' },
        { k: 'text', label: 'Пояснение', type: 'text' },
      ],
    }],
  },
  stats: {
    fields: [{
      k: 'items', label: 'Показатели', type: 'rows', item: 'Показатель',
      make: () => ({ title: '100 %', text: 'Подпись' }),
      fields: [
        { k: 'title', label: 'Число', type: 'text' },
        { k: 'text', label: 'Подпись', type: 'text' },
      ],
    }],
  },
  faq: {
    fields: [{
      k: 'items', label: 'Вопросы', type: 'rows', item: 'Вопрос',
      make: () => ({ title: 'Новый вопрос?', text: 'Ответ' }),
      fields: [
        { k: 'title', label: 'Вопрос', type: 'text' },
        { k: 'text', label: 'Ответ', type: 'textarea' },
      ],
    }],
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
  sandbox: {
    about: 'Песочница: код слева, результат справа. При показе код правится прямо на слайде, результат обновляется на лету; правки показа не сохраняются. Код в студии — кнопкой ниже или двойным щелчком.',
    fields: [
      { k: 'title', label: 'Имя файла в заголовке', type: 'text', placeholder: 'index.html' },
      { k: 'size', label: 'Кегль кода, px', type: 'number', min: 9, max: 40, placeholder: '15' },
      { k: 'split', label: 'Ширина редактора, %', type: 'number', min: 20, max: 80, placeholder: '56' },
      { k: 'theme', label: 'Цвета темы внутри результата', type: 'bool' },
      { k: 'console', label: 'Консоль под результатом', type: 'bool', default: true },
      { k: 'poster', label: 'Заставка результата', type: 'image' },
    ],
  },
  embed: {
    about: 'Живая вставка: HTML, CSS и JavaScript в изолированной рамке. Код — кнопкой ниже или двойным щелчком по вставке; HTML-файл можно просто перетащить на слайд.',
    fields: [
      { k: 'poster', label: 'Заставка', type: 'image' },
      { k: 'theme', label: 'Цвета темы внутри вставки', type: 'bool' },
      { k: 'interactive', label: 'Отвечает на мышь при показе', type: 'bool' },
      { k: 'dark', label: 'Тёмная заставка (не переворачивать в тёмной теме)', type: 'bool' },
    ],
  },
  model: {
    about: 'Снимок нужен для печати, PDF, миниатюр и окна докладчика.',
    fields: [
      { k: 'src', label: 'Модель', type: 'media', kind: 'model', placeholder: 'Файл GLB' },
      { k: 'poster', label: 'Снимок', type: 'image' },
      { k: 'rotate', label: 'Вращается сама', type: 'bool', default: false },
      { k: 'controls', label: 'Вращать мышью при показе', type: 'bool', default: true },
      { k: 'exposure', label: 'Яркость', type: 'number', min: 0.2, max: 3, step: 0.1, placeholder: '1' },
      { k: 'orbit', label: 'Ракурс', type: 'text', placeholder: '0deg 75deg', hint: 'Поворот и наклон камеры в градусах' },
      { k: 'animation', label: 'Анимация', type: 'text', placeholder: 'нет', hint: 'Имя анимации из файла модели, например Dance' },
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
      { k: 'tone', label: 'Светлая тема', type: 'select', options: [['', 'Слайд всегда тёмный'], ['theme', 'Светлый в светлой теме']] },
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
