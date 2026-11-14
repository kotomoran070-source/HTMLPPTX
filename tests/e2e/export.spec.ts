// Экспорт: один HTML-файл (для показа и с правкой) открывается без сервера; PowerPoint — настоящий PPTX
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { expect, test } from '@playwright/test';
import { DECKS, counter, nextTo, readDeck, watchErrors, exportAs } from './helpers';

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
  // Лицензии встроенных библиотек — в самом файле (на странице не видны)
  const notice = /<script type="text\/plain" id="slideria-licenses">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  expect(notice).toContain('qrcode-generator');
  expect(notice).toContain('Permission is hereby granted');
  // Без «Как на этом компьютере» — как у системы зрителя
  expect(html).toContain('prefers-reduced-motion');

  const errors = watchErrors(page);
  await page.goto(pathToFileURL(file).href + '#1');
  await expect(page.locator('#ct')).toHaveText(/^1 из \d+$/);
  const [, n] = await counter(page);
  expect(n).toBeGreaterThan(15);
  for (let i = 2; i <= n; i++) {
    await nextTo(page, i);
    await expect(page.locator('#ct')).toHaveText(`${i} из ${n}`);
  }
  await expect(page.locator('#ed-btn')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('компактный HTML: картинки в WebP, файл не больше обычного', async () => {
  test.setTimeout(180_000);
  const get = async (q: string) => {
    const r = await fetch(`http://localhost:5190/__htmlpptx/export?deck=tpl&mode=clean${q}`, { method: 'POST' });
    expect(r.ok).toBe(true);
    return r.text();
  };
  const [plain, compact] = [await get(''), await get('&quality=compact')];
  expect(compact.length).toBeLessThanOrEqual(plain.length);
  // Крупных PNG / JPEG / GIF нет: длина считается по самим данным картинки (за ней в строке идёт остальной код)
  expect(compact).not.toMatch(/data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/=]{200000}/);
});

test('«Как на этом компьютере»: вид слайдов автора и анимации при «Уменьшить движение» у зрителя', async ({ page }) => {
  test.setTimeout(120_000);
  const r = await fetch('http://localhost:5190/__htmlpptx/export?deck=auto&mode=clean&look=dark&motion=1', { method: 'POST' });
  const html = await r.text();
  expect(r.ok).toBe(true);
  // Стили и код не спрашивают систему про «Уменьшить движение»: запросов (в скобках, как в CSS и matchMedia) нет.
  // Само слово остаётся в коде стоп-кадров вставок (import-ui.ts, still) — это замена текста, а не запрос
  expect(html).not.toMatch(/\(\s*prefers-reduced-motion/);
  const file = path.join(OUT, 'auto-same.html');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, html);
  const errors = watchErrors(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(file).href + '#1');
  await expect(page.locator('#ct')).toHaveText('1 из 3');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // T переключает, как обычно
  await page.keyboard.press('t');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
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
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 150_000 }),
    exportAs(page, 'pptx'),
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
  // У мастера заметок — своя тема: с общей темой мастера слайдов настольный PowerPoint файл не открывает
  const themeOf = async (rels: string) => /Target="\.\.\/theme\/(theme\d+\.xml)"/.exec(await zip.file(rels)!.async('string'))?.[1];
  const noteTheme = await themeOf('ppt/notesMasters/_rels/notesMaster1.xml.rels');
  expect(noteTheme).toBeTruthy();
  expect(noteTheme).not.toBe(await themeOf('ppt/slideMasters/_rels/slideMaster1.xml.rels'));
  expect(names).toContain(`ppt/theme/${noteTheme}`);
  expect(await zip.file('[Content_Types].xml')!.async('string')).toContain(`PartName="/ppt/theme/${noteTheme}"`);
  // Картинки — в форматах любого PowerPoint с 2007-го: WebP шаблона уходит в PNG или JPEG (WebP открывают только новые версии)
  expect(names.filter((f) => /^ppt\/media\/.*\.(webp|avif)$/i.test(f))).toEqual([]);
  // Тексты — текстом, а не картинкой (слайд «Коротко о главном» другие тесты не правят)
  const xml = (await Promise.all(pptSlides.map((f) => zip.file(f)!.async('string')))).join('');
  expect(xml).toContain('Коротко о');
  expect(xml).toContain('1,2 млн');
  // Пункты списков — маркерами абзацев, цветные метки таблиц — своим цветом
  expect(xml).toContain('<a:buChar char="&#x2022;"/>');
  expect(xml).toMatch(/<a:srgbClr val="16A34A"\/><\/a:solidFill>[^]*?<a:t>● готово<\/a:t>/);
  // Размеры — без потерь: заголовок 32 px = 24 pt ровно
  expect(xml).toContain('sz="2400"');
  // Градиенты фигур и выделенных слов — градиентами PowerPoint (а не картинкой и не одним цветом), меток не осталось
  expect(xml).toMatch(/<p:spPr>(?:(?!<\/p:spPr>)[\s\S])*<a:gradFill rotWithShape="1"><a:gsLst>/);
  expect(xml).toMatch(/<a:rPr\b[^>]*>(?:(?!<\/a:rPr>)[\s\S])*<a:gradFill/);
  expect(xml).not.toMatch(/srgbClr val="01[7-9A-F][0-9A-F]{3}"/);
});

test('PowerPoint 2007: формулы картинками, без расширений новых версий; обычный PPTX — с уравнениями Office', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?deck=math&studio#2');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  fs.mkdirSync(OUT, { recursive: true });
  const parts = async (kind: 'pptx' | 'pptx2007', name: string) => {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 100_000 }), exportAs(page, kind)]);
    expect(download.suggestedFilename()).toBe(name);
    const file = path.join(OUT, name);
    await download.saveAs(file);
    await page.keyboard.press('Escape');
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const xml = Object.keys(zip.files).filter((f) => /\.xml$/.test(f));
    return { zip, all: (await Promise.all(xml.map((f) => zip.file(f)!.async('string')))).join('\n') };
  };
  const now = await parts('pptx', 'math.pptx');
  expect(now.all).toContain('<a14:m>');
  const old = await parts('pptx2007', 'math-2007.pptx');
  // Те же слайды, формулы — картинками с подписью
  const slides = (z: JSZip) => Object.keys(z.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
  expect(slides(old.zip)).toBe(slides(now.zip));
  expect(old.all).toMatch(/<p:pic>(?:(?!<\/p:pic>)[\s\S])*descr="Формула"/);
  // Ничего из PowerPoint 2010 и новее
  for (const s of ['mc:AlternateContent', '<a14:', '<p14:', '<p15:', '<thm15:', 'extLst>']) expect(old.all).not.toContain(s);
});

test('PowerPoint: стоп-кадр живой вставки — и у той, что рисует только в кадрах анимации; текст карточки после пустой строки переносится', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?deck=pptxstill&studio');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 100_000 }), exportAs(page, 'pptx')]);
  const file = path.join(OUT, 'pptxstill.pptx');
  fs.mkdirSync(OUT, { recursive: true });
  await download.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
  const rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string');
  const media = Object.fromEntries([...rels.matchAll(/Id="(rId\d+)"[^>]*Target="\.\.\/media\/([^"]+)"/g)].map((m) => [m[1], m[2]]));
  // Снимки вставок (фон слайда — картинкой во всю ширину — не в счёт), слева направо
  const pics = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map(([x]) => ({
    x: Number(/<a:off x="(\d+)"/.exec(x)![1]), w: Number(/<a:ext cx="(\d+)"/.exec(x)![1]), file: media[/r:embed="(rId\d+)"/.exec(x)![1]],
  })).filter((p) => p.w < 1280 * 9525 / 2).sort((a, b) => a.x - b.x);
  expect(pics).toHaveLength(2);
  const center = async (f: string) => {
    const data = await zip.file(`ppt/media/${f}`)!.async('base64');
    return page.evaluate(async ([b64, mime]) => {
      const img = new Image();
      img.src = `data:${mime};base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      return [...g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data];
    }, [data, /\.png$/i.test(f) ? 'image/png' : 'image/jpeg'] as const);
  };
  const [still, moving] = await Promise.all(pics.map((p) => center(p.file)));
  // Вставка, которая понимает «Уменьшить движение», — своим неподвижным кадром (зелёный)
  expect(still[3]).toBeGreaterThan(200);
  expect(still[1]).toBeGreaterThan(120);
  expect(still[0]).toBeLessThan(80);
  // Без него — кадром идущей анимации (синий появляется только после 0,3 с кадров), а не пустым первым кадром
  expect(moving[3]).toBeGreaterThan(200);
  expect(moving[2]).toBeGreaterThan(150);
  expect(moving[0]).toBeLessThan(80);
  // Текст карточки после пустой строки — надписью с переносом, а не одной длинной строкой
  const sp = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(([x]) => x).find((x) => x.includes('Восьмого ноября'));
  expect(sp).toContain('wrap="square"');
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
