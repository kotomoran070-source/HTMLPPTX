import { expect, test } from '@playwright/test';
import { customMarker, listCss } from '../../src/engine/text-style';
import { SEL_A, SEL_B, toggleListAt } from '../../src/engine/editor/serialize';

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
