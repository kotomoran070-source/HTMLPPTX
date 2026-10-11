// Импорт PowerPoint: файл собирается здесь же (pptxgenjs), переводится в слайды и проверяется по объектам
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
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

test('все стандартные фигуры PowerPoint, таблица как в файле, текст разного размера в строке', async () => {
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE';
  const s = p.addSlide();
  for (const [i, n] of ['curvedRightArrow', 'notchedRightArrow', 'stripedRightArrow', 'bentArrow', 'upArrowCallout', 'gear9'].entries()) {
    s.addShape(n as PptxGenJS.SHAPE_NAME, { x: 0.3 + i * 2, y: 0.3, w: 1.5, h: 1, fill: { color: '4472C4' } });
  }
  s.addText([{ text: 'Большой ', options: { fontSize: 40 } }, { text: 'мелкий', options: { fontSize: 20 } }], { x: 1, y: 2, w: 8, h: 1, color: '111111' });
  s.addTable([
    [{ text: 'Имя', options: { bold: true, fill: { color: 'E0B4A4' } } }, { text: 'Число', options: { bold: true, fill: { color: 'E0B4A4' } } }],
    [{ text: 'Альфа', options: { fontSize: 18 } }, { text: '12', options: { align: 'center', fontSize: 12 } }],
    [{ text: 'Бета', options: { fontSize: 18 } }, { text: '7', options: { align: 'center', fontSize: 12 } }],
  ], { x: 1, y: 4, w: 6, colW: [3, 3], rowH: [0.6, 0.8, 0.8], fontSize: 12 });
  const r = await convertPptx((await p.write({ outputType: 'nodebuffer' })) as Buffer, 'Фигуры.pptx');
  // Ни одной фигуры, заменённой прямоугольником: геометрия — по ECMA-376
  expect(r.warnings.filter((w) => /прямоугольником/.test(w))).toEqual([]);
  const free = (r.deck.slides as Obj[])[0].free as Obj[];
  const svgs = free.filter((o) => o.type === 'html' && /<path d="M/.test(o.html));
  expect(svgs.length).toBe(6);
  // Изогнутая стрелка: затенённая изнанка — заливкой с тенью поверх
  expect(svgs[0].html).toContain('fill-opacity');
  // Размер фрагмента — в % от абзаца
  expect(free.find((o) => o.type === 'text')?.text).toBe('Большой {s:50|мелкий}');
  const t = free.find((o) => o.type === 'table')!;
  // Ширина — по столбцам (6 дюймов), выравнивание и шрифт столбцов, высоты строк как в файле
  expect(t.place.w).toBeCloseTo(576, 0);
  expect(t.align).toEqual(['left', 'center']);
  expect(t.columns?.[1]?.size).toBeLessThan(t.size);
  expect(t.headHeight).toBeGreaterThanOrEqual(57);
  expect(t.heights[0]).toBeGreaterThanOrEqual(76);
  expect(t.colors.head).toBe('#E0B4A4');
});

test('пустая ячейка — по концу абзаца; линии в растянутой группе; сжатый автоподгонкой текст', async () => {
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE';
  const s = p.addSlide();
  s.addTable([[{ text: 'X', options: { fontSize: 18 } }, { text: 'Y', options: { fontSize: 18 } }]], { x: 1, y: 1, w: 4, colW: [2, 2], rowH: [0.25] });
  s.addText('Сжатый текст', { x: 1, y: 3, w: 4, h: 1, fontSize: 20, fontFace: 'Arial', fit: 'shrink' });
  const zip = await JSZip.loadAsync((await p.write({ outputType: 'nodebuffer' })) as Buffer);
  const line = (id: number, xfrm: string) => `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="L${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="12700"><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
  // Группа растянута по ширине вдвое: 1 000 000 EMU внутри → 2 000 000 на слайде
  const group = '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="90" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="6000000" y="1000000"/><a:ext cx="2000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="1000000"/></a:xfrm></p:grpSpPr>'
    + line(91, '<a:xfrm><a:off x="500000" y="0"/><a:ext cx="0" cy="1000000"/></a:xfrm>')
    + line(92, '<a:xfrm rot="5400000"><a:off x="0" y="450000"/><a:ext cx="1000000" cy="0"/></a:xfrm>')
    + '</p:grpSp>';
  const name = 'ppt/slides/slide1.xml';
  // Ячейки с пустым фрагментом 18 pt и концом абзаца 4 pt (так пишет Google Slides)
  const xml = (await zip.file(name)!.async('string')).replace(/<a:t>[XY]<\/a:t>/g, '<a:t></a:t>').replace(/<a:endParaRPr lang="en-US" sz="1800"/g, '<a:endParaRPr lang="en-US" sz="400"').replace('</p:spTree>', `${group}</p:spTree>`)
    .replace('<a:normAutofit/>', '<a:normAutofit fontScale="85000" lnSpcReduction="20000"/>');
  zip.file(name, xml);
  const r = await convertPptx(await zip.generateAsync({ type: 'nodebuffer' }), 'Линии.pptx');
  const free = (r.deck.slides as Obj[])[0].free as Obj[];
  // Пустой фрагмент PowerPoint не учитывает: строка — 0,25 дюйма (24 px), а не под 18 pt
  expect(free.find((o) => o.type === 'table')!.heights).toEqual([24]);
  const svg = free.find((o) => o.type === 'html')!.html as string;
  expect(svg).not.toContain('NaN');
  // Повёрнутая на 90° линия тянется растяжением группы по высоте (×1), а не по ширине (×2): 105 px
  const ends = [...svg.matchAll(/d="M0 0 L([\d.]+) ([\d.]+)"/g)].map((m) => [Math.round(+m[1]), Math.round(+m[2])]);
  expect(ends).toEqual([[0, 105], [105, 0]]);
  // Автоподгонка: 85 % размера и интервал на 20 % меньше одинарного (у Arial — 1,15)
  expect(free.find((o) => o.type === 'text')!.styles.text).toMatchObject({ size: 22.7, leading: 0.92 });
});

test('«Под темы Slideria»: картинка фоном — только для темы файла, под ней её тон, слайд перекрашивается', async () => {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 32, height: 18, channels: 3, background: '#203040' } }).png().toBuffer();
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE';
  const s = p.addSlide();
  s.background = { data: `image/png;base64,${png.toString('base64')}` };
  s.addText('Титул', { x: 1, y: 1, w: 8, h: 1, fontSize: 40, color: 'FFFFFF' });
  for (const t of ['Обычный слайд', 'Ещё один']) p.addSlide().addText(t, { x: 1, y: 1, w: 8, h: 1, fontSize: 18, color: '000000' });
  const d = (await convertPptx((await p.write({ outputType: 'nodebuffer' })) as Buffer, 'Фон.pptx', { adapt: true })).deck as Obj;
  const first = d.slides[0];
  expect(first.free[0]).toMatchObject({ type: 'image', locked: true, fileBg: true });
  expect(first.bg).toBe('#203040');
  // Слайд не исключается из перекраски: в другой теме вместо картинки — перекрашенный тон
  expect(first.recolor).toBeUndefined();
  expect(d.origin.colors).toContain('#203040');
  // Фон и текст файла — по слайдам: белый фон большинства и чёрный текст
  expect(d.origin).toMatchObject({ bg: '#FFFFFF', tx: '#000000' });
});

test('«Под темы Slideria»: фон и текст файла — по самим слайдам, а не по схеме темы', async () => {
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE';
  for (const t of ['Тёмный', 'Слайд', 'Ещё']) {
    const s = p.addSlide();
    s.background = { color: '101121' };
    s.addText(t, { x: 1, y: 1, w: 8, h: 1, fontSize: 24, color: 'FFFFFF' });
  }
  const d = (await convertPptx((await p.write({ outputType: 'nodebuffer' })) as Buffer, 'Тёмная.pptx', { adapt: true })).deck as Obj;
  // Схема темы pptxgenjs светлая, но слайды тёмные: тема файла — тёмная, светлый текст
  expect(d.origin).toMatchObject({ bg: '#101121', tx: '#FFFFFF' });
  expect(d.theme.mode).toBe('dark');
});

test('не PPTX — понятная ошибка', async () => {
  await expect(convertPptx(Buffer.from('не архив'), 'x.pptx')).rejects.toThrow();
});
