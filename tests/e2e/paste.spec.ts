// Вставка оформленного текста (engine/editor/paste-html.ts) и таблиц (paste-table.ts), «Параметры вставки»
// (paste-options.ts): на слайд — надписью или таблицей, внутрь набранного текста — в него; «Использовать тему»,
// «Сохранить исходное форматирование», «Рисунок» (картинка, которую Excel и Word кладут в буфер вместе с текстом),
// «Только текст»; другой режим и Ctrl+Z — одним шагом
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DECKS, readDeck, waitFile, watchErrors } from './helpers';

const DIR = path.join(DECKS, 'pastefmt');
const DECK = `title: Вставка
slides:
  - template: canvas
    free:
      - {type: text, id: t, text: "Начало текста конец", place: {x: 80, y: 80, w: 600}}
`;
test.beforeEach(() => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'deck.yaml'), DECK);
});
test.afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

/** Как копия со страницы сайта: браузер вписывает вычисленные стили в style */
const WEB = '<h2 style="font-size: 32px; color: rgb(32, 33, 36); font-weight: 700;">Итоги квартала</h2>'
  + '<p style="font-size: 16px; color: rgb(32, 33, 36); font-weight: 400;">Выручка <b style="font-weight: 700;">18 %</b>, '
  + '<span style="color: rgb(220, 38, 38);">красный</span>, <span style="color: rgb(255, 214, 0);">жёлтый</span> и '
  + '<a href="https://example.com/x" style="color: rgb(26, 13, 171);">ссылка</a>. Звёздочка *</p>'
  + '<ul><li>Новые клиенты: 42</li><li>Отток <b>вдвое</b></li></ul><script>top.__pwn = 1</script><img src="x" onerror="top.__pwn = 1">';
/** Как копия из Word: основной размер — в стилях документа, список — абзацами с mso-list */
const WORD = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{font-size:11.0pt}</style></head><body>'
  + '<p class=MsoNormal><b><span style=\'font-size:16.0pt\'>Заголовок Word</span></b></p>'
  + '<p class=MsoNormal>Обычный <span style=\'color:#2E74B5\'>синий</span> текст</p><p class=MsoNormal><o:p>&nbsp;</o:p></p>'
  + '<p class=MsoListParagraph style=\'mso-list:l0 level1 lfo1\'><span style=\'mso-list:Ignore\'>1.&nbsp;</span>Первый</p>'
  + '<p class=MsoListParagraph style=\'mso-list:l0 level1 lfo1\'><span style=\'mso-list:Ignore\'>2.&nbsp;</span>Второй</p></body></html>';

/** Как копия диапазона Excel: оформление — классами в <style>, переносы в ячейке — <br>, ширины — <col> */
const EXCEL = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><style><!--
td {color:black; font-size:11.0pt; font-weight:400; text-align:general;}
.xl65 {color:white; font-weight:700; text-align:center; background:#4472C4; mso-pattern:#4472C4 none;}
.xl66 {text-align:center;}
.xl67 {color:#C65911; font-weight:700; text-align:center; background:#FCE4D6;}
--></style></head><body><table border=0 cellpadding=0 cellspacing=0><col width=180><col width=120 span=2>
<tr><td class=xl65>Время</td><td class=xl65>Температура<br style='mso-data-placement:same-cell;'>(°C)</td><td class=xl65>Влажность</td></tr>
<tr><td class=xl66>2026-04-15 06:00</td><td class=xl66>15</td><td class=xl66>42</td></tr>
<tr><td class=xl66>2026-04-18 10:00</td><td class=xl67>32</td><td class=xl66>48</td></tr></table></body></html>`;
const EXCEL_TEXT = 'Время\t"Температура\n(°C)"\tВлажность\n2026-04-15 06:00\t15\t42\n2026-04-18 10:00\t32\t48\n';

/** Вставка, как из буфера: HTML, текст и (как кладут Excel и Word) картинка */
const paste = (page: Page, html: string, text: string, into?: string, image = false) => page.evaluate(async ([h, t, sel, img]) => {
  const dt = new DataTransfer();
  if (h) dt.setData('text/html', h);
  if (t) dt.setData('text/plain', t);
  if (img) {
    const c = Object.assign(document.createElement('canvas'), { width: 300, height: 90 });
    c.getContext('2d')!.fillRect(0, 0, 300, 90);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
  }
  const target = sel ? document.querySelector(sel)! : document;
  target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, [html, text, into ?? '', image] as const);
const modes = (page: Page) => page.locator('.ed-po-m').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.m));
/** Вставленный объект (второй на слайде: первый записан в одну строку) */
const pasted = () => {
  const y = readDeck('pastefmt');
  const at = y.indexOf('- type: ');
  return at < 0 ? '' : y.slice(at);
};

test('на слайд: тема — структура без чужих цветов; «исходное» — читаемые цвета и размер; «только текст»; Ctrl+Z — вся вставка', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=pastefmt&studio');
  const slide = page.locator('#st-canvas .slide.on');
  await expect(slide.locator('[data-free]')).toHaveCount(1);
  await paste(page, WEB, 'Итоги квартала\nВыручка 18 %, красный');
  await expect(slide.locator('[data-free]')).toHaveCount(2);
  await expect(page.locator('.ed-po')).toBeVisible();
  // Тема: жирный, ссылка, список, звёздочка — буквально; цвета и размеры — нет; скрипт не исполнился
  expect(await waitFile(() => pasted().includes('**Итоги квартала**'))).toBe(true);
  const theme = pasted();
  for (const s of ['Выручка **18 %**, красный, жёлтый и [ссылка](https://example.com/x). Звёздочка \\*', '- Новые клиенты: 42', '- Отток **вдвое**']) expect(theme).toContain(s);
  expect(theme).not.toMatch(/\{#|\{s:|accent/);
  expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn ?? 0)).toBe(0);
  // «Исходное»: заголовок крупнее, красный читается на обоих фонах — как есть, жёлтый — акцентом; чёрный — нет
  await page.locator('.ed-po').click();
  await page.locator('.ed-po-m[data-m="source"]').click();
  expect(await waitFile(() => pasted().includes('{s:200|Итоги квартала}'))).toBe(true);
  expect(pasted()).toContain('{#dc2626|красный}');
  expect(pasted()).toContain('{accent|жёлтый}');
  expect(pasted()).not.toContain('#202124');
  await expect(page.locator('.ed-po')).toBeVisible();
  // Ctrl (нажать и отпустить) — те же значки; «Только текст»
  await page.keyboard.press('Control');
  await expect(page.locator('.ed-po-pop')).toBeVisible();
  await expect(page.locator('.ed-po-m[data-m="source"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('.ed-po-m[data-m="text"]').click();
  expect(await waitFile(() => /Итоги квартала\n\s+Выручка 18 %, красный\n/.test(pasted()))).toBe(true);
  // Щелчок мимо — кнопка уходит; Ctrl+Z — вставки нет целиком
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.ed-po')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  expect(await waitFile(() => !readDeck('pastefmt').includes('Итоги'))).toBe(true);
  await expect(slide.locator('[data-free]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('из Word: основной размер — из стилей документа, нумерованный список, пустой абзац — промежуток', async ({ page }) => {
  await page.goto('/?deck=pastefmt&studio');
  await expect(page.locator('#st-canvas .slide.on [data-free]')).toHaveCount(1);
  await paste(page, WORD, 'Заголовок Word');
  expect(await waitFile(() => pasted().includes('**Заголовок Word**'))).toBe(true);
  expect(pasted()).toMatch(/\*\*Заголовок Word\*\*\n\s+Обычный синий текст\n\n\s+-\[num\] Первый\n\s+-\[num\] Второй/);
  await page.locator('.ed-po').click();
  await page.locator('.ed-po-m[data-m="source"]').click();
  // 16 pt к 11 pt — 145 %; синий Word читается на обоих фонах
  expect(await waitFile(() => pasted().includes('**{s:145|Заголовок Word}**'))).toBe(true);
  expect(pasted()).toContain('{#2e74b5|синий}');
});

test('внутрь набранного текста: тема, другой режим на том же месте, правка не прерывается', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=pastefmt&studio');
  const text = page.locator('#st-canvas .slide.on [data-free] [data-edit]').first();
  await expect(text).toBeVisible();
  // Первый щелчок выделяет надпись, второй — правка текста (у края: посередине — ручка рамки)
  const bb = (await text.boundingBox())!;
  await page.mouse.click(bb.x + 30, bb.y + bb.height / 2);
  await page.mouse.click(bb.x + 30, bb.y + bb.height / 2);
  await expect(text).toHaveAttribute('contenteditable', /true|plaintext-only/);
  // Выделено «текста» — его заменит вставка
  await text.evaluate((el) => {
    const t = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()!;
    const i = t.textContent!.indexOf('текста');
    getSelection()!.setBaseAndExtent(t, i, t, i + 6);
  });
  await paste(page, '<p>очень <b>важного</b> <span style="color:#dc2626">текста</span></p>', 'очень важного текста', '#st-canvas [contenteditable]');
  await expect(text.locator('b')).toHaveText('важного');
  await expect(text.locator('.md-c')).toHaveCount(0);
  await page.keyboard.press('Control');
  await page.locator('.ed-po-m[data-m="source"]').click();
  await expect(text.locator('.md-c')).toHaveText('текста');
  await expect(text).toHaveAttribute('contenteditable', /true|plaintext-only/);
  await page.keyboard.press('Escape');
  expect(await waitFile(() => readDeck('pastefmt').includes('Начало очень **важного** {#dc2626|текста} конец'))).toBe(true);
  expect(errors).toEqual([]);
});

test('таблица из Excel — таблицей, а не картинкой: тема, исходное (заливки, цвета), рисунок, только текст', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=pastefmt&studio');
  const slide = page.locator('#st-canvas .slide.on');
  await expect(slide.locator('[data-free]')).toHaveCount(1);
  await paste(page, EXCEL, EXCEL_TEXT, undefined, true);
  await expect(slide.locator('table')).toHaveCount(1);
  expect(await waitFile(() => pasted().startsWith('- type: table'))).toBe(true);
  // Тема: шапка с переносом, жирный «32», ширины столбцов; без заливок и цветов
  const theme = pasted();
  expect(theme).toMatch(/header:\n\s+- Время\n\s+- \|-\n\s+Температура\n\s+\(°C\)/);
  expect(theme).toContain('weight: 700');
  expect(theme).toMatch(/widths:\n\s+- 180\n\s+- 120\n\s+- 120/);
  expect(theme).not.toMatch(/fills|color:/i);
  await page.locator('.ed-po').click();
  expect(await modes(page)).toEqual(['theme', 'source', 'picture', 'text']);
  // Исходное: шапка — синяя с белым текстом, «32» — на персиковой заливке своим цветом; белая «по умолчанию» — нет
  await page.locator('.ed-po-m[data-m="source"]').click();
  expect(await waitFile(() => pasted().includes('headFills'))).toBe(true);
  const src = pasted();
  expect(src).toMatch(/headFills:(\n\s+- "#4472c4"){3}/);
  expect(src).toMatch(/fills:\n\s+- - null[\s\S]*- "#fce4d6"/);
  expect(src).toContain('color: "#ffffff"');
  expect(src).toContain('color: "#c65911"');
  expect(src).toContain('align: center');
  // Рисунок — картинка из буфера, на месте таблицы
  await page.locator('.ed-po').click();
  await page.locator('.ed-po-m[data-m="picture"]').click();
  expect(await waitFile(() => pasted().startsWith('- type: image'))).toBe(true);
  await expect(slide.locator('[data-free] img')).toHaveCount(1);
  // Только текст — строки, ячейки через широкий пробел
  await page.locator('.ed-po').click();
  await page.locator('.ed-po-m[data-m="text"]').click();
  expect(await waitFile(() => pasted().includes('2026-04-15 06:00\u200315\u200342'))).toBe(true);
  // Всё это — один шаг отмены
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(slide.locator('[data-free]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('текст из Word вместе с картинкой — текстом («Рисунок» — в параметрах); просто картинка — картинкой', async ({ page }) => {
  await page.goto('/?deck=pastefmt&studio');
  const slide = page.locator('#st-canvas .slide.on');
  await expect(slide.locator('[data-free]')).toHaveCount(1);
  await paste(page, WORD, 'Заголовок Word', undefined, true);
  expect(await waitFile(() => pasted().includes('**Заголовок Word**'))).toBe(true);
  await page.locator('.ed-po').click();
  expect(await modes(page)).toEqual(['theme', 'source', 'picture', 'text']);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('#st-canvas').click({ position: { x: 5, y: 5 } });
  // «Копировать картинку» в браузере: в HTML только <img> — вставляется картинка, без параметров
  await paste(page, '<img src="https://example.com/a.png">', '', undefined, true);
  await expect(slide.locator('[data-free] img')).toHaveCount(1);
  await expect(page.locator('.ed-po')).toHaveCount(0);
});
