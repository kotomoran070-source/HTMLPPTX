// Стили презентации (src/engine/deck-css.ts): секция файла — это и слайд движка, и корень вёрстки в нём.
// «.slide .x» и «.dark .x» — элементы всего слайда (и свободные объекты); «.slide { … }» — раскладка корню вёрстки,
// слайду — только цвет, шрифт и фон; классы секции — у слайда (slide.class)
import { expect, test } from '@playwright/test';
import { mapSelector, scopeCss, slideClasses } from '../../src/engine/deck-css';

const DARK = new Set(['dark']);

test('секция в начале селектора — весь слайд, и вёрстка, и свободные объекты', () => {
  expect(mapSelector('.slide .title').sel).toBe('&.slide .title');
  expect(mapSelector('section.slide h1').sel).toBe('&.slide h1');
  expect(mapSelector('body .slide .x').sel).toBe('&.slide .x');
  // Класс секции: у слайда; у презентаций, импортированных раньше, — у корня вёрстки
  expect(mapSelector('.slide.dark .body', DARK).sel).toBe(':is(&.slide.dark, & .slide-root.dark) .body');
  expect(mapSelector('.dark .body', DARK).sel).toBe(':is(&.dark, & .dark) .body');
  // Дети секции — дети корня вёрстки и элементы свободных объектов
  expect(mapSelector('.slide > .card').sel).toBe(':is(& .slide-root, &.slide > .free > .html-block > .html-inner) > .card');
  // «Слайд показан» у самодельных движков — показанный слайд движка
  expect(mapSelector('.slide.active .fade').sel).toBe(':is(&.slide:is(.on, .out), &:is(.on, .out) .slide-root) .fade');
  expect(mapSelector('.active .fade').sel).toBe('&:is(.on, .out) .fade');
});

test('правило самой секции: раскладка — корню вёрстки, слайду — только безопасное', () => {
  expect(mapSelector('.slide')).toEqual({ sel: '.slide-root', slide: '&.slide' });
  expect(mapSelector('.dark', DARK)).toEqual({ sel: '.dark', slide: '&.dark' });
  const css = scopeCss('.slide { display:grid; gap:24px; position:relative; opacity:0; transition:opacity .3s; background:var(--bg); color:var(--tx); font-family:Georgia; --gap:8px }', '.s', undefined, DARK);
  const slideRule = /&\.slide\{([^}]*)\}/.exec(css)![1];
  expect(slideRule).toBe('background:var(--bg);color:var(--tx);font-family:Georgia;--gap:8px');
  // Корню вёрстки — всё, как раньше
  expect(css).toMatch(/\.slide-root:not\([^{]*\{ display:grid; gap:24px; position:relative; opacity:0;/);
});

test('остальное — как было: классы без секции, соседи, «.deck .slide»', () => {
  expect(mapSelector('.title').sel).toBe('.title');
  // dark — не класс секций этой презентации: обычный класс
  expect(mapSelector('.dark .body').sel).toBe('.dark .body');
  expect(mapSelector('.dark.title', DARK).sel).toBe('.dark.title');
  expect(mapSelector('.deck .slide .x').sel).toBe('.deck .slide-root .x');
  expect(mapSelector('.slide + .slide').sel).toBe('.slide-root + .slide-root');
  expect(mapSelector('.slide::before').sel).toBe('.slide-root::before');
  expect(mapSelector(':root').sel).toBe('&');
});

test('классы слайда: только свои имена, без служебных и состояний', () => {
  expect(slideClasses('dark hero')).toEqual(['dark', 'hero']);
  expect(slideClasses('slide on active canvas-slide dark 1bad x"y')).toEqual(['dark']);
  expect(slideClasses(undefined)).toEqual([]);
});
