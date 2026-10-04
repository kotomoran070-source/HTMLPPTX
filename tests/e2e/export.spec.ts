// Экспорт: один HTML-файл (для показа и с правкой) открывается без сервера; PowerPoint — настоящий PPTX
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import { DECKS, counter, readDeck, watchErrors } from './helpers';

const OUT = path.resolve('.tmp', 'test-export');

async function exportHtml(mode: 'clean' | 'edit'): Promise<string> {
  const r = await fetch(`http://localhost:5190/__htmlpptx/export?deck=tpl&mode=${mode}`, { method: 'POST' });
  const html = await r.text();
  if (!r.ok) throw new Error(html);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `tpl-${mode}.html`);
  fs.writeFileSync(file, html);
  return file;
}

test('HTML для показа: один файл, без сервера, все слайды, без режима правки', async ({ page }) => {
  test.setTimeout(180_000);
  const file = await exportHtml('clean');
  const html = fs.readFileSync(file, 'utf8');
  // Внутри всё: никаких ссылок на файлы рядом
  expect(html).not.toMatch(/src="\.?\/?assets\//);
  expect(html).not.toContain('/@fs/');

  const errors = watchErrors(page);
  await page.goto(pathToFileURL(file).href + '#1');
  await expect(page.locator('#ct')).toHaveText(/^1 из \d+$/);
  const [, n] = await counter(page);
  expect(n).toBeGreaterThan(15);
  for (let i = 2; i <= n; i++) {
    await page.keyboard.press('PageDown');
    await expect(page.locator('#ct')).toHaveText(`${i} из ${n}`);
  }
  await expect(page.locator('#ed-btn')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('HTML с правкой: есть режим правки', async ({ page }) => {
  test.setTimeout(180_000);
  const file = await exportHtml('edit');
  await page.goto(pathToFileURL(file).href + '#1');
  await expect(page.locator('#ct')).toHaveText(/^1 из/);
  await expect(page.locator('#ed-btn')).toHaveCount(1);
});

test('PowerPoint: файл PPTX со всеми слайдами и заметками', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?deck=tpl&studio');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  const slides = (readDeck('tpl').match(/^ {2}- id: /gm) ?? []).length;
  await page.locator('[data-cmd="file.export"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 150_000 }),
    page.locator('[data-x="pptx"]').click(),
  ]);
  expect(download.suggestedFilename()).toBe('tpl.pptx');
  const file = path.join(OUT, 'tpl.pptx');
  fs.mkdirSync(OUT, { recursive: true });
  await download.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files);
  const pptSlides = names.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  expect(pptSlides.length).toBeGreaterThan(15);
  expect(pptSlides.length).toBe(slides);
  // Заметки докладчика уходят в PowerPoint
  expect(names.some((f) => /^ppt\/notesSlides\//.test(f))).toBe(true);
  // Тексты — текстом, а не картинкой (слайд «Коротко о главном» другие тесты не правят)
  const xml = (await Promise.all(pptSlides.map((f) => zip.file(f)!.async('string')))).join('');
  expect(xml).toContain('Коротко о');
  expect(xml).toContain('1,2 млн');
});

test('PowerPoint обратно: экспорт шаблона импортируется с теми же слайдами и текстами', async ({ page }) => {
  test.setTimeout(120_000);
  // Файл из предыдущего теста; если его запускали отдельно — его нет
  const file = path.join(OUT, 'tpl.pptx');
  test.skip(!fs.existsSync(file), 'нужен tpl.pptx из теста экспорта');
  const slides = (readDeck('tpl').match(/^ {2}- id: /gm) ?? []).length;
  const post = async (q: string, body: Uint8Array | string) => {
    const r = await fetch(`http://localhost:5190/__htmlpptx/import-pptx?${q}`, { method: 'POST', body });
    return { status: r.status, json: await r.json() };
  };
  // Не PPTX — понятная ошибка, ничего не создаётся
  const bad = await post('file=x.pptx&dry=1', 'hello');
  expect(bad.status).toBe(400);
  expect(bad.json.error).toMatch(/PowerPoint/);

  const data = new Uint8Array(fs.readFileSync(file));
  const dry = await post('file=tpl.pptx&deck=tpl-back&dry=1', data);
  expect(dry.json).toMatchObject({ name: 'tpl-back', slides, dryRun: true });
  expect(fs.existsSync(path.join(DECKS, 'tpl-back'))).toBe(false);

  const r = await post('file=tpl.pptx&deck=tpl-back', data);
  expect(r.json.name).toBe('tpl-back');
  const yaml = readDeck('tpl-back');
  expect((yaml.match(/^ {2}- id: /gm) ?? []).length).toBe(slides);
  expect(yaml).toContain('Коротко о');
  expect(yaml).toContain('1,2 млн');

  // Открывается без ошибок
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl-back#1');
  await expect(page.locator('#ct')).toHaveText(`1 из ${slides}`);
  await expect(page.locator('.slide.on .free').first()).toBeVisible();
  expect(errors).toEqual([]);
});
