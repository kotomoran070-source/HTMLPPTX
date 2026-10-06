import { icon } from '../components/icons';
import { H, W } from '../engine/deck-view';
import { esc } from '../engine/html';
import { Renderer } from '../engine/render';
import type { Block, Deck } from '../types';
import type { Template } from './templates';

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
/** Строка текста с оформлением: размер, насыщенность, цвет темы, заглавные */
const line = (text: string, st: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ type: 'text', text, ...extra, ...(Object.keys(st).length ? { styles: { text: st } } : {}) });
/** Надпись над заголовком: мелко, заглавными, цветом акцента */
const eyebrow = (text: string) => line(text, { size: 14, weight: 700, color: 'accent', upper: true, spacing: 0.12 });
/** Список текстом: вид маркера — как в меню списка (check, num, dash…) */
const bullets = (items: string[], list?: string, size?: number) => line(items.map((x) => `- ${x}`).join('\n'), { ...(list ? { list } : {}), ...(size ? { size } : {}) });
/** Фото человека в круге с именем и ролью */
const person = (name: string, role: string) => ({ type: 'stack', gap: 4, style: 'text-align:center;align-items:center', items: [{ type: 'image', src: '', height: 150, radius: 'circle', style: 'width:150px;margin:0 auto' }, line(name, { size: 20, weight: 700, align: 'center' }), { type: 'note', text: role, style: 'text-align:center' }] });
/** Тариф: название, цена, что входит; выделенный — с рамкой акцента */
const plan = (name: string, price: string, items: string[], top = false) => ({
  type: 'card', ...(top ? { style: 'border:2px solid var(--ac);box-shadow:0 18px 40px color-mix(in srgb, var(--ac) 18%, transparent)' } : {}),
  body: [eyebrow(top ? `${name} · выбор клиентов` : name), line(price, { size: 40, weight: 800 }), bullets(items, 'check', 17)],
});

/** Стартовый код живой вставки: частицы в цветах темы, разбегаются от курсора */
export const EMBED_SAMPLE = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  canvas { display: block; width: 100%; height: 100%; }
</style></head>
<body><canvas id="c"></canvas>
<script>
// Живой код: HTML, CSS и JavaScript работают в изолированной рамке.
// Цвета темы презентации — CSS-переменные --ac, --ac2, --tx (включено «Цвета темы»).
const c = document.getElementById('c'), x = c.getContext('2d');
const css = getComputedStyle(document.documentElement);
const A = css.getPropertyValue('--ac').trim() || '#6366F1';
const B = css.getPropertyValue('--ac2').trim() || '#EC4899';
let w = 0, h = 0, mx = -1e3, my = -1e3;
function fit() {
  const r = devicePixelRatio || 1;
  w = c.clientWidth; h = c.clientHeight;
  c.width = w * r; c.height = h * r;
  x.setTransform(r, 0, 0, r, 0, 0);
}
addEventListener('resize', fit); fit();
addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; });
addEventListener('pointerleave', () => { mx = my = -1e3; });
const P = Array.from({ length: 160 }, (_, i) => ({
  a: Math.random() * 6.283, r: 0.1 + Math.random() * 0.36,
  s: (i % 2 ? 1 : -1) * (0.002 + Math.random() * 0.006), k: i % 2,
}));
(function frame() {
  x.clearRect(0, 0, w, h);
  for (const p of P) {
    p.a += p.s;
    let px = w / 2 + Math.cos(p.a) * p.r * w, py = h / 2 + Math.sin(p.a) * p.r * h;
    const d = Math.hypot(px - mx, py - my);
    if (d < 90) { px += (px - mx) / d * (90 - d) * 0.6; py += (py - my) / d * (90 - d) * 0.6; }
    x.fillStyle = p.k ? A : B;
    x.beginPath(); x.arc(px, py, 2.6, 0, 6.283); x.fill();
  }
  requestAnimationFrame(frame);
})();
</script></body></html>
`;

/** Стартовый код песочницы: короткий, чтобы его было удобно править при показе */
export const SANDBOX_SAMPLE = `<style>
  body { margin: 0; height: 100vh;
         display: grid; place-content: center; }
  .dot { display: inline-block; margin: 6px;
         width: 22px; height: 22px; border-radius: 50%;
         background: var(--ac);
         animation: jump .8s ease-in-out infinite alternate; }
  @keyframes jump {
    to { transform: translateY(-40px); background: var(--ac2); }
  }
</style>
<div id="row"></div>
<script>
  const count = 7;   // поменяйте число — результат обновится сам
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.animationDelay = i * 0.1 + 's';
    row.append(dot);
  }
  console.log('Точек:', count);
</script>
`;

/** Заготовка по разделу и имени — для кнопок вкладки «Вставка» */
export function presetOf(category: string, name: string): Preset | null {
  return LIBRARY.find((c) => c.name === category)?.items.find((p) => p.name === name) ?? null;
}

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
      {
        name: 'Заголовок с надписью', w: 820, pw: 460, make: () => ({
          type: 'stack', gap: 8, items: [eyebrow('Раздел 02'), line('Заголовок, который читается сразу', { size: 48, weight: 700 }), line('Подзаголовок: о чём этот слайд в одной строке', {}, { size: 'lead' })],
        }),
      },
      { name: 'Мысль с чертой', w: 760, pw: 440, make: () => line('Главная мысль — крупно и с акцентной чертой слева, чтобы её нельзя было пропустить.', { size: 30, leading: 1.3 }, { style: 'border-left:5px solid var(--ac);padding-left:24px' }) },
      { name: 'Список с галочками', w: 520, pw: 300, make: () => bullets(['Готово за один день', 'Без лишних согласований', 'Цифры из таблицы'], 'check', 22) },
      { name: 'Нумерованный список', w: 520, pw: 300, make: () => bullets(['Собираем данные', 'Проверяем гипотезу', 'Показываем результат'], 'num', 22) },
      { name: 'Шаги текстом', w: 560, pw: 320, make: () => bullets(['заявка онлайн', 'согласование', 'запуск'], 'Шаг #:', 22) },
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
      { name: 'Баннер на градиенте', w: 1040, h: 150, make: () => ({ type: 'shape', fill: 'gradient', radius: 28, shadow: 'sm', text: 'Главная мысль слайда — крупно на градиенте', styles: { text: { size: 34, weight: 700 } } }) },
      { name: 'Выноска', w: 640, h: 120, make: () => ({ type: 'shape', kind: 'rect', fill: 'soft', radius: 14, style: 'border-left:6px solid var(--ac)', text: 'Важно: короткое пояснение, на которое стоит обратить внимание', styles: { text: { align: 'left', size: 20 } } }) },
      { name: 'Номер в круге', w: 120, h: 120, make: () => ({ type: 'shape', kind: 'ellipse', fill: 'gradient', shadow: 'sm', text: '1', styles: { text: { size: 52, weight: 800 } } }) },
      {
        name: 'Карточка с полосой', w: 380, h: 220, make: () => ({
          type: 'group', base: { w: 380, h: 220 }, items: [
            { type: 'shape', kind: 'round', fill: 'surface', stroke: 'border', width: 1, radius: 18, shadow: 'sm', place: { x: 0, y: 0, w: 380, h: 220 } },
            { type: 'shape', kind: 'rect', fill: 'gradient', radius: 0, place: { x: 0, y: 0, w: 380, h: 8 }, style: 'border-radius:18px 18px 0 0' },
            { ...line('Заголовок карточки', { size: 24, weight: 700 }), place: { x: 28, y: 40, w: 324 } },
            { ...line('Пояснение в две строки: что это и почему важно.', { size: 17, color: 'text2' }), place: { x: 28, y: 92, w: 324 } },
          ],
        }),
      },
    ],
  },
  {
    name: 'Числа',
    icon: 'sliders',
    items: [
      { name: 'Ключевое число', w: 300, make: () => stat('128', 'новых клиентов', '+18 за месяц') },
      {
        name: 'Число на градиенте', w: 380, h: 240, make: () => ({
          type: 'group', base: { w: 380, h: 240 }, items: [
            { type: 'shape', fill: 'gradient', radius: 28, shadow: 'md', place: { x: 0, y: 0, w: 380, h: 240 } },
            { ...line('+38 %', { size: 84, weight: 800, color: '#FFFFFF' }), place: { x: 32, y: 40, w: 330 } },
            { ...line('рост выручки за год', { size: 20, color: '#FFFFFF' }), place: { x: 34, y: 158, w: 320 } },
          ],
        }),
      },
      {
        name: 'Четыре числа', w: 1080, pw: 700, make: () => ({
          type: 'grid', columns: 4, items: [stat('3,4 млн', 'выручка, ₽', '+12 %'), stat('12 400', 'клиентов', '+8 %'), stat('98 %', 'довольны'), stat('24/7', 'поддержка')],
        }),
      },
      {
        name: 'Число и график', w: 520, pw: 380, make: () => ({
          type: 'card', body: [stat('218', 'заказов в октябре', '+12 %'), { type: 'line-chart', values: [120, 128, 124, 141, 156, 151, 170, 186, 194, 218], start: 'январь', end: 'октябрь' }],
        }),
      },
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
    name: 'Интерактив',
    icon: 'cursor',
    items: [
      { name: 'Регулятор', w: 420, pw: 320, make: () => ({ type: 'control', name: 'x', label: 'Параметр', min: 0, max: 100, step: 1, value: 40, unit: ' %' }) },
      {
        name: 'Регулятор и столбцы', w: 520, pw: 360, make: () => ({
          type: 'stack', gap: 20,
          items: [
            { type: 'control', name: 'x', label: 'Рост в месяц', min: 0, max: 50, step: 1, value: 20, unit: ' %' },
            { type: 'bars', values: [100, '=100*(1+x/100)', '=100*(1+x/100)^2', '=100*(1+x/100)^3'], labels: ['Сейчас', '+1 мес', '+2 мес', '+3 мес'], max: 350, height: 160 },
            { type: 'text', text: 'Через три месяца: **{{round(100*(1+x/100)^3)}}** вместо 100' },
          ],
        }),
      },
      { name: 'Песочница', w: 1040, h: 440, pw: 360, make: () => ({ type: 'sandbox', theme: true, code: SANDBOX_SAMPLE }) },
      { name: 'Живой код', w: 640, h: 360, make: () => ({ type: 'embed', theme: true, interactive: true, code: EMBED_SAMPLE }) },
      { name: 'Кнопка «Дальше»', w: 260, h: 64, make: () => ({ type: 'shape', kind: 'pill', fill: 'gradient', text: 'Дальше →', action: 'next', styles: { text: { size: 20 } } }) },
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
        name: 'План с приоритетами', w: 1120, pw: 600, make: () => ({
          type: 'table', variant: 'plan', header: ['№', 'Направление', 'Задача и ожидаемый результат', 'Приоритет'],
          rows: [
            ['01', 'Оборудование', '**Автономное питание устройств**\nДо трёх лет работы без замены батарей', 'Высокий'],
            ['02', 'Связь', '**Резервный канал передачи данных**\nРабота без проводной сети на объекте', 'Критический'],
            ['03', 'Программная часть', '**Удалённое обновление устройств**\nОбновление всего парка в один клик', 'Высокий'],
            ['04', 'Интеграции', '**Открытое API для внешних систем**\nОбмен данными без ручной выгрузки', 'Средний'],
            ['05', 'Документация', '**Руководство по монтажу**\nПодключение объекта за один визит', 'Низкий'],
          ],
          widths: [0.6, 1.9, 5, 1.6], align: ['center', 'left', 'left', 'center'], badge: 3,
          footer: 'Всего позиций: **{rows}**', footnote: 'План работ на квартал',
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
        name: 'Два графика рядом', w: 1080, pw: 700, make: () => ({
          type: 'grid', columns: 2, items: [
            { type: 'card', title: 'Выручка, млн ₽', body: { type: 'line-chart', values: [2.1, 2.3, 2.2, 2.6, 2.9, 3.1, 3.4], start: 'апрель', end: 'октябрь' } },
            { type: 'card', title: 'Время ответа, мин', body: { type: 'bars', values: [1.9, 1.7, 1.6, 1.4, 1.2], labels: ['Июн', 'Июл', 'Авг', 'Сен', 'Окт'], height: 150 } },
          ],
        }),
      },
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
        name: 'Карточки с номерами', w: 1080, pw: 700, make: () => ({
          type: 'grid', columns: 3, items: [['01', 'Анализ', 'Собираем данные и находим, где теряем время'], ['02', 'Решение', 'Предлагаем два-три варианта с оценкой'], ['03', 'Запуск', 'Внедряем по шагам и меряем результат']]
            .map(([n, h, t]) => ({ type: 'card', body: [line(n, { size: 44, weight: 800, color: 'accent' }), line(h, { size: 24, weight: 700 }), line(t, { size: 17, color: 'text2' })] })),
        }),
      },
      {
        name: 'Тарифы', w: 1080, pw: 760, make: () => ({
          type: 'grid', columns: 3, align: 'stretch', items: [
            plan('Старт', '990 ₽', ['5 презентаций', 'Экспорт в PDF']),
            plan('Команда', '2 490 ₽', ['Без ограничений', 'Общие темы', 'Пульт с телефона'], true),
            plan('Компания', 'по запросу', ['Свой сервер', 'Поддержка 24/7']),
          ],
        }),
      },
      {
        name: 'Команда', w: 1040, pw: 720, make: () => ({
          type: 'grid', columns: 4, items: [person('Анна Смирнова', 'руководитель'), person('Игорь Ким', 'дизайн'), person('Мария Лебедева', 'аналитика'), person('Олег Петров', 'разработка')],
        }),
      },
      {
        name: 'Отзывы', w: 1040, pw: 700, make: () => ({
          type: 'grid', columns: 2, items: [
            { type: 'card', body: { type: 'quote', text: 'Сделали квартальный отчёт за вечер — раньше уходила неделя.', author: 'Елена В.', role: 'финансовый директор' } },
            { type: 'card', body: { type: 'quote', text: 'Клиенты листают презентацию с телефона и сами задают вопросы.', author: 'Дмитрий К.', role: 'руководитель продаж' } },
          ],
        }),
      },
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
        name: 'Проблема → решение', w: 1040, pw: 700, make: () => ({
          type: 'grid', columns: '1fr 72px 1fr', align: 'center', items: [
            { type: 'card', body: [eyebrow('Проблема'), line('Отчёт собирают вручную два дня', { size: 24, weight: 700 }), line('Ошибки в цифрах, версии путаются', { size: 17, color: 'text2' })] },
            { type: 'shape', kind: 'arrow', stroke: 'accent', width: 4, style: 'height:28px' },
            { type: 'card', style: 'border:2px solid var(--ac)', body: [eyebrow('Решение'), line('Отчёт собирается из таблицы за минуту', { size: 24, weight: 700 }), line('Цифры всегда свежие, один файл', { size: 17, color: 'text2' })] },
          ],
        }),
      },
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
    name: 'Схемы из пунктов',
    icon: 'cycle',
    items: [
      {
        name: 'Цикл', w: 1080, pw: 640, make: () => ({
          type: 'cycle', items: [{ title: 'Планируем', text: 'Цели квартала' }, { title: 'Делаем', text: 'Спринты по две недели' }, { title: 'Проверяем', text: 'Метрики и отзывы' }, { title: 'Улучшаем', text: 'Выводы — в следующий план' }],
        }),
      },
      {
        name: 'Воронка', w: 1000, pw: 620, make: () => ({
          type: 'funnel', items: [{ title: 'Посетители', text: '12 400 за месяц' }, { title: 'Заявки', text: '1 860 — 15 %' }, { title: 'Встречи', text: '420' }, { title: 'Сделки', text: '96 договоров' }],
        }),
      },
      {
        name: 'Пирамида', w: 1000, pw: 620, make: () => ({
          type: 'pyramid', items: [{ title: 'Миссия', text: 'Зачем мы существуем' }, { title: 'Стратегия', text: 'Куда идём три года' }, { title: 'Цели', text: 'Что делаем в этом году' }, { title: 'Задачи', text: 'Ежедневная работа' }],
        }),
      },
      {
        name: 'Сравнение', w: 1000, pw: 620, make: () => ({
          type: 'compare', items: [{ title: 'Было', text: '- Отчёт вручную два дня\n- Ошибки в цифрах' }, { title: 'Стало', text: '+ Отчёт за минуту\n+ Цифры из таблицы' }],
        }),
      },
      {
        name: 'Матрица 2×2', w: 1000, pw: 620, make: () => ({
          type: 'matrix', xAxis: 'Срочность →', yAxis: 'Важность →',
          items: [{ title: 'Запланировать', text: 'Важно, не срочно' }, { title: 'Сделать сейчас', text: 'Важно и срочно' }, { title: 'Отказаться', text: 'Не важно, не срочно' }, { title: 'Поручить', text: 'Срочно, не важно' }],
        }),
      },
      {
        name: 'Крупные номера', w: 1080, pw: 640, make: () => ({
          type: 'numbers', items: [{ title: 'Быстро', text: 'Слайды из данных за минуты' }, { title: 'Живо', text: 'Анимации и графики в показе' }, { title: 'Один файл', text: 'Открывается где угодно' }],
        }),
      },
      {
        name: 'Иконки с подписями', w: 1080, pw: 640, make: () => ({
          type: 'icons', items: [{ title: 'Скорость', text: 'Ответ за 5 минут' }, { title: 'Безопасность', text: 'Данные под защитой' }, { title: 'Команда', text: '40 инженеров' }, { title: 'Поддержка', text: 'Круглосуточный чат' }],
        }),
      },
      {
        name: 'Цифры', w: 1080, pw: 1000, make: () => ({
          type: 'stats', items: [{ title: '99,9 %', text: 'показов без сбоев' }, { title: '2,4 с', text: 'сборка в один файл' }, { title: '17 234', text: 'презентаций в месяц' }],
        }),
      },
      {
        name: 'Вопрос — ответ', w: 1000, pw: 620, make: () => ({
          type: 'faq', items: [{ title: 'Нужен ли интернет?', text: 'Нет: презентация — один файл.' }, { title: 'Можно открыть в PowerPoint?', text: 'Да, через экспорт в PPTX.' }, { title: 'Как показывать с телефона?', text: 'Отсканируйте QR в окне показа.' }],
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
      {
        name: 'Фото и текст', w: 1080, pw: 720, make: () => ({
          type: 'grid', columns: '1fr 1fr', gap: 48, align: 'center', items: [
            { type: 'image', src: '', height: 400, radius: 24 },
            { type: 'stack', gap: 12, items: [eyebrow('О продукте'), line('Заголовок рядом с фотографией', { size: 40, weight: 700 }), line('Пара предложений: что изображено и зачем это зрителю.', {}, { size: 'lead' }), bullets(['Первое преимущество', 'Второе преимущество', 'Третье преимущество'], 'check', 20)] },
          ],
        }),
      },
      {
        name: 'Фото с числом', w: 840, h: 470, make: () => ({
          type: 'group', base: { w: 840, h: 470 }, items: [
            { type: 'image', src: '', radius: 24, place: { x: 0, y: 0, w: 740, h: 430 } },
            { type: 'card', style: 'box-shadow:0 20px 50px rgba(2,6,23,.22)', body: stat('+38 %', 'рост за год', 'рекорд'), place: { x: 540, y: 270, w: 300 } },
          ],
        }),
      },
      {
        name: 'Три фото', w: 1080, pw: 720, make: () => ({
          type: 'grid', columns: 3, items: ['Первое фото', 'Второе фото', 'Третье фото'].map((caption) => ({ type: 'image', src: '', height: 300, radius: 18, caption })),
        }),
      },
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

const PEEK_W = 440;
const PEEK_H = 248;
const PEEK_PAD = 22;

/**
 * Крупное превью при наведении: тот же блок на фоне слайда, с анимацией появления.
 * Стоит сбоку от галереи и не ловит мышь — выбирать не мешает.
 */
function bigPreview(deck: Deck, p: Preset): HTMLElement {
  const box = document.createElement('div');
  box.className = 'st-peek-frame';
  const w0 = p.w;
  const block = { ...p.make(), place: { x: 0, y: 0, w: w0, ...(p.h ? { h: p.h } : {}) } } as Block;
  const tmp: Deck = { ...deck, slides: [{ template: 'canvas', free: [block] }] };
  const inner = document.createElement('div');
  inner.className = 'thumb-stage canvas';
  inner.style.width = `${W}px`;
  inner.style.height = `${H}px`;
  inner.innerHTML = new Renderer(tmp, deck.brand?.logo).slide(tmp.slides[0], 0, 'on');
  box.appendChild(inner);
  requestAnimationFrame(() => {
    const el = inner.querySelector<HTMLElement>('.free');
    const w = el?.offsetWidth || w0;
    const h = el?.offsetHeight || p.h || 200;
    const k = Math.min((PEEK_W - PEEK_PAD * 2) / w, (PEEK_H - PEEK_PAD * 2) / h, 1);
    inner.style.transform = `translate(${(PEEK_W - w * k) / 2}px, ${(PEEK_H - h * k) / 2}px) scale(${k})`;
  });
  return box;
}

let openEl: HTMLElement | null = null;
let peekEl: HTMLElement | null = null;

export function closeLibrary(): void {
  openEl?.remove();
  openEl = null;
  peekEl?.remove();
  peekEl = null;
}

/**
 * Галерея блоков под кнопкой ленты, как галерея фигур в PowerPoint:
 * разделы с заголовками одной прокручиваемой панелью. pick — вставить выбранный.
 */
export interface MineOpts {
  list: Template[];
  pick(t: Template): void;
  remove(t: Template): void;
}

/** only — показать только эти разделы (галереи вкладки «Вставка»: «Таблица», «Диаграмма», «Схемы»…) */
export function showLibrary(anchor: HTMLElement, deck: Deck, pick: (p: Preset) => void, mine?: MineOpts, only?: string[]): void {
  if (openEl) {
    const same = openEl.dataset.only === (only?.join('|') ?? '');
    closeLibrary();
    if (same) return;
  }
  const el = document.createElement('div');
  el.className = 'st-lib';
  el.dataset.edKeep = '';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Блоки');
  // Свои шаблоны — первым разделом, если они есть
  el.dataset.only = only?.join('|') ?? '';
  if (only) el.classList.add('part');
  const own = !only && mine?.list.length
    ? `<section class="st-lib-mine"><h4>${icon('sparkle')}<span>Мои шаблоны</span></h4><div class="st-lib-grid">${mine.list.map((t, ti) =>
      `<div class="st-lib-own"><button type="button" class="st-lib-item" data-t="${ti}" title="Вставить: ${esc(t.name)}"><span class="st-lib-slot"><span class="st-lib-prev">${t.preview ? `<img src="${esc(t.preview)}" alt="">` : ''}</span></span><span class="st-lib-name">${esc(t.name)}</span></button>`
      + `<button type="button" class="st-lib-del" data-del="${ti}" title="Удалить шаблон" aria-label="Удалить шаблон «${esc(t.name)}»">${icon('close')}</button></div>`).join('')}</div></section>`
    : '';
  // Разделы галереи — в порядке, в котором их просили (новые схемы — первыми)
  const order = only ? only.map((n) => LIBRARY.findIndex((c) => c.name === n)).filter((i) => i >= 0) : LIBRARY.map((_c, i) => i);
  el.innerHTML = own + order.map((ci) => LIBRARY[ci]).map((c, k) => { const ci = order[k]; return `<section><h4>${icon(c.icon)}<span>${esc(c.name)}</span></h4><div class="st-lib-grid${c.compact ? ' compact' : ''}">${c.items.map((p, pi) =>
    `<button type="button" class="st-lib-item" data-c="${ci}" data-p="${pi}" title="Вставить: ${esc(p.name)}"><span class="st-lib-slot">${p.glyph ? `<svg class="st-lib-glyph" viewBox="0 0 48 32" aria-hidden="true">${p.glyph}</svg>` : ''}</span><span class="st-lib-name">${esc(p.name)}</span></button>`).join('')}</div></section>`; }).join('');
  document.body.appendChild(el);
  el.querySelectorAll<HTMLElement>('.st-lib-item[data-c]').forEach((b) => {
    const p = LIBRARY[Number(b.dataset.c)].items[Number(b.dataset.p)];
    if (!p.glyph) b.querySelector('.st-lib-slot')!.appendChild(preview(deck, p));
  });
  const r = anchor.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, r.left))}px`;
  el.style.top = `${r.bottom + 6}px`;
  openEl = el;

  // ---------- крупное превью при наведении ----------
  const peek = document.createElement('div');
  peek.className = 'st-peek';
  peek.setAttribute('aria-hidden', 'true');
  document.body.appendChild(peek);
  peekEl = peek;
  let peekTimer = 0;
  let shownFor: HTMLElement | null = null;
  const place = (item: HTMLElement) => {
    const g = el.getBoundingClientRect();
    const pw = peek.offsetWidth;
    const ph = peek.offsetHeight;
    const ir = item.getBoundingClientRect();
    // Сбоку от галереи, где есть место; иначе — над противоположной половиной галереи, не над плиткой под мышью
    let x: number;
    if (innerWidth - g.right >= pw + 20) x = g.right + 12;
    else if (g.left >= pw + 20) x = g.left - pw - 12;
    else x = ir.left + ir.width / 2 < g.left + g.width / 2 ? g.right - pw - 10 : g.left + 10;
    const y = Math.max(8, Math.min(innerHeight - ph - 8, ir.top + ir.height / 2 - ph / 2));
    peek.style.left = `${Math.round(x)}px`;
    peek.style.top = `${Math.round(y)}px`;
  };
  const showPeek = (item: HTMLElement) => {
    if (shownFor === item) return;
    shownFor = item;
    const name = item.querySelector('.st-lib-name')?.textContent ?? '';
    peek.innerHTML = '';
    if (item.dataset.t !== undefined && mine) {
      const t = mine.list[Number(item.dataset.t)];
      const f = document.createElement('div');
      f.className = 'st-peek-frame';
      if (t.preview) f.innerHTML = `<img src="${esc(t.preview)}" alt="">`;
      peek.appendChild(f);
    } else {
      const p = LIBRARY[Number(item.dataset.c)].items[Number(item.dataset.p)];
      peek.appendChild(bigPreview(deck, p));
    }
    peek.insertAdjacentHTML('beforeend', `<div class="st-peek-cap"><b>${esc(name)}</b><span>Щелчок — вставить на слайд</span></div>`);
    place(item);
    peek.classList.add('on');
  };
  const hidePeek = () => {
    clearTimeout(peekTimer);
    shownFor = null;
    peek.classList.remove('on');
  };
  const want = (item: HTMLElement | null) => {
    clearTimeout(peekTimer);
    if (!item) return hidePeek();
    // Уже видно — сразу следующий блок; первый показ — после короткой паузы, чтобы не мигало при проходе мышью
    if (peek.classList.contains('on')) showPeek(item);
    else peekTimer = window.setTimeout(() => showPeek(item), 320);
  };
  el.addEventListener('pointerover', (e) => want((e.target as Element).closest<HTMLElement>('.st-lib-item')));
  el.addEventListener('pointerleave', hidePeek);
  el.addEventListener('focusin', (e) => {
    const item = (e.target as Element).closest<HTMLElement>('.st-lib-item');
    if (item && item.matches(':focus-visible')) want(item);
  });
  el.addEventListener('scroll', hidePeek, { passive: true });

  const close = () => {
    clearTimeout(peekTimer);
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
    const del = (e.target as Element).closest<HTMLElement>('[data-del]');
    if (del && mine) {
      const t = mine.list[Number(del.dataset.del)];
      mine.remove(t);
      del.parentElement!.remove();
      if (!el.querySelector('.st-lib-own')) el.querySelector('.st-lib-mine')?.remove();
      return;
    }
    const b = (e.target as Element).closest<HTMLElement>('.st-lib-item');
    if (!b) return;
    close();
    if (b.dataset.t !== undefined && mine) mine.pick(mine.list[Number(b.dataset.t)]);
    else pick(LIBRARY[Number(b.dataset.c)].items[Number(b.dataset.p)]);
  });
  addEventListener('pointerdown', outside, true);
  addEventListener('keydown', onKey, true);
  items()[0]?.focus({ preventScroll: true });
}
