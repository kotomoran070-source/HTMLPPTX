// Импорт своего HTML (plugins/html-import.ts): класс секции — у слайда, свободный объект заполняет свою рамку,
// отчёт говорит о стилях, которые после импорта ни к чему не применяются
import { expect, test } from '@playwright/test';
import { fromSlidesHtml } from '../../plugins/html-import';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const page = (css: string, body: string) => `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`;
type Free = { html: string; place: Record<string, number> };

test('класс секции — у слайда; объект с размером заполняет рамку, картинка — блоком', () => {
  const { deck, warnings } = fromSlidesHtml(page('.slide .title{font-size:48px} .dark .title{color:#fff} .slide .photo{object-fit:cover}', `
    <section class="slide dark active" data-id="a" style="background:#0B1220">
      <h1 class="title" style="position:absolute; left:64px; top:60px; width:900px">Заголовок</h1>
      <img class="photo" src="${PNG}" style="position:absolute; left:64px; top:200px; width:194px; height:242px">
      <div class="panel" style="position:absolute; left:400px; top:200px; width:500px; height:300px"><p>Текст</p></div>
      <svg width="120" height="80" viewBox="0 0 120 80" style="position:absolute; left:900px; top:200px"><rect width="120" height="80"/></svg>
    </section>
    <section class="slide" data-id="b"><h2 class="title">Без свободных</h2></section>`));
  expect(warnings).toEqual([]);
  const [a, b] = deck.slides;
  // Состояние самодельного движка (active) — не класс слайда
  expect(a.class).toBe('dark');
  expect(b.class).toBeUndefined();
  const free = a.free as Free[];
  expect(free[0].html).toContain('style="width: 100%"');
  expect(free[1].place).toEqual({ x: 64, y: 200, w: 194, h: 242 });
  expect(free[1].html).toContain('style="width: 100%; height: 100%; display: block"');
  expect(free[2].html).toContain('style="width: 100%; height: 100%"');
  // У svg размер — из атрибутов
  expect(free[3].place).toEqual({ x: 900, y: 200, w: 120, h: 80 });
});

test('отчёт: правило оформляло элементы в файле, а после импорта не находит ничего', () => {
  const css = '.slide .title{font-size:48px} section:first-of-type .note{color:red} .unused{color:blue} .slide [data-enter="rise"]{animation:none}';
  const { warnings } = fromSlidesHtml(page(css, `
    <section class="slide"><p class="note" style="position:absolute; left:10px; top:10px; width:300px" data-enter="rise">Сноска</p>
      <h1 class="title" style="position:absolute; left:10px; top:60px; width:600px">Заголовок</h1></section>`));
  // Не применилось только правило, которое и в файле что-то оформляло; data-enter забирает себе движок
  expect(warnings).toEqual([expect.stringMatching(/стили не нашли, к чему применяться после импорта \(1\): section:first-of-type \.note/)]);
});
