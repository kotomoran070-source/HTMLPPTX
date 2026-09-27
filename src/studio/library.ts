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

const PREVIEW_W = 164;
const PREVIEW_H = 92;
const PAD = 8;

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
let lastCat = 0;

export function closeLibrary(): void {
  openEl?.remove();
  openEl = null;
}

/** Галерея блоков под кнопкой ленты: категории слева, карточки справа. pick — вставить выбранный. */
export function showLibrary(anchor: HTMLElement, deck: Deck, pick: (p: Preset) => void): void {
  if (openEl) return closeLibrary();
  const el = document.createElement('div');
  el.className = 'st-lib';
  el.dataset.edKeep = '';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Библиотека блоков');
  el.innerHTML = `<nav class="st-lib-cats" role="tablist" aria-label="Категории">${LIBRARY.map((c, ci) =>
    `<button type="button" role="tab" data-cat="${ci}" aria-selected="false">${icon(c.icon)}<span>${esc(c.name)}</span><em>${c.items.length}</em></button>`).join('')}</nav>
<div class="st-lib-main"><div class="st-lib-head"><b></b><span>Вставляется в центр слайда</span><button type="button" class="st-f-x" data-close aria-label="Закрыть">${icon('close')}</button></div>
<div class="st-lib-grid" role="tabpanel"></div></div>`;
  document.body.appendChild(el);
  const grid = el.querySelector<HTMLElement>('.st-lib-grid')!;
  const cache = new Map<number, HTMLElement[]>();

  const show = (ci: number) => {
    lastCat = ci;
    el.querySelectorAll<HTMLElement>('[data-cat]').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.cat) === ci)));
    el.querySelector('.st-lib-head b')!.textContent = LIBRARY[ci].name;
    // Миниатюры категории строятся один раз
    if (!cache.has(ci)) {
      cache.set(ci, LIBRARY[ci].items.map((p, pi) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'st-lib-item';
        b.dataset.c = String(ci);
        b.dataset.p = String(pi);
        b.title = `Вставить: ${p.name}`;
        b.appendChild(preview(deck, p));
        b.insertAdjacentHTML('beforeend', `<span class="st-lib-name">${esc(p.name)}</span>`);
        return b;
      }));
    }
    grid.replaceChildren(...cache.get(ci)!);
  };
  show(Math.min(lastCat, LIBRARY.length - 1));

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
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      anchor.focus();
    }
  };
  el.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-close]')) return close();
    const cat = t.closest<HTMLElement>('[data-cat]');
    if (cat) return show(Number(cat.dataset.cat));
    const b = t.closest<HTMLElement>('.st-lib-item');
    if (!b) return;
    close();
    pick(LIBRARY[Number(b.dataset.c)].items[Number(b.dataset.p)]);
  });
  // Наведение на категорию тоже переключает: быстро пробежаться глазами
  el.querySelector('.st-lib-cats')!.addEventListener('pointerover', (e) => {
    const cat = (e.target as Element).closest<HTMLElement>('[data-cat]');
    if (cat && (e as PointerEvent).pointerType === 'mouse') show(Number(cat.dataset.cat));
  });
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', onKey, true);
  el.querySelector<HTMLElement>(`[data-cat="${lastCat}"]`)?.focus();
}
