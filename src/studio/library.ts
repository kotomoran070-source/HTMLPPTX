import { icon } from '../components/icons';
import { H, W } from '../engine/deck-view';
import { esc } from '../engine/html';
import { Renderer } from '../engine/render';
import type { Block, Deck } from '../types';

export interface Preset {
  name: string;
  /** Размер свободного объекта при вставке */
  w: number;
  h?: number;
  /** Ширина блока в миниатюре галереи, если отличается (мелкое читается крупнее) */
  pw?: number;
  make(): Block;
}

export interface Category {
  name: string;
  icon: string;
  items: Preset[];
}

const card = (title: string, text: string) => ({ type: 'card', title, text });
const stat = (value: string, label: string, delta?: string) => ({ type: 'stat', value, label, ...(delta ? { delta } : {}) });

/** Готовые блоки: вставляются свободным объектом в центр слайда. Данные — как в deck.yaml. */
export const LIBRARY: Category[] = [
  {
    name: 'Текст',
    icon: 'text',
    items: [
      { name: 'Заголовок', w: 760, pw: 300, make: () => ({ type: 'text', text: 'Заголовок', styles: { text: { size: 44 } } }) },
      { name: 'Абзац', w: 520, pw: 250, make: () => ({ type: 'text', text: 'Короткий абзац текста. **Главное** можно выделить.' }) },
      { name: 'Крупный текст', w: 560, pw: 280, make: () => ({ type: 'text', text: 'Ключевая мысль слайда', size: 'lead' }) },
      { name: 'Список', w: 480, pw: 240, make: () => ({ type: 'list', items: ['Первый пункт', 'Второй пункт', 'Третий пункт'] }) },
      { name: 'Цитата', w: 760, pw: 520, make: () => ({ type: 'quote', text: 'Хорошая презентация отвечает на вопрос раньше, чем его зададут.', author: 'Имя Фамилия', role: 'должность' }) },
      { name: 'Чипы', w: 560, pw: 300, make: () => ({ type: 'chips', items: ['Важное*', 'Метка', 'Ещё метка'] }) },
      { name: 'Подпись', w: 360, pw: 200, make: () => ({ type: 'note', text: 'Мелкая серая подпись' }) },
    ],
  },
  {
    name: 'Фигуры',
    icon: 'frame',
    items: [
      { name: 'Скруглённый', w: 320, h: 180, make: () => ({ type: 'shape', fill: 'soft' }) },
      { name: 'Прямоугольник', w: 320, h: 180, make: () => ({ type: 'shape', kind: 'rect', fill: 'surface', stroke: 'border', width: 1 }) },
      { name: 'Карточка с тенью', w: 360, h: 200, make: () => ({ type: 'shape', fill: 'surface', stroke: 'border', width: 1, radius: 16, shadow: true }) },
      { name: 'Плашка с текстом', w: 360, h: 72, make: () => ({ type: 'shape', kind: 'pill', fill: 'accent', text: 'Главное' }) },
      { name: 'Метка', w: 200, h: 44, make: () => ({ type: 'shape', kind: 'pill', fill: 'soft', stroke: 'accent', width: 1, text: 'метка', styles: { text: { size: 15 } } }) },
      { name: 'Круг', w: 180, h: 180, make: () => ({ type: 'shape', kind: 'ellipse', fill: 'soft', stroke: 'accent', width: 2 }) },
      { name: 'Линия', w: 400, h: 16, make: () => ({ type: 'shape', kind: 'line', stroke: 'border', width: 2 }) },
      { name: 'Стрелка', w: 260, h: 24, make: () => ({ type: 'shape', kind: 'arrow', stroke: 'accent', width: 3 }) },
    ],
  },
  {
    name: 'Числа',
    icon: 'sliders',
    items: [
      { name: 'Ключевое число', w: 300, make: () => stat('24', 'устройства в работе', '+6 за месяц') },
      {
        name: 'Три числа', w: 1040, pw: 620, make: () => ({
          type: 'grid', columns: 3, gap: 40,
          items: [stat('3,4 млн', 'сообщений получено', '+12 %'), stat('99,7 %', 'доступность сервиса'), stat('1,4 с', 'задержка доставки', '−18 %')],
        }),
      },
      { name: 'Прогресс', w: 460, pw: 320, make: () => ({ type: 'progress', label: 'Готовность', value: '18 из 24', percent: 75 }) },
      {
        name: 'Три прогресса', w: 520, pw: 380, make: () => ({
          type: 'stack', gap: 4,
          items: [
            { type: 'progress', label: 'Прошивка', value: '100 %', percent: 100 },
            { type: 'progress', label: 'Сервер', value: '80 %', percent: 80 },
            { type: 'progress', label: 'Интерфейсы', value: '55 %', percent: 55 },
          ],
        }),
      },
      {
        name: 'Ключ — значение', w: 520, pw: 380, make: () => ({
          type: 'kv', rows: { 'Доступ': 'TLS-сертификаты', 'Секреты': 'в хранилище, не в коде', 'Резерв': 'каждую ночь' },
        }),
      },
    ],
  },
  {
    name: 'Таблицы',
    icon: 'list',
    items: [
      {
        name: 'Линии', w: 760, pw: 520, make: () => ({
          type: 'table', header: ['Показатель', 'План', 'Факт'],
          rows: [['Устройств в работе', 20, 24], ['Доступность, %', 99.5, 99.7], ['Задержка, с', 2, 1.4], ['Сообщений, млн', 3, 3.4]],
          widths: [2, 1, 1], labels: true,
        }),
      },
      {
        name: 'Зебра', w: 760, pw: 520, make: () => ({
          type: 'table', variant: 'stripes', header: ['Этап', 'Срок', 'Статус'],
          rows: [['Прототип', 'март', '{#16A34A|● готово}'], ['Пилот', 'май', '{#16A34A|● готово}'], ['Эксплуатация', 'сентябрь', '{#CA8A04|● идёт}'], ['Масштабирование', 'декабрь', '{muted|○ план}']],
          widths: [2, 1, 1],
        }),
      },
      {
        name: 'Сетка', w: 760, pw: 520, make: () => ({
          type: 'table', variant: 'boxed', header: ['№', 'Вопрос', 'Приоритет'],
          rows: [[1, 'Первый вопрос', '{#DC2626|● Высокий}'], [2, 'Второй вопрос', '{#CA8A04|● Средний}'], [3, 'Третий вопрос', '{#0369A1|● Низкий}']],
          widths: [1, 7, 2], align: ['center', 'left', 'left'],
        }),
      },
      {
        name: 'Акцентная шапка', w: 760, pw: 520, make: () => ({
          type: 'table', variant: 'accent', header: ['Тариф', 'Устройств', 'Цена в месяц'],
          rows: [['Старт', 10, '4 900 ₽'], ['Бизнес', 50, '19 900 ₽'], ['Объект', 'без ограничений', 'по запросу']],
          widths: [2, 1, 1], labels: true, highlight: 1,
        }),
      },
      {
        name: 'Сравнение', w: 760, pw: 520, make: () => ({
          type: 'table', header: ['', 'Было', 'Стало'],
          rows: [['Сбор данных', 'вручную, раз в неделю', '**автоматически, каждую минуту**'], ['Оповещения', '—', '{accent|✓} при выходе за порог'], ['История', 'таблицы Excel', '{accent|✓} графики за год']],
          widths: [1.2, 1.5, 1.8], labels: true,
        }),
      },
    ],
  },
  {
    name: 'Графики',
    icon: 'chart',
    items: [
      {
        name: 'График в карточке', w: 620, pw: 420, make: () => ({
          type: 'card', title: 'Сообщений в сутки',
          body: { type: 'line-chart', values: [120, 128, 124, 141, 156, 151, 170, 186, 194, 218], start: 'январь', end: 'октябрь' },
        }),
      },
      {
        name: 'Линейный график', w: 620, pw: 380, make: () => ({
          type: 'line-chart', values: [120, 128, 124, 141, 156, 151, 170, 186, 194, 218], start: 'январь', end: 'октябрь',
        }),
      },
      {
        name: 'Столбцы в карточке', w: 480, pw: 360, make: () => ({
          type: 'card', title: 'Задержка доставки, с',
          body: { type: 'bars', values: [1.9, 1.7, 1.6, 1.4, 1.2], labels: ['Янв', 'Фев', 'Мар', 'Апр', 'Май'], height: 150 },
        }),
      },
      { name: 'Столбцы', w: 520, pw: 340, make: () => ({ type: 'bars', values: [1.9, 1.7, 1.6, 1.4, 1.2], labels: ['Янв', 'Фев', 'Мар', 'Апр', 'Май'], height: 150 }) },
      {
        name: 'Доступность по дням', w: 620, pw: 320, make: () => ({
          type: 'uptime', threshold: 99.5,
          values: Array.from({ length: 30 }, (_x, i) => [99.9, 99.8, 99.95, 99.4, 99.7, 99.99][i % 6]),
        }),
      },
    ],
  },
  {
    name: 'Карточки',
    icon: 'grid',
    items: [
      { name: 'Карточка', w: 380, pw: 300, make: () => card('Заголовок', 'Пояснение в пару строк.') },
      { name: 'Три карточки', w: 1040, pw: 640, make: () => ({ type: 'grid', columns: 3, items: [1, 2, 3].map((k) => card(`Пункт ${k}`, 'Короткое пояснение')) }) },
      { name: 'Было — стало', w: 820, pw: 460, make: () => ({ type: 'grid', columns: 2, items: [card('Было', 'Данные собирали вручную раз в неделю'), card('Стало', 'Показания приходят каждую минуту')] }) },
      {
        name: 'Панель', w: 520, make: () => ({
          type: 'panel', title: 'Серверная часть', columns: 2,
          cells: [{ title: 'GitLab', sub: 'репозитории и CI' }, { title: 'Grafana', sub: 'мониторинг' }, 'Redis', 'PostgreSQL'],
        }),
      },
      {
        name: 'Ползунки', w: 460, pw: 320, make: () => ({
          type: 'sliders', rows: [{ label: 'Интервал', value: '60 с', position: 0.6 }, { label: 'Мощность', value: '14 дБм', position: 0.8 }],
        }),
      },
    ],
  },
  {
    name: 'Схемы',
    icon: 'layers',
    items: [
      {
        name: 'Хронология', w: 1040, pw: 640, make: () => ({
          type: 'timeline', items: [
            { date: 'Март', title: 'Прототип', text: 'первые датчики', done: true },
            { date: 'Май', title: 'Пилот', text: '12 устройств', done: true },
            { date: 'Сентябрь', title: 'Эксплуатация', text: '24 устройства', done: true },
            { date: 'Декабрь', title: 'Масштабирование', text: 'новые объекты' },
          ],
        }),
      },
      {
        name: 'Шаги по очереди', w: 900, pw: 560, make: () => ({
          type: 'pipeline', steps: [{ title: 'Коммит', sub: 'GitLab' }, { title: 'Сборка', sub: 'CI' }, { title: 'Тесты', sub: 'автоматически' }, { title: 'Выкладка', sub: 'сервер' }],
        }),
      },
      { name: 'Сеть устройств', w: 520, h: 360, make: () => ({ type: 'network', nodes: 7 }) },
      {
        name: 'Итоги вокруг логотипа', w: 1040, pw: 760, make: () => ({
          type: 'hub', items: [
            { title: 'Первый итог', text: 'Пояснение' }, { title: 'Второй итог', text: 'Пояснение' },
            { title: 'Третий итог', text: 'Пояснение' }, { title: 'Четвёртый итог', text: 'Пояснение' },
          ],
        }),
      },
    ],
  },
  {
    name: 'Медиа',
    icon: 'image',
    items: [
      { name: 'Картинка', w: 480, h: 320, make: () => ({ type: 'image', src: '' }) },
      { name: 'Картинка с подписью', w: 480, make: () => ({ type: 'image', src: '', height: 280, caption: 'Подпись к картинке' }) },
      { name: 'Плитка с иллюстрацией', w: 420, h: 300, make: () => ({ type: 'tile', illustration: 'station', caption: 'Базовая станция' }) },
    ],
  },
];

const PREVIEW_W = 136;
const PREVIEW_H = 76;
const PAD = 6;

/** Миниатюра блока: рендер настоящим движком в отдельной сцене, вписанный в карточку по центру. */
function preview(deck: Deck, p: Preset): HTMLElement {
  const box = document.createElement('div');
  box.className = 'st-lib-prev';
  const w0 = p.pw ?? p.w;
  const block = { ...p.make(), place: { x: 0, y: 0, w: w0, ...(p.h ? { h: p.h } : {}) } } as Block;
  const tmp: Deck = { ...deck, slides: [{ template: 'canvas', free: [block] }] };
  const inner = document.createElement('div');
  inner.className = 'thumb-stage canvas static';
  inner.style.width = `${W}px`;
  inner.style.height = `${H}px`;
  inner.innerHTML = new Renderer(tmp, deck.brand?.logo).slide(tmp.slides[0], 0, 'on static');
  box.appendChild(inner);
  // Масштаб по настоящему размеру блока — после вставки в документ
  requestAnimationFrame(() => {
    const el = inner.querySelector<HTMLElement>('.free');
    const w = el?.offsetWidth || w0;
    const h = el?.offsetHeight || p.h || 200;
    const k = Math.min((PREVIEW_W - PAD * 2) / w, (PREVIEW_H - PAD * 2) / h, 0.6);
    inner.style.transform = `translate(${(PREVIEW_W - w * k) / 2}px, ${(PREVIEW_H - h * k) / 2}px) scale(${k})`;
  });
  return box;
}

let openEl: HTMLElement | null = null;

export function closeLibrary(): void {
  openEl?.remove();
  openEl = null;
}

/**
 * Галерея блоков под кнопкой ленты, как галерея фигур в PowerPoint:
 * разделы с заголовками одной прокручиваемой панелью. pick — вставить выбранный.
 */
export function showLibrary(anchor: HTMLElement, deck: Deck, pick: (p: Preset) => void): void {
  if (openEl) return closeLibrary();
  const el = document.createElement('div');
  el.className = 'st-lib';
  el.dataset.edKeep = '';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Блоки');
  el.innerHTML = LIBRARY.map((c, ci) => `<section><h4>${icon(c.icon)}<span>${esc(c.name)}</span></h4><div class="st-lib-grid">${c.items.map((p, pi) =>
    `<button type="button" class="st-lib-item" data-c="${ci}" data-p="${pi}" title="Вставить: ${esc(p.name)}"><span class="st-lib-slot"></span><span class="st-lib-name">${esc(p.name)}</span></button>`).join('')}</div></section>`).join('');
  document.body.appendChild(el);
  el.querySelectorAll<HTMLElement>('.st-lib-item').forEach((b) => {
    b.querySelector('.st-lib-slot')!.appendChild(preview(deck, LIBRARY[Number(b.dataset.c)].items[Number(b.dataset.p)]));
  });
  const r = anchor.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, r.left))}px`;
  el.style.top = `${r.bottom + 6}px`;
  openEl = el;

  const close = () => {
    closeLibrary();
    removeEventListener('pointerdown', outside, true);
    removeEventListener('keydown', onKey, true);
  };
  const outside = (e: PointerEvent) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const items = () => [...el.querySelectorAll<HTMLElement>('.st-lib-item')];
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      anchor.focus();
      return;
    }
    // Стрелки — по карточкам
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const cols = Math.max(1, Math.round(el.querySelector('.st-lib-grid')!.clientWidth / (list[0].offsetWidth + 8)));
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key]!;
    list[Math.max(0, Math.min(list.length - 1, i + d))].focus();
  };
  el.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.st-lib-item');
    if (!b) return;
    close();
    pick(LIBRARY[Number(b.dataset.c)].items[Number(b.dataset.p)]);
  });
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', onKey, true);
  items()[0]?.focus({ preventScroll: true });
}
