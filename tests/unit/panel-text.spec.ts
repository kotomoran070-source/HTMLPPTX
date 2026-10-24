// Панель свойств: пояснения и подсказки короткие — длинные тексты превращают панель в кашу
import { expect, test } from '@playwright/test';
import { BLOCKS, TEMPLATES, type Field } from '../../src/studio/schema';

test('пояснения и подсказки полей короткие, номера — не «с нуля»', () => {
  const long: string[] = [];
  const walk = (fs: Field[]) => fs.forEach((f) => {
    const hint = 'hint' in f ? f.hint ?? '' : '';
    if (hint.length > 70 || /с нуля/i.test(hint)) long.push(`${f.k}: ${hint}`);
    if (f.label.length > 32) long.push(`${f.k}: ${f.label}`);
    if ('fields' in f) walk(f.fields);
  });
  for (const s of [...Object.values(BLOCKS), ...Object.values(TEMPLATES)]) {
    if ((s.about ?? '').length > 80) long.push(s.about!);
    walk(s.fields);
  }
  expect(long).toEqual([]);
});
