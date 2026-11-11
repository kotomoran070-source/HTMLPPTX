import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Правила «при наведении» в стилях слайдов и страницы выбора — по классу, не по тегу и не «> *».
 * Браузер собирает все правила с :hover в одно: если хоть одно из них — «.x:hover b» или «.x:hover > *», то при
 * любом наведении (курсор вошёл в ленту, ушёл с карточки) пересчитываются все b (или вообще все элементы) внутри
 * элемента под курсором. На странице выбора это сотни элементов в миниатюрах — заметная запинка.
 * Исключения: таблица (td) и «Список» редактора — их мало и они вне миниатюр ленты
 */
const ROOTS = ['src/components', 'src/engine/picker.css'];
const ALLOW = [/^\.tbl(-cards)? tbody tr:hover > td/, /^\.donut:has\(/];

function cssFiles(p: string): string[] {
  if (!fs.statSync(p).isDirectory()) return p.endsWith('.css') ? [p] : [];
  return fs.readdirSync(p).flatMap((n) => cssFiles(path.join(p, n)));
}

test('наведение не заставляет пересчитывать все элементы одного тега внутри', () => {
  const bad: string[] = [];
  for (const file of ROOTS.flatMap(cssFiles)) {
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{/g)) {
      const head = m[1].trim();
      if (head.startsWith('@')) continue;
      for (const raw of head.split(/,(?![^(]*\))/)) {
        const sel = raw.trim().replace(/\s+/g, ' ');
        if (ALLOW.some((r) => r.test(sel))) continue;
        // Составные части через пробел и > ~ + (но не внутри скобок)
        const parts = sel.split(/\s*(?:[>~+]|\s)\s*(?![^(]*\))/).filter(Boolean);
        const at = parts.findIndex((c) => /:hover\b/.test(c.replace(/:not\([^)]*\)/g, '')));
        if (at < 0 || at === parts.length - 1) continue;
        // Последняя часть — та, что пересчитывается: нужен класс или id (в :is(…) — у каждого варианта)
        const last = parts.at(-1)!.replace(/::?[\w-]+(?!\()/g, '');
        const is = /^:is\((.*)\)$/.exec(last);
        const ok = is ? is[1].split(',').every((v) => /[.#]/.test(v)) : /[.#]/.test(last.replace(/:is\([^)]*\)|:not\([^)]*\)/g, ''));
        if (!ok) bad.push(`${file}: ${sel}`);
      }
    }
  }
  expect(bad).toEqual([]);
});
