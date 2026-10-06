import { expect, test } from '@playwright/test';
import { customMarker, listCss } from '../../src/engine/text-style';

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
