// Готовый проигрыватель для экспорта (server/player.ts): вариант по презентации, кэш вариантов и его отпечаток,
// собранные с программой варианты, сборка один раз на вариант; файл из проигрывателя и данных (server/core.ts) —
// данные в настоящий <body>, а не в такую же строку в коде, «$» в тексте не портится, вид и анимации,
// блок лицензий. Сборку здесь заменяет подставной запуск: без Vite
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createDecksCore, type Runner } from '../../server/core';
import { replaceTag } from '../../server/deck-files';
import { createPlayers, finishFile, keepMotion, sourceHash, variantId, variantOf, VARIANTS } from '../../server/player';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Как собранный проигрыватель: код в <head>, и в нём — строки, похожие на теги страницы */
const page = (id: string) => '<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<title>Презентация</title>\n'
  + `<script type="module">const v=${JSON.stringify(id)};const t="<head><title>x</title><body></body>";@media (prefers-reduced-motion: reduce){}</script>\n`
  + '<style>@media (prefers-reduced-motion: reduce){.a{animation:none}}</style>\n</head>\n<body>\n</body>\n</html>\n';

/** Подставная сборка: пишет вариант и список библиотек туда, куда просит player.ts */
function fakeRunner(log: string[], fail = false): Runner {
  return async (script, args) => {
    const id = args.find((a) => a.startsWith('--player='))!.slice(9);
    const out = args.find((a) => a.startsWith('--out='))!.slice(6);
    log.push(id);
    expect(path.basename(script)).toBe('build.mjs');
    await new Promise((r) => setTimeout(r, 20));
    if (fail) return { code: 1, stderr: 'шаг 1\nшаг 2\nне собралось: нет модуля' };
    fs.writeFileSync(out, page(id));
    fs.writeFileSync(out.replace(/\.html$/, '.json'), JSON.stringify({ packages: [{ name: 'lib-a', version: '1.0.0', license: 'MIT', text: 'Цена: $$ и $& остаются' }] }));
    return { code: 0, stderr: '' };
  };
}

let tmp = '';
test.beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-player-'));
});
test.afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('вариант — по блокам презентации: 3D и формулы только если есть', () => {
  expect(variantOf('slides:\n  - free:\n      - {type: text}\n', false)).toEqual({ edit: false, model: false, math: false });
  expect(variantOf('slides:\n  - free:\n      - type: model\n        src: ./a.glb\n', true)).toEqual({ edit: true, model: true, math: false });
  expect(variantOf('slides:\n  - free: [{type: "math", tex: x}]\n', false)).toEqual({ edit: false, model: false, math: true });
  // Похожие имена — не тот блок
  expect(variantOf('slides:\n  - free: [{type: models}, {type: mathx}]\n', false)).toEqual({ edit: false, model: false, math: false });
  expect(variantId({ edit: true, model: true, math: true })).toBe('edit-3d-math');
  expect(variantId({ edit: false, model: false, math: true })).toBe('show-math');
  expect(new Set(VARIANTS.map(variantId)).size).toBe(8);
});

test('кэш: вариант собирается один раз, одновременные экспорты ждут одну сборку', async () => {
  const root = path.join(tmp, 'app');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export {};');
  const log: string[] = [];
  const cache = path.join(tmp, 'cache');
  const players = createPlayers({ root, cache, run: fakeRunner(log) });
  const v = { edit: false, model: true, math: false };
  const [a, b] = await Promise.all([players.get(v), players.get(v)]);
  expect(log).toEqual(['show-3d']);
  expect(a.html).toContain('"show-3d"');
  expect(b.html).toBe(a.html);
  expect(a.packages.map((p) => p.name)).toEqual(['lib-a']);
  // Второй экспорт — из кэша; другой вариант — своя сборка
  await players.get(v);
  await players.get({ edit: true, model: false, math: false });
  expect(log).toEqual(['show-3d', 'edit']);
  expect(JSON.parse(fs.readFileSync(path.join(cache, 'manifest.json'), 'utf8'))).toEqual({ hash: sourceHash(root), variants: ['show-3d', 'edit'] });
  // Новый экземпляр (перезапуск программы) берёт кэш с диска
  await createPlayers({ root, cache, run: fakeRunner(log) }).get(v);
  expect(log).toEqual(['show-3d', 'edit']);
});

test('кэш: код программы поменялся — варианты собираются заново, устаревшие удаляются', async () => {
  const root = path.join(tmp, 'app');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export const a = 1;');
  const log: string[] = [];
  const cache = path.join(tmp, 'cache');
  const players = createPlayers({ root, cache, run: fakeRunner(log) });
  await players.get({ edit: true, model: false, math: false });
  await players.get({ edit: false, model: false, math: false });
  const before = sourceHash(root);
  // Файлы вне исходников проигрывателя отпечаток не меняют
  fs.writeFileSync(path.join(root, 'notes.txt'), 'заметки');
  expect(sourceHash(root)).toBe(before);
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export const a = 2;');
  expect(sourceHash(root)).not.toBe(before);
  await players.get({ edit: true, model: false, math: false });
  expect(log).toEqual(['edit', 'show', 'edit']);
  expect(JSON.parse(fs.readFileSync(path.join(cache, 'manifest.json'), 'utf8')).variants).toEqual(['edit']);
  expect(fs.existsSync(path.join(cache, 'show.html'))).toBe(false);
});

test('собранные с программой варианты: без сборки и без проверки отпечатка', async () => {
  const root = path.join(tmp, 'app');
  const pre = path.join(root, 'player');
  fs.mkdirSync(pre, { recursive: true });
  fs.writeFileSync(path.join(pre, 'show.html'), page('готовый'));
  fs.writeFileSync(path.join(pre, 'show.json'), JSON.stringify({ packages: [] }));
  fs.writeFileSync(path.join(pre, 'manifest.json'), JSON.stringify({ prebuilt: true, variants: ['show'] }));
  const log: string[] = [];
  const players = createPlayers({ root, cache: path.join(tmp, 'cache'), run: fakeRunner(log) });
  expect((await players.get({ edit: false, model: false, math: false })).html).toContain('"готовый"');
  expect(log).toEqual([]);
  // Варианта нет среди готовых — собирается в кэш
  await players.get({ edit: true, model: false, math: false });
  expect(log).toEqual(['edit']);
});

test('сборка не удалась — понятная ошибка с концом её вывода, следующая попытка собирает снова', async () => {
  const log: string[] = [];
  const players = createPlayers({ root: path.join(tmp, 'app'), cache: path.join(tmp, 'cache'), run: fakeRunner(log, true) });
  await expect(players.get({ edit: false, model: false, math: false })).rejects.toThrow('шаг 1 шаг 2 не собралось: нет модуля');
  await expect(players.get({ edit: false, model: false, math: false })).rejects.toThrow();
  expect(log).toEqual(['show', 'show']);
});

test('теги страницы — вне кода: replaceTag не трогает такие же строки в <script> и <style>', () => {
  const html = page('x');
  const out = replaceTag(html, /<body>/, () => '<body data-x="$&">');
  expect(out).toContain('<body data-x="$&">\n</body>');
  expect(out).toContain('const t="<head><title>x</title><body></body>"');
  expect(replaceTag(html, /<title>.*?<\/title>/, () => '<title>$$</title>')).toContain('<title>$$</title>\n<script');
  expect(replaceTag('<p>нет</p>', /<body>/, () => 'x')).toBe('<p>нет</p>');
});

test('файл: вид слайдов, анимации при «Уменьшить движение», лицензии со знаком «$»', () => {
  const t = { html: '', packages: [{ name: 'lib-a', version: '1.0.0', license: 'MIT', text: 'Цена: $$ и $& остаются' }] };
  const plain = finishFile(page('x'), t, ROOT, {});
  expect(plain).not.toContain('data-slideria-look');
  expect(plain).toContain('prefers-reduced-motion');
  const notice = /<script type="text\/plain" id="slideria-licenses">([\s\S]*?)<\/script>\n<\/body>\n<\/html>/.exec(plain)?.[1] ?? '';
  expect(notice).toContain('lib-a');
  expect(notice).toContain('Цена: $$ и $& остаются');
  // Блок лицензий — перед последним </body>, не в строке кода
  expect(plain).toContain('<body></body>";');

  const same = finishFile(page('x'), t, ROOT, { look: 'dark', motion: true });
  expect(same).toMatch(/^<!DOCTYPE html>\n<html data-slideria-look="dark" lang="ru">/);
  expect(same).not.toContain('prefers-reduced-motion');
  expect(keepMotion('@media (prefers-reduced-motion:reduce){} @media ( prefers-reduced-motion : no-preference ){}')).toBe('@media not all{} @media all{}');
});

test('экспорт ядра: данные, имя и заголовок — в страницу проигрывателя, «$$» в тексте не портится', async () => {
  const dir = path.join(tmp, 'decks');
  fs.mkdirSync(path.join(dir, 'formulas'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'formulas', 'deck.yaml'), 'title: "Цены $$ и $&"\nlang: en\nslides:\n  - free: [{type: math, tex: "$$x$$"}]\n');
  const log: string[] = [];
  const core = createDecksCore({ dir, root: ROOT, playerCache: path.join(tmp, 'cache'), hooks: { run: fakeRunner(log) } });
  const html = (await core.exportHtml('formulas', { clean: true })).toString('utf8');
  expect(log).toEqual(['show-math']);
  expect(html).toContain('<html lang="en">');
  expect(html).toContain('<title>Цены $$ и $&amp;</title>');
  expect(html).toContain('<meta name="slideria-deck" content="formulas">');
  // Данные — сразу после настоящего <body>; строки в коде проигрывателя не тронуты
  expect(html).toMatch(/<\/head>\n<body>\n<script type="application\/json" id="htmlpptx-deck">/);
  expect(html).toContain('const t="<head><title>x</title><body></body>"');
  const data = /<script type="application\/json" id="htmlpptx-deck">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  expect(data).toContain('"$$x$$"');
  // С правкой — другой вариант
  await core.exportHtml('formulas', { clean: false });
  expect(log).toEqual(['show-math', 'edit-math']);
});
