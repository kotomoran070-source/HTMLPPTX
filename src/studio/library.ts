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
  /** Значок вместо живой миниатюры (простые формы): SVG 48×32 */
  glyph?: string;
  make(): Block;
}

export interface Category {
  name: string;
  icon: string;
  /** Мелкие плитки со значками — как галерея фигур в PowerPoint */
  compact?: boolean;
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
    compact: true,
    items: [
      { name: 'Прямоугольник', w: 320, h: 180, glyph: '<rect x="5" y="6" width="38" height="20"/>', make: () => ({ type: 'shape', kind: 'rect', fill: 'soft', stroke: 'accent', width: 2 }) },
      { name: 'Скруглённый', w: 320, h: 180, glyph: '<rect x="5" y="6" width="38" height="20" rx="6"/>', make: () => ({ type: 'shape', fill: 'soft', stroke: 'accent', width: 2, radius: 24 }) },
      { name: 'Капсула', w: 320, h: 96, glyph: '<rect x="5" y="8" width="38" height="16" rx="8"/>', make: () => ({ type: 'shape', kind: 'pill', fill: 'soft', stroke: 'accent', width: 2 }) },
      { name: 'Круг', w: 180, h: 180, glyph: '<circle cx="24" cy="16" r="10.5"/>', make: () => ({ type: 'shape', kind: 'ellipse', fill: 'soft', stroke: 'accent', width: 2 }) },
      { name: 'Овал', w: 300, h: 180, glyph: '<ellipse cx="24" cy="16" rx="19" ry="10.5"/>', make: () => ({ type: 'shape', kind: 'ellipse', fill: 'soft', stroke: 'accent', width: 2 }) },
      { name: 'Линия', w: 400, h: 16, glyph: '<path class="ln" d="M6 16h36"/>', make: () => ({ type: 'shape', kind: 'line', stroke: 'accent', width: 3 }) },
      { name: 'Стрелка', w: 260, h: 24, glyph: '<path class="ln" d="M6 16h34M33 10l7 6-7 6"/>', make: () => ({ type: 'shape', kind: 'arrow', stroke: 'accent', width: 3 }) },
    ],
  },
  {
    name: 'Плашки',
    icon: 'layers',
    items: [
      { name: 'Карточка с тенью', w: 360, h: 200, make: () => ({ type: 'shape', fill: 'surface', stroke: 'border', width: 1, radius: 16, shadow: true }) },
      { name: 'Карточка с заголовком', w: 360, h: 200, make: () => ({ type: 'shape', fill: 'surface', stroke: 'line', width: 1, shadow: 'sm', valign: 'top', text: 'Заголовок\nКороткое пояснение в две строки', styles: { text: { align: 'left', size: 20 } } }) },
      { name: 'Плашка с текстом', w: 360, h: 72, make: () => ({ type: 'shape', kind: 'pill', fill: 'accent', text: 'Главное' }) },
      { name: 'Градиентная плашка', w: 360, h: 120, make: () => ({ type: 'shape', fill: 'gradient', shadow: 'sm', text: 'Ключевая мысль', styles: { text: { size: 24 } } }) },
      { name: 'Метка', w: 200, h: 44, make: () => ({ type: 'shape', kind: 'pill', fill: 'soft', stroke: 'accent', width: 1, text: 'метка', styles: { text: { size: 15 } } }) },
      { name: 'Зона пунктиром', w: 420, h: 240, make: () => ({ type: 'shape', fill: 'none', stroke: 'border', width: 2, dash: 'dash', radius: 20 }) },
    ],
  },
  {
    name: 'Числа',
    icon: 'sliders',
    items: [
      { name: 'Ключевое число', w: 300, make: () => stat('128', 'новых клиентов', '+18 за месяц') },
      {
        name: 'Три числа', w: 1040, pw: 620, make: () => ({
          type: 'grid', columns: 3, gap: 40,
          items: [stat('4,2 млн ₽', 'выручка за квартал', '+12 %'), stat('92 %', 'довольных клиентов'), stat('3 дня', 'средний срок заказа', '−1 день')],
        }),
      },
      { name: 'Прогресс', w: 460, pw: 320, make: () => ({ type: 'progress', label: 'План продаж', value: '75 из 100', percent: 75 }) },
      {
        name: 'Три прогресса', w: 520, pw: 380, make: () => ({
          type: 'stack', gap: 4,
          items: [
            { type: 'progress', label: 'Исследование', value: '100 %', percent: 100 },
            { type: 'progress', label: 'Дизайн', value: '80 %', percent: 80 },
            { type: 'progress', label: 'Разработка', value: '55 %', percent: 55 },
          ],
        }),
      },
      {
        name: 'Ключ — значение', w: 520, pw: 380, make: () => ({
          type: 'kv', rows: { 'Срок': '3 месяца', 'Команда': '5 человек', 'Бюджет': '1,2 млн ₽' },
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
          rows: [['Новых клиентов', 100, 128], ['Выручка, млн ₽', 4, 4.2], ['Средний чек, тыс. ₽', 32, 33], ['Отток, %', 5, 4]],
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
          type: 'table', variant: 'accent', header: ['Тариф', 'Пользователей', 'Цена в месяц'],
          rows: [['Старт', 10, '4 900 ₽'], ['Бизнес', 50, '19 900 ₽'], ['Объект', 'без ограничений', 'по запросу']],
          widths: [2, 1, 1], labels: true, highlight: 1,
        }),
      },
      {
        name: 'Мягкая с итогом', w: 760, pw: 520, make: () => ({
          type: 'table', variant: 'soft', header: ['Статья', 'I кв.', 'II кв.'],
          rows: [['Маркетинг', '1,2 млн', '0,8 млн'], ['Разработка', '0,4 млн', '0,3 млн'], ['Поддержка', '0,2 млн', '0,2 млн'], ['Итого', '1,8 млн', '1,3 млн']],
          widths: [2, 1, 1], labels: true, total: true,
        }),
      },
      {
        name: 'Тёмная шапка', w: 760, pw: 520, make: () => ({
          type: 'table', variant: 'dark', density: 'compact', header: ['Параметр', 'Значение'],
          rows: [['Формат', 'онлайн и очно'], ['Длительность', '2 дня'], ['Участников', 'до 40'], ['Язык', 'русский']],
          widths: [1, 2], labels: true,
        }),
      },
      {
        name: 'Сравнение', w: 760, pw: 520, make: () => ({
          type: 'table', header: ['', 'Было', 'Стало'],
          rows: [['Отчёты', 'вручную, раз в месяц', '**автоматически, каждый день**'], ['Напоминания', '—', '{accent|✓} по почте и в чате'], ['История', 'таблицы Excel', '{accent|✓} графики за год']],
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
          type: 'card', title: 'Продажи по месяцам',
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
          type: 'card', title: 'Время ответа, мин',
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
      { name: 'Было — стало', w: 820, pw: 460, make: () => ({ type: 'grid', columns: 2, items: [card('Было', 'Отчёт собирали вручную два дня'), card('Стало', 'Отчёт готов за минуту')] }) },
      {
        name: 'Панель', w: 520, make: () => ({
          type: 'panel', title: 'Команда проекта', columns: 2,
          cells: [{ title: 'Анна', sub: 'руководитель' }, { title: 'Игорь', sub: 'дизайн' }, 'Аналитика', 'Разработка'],
        }),
      },
      {
        name: 'Ползунки', w: 460, pw: 320, make: () => ({
          type: 'sliders', rows: [{ label: 'Скорость', value: '70 %', position: 0.7 }, { label: 'Качество', value: '90 %', position: 0.9 }],
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
            { date: 'Март', title: 'Прототип', text: 'первая версия', done: true },
            { date: 'Май', title: 'Пилот', text: '12 клиентов', done: true },
            { date: 'Сентябрь', title: 'Эксплуатация', text: 'для всех', done: true },
            { date: 'Декабрь', title: 'Масштабирование', text: 'новые рынки' },
          ],
        }),
      },
      {
        name: 'Шаги по очереди', w: 900, pw: 560, make: () => ({
          type: 'pipeline', steps: [{ title: 'Заявка', sub: 'онлайн' }, { title: 'Согласование', sub: '1 день' }, { title: 'Работа', sub: 'по плану' }, { title: 'Сдача', sub: 'акт и отчёт' }],
        }),
      },
      { name: 'Схема связей', w: 520, h: 360, make: () => ({ type: 'network', nodes: 7 }) },
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
      { name: 'Плитка с фото', w: 420, h: 300, make: () => ({ type: 'tile', caption: 'Подпись к фото' }) },
      { name: 'Видео', w: 640, h: 360, make: () => ({ type: 'video' }) },
      { name: '3D-модель', w: 420, h: 420, make: () => ({ type: 'model' }) },
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
  el.innerHTML = LIBRARY.map((c, ci) => `<section><h4>${icon(c.icon)}<span>${esc(c.name)}</span></h4><div class="st-lib-grid${c.compact ? ' compact' : ''}">${c.items.map((p, pi) =>
    `<button type="button" class="st-lib-item" data-c="${ci}" data-p="${pi}" title="Вставить: ${esc(p.name)}"><span class="st-lib-slot">${p.glyph ? `<svg class="st-lib-glyph" viewBox="0 0 48 32" aria-hidden="true">${p.glyph}</svg>` : ''}</span><span class="st-lib-name">${esc(p.name)}</span></button>`).join('')}</div></section>`).join('');
  document.body.appendChild(el);
  el.querySelectorAll<HTMLElement>('.st-lib-item').forEach((b) => {
    const p = LIBRARY[Number(b.dataset.c)].items[Number(b.dataset.p)];
    if (!p.glyph) b.querySelector('.st-lib-slot')!.appendChild(preview(deck, p));
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
