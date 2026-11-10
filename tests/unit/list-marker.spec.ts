import { expect, test } from '@playwright/test';
import { customMarker, itemListCss, listCss, listToken } from '../../src/engine/text-style';
import { t } from '../../src/engine/html';
import { SEL_A, SEL_B, setListKindAt, toggleListAt } from '../../src/engine/editor/serialize';

test('свой маркер: # — номер пункта, текст вокруг — строками CSS', () => {
  expect(listCss('Шаг #:')).toContain('--li-mark:"Шаг " counter(md-li) ":"');
  expect(listCss('#')).toContain('--li-mark:counter(md-li);');
  expect(listCss('★')).toContain('--li-mark:"★"');
});

test('свой маркер: кавычки, ; и обратная косая черта не проходят — CSS не ломается', () => {
  for (const bad of ['"', 'a;b', 'x\\', '', '   ', 'слишком-длинный-маркер']) expect(customMarker(bad)).toBeNull();
  expect(listCss('a;color:red')).toBe('');
  // Встроенные виды — не «свои»
  expect(customMarker('num')).toBeNull();
});

test('цвет маркера: цвет темы или #RRGGBB, остальное пропускается', () => {
  expect(listCss(undefined, 'muted')).toBe('--li-c:var(--mu)');
  expect(listCss('dash', '#16A34A')).toContain('--li-c:#16A34A');
  expect(listCss(undefined, 'red;x')).toBe('');
});

test('список — у строк под курсором, как в Word: у одной строки маркер ставится и убирается, остальные не трогаются', () => {
  const A = SEL_A;
  const B = SEL_B;
  // Курсор во второй строке — пунктом становится только она
  expect(toggleListAt(`Один\nДв${A}${B}а\nТри`)).toBe(`Один\n- Дв${A}${B}а\nТри`);
  // Курсор в пункте списка — маркер уходит только у него
  expect(toggleListAt(`- Один\n- Д${A}${B}ва\n- Три`)).toBe(`- Один\nД${A}${B}ва\n- Три`);
  // Выделение на двух строках: одна уже пункт — пунктами становятся обе
  expect(toggleListAt(`О${A}дин\n- Дв${B}а\nТри`)).toBe(`- О${A}дин\n- Дв${B}а\nТри`);
  // …обе пункты — у обеих снимается
  expect(toggleListAt(`- О${A}дин\n- Дв${B}а\nТри`)).toBe(`О${A}дин\nДв${B}а\nТри`);
  // Протянули до самого начала следующей строки — она не задета
  expect(toggleListAt(`${A}Один\n${B}Два`)).toBe(`- ${A}Один\n${B}Два`);
  // Пустые строки в выделении — без маркера
  expect(toggleListAt(`${A}Один\n\nДва${B}`)).toBe(`- ${A}Один\n\n- Два${B}`);
  // Без меток (курсора в поле нет) — все строки
  expect(toggleListAt('Один\nДва')).toBe('- Один\n- Два');
});

test('вид маркера у строки: «-[вид] текст» — свой вид поверх вида поля, нумеруются только нумерованные; римские', () => {
  const html = t('-[num] Один\n- Точка\n-[roman] Два\n-[★] Звезда\n-[img:./assets/m.png] Значок');
  expect(html).toContain('<span class="md-li" data-li="num" style="');
  expect(html).toContain('<span class="md-li">Точка</span>');
  expect(html).toContain('counter(md-li-roman, upper-roman)');
  expect(html).toContain('data-li="★"');
  expect(html).toContain('url(&quot;./assets/m.png&quot;)');
  // Вид строки сначала возвращает маркер по умолчанию (иначе взял бы вид поля), счёт — только у нумерующих
  expect(itemListCss('dot')).toContain('--li-inc:none');
  expect(itemListCss('num')).toMatch(/--li-inc:none;.*--li-inc:md-li/);
  expect(itemListCss('roman')).toContain('--li-inc:md-li-roman');
  expect(listCss('roman-lower')).toContain('lower-roman');
  expect(listCss('Шаг #:')).toContain('--li-inc:md-li');
  expect(listCss('★')).not.toContain('--li-inc');
  // Вида нет — строка как есть, не пункт
  expect(t('-[нет такого вида] текст')).not.toContain('md-li');
  expect(listToken('img:"x')).toBe(false);
  expect(listToken('a]b')).toBe(false);
});

test('вид маркера — строкам под курсором; все пункты одного вида — вид всего поля, свои у строк убираются', () => {
  const A = SEL_A;
  const B = SEL_B;
  // Курсор во второй строке списка с точками — нумерация только у неё
  expect(setListKindAt(`- Один\n- Д${A}${B}ва\n- Три`, 'num', 'dot')).toEqual({ markup: `- Один\n-[num] Д${A}${B}ва\n- Три`, field: null });
  // Строка не пункт — становится пунктом этого вида
  expect(setListKindAt(`- Один\nД${A}${B}ва`, 'roman', 'dot')).toEqual({ markup: `- Один\n-[roman] Д${A}${B}ва`, field: null });
  // Вид поля — у строки без своего вида
  expect(setListKindAt(`-[num] О${A}${B}дин\n- Два`, 'dot', 'dot').markup).toBe(`- О${A}${B}дин\n- Два`);
  // Все пункты стали одного вида — он становится видом поля
  expect(setListKindAt(`-[num] Один\n- Д${A}${B}ва`, 'num', 'dot')).toEqual({ markup: `- Один\n- Д${A}${B}ва`, field: 'num' });
  // Без меток — все строки
  expect(setListKindAt('Один\n\nДва', 'alpha', 'dot')).toEqual({ markup: '- Один\n\n- Два', field: 'alpha' });
  // «Список» снимает пункт вместе с его видом
  expect(toggleListAt(`-[num] О${A}${B}дин\n- Два`)).toBe(`О${A}${B}дин\n- Два`);
});
