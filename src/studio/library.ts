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
  /** Ширина блока в миниатюре галереи, если отличается (текст читается крупнее) */
  pw?: number;
  make(): Block;
}

export interface Category {
  name: string;
  items: Preset[];
}

/** Готовые блоки: вставляются свободным объектом в центр слайда. Данные — как в deck.yaml. */
export const LIBRARY: Category[] = [
  {
    name: 'Текст',
    items: [
      { name: 'Заголовок', w: 760, pw: 300, make: () => ({ type: 'text', text: 'Заголовок', styles: { text: { size: 44 } } }) },
      { name: 'Абзац', w: 520, pw: 250, make: () => ({ type: 'text', text: 'Короткий абзац текста. **Главное** можно выделить.' }) },
      { name: 'Крупный текст', w: 560, pw: 280, make: () => ({ type: 'text', text: 'Ключевая мысль слайда', size: 'lead' }) },
      { name: 'Подпись', w: 360, pw: 200, make: () => ({ type: 'note', text: 'Мелкая серая подпись' }) },
      { name: 'Список', w: 480, pw: 220, make: () => ({ type: 'list', items: ['Первый пункт', 'Второй пункт', 'Третий пункт'] }) },
      { name: 'Чипы', w: 560, pw: 300, make: () => ({ type: 'chips', items: ['Важное*', 'Метка', 'Ещё метка'] }) },
    ],
  },
  {
    name: 'Карточки и данные',
    items: [
      { name: 'Карточка', w: 380, pw: 300, make: () => ({ type: 'card', title: 'Заголовок', text: 'Пояснение в пару строк.' }) },
      {
        name: 'Три карточки', w: 1040, make: () => ({
          type: 'grid', columns: 3,
          items: [1, 2, 3].map((k) => ({ type: 'card', title: `Пункт ${k}`, text: 'Короткое пояснение' })),
        }),
      },
      {
        name: 'Панель', w: 520, make: () => ({
          type: 'panel', title: 'Серверная часть', columns: 2,
          cells: [{ title: 'GitLab', sub: 'репозитории и CI' }, { title: 'Grafana', sub: 'мониторинг' }, 'Redis', 'PostgreSQL'],
        }),
      },
      {
        name: 'Ключ — значение', w: 520, make: () => ({
          type: 'kv', rows: { 'Доступ': 'TLS-сертификаты', 'Секреты': 'в хранилище, не в коде', 'Резерв': 'каждую ночь' },
        }),
      },
      { name: 'Прогресс', w: 460, pw: 320, make: () => ({ type: 'progress', label: 'Готовность', value: '18 из 24', percent: 75 }) },
      {
        name: 'Ползунки', w: 460, make: () => ({
          type: 'sliders', rows: [{ label: 'Интервал', value: '60 с', position: 0.6 }, { label: 'Мощность', value: '14 дБм', position: 0.8 }],
        }),
      },
    ],
  },
  {
    name: 'Графики',
    items: [
      {
        name: 'Линейный график', w: 620, make: () => ({
          type: 'line-chart', values: [120, 132, 128, 150, 162, 158, 181, 196, 204, 230], start: 'январь', end: 'октябрь', unit: '',
        }),
      },
      { name: 'Столбцы', w: 480, make: () => ({ type: 'bars', values: [1.9, 1.7, 1.6, 1.4, 1.2], labels: ['Янв', 'Фев', 'Мар', 'Апр', 'Май'], height: 140 }) },
      {
        name: 'Доступность', w: 620, make: () => ({
          type: 'uptime', threshold: 99.5,
          values: Array.from({ length: 30 }, (_x, i) => [99.9, 99.8, 99.95, 99.4, 99.7, 99.99][i % 6]),
        }),
      },
    ],
  },
  {
    name: 'Схемы',
    items: [
      { name: 'Сеть устройств', w: 520, h: 360, make: () => ({ type: 'network', nodes: 7 }) },
      {
        name: 'Шаги по очереди', w: 900, make: () => ({
          type: 'pipeline', steps: [{ title: 'Коммит', sub: 'GitLab' }, { title: 'Сборка', sub: 'CI' }, { title: 'Тесты', sub: 'автоматически' }, { title: 'Выкладка', sub: 'сервер' }],
        }),
      },
      {
        name: 'Итоги вокруг логотипа', w: 1040, make: () => ({
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
    items: [
      { name: 'Картинка', w: 480, h: 320, make: () => ({ type: 'image', src: '' }) },
      { name: 'Плитка с иллюстрацией', w: 420, h: 300, make: () => ({ type: 'tile', illustration: 'station', caption: 'Базовая станция' }) },
    ],
  },
];

const PREVIEW_W = 168;
const PREVIEW_H = 96;

/** Миниатюра блока: рендер настоящим движком в отдельной сцене, вписанный в карточку. */
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
    const k = Math.min(PREVIEW_W / w, PREVIEW_H / h);
    inner.style.transform = `translate(${(PREVIEW_W - w * k) / 2}px, ${(PREVIEW_H - h * k) / 2}px) scale(${k})`;
  });
  return box;
}

let openEl: HTMLElement | null = null;

export function closeLibrary(): void {
  openEl?.remove();
  openEl = null;
}

/** Галерея блоков под кнопкой ленты. pick — вставить выбранный. */
export function showLibrary(anchor: HTMLElement, deck: Deck, pick: (p: Preset) => void): void {
  if (openEl) return closeLibrary();
  const el = document.createElement('div');
  el.className = 'st-lib';
  el.dataset.edKeep = '';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Библиотека блоков');
  el.innerHTML = `<div class="st-lib-head"><b>Блоки</b><span>Вставляются свободным объектом в центр слайда</span><button type="button" class="st-f-x" data-close aria-label="Закрыть">${icon('close')}</button></div>`
    + `<div class="st-lib-body">${LIBRARY.map((c, ci) => `<section><h4>${esc(c.name)}</h4><div class="st-lib-grid">${c.items.map((p, pi) =>
      `<button type="button" class="st-lib-item" data-c="${ci}" data-p="${pi}" title="Вставить: ${esc(p.name)}"><span class="st-lib-slot"></span><span class="st-lib-name">${esc(p.name)}</span></button>`).join('')}</div></section>`).join('')}</div>`;
  document.body.appendChild(el);
  el.querySelectorAll<HTMLElement>('.st-lib-item').forEach((b) => {
    const p = LIBRARY[Number(b.dataset.c)].items[Number(b.dataset.p)];
    b.querySelector('.st-lib-slot')!.appendChild(preview(deck, p));
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
    const b = t.closest<HTMLElement>('.st-lib-item');
    if (!b) return;
    close();
    pick(LIBRARY[Number(b.dataset.c)].items[Number(b.dataset.p)]);
  });
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', onKey, true);
  el.querySelector<HTMLElement>('.st-lib-item')?.focus();
}
