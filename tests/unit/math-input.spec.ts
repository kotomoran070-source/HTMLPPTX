// Формулы: простая запись → LaTeX, живые числа из ползунков, LaTeX как есть
import { expect, test } from '@playwright/test';
import temml from 'temml';
import { mathTex, texNumber, toTex } from '../../src/engine/math-input';

/** Без лишних пробелов — сравнивать проще */
const t = (s: string) => toTex(s).replace(/\s+/g, ' ').trim();

test('степени, индексы, дроби', () => {
  expect(t('x^2 + y^2 = r^2')).toBe('x^{2} + y^{2} = r^{2}');
  expect(t('x^(n+1)')).toBe('x^{n + 1}');
  expect(t('e^-x')).toBe('e^{-x}');
  expect(t('a_1 + a_max')).toBe('a_{1} + a_{\\mathrm{max}}');
  expect(t('(a+b)/(c+d)')).toBe('\\frac{a + b}{c + d}');
  expect(t('a + b/c')).toBe('a + \\frac{b}{c}');
  expect(t('m v^2/2')).toBe('m \\frac{v^{2}}{2}');
  expect(t('1 / 2')).toBe('\\frac{1}{2}');
  // Дробь в скобках — скобки растягиваются
  expect(t('(1/2)^2')).toBe('\\left(\\frac{1}{2}\\right)^{2}');
});

test('квадратное уравнение целиком', () => {
  expect(t('x = (-b +- sqrt(b^2 - 4ac))/(2a)')).toBe('x = \\frac{- b \\pm \\sqrt{b^{2} - 4ac}}{2a}');
});

test('функции, корни, греческие буквы, знаки', () => {
  expect(t('sin(alpha) <= 1')).toBe('\\sin (\\alpha) \\le 1');
  expect(t('cbrt(8) = 2')).toBe('\\sqrt[3]{8} = 2');
  expect(t('root(n, x)')).toBe('\\sqrt[n]{x}');
  expect(t('√x')).toBe('\\sqrt{x}');
  expect(t('lim_(x->0) sinx/x = 1')).toBe('\\lim _{x \\to 0} \\frac{\\sin x}{x} = 1');
  expect(t('sum_(i=1)^n i = n(n+1)/2')).toBe('\\sum _{i = 1}^{n} i = \\frac{n(n + 1)}{2}');
  expect(t('int_0^1 x^2 dx')).toBe('\\int _{0}^{1} x^{2} \\,dx');
  expect(t('tg x')).toBe('\\operatorname{tg} x');
  expect(t('vec(F) = m*vec(a)')).toBe('\\vec{F} = m \\cdot \\vec{a}');
  expect(t('abs(x) != 0')).toBe('\\left|x\\right| \\ne 0');
  expect(t('30 deg')).toBe('30 ^{\\circ}');
});

test('десятичная запятая, русский текст, кавычки', () => {
  expect(t('g = 9,8')).toBe('g = 9{,}8');
  expect(t('v = 10 м/с')).toBe('v = 10\\ \\frac{\\text{м}}{\\text{с}}');
  expect(t('S = "площадь"')).toBe('S = \\text{площадь}');
  expect(t('t = 5 мин')).toBe('t = 5\\ \\text{мин}');
});

test('несколько строк — столбиком по знаку «=»', () => {
  expect(t('(a+b)^2 = (a+b)(a+b)\n= a^2 + 2ab + b^2')).toBe('\\begin{aligned}(a + b)^{2} &= (a + b)(a + b) \\\\ &= a^{2} + 2ab + b^{2}\\end{aligned}');
});

test('LaTeX — как есть', () => {
  expect(toTex('\\frac{a}{b} + x^2')).toBe('\\frac{a}{b} + x^2');
});

test('живые числа: по ползункам, по-русски, без ползунка — в рамке', () => {
  expect(texNumber(117.6)).toBe('117{,}6');
  expect(texNumber(1500)).toBe('1\\,500');
  expect(texNumber(-2.5)).toBe('-2{,}5');
  expect(mathTex('F = m*a = {{m}}*{{a}} = {{=m*a}}', { m: 12, a: 9.8 }).replace(/\s+/g, ' ')).toBe('F = m \\cdot a = {12} \\cdot {9{,}8} = {117{,}6}');
  expect(mathTex('x^{{n}}', { n: 3 })).toBe('x^{{3}}');
  expect(mathTex('\\frac{{{a}}}{2}', { a: 4 })).toBe('\\frac{{4}}{2}');
  expect(mathTex('y = {{k}}x', {})).toContain('\\boxed{\\text{k}}');
});

test('всё, что выдаёт простая запись, Temml понимает', () => {
  for (const src of ['x = (-b +- sqrt(b^2 - 4ac))/(2a)', 'lim_(x->0) sinx/x = 1', 'sum_(i=1)^n i = n(n+1)/2', 'v = 10 м/с', 'a_max ~= 30 deg',
    '(a+b)^2 = (a+b)(a+b)\n= a^2 + 2ab + b^2', 'vec(AB) + bar(x) + hat(y)', 'S = "площадь" * 2', 'f\'(x) = 3!', 'F = {{m}}*{{a}}']) {
    const tex = mathTex(src, { m: 2, a: 3 });
    expect(() => temml.renderToString(tex, { throwOnError: true }), `${src} → ${tex}`).not.toThrow();
  }
});
