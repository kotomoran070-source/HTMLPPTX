// Формулы в PowerPoint: MathML (Temml) → уравнение Office (OMML); незнакомое — null (останется картинкой)
import { expect, test } from '@playwright/test';
import { DOMParser } from '@xmldom/xmldom';
import temml from 'temml';
import { mathTex } from '../../src/engine/math-input';
import { equationShape, mathToOmml, type MEl } from '../../src/studio/omml';

const macros = { '\\hl': '\\class{hl}{#1}' };
const trust = (c: { command?: string; class?: string }) => c.command === '\\class' && c.class === 'hl';
/** Простая запись → OMML, как при экспорте */
function omml(src: string): string | null {
  const html = temml.renderToString(mathTex(src, { m: 12, a: 9.8 }), { displayMode: true, throwOnError: true, macros, trust });
  const doc = new DOMParser().parseFromString(html, 'text/xml');
  // Цвет наследуется, как в браузере: внутри выделенного — цвет выделения
  const color = (e: MEl): string | undefined => {
    for (let x: MEl | null = e; x && x.nodeType === 1; x = (x as unknown as { parentNode: MEl | null }).parentNode) if ((x.getAttribute('class') ?? '').split(' ').includes('hl')) return '2563EB';
    return undefined;
  };
  return mathToOmml(doc.documentElement as unknown as MEl, { pt: 30, color });
}
/** Корректный XML со всеми пространствами имён, как в слайде */
function wellFormed(xml: string): boolean {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (level: string, msg: string) => { if (level !== 'warning') errors.push(msg); } } as never).parseFromString(
    `<p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${xml}</p:spTree>`, 'text/xml');
  return !!doc.documentElement && !errors.length;
}

test('дроби, степени, корни, суммы, интегралы, пределы — объектами уравнения Office', () => {
  const quad = omml('x = (-b +- sqrt(b^2 - 4ac))/(2a)')!;
  expect(quad).toContain('<m:f><m:num>');
  expect(quad).toContain('<m:rad><m:radPr><m:degHide m:val="1"/>');
  expect(quad).toContain('<m:sSup><m:e>');
  // Буквы — математическим курсивом, как пишет сам PowerPoint; знаки — прямо
  expect(quad).toContain('>𝑥</m:t>');
  expect(quad).toContain('>±</m:t>');
  const sum = omml('sum_(i=1)^n i = n(n+1)/2')!;
  expect(sum).toMatch(/<m:nary><m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/><\/m:naryPr><m:sub>.*<\/m:sub><m:sup>.*<\/m:sup><m:e>.*𝑖.*<\/m:e><\/m:nary>/);
  expect(omml('int_0^1 x^2 dx')).toContain('<m:chr m:val="∫"/><m:limLoc m:val="subSup"/>');
  expect(omml('lim_(x->0) sinx/x = 1')).toContain('<m:limLow>');
  expect(omml('cbrt(8)')).toContain('<m:deg><m:r>');
  for (const s of ['x = (-b +- sqrt(b^2 - 4ac))/(2a)', 'sum_(i=1)^n i = n(n+1)/2', 'lim_(x->0) sinx/x = 1', 'vec(F) = m*vec(a)', 'v = 10 м/с']) {
    expect(wellFormed(omml(s)!), s).toBe(true);
  }
});

test('скобки, матрица, система, столбик по «=», выделение и зачёркивание, живые числа', () => {
  expect(omml('(1/2)^2')).toContain('<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr>');
  const mat = omml('A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')!;
  expect(mat).toContain('<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="2"/>');
  expect(mat.match(/<m:mr>/g)).toHaveLength(2);
  const sys = omml('\\begin{cases} x + y = 5 \\\\ x - y = 1 \\end{cases}')!;
  expect(sys).toContain('<m:begChr m:val="{"/><m:endChr m:val=""/>');
  expect(sys).toContain('<m:eqArr>');
  const col = omml('(a+b)^2 = (a+b)(a+b)\n= a^2 + 2ab + b^2')!;
  expect(col.match(/<m:aln\/>/g)).toHaveLength(2);
  const hl = omml('a^2 + [[2ab]] + ~~b~~')!;
  expect(hl).toContain('<a:srgbClr val="2563EB"/>');
  expect(hl).toContain('<m:strikeBLTR m:val="1"/>');
  // Русский текст и единицы — прямо, не курсивом
  expect(omml('v = 10 м/с')).toContain('<m:sty m:val="p"/>');
  expect(omml('F = {{=m*a}} Н')).toContain('117,6');
  for (const s of ['(1/2)^2', 'A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '(a+b)^2 = (a+b)(a+b)\n= a^2 + 2ab + b^2', 'a^2 + [[2ab]] + ~~b~~']) {
    expect(wellFormed(omml(s)!), s).toBe(true);
  }
});

test('незнакомое — null (формула останется картинкой); фигура-уравнение с картинкой запасной', () => {
  const doc = new DOMParser().parseFromString('<math><mmultiscripts><mi>x</mi></mmultiscripts></math>', 'text/xml');
  expect(mathToOmml(doc.documentElement as unknown as MEl, { pt: 30 })).toBeNull();
  const shape = equationShape('5', '<a:xfrm><a:off x="1" y="2"/><a:ext cx="3" cy="4"/></a:xfrm>', omml('x^2')!, 'ctr', '<p:pic><p:nvPicPr><p:cNvPr id="5" name="x"/></p:nvPicPr></p:pic>');
  expect(shape).toMatch(/^<mc:AlternateContent[^>]*><mc:Choice xmlns:a14="[^"]+" Requires="a14"><p:sp>.*<a14:m><m:oMathPara .*<\/mc:Choice><mc:Fallback><p:pic>/);
  expect(wellFormed(shape)).toBe(true);
});
