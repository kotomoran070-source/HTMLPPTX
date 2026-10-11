// Импорт PowerPoint: файл собирается здесь же (pptxgenjs), переводится в слайды и проверяется по объектам
import { expect, test } from '@playwright/test';
import PptxGenJS from 'pptxgenjs';
import { convertPptx } from '../../plugins/pptx/convert';

type Obj = Record<string, any>;

async function sample(): Promise<Buffer> {
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE'; // 13,33 × 7,5 дюйма → 1280 × 720
  p.title = 'Проверка импорта';
  const s1 = p.addSlide();
  s1.background = { color: '1E293B' };
  s1.addText('Заголовок слайда', { x: 1, y: 0.5, w: 8, h: 1, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Arial' });
  s1.addText([{ text: 'Обычный ' }, { text: 'жирный', options: { bold: true } }, { text: ' текст' }], { x: 1, y: 2, w: 8, h: 1, fontSize: 18, color: 'E2E8F0' });
  s1.addShape(p.ShapeType.ellipse, { x: 10, y: 1, w: 2, h: 2, fill: { color: 'F97316' } });
  s1.addShape(p.ShapeType.line, { x: 1, y: 4, w: 6, h: 0, line: { color: '38BDF8', width: 3, endArrowType: 'triangle' } });
  s1.addText('01', { x: 1, y: 5, w: 1, h: 0.6, fontSize: 28, valign: 'bottom', color: 'FFFFFF' });
  s1.addNotes('Заметка докладчика');
  const s2 = p.addSlide();
  s2.addTable([
    [{ text: 'Этап', options: { bold: true, fill: { color: '1F3B4D' }, color: 'FFFFFF' } }, { text: 'Срок', options: { bold: true, fill: { color: '1F3B4D' }, color: 'FFFFFF' } }],
    [{ text: 'Запуск', options: { bold: true } }, { text: [{ text: '● готово', options: { color: '16A34A' } }] }],
    ['Рост', 'Июнь'],
  ], { x: 1, y: 1, w: 8, colW: [4, 4], fontSize: 14 });
  s2.addShape(p.ShapeType.rect, { x: 0, y: 8, w: 1, h: 1, fill: { color: 'FF0000' } }); // за краем слайда — не переносится
  return (await p.write({ outputType: 'nodebuffer' })) as Buffer;
}

test('PPTX → холсты со свободными объектами', async () => {
  const r = await convertPptx(await sample(), 'Проверка.pptx');
  expect(r.slides).toBe(2);
  expect(r.title).toBe('Проверка импорта');
  const slides = r.deck.slides as Obj[];
  expect(slides.every((s) => s.template === 'canvas')).toBe(true);

  const [a, b] = slides.map((s) => s.free as Obj[]);
  const title = a.find((o) => o.type === 'text' && /Заголовок слайда/.test(o.text));
  expect(title).toBeTruthy();
  expect(title.styles.text).toMatchObject({ color: '#FFFFFF', weight: 700 });
  // 40 pt при 96 px на дюйм: 53,3 px
  expect(title.styles.text.size).toBeCloseTo(53.3, 0);
  expect(title.place.x).toBeCloseTo(96, 0);
  // Жирный фрагмент — разметкой внутри строки
  expect(a.some((o) => o.type === 'text' && o.text.includes('**жирный**'))).toBe(true);
  expect(a.find((o) => o.type === 'shape' && o.kind === 'ellipse')).toMatchObject({ fill: '#F97316' });
  expect(a.find((o) => o.type === 'shape' && o.kind === 'arrow')).toMatchObject({ stroke: '#38BDF8' });
  // Текст по низу рамки — valign: лишнее уходит вверх, как в PowerPoint
  expect(a.find((o) => o.type === 'text' && o.text === '01')).toMatchObject({ valign: 'bottom' });
  expect(slides[0].notes).toContain('Заметка докладчика');
  expect(slides[0].bg).toBe('#1E293B');

  const table = b.find((o) => o.type === 'table');
  expect(table.header).toEqual(['Этап', 'Срок']);
  expect(JSON.stringify(table)).toContain('Июнь');
  // Жирная подпись строки и цветная метка в ячейке не теряются
  expect(table.rows[0]).toEqual(['**Запуск**', '{#16A34A|● готово}']);
  expect(table.colors?.head).toBe('#1F3B4D');
  expect(b.some((o) => o.fill === '#FF0000')).toBe(false);
});

test('«Под темы Slideria»: палитра файла, шрифты — шрифтами темы, фон темы не пишется у слайда', async () => {
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE';
  for (const t of ['Первый', 'Второй']) {
    const s = p.addSlide();
    s.background = { color: 'FFFFFF' };
    s.addText(t, { x: 1, y: 0.5, w: 8, h: 1, fontSize: 40, bold: true, color: '3C388D', fontFace: 'Verdana' });
    s.addText('Текст слайда', { x: 1, y: 2, w: 8, h: 1, fontSize: 18, color: '000000', fontFace: 'Calibri' });
    s.addShape(p.ShapeType.rect, { x: 10, y: 6, w: 2, h: 0.5, fill: { color: '3C388D' } });
  }
  const file = (await p.write({ outputType: 'nodebuffer' })) as Buffer;
  // Как в файле (по умолчанию): цвета и шрифты как есть, палитры для тем нет
  const plain = (await convertPptx(file, 'Тема.pptx')).deck as Obj;
  expect(plain.origin).toBeUndefined();
  expect(plain.slides[0].free.find((o: Obj) => o.type === 'text').styles.text.font).toBe('Verdana');
  const r = await convertPptx(file, 'Тема.pptx', { adapt: true });
  const d = r.deck as Obj;
  expect(d.theme).toMatchObject({ preset: 'file', accent: '#3C388D', mode: 'light', light: { bg: '#FFFFFF', tx: '#000000' }, font: 'Calibri', head: 'Verdana', bg: 'plain' });
  expect(d.origin).toMatchObject({ bg: '#FFFFFF', tx: '#000000', accents: ['#3C388D'] });
  expect(d.origin.colors).toEqual(expect.arrayContaining(['#3C388D', '#000000']));
  expect(d.origin.theme.preset).toBeUndefined();
  const free = d.slides[0].free as Obj[];
  // Шрифт заголовка и текста — от темы: у объектов не записан
  expect(free.filter((o) => o.type === 'text').map((o) => o.styles.text.font)).toEqual([undefined, undefined]);
  // Белый фон слайда = фон темы
  expect(d.slides[0].bg).toBeUndefined();
});

test('не PPTX — понятная ошибка', async () => {
  await expect(convertPptx(Buffer.from('не архив'), 'x.pptx')).rejects.toThrow();
});
