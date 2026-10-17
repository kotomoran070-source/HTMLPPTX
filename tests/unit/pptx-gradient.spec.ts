// Градиенты и PowerPoint: CSS → a:gradFill при экспорте, градиент текста из файла → {g:…|…} при импорте
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { convertPptx } from '../../plugins/pptx/convert';
import { GradientMarks, gradFillXml, parseCssGradient } from '../../src/studio/pptx-gradient';
import { parseTextGradient } from '../../src/engine/gradients';

test('вычисленный CSS-градиент → точки, места и направление; узоры и картинки — нет', () => {
  const g = parseCssGradient('linear-gradient(135deg, rgb(79, 70, 229), rgb(234, 88, 12) 30%, rgba(14, 165, 233, 0.5))')!;
  expect(g.radial).toBe(false);
  expect(g.angle).toBe(135);
  expect(g.stops).toEqual([{ hex: '4F46E5', a: 1, pos: 0 }, { hex: 'EA580C', a: 1, pos: 0.3 }, { hex: '0EA5E9', a: 0.5, pos: 1 }]);
  // Без мест — поровну; color(srgb …) после color-mix
  const e = parseCssGradient('linear-gradient(to right, color(srgb 1 0 0), rgb(0, 255, 0), rgb(0, 0, 255))')!;
  expect(e.angle).toBe(90);
  expect(e.stops.map((s) => [s.hex, s.pos])).toEqual([['FF0000', 0], ['00FF00', 0.5], ['0000FF', 1]]);
  expect(parseCssGradient('radial-gradient(circle at 50% 40%, rgb(0, 0, 0), rgb(255, 255, 255))')?.radial).toBe(true);
  expect(parseCssGradient('linear-gradient(rgb(0, 0, 0), rgb(1, 1, 1)), url("x.png")')).toBeNull();
  expect(parseCssGradient('repeating-linear-gradient(90deg, rgb(0, 0, 0) 0px, rgb(1, 1, 1) 4px)')).toBeNull();
  expect(parseCssGradient('url("x.png")')).toBeNull();
});

test('a:gradFill: места в стотысячных, прозрачность с учётом opacity, 0° PowerPoint — слева направо', () => {
  const x = gradFillXml(parseCssGradient('linear-gradient(90deg, rgb(255, 0, 0), rgba(0, 0, 255, 0.5) 100%)')!, 0.8);
  expect(x).toBe('<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"><a:alpha val="80000"/></a:srgbClr></a:gs>'
    + '<a:gs pos="100000"><a:srgbClr val="0000FF"><a:alpha val="40000"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="0" scaled="0"/></a:gradFill>');
  expect(gradFillXml(parseCssGradient('linear-gradient(180deg, rgb(0, 0, 0), rgb(1, 1, 1))')!)).toContain('<a:lin ang="5400000"');
  // Метка в XML слайда меняется на градиент — с прозрачностью внутри метки и без
  const m = new GradientMarks();
  const a = m.mark('<G1/>');
  const b = m.mark('<G2/>');
  expect(m.swap(`<a:solidFill><a:srgbClr val="${a}"/></a:solidFill>|<a:solidFill><a:srgbClr val="${b}"><a:alpha val="50000"/></a:srgbClr></a:solidFill>|<a:solidFill><a:srgbClr val="112233"/></a:solidFill>`))
    .toBe('<G1/>|<G2/>|<a:solidFill><a:srgbClr val="112233"/></a:solidFill>');
});

test('градиент текста из PowerPoint — со всеми точками и направлением, а не первым цветом', async () => {
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE';
  const marks = new GradientMarks();
  const rainbow = marks.mark(gradFillXml(parseCssGradient('linear-gradient(90deg, rgb(249, 115, 22), rgb(236, 72, 153) 40%, rgb(124, 58, 237))')!));
  const gold = marks.mark(gradFillXml(parseCssGradient('linear-gradient(180deg, rgb(255, 215, 0), rgb(184, 134, 11))')!));
  const s = p.addSlide();
  s.addText([{ text: 'Обычный ' }, { text: 'радуга', options: { color: rainbow } }, { text: ' и ' }, { text: 'золото', options: { color: gold } }], { x: 1, y: 1, w: 8, h: 1, fontSize: 32, color: '111827' });
  const zip = await JSZip.loadAsync(await p.write({ outputType: 'nodebuffer' }) as Buffer);
  const name = 'ppt/slides/slide1.xml';
  zip.file(name, marks.swap(await zip.file(name)!.async('string')));
  const r = await convertPptx(await zip.generateAsync({ type: 'nodebuffer' }), 'Градиент.pptx');
  const text = ((r.deck.slides as Record<string, any>[])[0].free as Record<string, any>[]).find((o) => o.type === 'text')!.text as string;
  const codes = [...text.matchAll(/\{(g:[^|]+)\|([^}]*)\}/g)].map((m) => [m[1], m[2]]);
  expect(codes).toEqual([['g:#F97316,#EC4899@40,#7C3AED', 'радуга'], ['g:180deg,#FFD700,#B8860B', 'золото']]);
  expect(parseTextGradient(codes[1][0])).toEqual({ from: '#FFD700', to: '#B8860B', angle: 180 });
});
