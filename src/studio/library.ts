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
/** Тариф: название, цена, что входит; выделенный — с рамкой акцента */
const plan = (name: string, price: string, items: string[], top = false) => ({
  type: 'card', ...(top ? { style: 'border:2px solid var(--ac);box-shadow:0 18px 40px color-mix(in srgb, var(--ac) 18%, transparent)' } : {}),
  body: [eyebrow(top ? `${name} · выбор клиентов` : name), line(price, { size: 40, weight: 800 }), bullets(items, 'check', 17)],
});
/**
 * Дизайнерский блок: вёрстка с классами kt-* (components/html/kit.css) в цветах темы. Тексты
 * (data-t) и фото (data-i) правятся прямо на слайде, как у импорта из Claude Design
 */
const kit = (html: string, texts: string[], photos = 0) => ({ type: 'html', html, texts, ...(photos ? { images: Array.from({ length: photos }, () => ({ src: '' })) } : {}) });
/** Редактируемый текст вёрстки: номер в texts, своё оформление и класс */
const T = (i: number, style = '', cls = '', tag = 'div') => `<${tag} data-t="${i}"${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}></${tag}>`;
const HEAD = 'font-family:var(--font-head, var(--font))';
/** Формула: простая запись или LaTeX (блок math) */
const eq = (tex: string, size?: number, color?: string): Block => ({ type: 'math', tex, ...(size ? { size } : {}), ...(color ? { color } : {}) });

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
      {
        name: 'Заголовок с градиентом', w: 900, pw: 520, make: () => kit(
          `<div>${T(0, `${HEAD};display:inline-block;font-size:68px;font-weight:800;line-height:1.05`, 'kt-grad')}<svg class="kt-swoosh" viewBox="0 0 400 22" preserveAspectRatio="none"><path pathLength="1" d="M4 16C110 3 290 3 396 12"/></svg>${T(1, 'margin-top:16px;font-size:24px;line-height:1.4;color:var(--tx2)')}</div>`,
          ['Рост, который видно', 'Подзаголовок: одна строка о главном'],
        ),
      },
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
      { name: 'Градиентная плашка', w: 360, h: 120, make: () => ({ type: 'shape', fill: 'gradient', shadow: 'sm', text: 'Ключевая мысль', styles: { text: { size: 24 } } }) },
      { name: 'Метка', w: 200, h: 44, make: () => ({ type: 'shape', kind: 'pill', fill: 'soft', stroke: 'accent', width: 1, text: 'метка', styles: { text: { size: 15 } } }) },
      { name: 'Зона пунктиром', w: 420, h: 240, make: () => ({ type: 'shape', fill: 'none', stroke: 'border', width: 2, dash: 'dash', radius: 20 }) },
      {
        name: 'Стеклянная карточка', w: 560, h: 340, pw: 360, make: () => kit(
          `<div class="kt-glass"><i class="kt-blob a"></i><i class="kt-blob b"></i><div class="kt-pane">${T(0, '', 'kt-eyebrow')}${T(1, `${HEAD};font-size:32px;font-weight:700;line-height:1.15`)}${T(2, 'font-size:18px;line-height:1.45;color:var(--tx2)')}</div></div>`,
          ['Новое', 'Карточка из матового стекла', 'Цветные пятна под ней плавают в цветах темы.'],
        ),
      },
      {
        name: 'Карточка со свечением', w: 440, h: 250, pw: 340, make: () => kit(
          `<div class="kt-glow"><div>${T(0, '', 'kt-eyebrow')}${T(1, `${HEAD};font-size:28px;font-weight:700;line-height:1.2`)}${T(2, 'font-size:17px;line-height:1.45;color:var(--tx2)')}</div></div>`,
          ['Главное', 'По рамке бежит свет', 'Выделит одну карточку среди остальных.'],
        ),
      },
      { name: 'Бейдж «в эфире»', w: 280, pw: 220, make: () => kit(`<div class="kt-live"><span class="kt-dot"></span>${T(0, '', '', 'span')}</div>`, ['Сейчас в работе']) },
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
        name: 'Число в ореоле', w: 340, h: 340, pw: 240, make: () => kit(
          `<div class="kt-halo"><i></i><i></i><i></i><div>${T(0, `${HEAD};font-size:76px;font-weight:800;line-height:1`, 'kt-grad')}${T(1, 'margin-top:8px;font-size:18px;color:var(--mu)')}</div></div>`,
          ['98 %', 'клиентов довольны'],
        ),
      },
      {
        name: 'Число и кривая роста', w: 560, pw: 380, make: () => kit(
          `<div>${T(0, '', 'kt-eyebrow')}${T(1, `${HEAD};display:inline-block;margin:8px 0 2px;font-size:84px;font-weight:800;line-height:1`, 'kt-grad')}${T(2, 'font-size:19px;color:var(--tx2)')}`
          + '<svg class="kt-spark" viewBox="0 0 560 124" style="margin-top:22px"><defs><linearGradient id="kt-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0"/><stop offset="1"/></linearGradient></defs>'
          + '<path class="ar" fill="url(#kt-fill)" d="M8 104C60 100 90 88 140 90S220 74 270 70S350 62 390 48S470 34 548 14L548 124L8 124Z"/>'
          + '<path class="ln" pathLength="1" d="M8 104C60 100 90 88 140 90S220 74 270 70S350 62 390 48S470 34 548 14"/><circle cx="548" cy="14" r="7"/></svg></div>',
          ['Выручка за год', '+38 %', 'рост к прошлому году'],
        ),
      },
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
    name: 'Уравнения',
    icon: 'sigma',
    items: [
      // Двойной щелчок по формуле на слайде — правка: простая запись (x^2, a/b, sqrt(x)) или LaTeX
      { name: 'Квадратное уравнение', w: 620, make: () => eq('x = (-b +- sqrt(b^2 - 4ac))/(2a)', 48) },
      { name: 'Теорема Пифагора', w: 420, make: () => eq('a^2 + b^2 = c^2', 48) },
      { name: 'Дробь', w: 300, make: () => eq('(a + b)/c', 48) },
      { name: 'Корень', w: 340, make: () => eq('sqrt(x^2 + y^2)', 48) },
      { name: 'Сумма', w: 460, make: () => eq('sum_(i=1)^n i = n(n+1)/2') },
      { name: 'Интеграл', w: 420, make: () => eq('int_0^1 x^2 dx = 1/3') },
      { name: 'Предел', w: 400, make: () => eq('lim_(x->0) sinx/x = 1') },
      { name: 'Производная', w: 600, make: () => eq("f'(x) = lim_(h->0) (f(x+h) - f(x))/h", 36) },
      { name: 'Тождество Эйлера', w: 360, make: () => eq('e^(i pi) + 1 = 0', 48) },
      { name: 'Система', w: 300, make: () => eq('\\begin{cases} x + y = 5 \\\\ x - y = 1 \\end{cases}') },
      { name: 'Матрица', w: 340, make: () => eq('A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}') },
      // По шагам: строки открываются по щелчку при показе
      { name: 'Решение по шагам', w: 380, make: () => ({ ...eq('2x + 6 = 10\n2x = 4\nx = [[2]]', 40), steps: 'lines' }) },
      // Превращение: одинаковые части перелетают из строки в строку
      { name: 'Превращение', w: 640, make: () => ({ ...eq('(a+b)^2\n= (a+b)(a+b)\n= a^2 + ab + ba + b^2\n= a^2 + [[2ab]] + b^2', 44), steps: 'morph' }) },
      { name: 'Сокращение', w: 420, make: () => eq('(~~3~~ * 7)/(~~3~~ * 5) = [[7/5]]', 48) },
      {
        // Живые числа: формула считает по ползункам и пересчитывается при показе
        name: 'Живая формула', w: 760, pw: 520, make: () => ({
          type: 'stack', gap: 22,
          items: [
            { type: 'grid', columns: 2, gap: 16, items: [
              { type: 'control', name: 'm', label: 'Масса', min: 1, max: 50, step: 1, value: 12, unit: ' кг' },
              { type: 'control', name: 'a', label: 'Ускорение', min: 0.5, max: 20, step: 0.5, value: 9.8, unit: ' м/с²' },
            ] },
            eq('F = m*a = {{m}}*{{a}} = {{=m*a}} Н', 44, 'accent'),
          ],
        }),
      },
      {
        name: 'Живая площадь круга', w: 640, pw: 480, make: () => ({
          type: 'stack', gap: 22,
          items: [
            { type: 'control', name: 'r', label: 'Радиус', min: 1, max: 20, step: 0.5, value: 5, unit: ' см' },
            eq('S = pi r^2 = pi * {{r}}^2 ~= {{=pi*r^2}} см^2', 44, 'accent'),
          ],
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
        name: 'Доли', w: 620, pw: 420, make: () => ({
          type: 'card', title: 'Выручка по каналам', body: { type: 'donut', values: [1.42, 0.95, 0.61, 0.42], labels: ['Сайт', 'Партнёры', 'Магазины', 'Прочее'], center: '3,4', sub: 'млн ₽ за год', unit: ' млн' },
        }),
      },
      {
        name: 'Рейтинг', w: 620, pw: 420, make: () => ({
          type: 'card', title: 'Откуда приходят клиенты', body: { type: 'hbars', values: [38, 24, 17, 12, 9], labels: ['Рекомендации', 'Поиск', 'Соцсети', 'Реклама', 'Выставки'], unit: ' %' },
        }),
      },
      {
        name: 'Спидометр', w: 420, pw: 300, make: () => ({
          type: 'card', title: 'План года', body: { type: 'gauge', value: 78, unit: ' %', label: 'выполнено, цель — 85 %', target: 85 },
        }),
      },
      {
        name: 'Кольца целей', w: 560, pw: 400, make: () => ({
          type: 'card', title: 'Цели квартала', body: { type: 'rings', values: [92, 74, 58], labels: ['Продажи', 'Новые клиенты', 'Удержание'] },
        }),
      },
      {
        name: 'Столбцы по годам', w: 720, pw: 480, make: () => ({
          type: 'card', title: 'Выручка по кварталам, млн ₽', body: { type: 'columns', labels: ['I кв.', 'II кв.', 'III кв.', 'IV кв.'], series: [{ name: '2025', values: [2.1, 2.4, 2.2, 2.9] }, { name: '2026', values: [2.6, 3.1, 3.3, 3.8] }] },
        }),
      },
      {
        name: 'Столбцы стопкой', w: 720, pw: 480, make: () => ({
          type: 'card', title: 'Заказы по месяцам', body: {
            type: 'columns', stacked: true, labels: ['Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт'],
            series: [{ name: 'Сайт', values: [120, 132, 128, 150, 164, 181] }, { name: 'Приложение', values: [64, 70, 82, 91, 104, 118] }, { name: 'Офис', values: [30, 28, 31, 27, 29, 26] }],
          },
        }),
      },
      {
        name: 'Несколько линий', w: 760, pw: 500, make: () => ({
          type: 'card', title: 'Активные пользователи, тыс', body: {
            type: 'lines', labels: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен'],
            series: [{ name: 'Веб', values: [42, 44, 47, 46, 52, 55, 58, 61, 66] }, { name: 'Телефон', values: [18, 21, 25, 30, 33, 38, 41, 47, 52] }],
          },
        }),
      },
      {
        name: 'Круговая', w: 480, pw: 340, make: () => ({ type: 'donut', hole: 0, values: [55, 30, 15], labels: ['Москва', 'Регионы', 'Другие страны'], unit: ' %' }),
      },
      {
        name: 'Панель показателей', w: 1120, pw: 760, make: () => ({
          type: 'grid', columns: '1.4fr 1fr', items: [
            { type: 'card', title: 'Выручка и расходы, млн ₽', body: { type: 'lines', labels: ['Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт'], series: [{ name: 'Выручка', values: [2.1, 2.3, 2.2, 2.6, 2.9, 3.1, 3.4] }, { name: 'Расходы', values: [1.6, 1.7, 1.7, 1.8, 1.9, 2.0, 2.1] }] } },
            { type: 'card', title: 'Структура расходов', body: { type: 'donut', values: [48, 27, 15, 10], labels: ['Зарплаты', 'Реклама', 'Аренда', 'Прочее'], unit: ' %', legend: 'bottom', center: '2,1', sub: 'млн ₽ в октябре' } },
          ],
        }),
      },
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
      // Функция по формуле; кнопка «График» в правке формулы делает такой же рядом с ней
      { name: 'График функции', w: 560, pw: 420, make: () => ({ type: 'plot', fn: 'sin(x)', x: [-6.2832, 6.2832] }) },
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
        name: 'Тарифы', w: 1080, pw: 760, make: () => ({
          type: 'grid', columns: 3, align: 'stretch', items: [
            plan('Старт', '990 ₽', ['5 презентаций', 'Экспорт в PDF']),
            plan('Команда', '2 490 ₽', ['Без ограничений', 'Общие темы', 'Пульт с телефона'], true),
            plan('Компания', 'по запросу', ['Свой сервер', 'Поддержка 24/7']),
          ],
        }),
      },
      {
        name: 'Команда', w: 1080, h: 380, pw: 720, make: () => kit(
          `<div class="kt-team">${[0, 1, 2, 3].map((k) => `<div class="kt-person"><span class="kt-ava"><img data-i="${k}" alt=""></span>${T(k * 3, `${HEAD};font-size:22px;font-weight:700;line-height:1.2`)}${T(k * 3 + 1, '', 'kt-role')}${T(k * 3 + 2, 'font-size:15px;line-height:1.4;color:var(--mu)')}</div>`).join('')}</div>`,
          ['Анна Смирнова', 'руководитель', 'Ведёт проект и отвечает за сроки', 'Игорь Ким', 'дизайн', 'Интерфейсы и фирменный стиль', 'Мария Лебедева', 'аналитика', 'Цифры, гипотезы и отчёты', 'Олег Петров', 'разработка', 'Архитектура и запуск'], 4,
        ),
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
        name: 'Итоги вокруг логотипа', w: 1040, pw: 760, make: () => ({
          type: 'hub', items: [
            { title: 'Первый итог', text: 'Пояснение' }, { title: 'Второй итог', text: 'Пояснение' },
            { title: 'Третий итог', text: 'Пояснение' }, { title: 'Четвёртый итог', text: 'Пояснение' },
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
        name: 'Дорожная карта', w: 1080, h: 380, pw: 700, make: () => kit(
          '<div class="kt-road"><svg viewBox="0 0 1080 360" preserveAspectRatio="none"><path class="bg" d="M20 260C80 260 100 230 150 230S300 110 400 110S580 230 680 230S850 110 930 110S1030 150 1060 150"/>'
          + '<path class="fg" pathLength="1" d="M20 260C80 260 100 230 150 230S300 110 400 110S580 230 680 230S850 110 930 110S1030 150 1060 150"/></svg>'
          + [[13.9, 60.3], [37, 26.9], [63, 60.3], [86.1, 26.9]].map(([x, y], k) => `<div class="kt-mile" style="left:${x}%;top:${y}%"><i></i>${T(k * 2, '', 'kt-eyebrow')}${T(k * 2 + 1, `${HEAD};margin-top:6px;font-size:21px;font-weight:700;line-height:1.2`)}</div>`).join('')
          + '</div>',
          ['I квартал', 'Исследование', 'II квартал', 'Прототип', 'III квартал', 'Пилот', 'IV квартал', 'Запуск'],
        ),
      },
      {
        name: 'Лестница роста', w: 900, h: 400, pw: 560, make: () => kit(
          `<div class="kt-steps">${[0, 1, 2, 3].map((k) => `<div>${T(k * 2, `${HEAD};font-size:30px;font-weight:800;line-height:1`, 'kt-grad')}${T(k * 2 + 1, 'font-size:16px;line-height:1.3;color:var(--tx2)')}<b></b></div>`).join('')}</div>`,
          ['2023', 'старт', '2024', '×2 клиентов', '2025', 'новые рынки', '2026', 'лидер ниши'],
        ),
      },
      {
        name: 'Орбиты', w: 760, h: 520, pw: 480, make: () => kit(
          `<div class="kt-orbit"><i class="ring r2"></i><i class="ring r1"></i><div class="kt-core">${T(0, `${HEAD};font-size:30px;font-weight:800;line-height:1.1`)}${T(1, 'font-size:15px;opacity:.85')}</div>`
          + [[17, 18], [83, 22], [13, 78], [86, 80]].map(([x, y], k) => T(k + 2, `left:${x}%;top:${y}%`, 'kt-tag')).join('') + '</div>',
          ['Продукт', 'в центре всего', 'Клиенты', 'Партнёры', 'Данные', 'Команда'],
        ),
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
        name: 'Фото с числом', w: 840, h: 470, make: () => ({
          type: 'group', base: { w: 840, h: 470 }, items: [
            { type: 'image', src: '', radius: 24, place: { x: 0, y: 0, w: 740, h: 430 } },
            { type: 'card', style: 'box-shadow:0 20px 50px rgba(2,6,23,.22)', body: stat('+38 %', 'рост за год', 'рекорд'), place: { x: 540, y: 270, w: 300 } },
          ],
        }),
      },
      {
        name: 'Фото в рамке', w: 560, h: 400, pw: 360, make: () => kit(`<div class="kt-framed"><img data-i="0" alt=""><div class="kt-live"><span class="kt-dot"></span>${T(0, '', '', 'span')}</div></div>`, ['Наш офис в Казани'], 1),
      },
      {
        name: 'Коллаж веером', w: 960, h: 480, pw: 600, make: () => kit(
          `<div class="kt-fan">${[0, 1, 2].map((k) => `<figure><img data-i="${k}" alt="">${T(k, '', '', 'figcaption')}</figure>`).join('')}</div>`,
          ['Первое фото', 'Второе фото', 'Третье фото'], 3,
        ),
      },
      { name: 'Окно браузера', w: 760, h: 470, pw: 480, make: () => kit(`<div class="kt-browser"><div class="kt-bar"><i></i><i></i><i></i>${T(0, '', '', 'span')}</div><img class="kt-shot" data-i="0" alt=""></div>`, ['slideria.app'], 1) },
      { name: 'Телефон', w: 300, h: 600, pw: 170, make: () => kit('<div class="kt-phone"><img data-i="0" alt=""></div>', [], 1) },
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
  // Раздел длиннее трёх строк (в галерее вкладки «Вставка» — четырёх: там разделы по одному)
  // не растягивает панель вниз: остальное листается вбок
  const nav = (d: number) => `<button type="button" class="st-bdnav" data-nav="${d}" aria-label="${d < 0 ? 'Листать влево' : 'Листать вправо'}" tabindex="-1">${icon(d < 0 ? 'prev' : 'next')}</button>`;
  el.innerHTML = own + order.map((ci) => LIBRARY[ci]).map((c, k) => {
    const ci = order[k];
    const rail = c.items.length > (c.compact ? 7 : 4) * (only ? 4 : 3);
    const grid = `<div class="st-lib-grid${c.compact ? ' compact' : ''}${rail ? ' rail' : ''}">${c.items.map((p, pi) =>
      `<button type="button" class="st-lib-item" data-c="${ci}" data-p="${pi}" title="Вставить: ${esc(p.name)}"><span class="st-lib-slot">${p.glyph ? `<svg class="st-lib-glyph" viewBox="0 0 48 32" aria-hidden="true">${p.glyph}</svg>` : ''}</span><span class="st-lib-name">${esc(p.name)}</span></button>`).join('')}</div>`;
    return `<section><h4>${icon(c.icon)}<span>${esc(c.name)}</span></h4>${rail ? `<div class="st-lib-rail">${nav(-1)}${grid}${nav(1)}</div>` : grid}</section>`;
  }).join('');
  document.body.appendChild(el);
  el.querySelectorAll<HTMLElement>('.st-lib-rail').forEach((rail) => {
    const grid = rail.querySelector<HTMLElement>('.st-lib-grid')!;
    const ends = () => {
      rail.querySelector('[data-nav="-1"]')?.classList.toggle('off', grid.scrollLeft < 4);
      rail.querySelector('[data-nav="1"]')?.classList.toggle('off', grid.scrollLeft > grid.scrollWidth - grid.clientWidth - 4);
    };
    grid.addEventListener('scroll', ends, { passive: true });
    rail.querySelectorAll<HTMLElement>('[data-nav]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      grid.scrollBy({ left: Number(b.dataset.nav) * grid.clientWidth, behavior: 'smooth' });
    }));
    requestAnimationFrame(ends);
  });
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
    // Ближайшая карточка в сторону стрелки: так же и в разделах, что листаются вбок
    const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]!;
    const at = (b: HTMLElement) => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const [x0, y0] = at(list[i]);
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    for (const b of list) {
      const [x, y] = at(b);
      const along = (x - x0) * dx + (y - y0) * dy;
      if (along < 4) continue;
      const d = along + Math.abs(dx ? y - y0 : x - x0) * 3;
      if (d < bestD) { bestD = d; best = b; }
    }
    best?.focus();
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
