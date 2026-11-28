// Раздел «Файл» студии (studio/file-panel.ts): открывается кнопкой «Файл» и щелчком по «Сохранено», закрывается
// Esc; клавиши студии до слайдов не доходят; сведения, экспорт, версии, параметры и лицензии
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DECKS, api, deckFile, readDeck, waitFile, watchErrors } from './helpers';

// «Вернуть» переписывает deck.yaml целиком: данные те же, но YAML — блочным стилем, а тесты студии ищут
// объект по одной строке файла. Поэтому после теста файл презентации возвращается как был
let restoreFile: { deck: string; text: string } | undefined;
test.afterEach(() => {
  if (restoreFile) fs.writeFileSync(deckFile(restoreFile.deck), restoreFile.text);
  restoreFile = undefined;
});

test('«Файл»: разделы, клавиатура, Esc, сведения и название', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  const slides = await page.locator('.st-slides-list > *').count();
  const fp = page.locator('.fp');
  await page.locator('#st-file').click();
  await expect(fp).toBeVisible();
  await expect(page.locator('#st-file')).toHaveAttribute('aria-expanded', 'true');
  // Сведения: число слайдов — как в презентации, раздел выбран и в фокусе
  await expect(page.locator('.fp [data-fs="info"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.fp [data-fs="info"]')).toBeFocused();
  await expect(page.locator('.fp-tile b').first()).toHaveText(String(slides));
  await expect(page.locator('.fp-cover .thumb')).toHaveCount(1);
  // Стрелки — по разделам
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.fp [data-fs="export"]')).toHaveAttribute('aria-selected', 'true');
  // HTML для показа, HTML с правкой, PowerPoint, PowerPoint 2007, PDF, Видео
  await expect(page.locator('.fp-fmt')).toHaveCount(6);
  // Клавиши студии, пока раздел открыт, слайды не трогают
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+m');
  await expect(page.locator('.st-slides-list > *')).toHaveCount(slides);
  // Esc — обратно к слайдам, фокус — на «Файл»
  await page.keyboard.press('Escape');
  await expect(fp).toBeHidden();
  await expect(page.locator('#st-file')).toBeFocused();
  // …без рамки фокуса: раздел просто закрыли
  expect(await page.locator('#st-file').evaluate((b) => b.matches(':focus-visible'))).toBe(false);
  await expect(page.locator('#st-file')).toHaveAttribute('aria-expanded', 'false');

  // Открывается на разделе, где закрыли. Название в «Сведениях» — то же, что в шапке, и в файле
  await page.locator('#st-file').click();
  await expect(page.locator('.fp [data-fs="export"]')).toHaveAttribute('aria-selected', 'true');
  await page.locator('.fp [data-fs="info"]').click();
  await page.locator('#fp-name').fill('Отчёт для теста');
  await page.locator('#fp-name').press('Enter');
  expect(await waitFile(() => /^title: "?Отчёт для теста"?$/m.test(readDeck('tpl')))).toBe(true);
  await expect(page.locator('#st-title')).toHaveValue('Отчёт для теста');
  expect(errors).toEqual([]);
});

test('«Файл» не ждёт сервер: раздел сразу в фокусе, Esc закрывает, сведения дорисовываются после ответа', async ({ page }) => {
  const errors = watchErrors(page);
  // Сервер занят: список файлов презентации не отвечает, пока тест не отпустит
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/__htmlpptx/assets-list*', async (route) => { await gate; await route.continue(); });
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  const slides = await page.locator('.st-slides-list > *').count();
  const fp = page.locator('.fp');
  await page.locator('#st-file').click();
  // Раздел — в фокусе сразу и не пустой: сводка ещё считается
  await expect(page.locator('.fp [data-fs="info"]')).toBeFocused();
  await expect(page.locator('.fp-wait')).toBeVisible();
  // Фокус ушёл на «Файл» в шапке — Esc всё равно закрывает, Delete до слайдов не доходит
  await page.locator('#st-file').focus();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Escape');
  await expect(fp).toBeHidden();
  await expect(page.locator('.st-slides-list > *')).toHaveCount(slides);
  // Открыли снова, сервер ответил — сводка на месте
  await page.locator('#st-file').click();
  release();
  await expect(page.locator('.fp-tile b').first()).toHaveText(String(slides));
  await expect(page.locator('.fp-wait')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('«Файл»: экспорт — настройки по формату; версии — точка и «Вернуть»; параметры — тема', async ({ page }) => {
  const errors = watchErrors(page);
  restoreFile = { deck: 'fx', text: readDeck('fx') };
  await page.goto('/?deck=fx&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  // Экспорт: у HTML — «Как на этом компьютере», у PDF его нет; качество запоминается
  await page.locator('#st-file').click();
  await page.locator('.fp [data-fs="export"]').click();
  await page.locator('.fp [data-x="clean"]').click();
  await expect(page.locator('.fp-side [data-same]')).toHaveCount(1);
  await expect(page.locator('.fp-file')).toContainText('fx.html');
  await page.locator('.fp [data-x="pdf"]').click();
  await expect(page.locator('.fp-side h3')).toHaveText('PDF');
  await expect(page.locator('.fp-side [data-same]')).toHaveCount(0);
  await page.locator('.fp [data-q="compact"]').click();
  await expect(page.locator('.fp [data-q="compact"]')).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('htmlpptx-export-quality'))).toBe('compact');
  await page.keyboard.press('Escape');

  // Версии: щелчок по «Сохранено» — сюда; Ctrl+S — точка в списке; «Вернуть» — к ней (одной правкой)
  await page.locator('#st-status').click();
  await expect(page.locator('.fp [data-fs="versions"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.fp-ver')).not.toHaveCount(0);
  await expect(page.locator('.fp-ver-th .thumb').first()).toBeAttached();
  await page.keyboard.press('Escape');
  const slides = await page.locator('.st-slides-list > *').count();
  await page.locator('#st-canvas').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+m');
  await expect(page.locator('.st-slides-list > *')).toHaveCount(slides + 1);
  await page.locator('#st-status').click();
  await page.locator('.fp-ver').first().hover();
  await page.locator('.fp-ver [data-restore]').first().click();
  await expect(page.locator('.st-slides-list > *')).toHaveCount(slides);
  await expect(page.locator('#ed-toast')).toContainText('Возвращено к точке');
  // И в файле: дальше тест быстрый — без ожидания записи автосохранение пришло бы уже после того,
  // как файл вернут в исходный вид, и лишний слайд остался бы в презентации для следующих тестов
  await expect.poll(() => (readDeck('fx').match(/^ {2}- /gm) ?? []).length).toBe(slides);

  // Параметры: тема интерфейса — сразу
  await page.locator('.fp [data-fs="prefs"]').click();
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const other = theme === 'dark' ? 'light' : 'dark';
  await page.locator(`.fp [data-uitheme="${other}"]`).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(other);
  await expect(page.locator(`.fp [data-uitheme="${other}"]`)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.fp .rs-presets button')).toHaveCount(3);
  // О программе — карточкой в «Параметрах» (в браузере сборки нет); строки сборки внизу разделов больше нет.
  // «Лицензии» из карточки — в свой раздел
  await expect(page.locator('.fp-about')).toContainText('Slideria');
  await expect(page.locator('.fp-about')).toContainText('Открыта в браузере');
  await expect(page.locator('.fp-build')).toHaveCount(0);
  await page.locator('.fp-about [data-fs="licenses"]').click();
  await expect(page.locator('.fp #fp-t-licenses')).toHaveAttribute('aria-selected', 'true');
  await page.locator('.fp [data-fs="prefs"]').click();
  // T — тема и в разделе, как в студии; выбор в «Теме» следует за ней
  await page.locator('.fp [data-fs="prefs"]').focus();
  await page.keyboard.press('t');
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme === 'dark' ? 'dark' : 'light');
  await expect(page.locator(`.fp [data-uitheme="${other}"]`)).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.fp')).toBeVisible();
  expect(errors).toEqual([]);
});

/** Что вылезает за свою карточку (или за раздел, если карточки нет) — то, что не обрезано по дороге */
function escapes(): string[] {
  const main = document.querySelector('#fp-main')!;
  const out: string[] = [];
  for (const el of main.querySelectorAll<HTMLElement>('*')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const box = el.parentElement!.closest('.fp-card') ?? main;
    let cut = false;
    for (let a = el.parentElement; a && a !== box; a = a.parentElement) if (getComputedStyle(a).overflow !== 'visible') cut = true;
    const c = box.getBoundingClientRect();
    if (!cut && (r.right > c.right + 1 || r.left < c.left - 1)) out.push(`${el.tagName.toLowerCase()}.${el.className} «${el.textContent!.trim().slice(0, 40)}»`);
  }
  return out;
}

test('«Файл»: длинное название и имя папки — ничего не выходит за карточки; имя файла — до двух строк, целиком в подсказке', async ({ page }) => {
  const errors = watchErrors(page);
  const key = 'sistema-avtomaticheskogo-monitoringa-parametrov-na-baze-seti-lorawan';
  const title = 'Система автоматического мониторинга параметров на базе сети LoRaWAN';
  const dir = path.join(DECKS, key);
  // Картинка с длинным именем — в «Сведениях» она в списке «Самые тяжёлые файлы»
  const img = 'Фотография_базовой_станции_LoRaWAN_на_крыше_корпуса_Б_вид_с_северо-западной_стороны.png';
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', img), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync(path.join(dir, 'deck.yaml'), `title: ${title}\nauthor: Константин Константинопольский, кафедра информационно-измерительных систем\nslides:\n  - template: canvas\n    free:\n      - {type: text, text: Слайд, place: {x: 100, y: 100, w: 600}}\n      - {type: image, src: ./assets/${img}, place: {x: 100, y: 300, w: 200, h: 200}}\n`);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/?deck=${key}&studio#1`);
    await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
    await page.locator('#st-file').click();
    // «Сведения» и в узком окне (одной колонкой): карточка с названием и папкой — не шире окна
    await page.locator('.fp [data-fs="info"]').first().click();
    await expect(page.locator('.fp-list .fp-n')).toContainText('LoRaWAN');
    for (const width of [1093, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      expect(await page.evaluate(escapes), `сведения, окно ${width}`).toEqual([]);
      expect(await page.locator('#fp-main').evaluate((m) => m.scrollWidth - m.clientWidth), `сведения, окно ${width}: вбок`).toBeLessThanOrEqual(1);
    }
    for (const s of await page.locator('.fp [data-fs]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.fs!))) {
      await page.locator(`.fp [data-fs="${s}"]`).first().click();
      await expect(page.locator(`.fp #fp-t-${s}`)).toHaveAttribute('aria-selected', 'true');
      await page.waitForTimeout(300);
      expect(await page.evaluate(escapes), `раздел ${s}`).toEqual([]);
      if (s !== 'export') continue;
      // Каждый формат: имя файла — из названия (PDF) или из папки, оба длинные
      for (const x of await page.locator('.fp [data-x]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.x!))) {
        await page.locator(`.fp [data-x="${x}"]`).click();
        await expect(page.locator(`.fp [data-x="${x}"]`)).toHaveAttribute('aria-checked', 'true');
        expect(await page.evaluate(escapes), `экспорт ${x}`).toEqual([]);
        const name = page.locator('.fp-file span').last();
        const lines = await name.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
        expect(lines, `экспорт ${x}: строк в имени файла`).toBe(2);
        if (x === 'pdf') await expect(name).toHaveAttribute('title', `${title}.pdf`);
        else await expect(name).toHaveAttribute('title', new RegExp(`^${key}`));
      }
    }
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('«Версии»: строка — из истории с «Отменить» на её месте; «Очистить историю» — после вопроса, точка выхода остаётся', async ({ page }) => {
  const errors = watchErrors(page);
  const NAME = 'zz-hist';
  const trashed = () => (fs.existsSync(path.join(DECKS, '.trash')) ? fs.readdirSync(path.join(DECKS, '.trash')).filter((f) => f.startsWith(`${NAME}-history-`)) : []);
  const clean = () => {
    fs.rmSync(path.join(DECKS, NAME), { recursive: true, force: true });
    fs.rmSync(path.join(DECKS, '.checkpoints', NAME), { recursive: true, force: true });
    fs.rmSync(path.join(DECKS, '.slideria', 'journal', `${NAME}.jsonl`), { force: true });
    for (const f of trashed()) fs.rmSync(path.join(DECKS, '.trash', f), { recursive: true, force: true });
  };
  clean();
  fs.mkdirSync(path.join(DECKS, NAME), { recursive: true });
  fs.writeFileSync(deckFile(NAME), 'title: История\nslides:\n  - template: canvas\n    free:\n      - {type: text, text: Первый, place: {x: 80, y: 80, w: 600}}\n');
  try {
    // Открыли — точка «Когда открыли» (с ней сравниваются правки при выходе); потом правка агента и своя точка
    await page.goto(`/?deck=${NAME}&studio#1`);
    await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
    await expect.poll(() => fs.existsSync(path.join(DECKS, '.checkpoints', NAME, 'session'))).toBe(true);
    const by = { kind: 'agent', id: 'zz', name: 'Тестовый агент' };
    expect((await api(page, `apply?deck=${NAME}&from=mcp`, JSON.stringify({ ops: [{ op: 'slide.set', slide: 1, set: { notes: 'от агента' } }], by }))).status).toBe(200);
    expect((await api(page, `checkpoint?deck=${NAME}`)).status).toBe(200);

    await page.locator('#st-file').click();
    await page.locator('.fp [data-fs="versions"]').click();
    const rows = page.locator('.fp-ver');
    await expect(rows).toHaveCount(3);
    const hist = page.locator('.fp-hist');
    await expect(hist).toContainText('2 точки · журнал — 1 правка агентов и скриптов');
    // У точки выхода корзины нет: «Не сохранять» вернёт к ней
    await expect(page.locator('.fp-ver[data-cp^="open:"] [data-del]')).toHaveCount(0);
    await expect(page.locator('.fp-ver-e [data-del]')).toHaveCount(1);

    // Своя точка — из истории; на её месте — «Отменить»
    const mine = page.locator('.fp-ver[data-cp]:not([data-cp*=":"])');
    await mine.hover();
    await mine.locator('[data-del]').click();
    const undo = page.locator('.fp-ver-undo');
    await expect(undo).toContainText('Точка «Ваша точка»');
    await expect(undo).toContainText('удалена из истории');
    await expect(mine).toHaveCount(0);
    await expect(hist).toContainText('1 точка ·');
    expect(trashed()).toHaveLength(1);
    await undo.locator('[data-undo]').click();
    await expect(undo).toHaveCount(0);
    await expect(mine).toHaveCount(1);
    await expect(hist).toContainText('2 точки ·');
    // Раздел перерисовался — миниатюры точек те же (а не сжатые в точку копии)
    await expect.poll(() => page.locator('.fp-ver[data-cp^="open:"] .thumb-stage .slide').evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(90);
    expect(trashed()).toHaveLength(0);

    // Правки агента — из истории (в презентации остаются), с клавиатуры: фокус — на «Отменить»
    await page.locator('.fp-ver-e [data-del]').focus();
    await page.keyboard.press('Enter');
    await expect(undo).toContainText('Правки «Тестовый агент»');
    await expect(undo.locator('[data-undo]')).toBeFocused();
    await expect(page.locator('.fp-ver-e')).toHaveCount(0);
    await expect(hist).toContainText('журнал пуст');
    expect(readDeck(NAME)).toContain('от агента');

    // «Очистить историю»: вопрос; Esc — ничего не меняется
    await page.locator('.fp-hist [data-a="hclear"]').click();
    const dlg = page.locator('.ig-dlg');
    await expect(dlg.locator('h2')).toHaveText('Очистить историю?');
    await expect(dlg.locator('.ig-dlg-item')).toContainText('История');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('.fp')).toBeVisible();
    await expect(rows).toHaveCount(3);
    await page.locator('.fp-hist [data-a="hclear"]').click();
    await dlg.locator('[data-k="ok"]').click();
    await expect(page.locator('#ed-toast')).toContainText('История — в корзине');
    // Осталась только точка «Когда открыли»; «Отменить» у убранной раньше строки — больше не нужна
    await expect(rows).toHaveCount(1);
    await expect(page.locator('.fp-ver[data-cp^="open:"]')).toHaveCount(1);
    await expect(hist).toContainText('1 точка · журнал пуст');
    expect(trashed()).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    clean();
  }
});

test('«Версии»: автоматические точки подряд — одной строкой, щелчок раскрывает; время без даты; «Показать более ранние»', async ({ page }) => {
  const errors = watchErrors(page);
  const NAME = 'zz-group';
  const cps = path.join(DECKS, '.checkpoints', NAME);
  const clean = () => {
    fs.rmSync(path.join(DECKS, NAME), { recursive: true, force: true });
    fs.rmSync(cps, { recursive: true, force: true });
    if (fs.existsSync(path.join(DECKS, '.trash'))) for (const f of fs.readdirSync(path.join(DECKS, '.trash'))) if (f.startsWith(`${NAME}-history-`)) fs.rmSync(path.join(DECKS, '.trash', f), { recursive: true, force: true });
  };
  clean();
  const text = 'title: Группы\nslides:\n  - template: canvas\n    free:\n      - {type: text, text: Первый, place: {x: 80, y: 80, w: 600}}\n';
  fs.mkdirSync(path.join(DECKS, NAME), { recursive: true });
  fs.writeFileSync(deckFile(NAME), text);
  // Точки — файлами с метками времени: вчера и три дня назад (время точки — время файла)
  const p2 = (n: number) => String(n).padStart(2, '0');
  const point = (days: number, h: number, m: number, s: number, dir: string, ext: string) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(h, m, s, 0);
    const file = path.join(cps, dir, `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(h)}${p2(m)}${p2(s)}${ext}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    fs.utimesSync(file, d, d);
  };
  // Вчера: три автоматические подряд, своя точка, ещё две автоматические
  point(1, 17, 28, 30, 'dropped', '.yaml');
  point(1, 17, 28, 0, 'session', '.open.yaml');
  point(1, 16, 21, 0, 'session', '.open.yaml');
  point(1, 15, 0, 0, '', '.yaml');
  point(1, 11, 53, 0, 'session', '.open.yaml');
  point(1, 11, 5, 0, 'dropped', '.yaml');
  // Три дня назад — 40 своих точек: строк больше 40, остальное — «Показать более ранние»
  for (let i = 0; i < 40; i++) point(3, 10, i, 0, '', '.yaml');
  try {
    await page.goto(`/?deck=${NAME}&studio#1`);
    await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
    await page.locator('#st-file').click();
    await page.locator('.fp [data-fs="versions"]').click();
    // Сверху — время последней точки без даты
    await expect(page.locator('.fp-now small')).toHaveText('Последняя точка — вчера в 17:28');
    const groups = page.locator('.fp-ver-g');
    await expect(groups).toHaveCount(2);
    await expect(groups.first()).toContainText('Автоматические точки 3 точки · 16:21–17:28');
    await expect(groups.first()).toContainText('Когда открыли — 2, не сохранено при выходе — 1');
    await expect(groups.nth(1)).toContainText('2 точки · 11:05–11:53');
    await expect(page.locator('.fp-ver-stack .thumb').first()).toBeAttached();
    // Время в строках — только часы и минуты: день — в заголовке
    for (const t of await page.locator('.fp-ver time').allTextContents()) expect(t).toMatch(/^\d\d:\d\d$/);
    // 40 строк: группа, своя точка, группа и 37 из 40 точек трёхдневной давности; дальше — по кнопке
    const top = page.locator('.fp-card > .fp-ver');
    await expect(top).toHaveCount(40);
    await page.locator('[data-a="vmore"]').click();
    await expect(top).toHaveCount(43);
    await expect(page.locator('[data-a="vmore"]')).toHaveCount(0);

    // Щелчок — раскрыть: точки группы со своими «Вернуть»; удалить одну — «Отменить» внутри группы
    await groups.first().click();
    await expect(groups.first()).toHaveAttribute('aria-expanded', 'true');
    const sub = page.locator('.fp-ver-sub .fp-ver');
    await expect(sub).toHaveCount(3);
    await expect(sub.nth(1)).toContainText('Когда открыли');
    await expect(sub.nth(1).locator('[data-restore]')).toHaveCount(1);
    await sub.first().hover();
    await sub.first().locator('[data-del]').click();
    await expect(page.locator('.fp-ver-sub .fp-ver-undo')).toContainText('Точка «Не сохранено при выходе», 17:28 удалена из истории');
    await expect(groups.first()).toContainText('2 точки · 16:21–17:28');
    await page.locator('.fp-ver-sub [data-undo]').click();
    await expect(groups.first()).toContainText('3 точки');
    await expect(sub).toHaveCount(3);
    // Ещё щелчок — свернуть; с клавиатуры — Enter
    await groups.first().click();
    await expect(sub).toHaveCount(0);
    await groups.first().focus();
    await page.keyboard.press('Enter');
    await expect(groups.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(groups.first()).toBeFocused();
    // Закрыли «Файл» и открыли снова — группы свёрнуты
    await page.keyboard.press('Escape');
    await page.locator('#st-file').click();
    await expect(page.locator('.fp-ver-sub')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    clean();
  }
});

test('«Файл → Лицензии»: список и текст, фильтр, поиск, клавиатура, узкое место; страница выбора — своя страница', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?deck=tpl&studio#1');
  await expect(page.locator('#st-canvas .slide')).not.toHaveCount(0);
  // «Инструменты» → «Лицензии» — раздел «Файла», не отдельное окно
  await page.locator('[data-tab="tools"]').click();
  await page.locator('.st-ribbon [data-cmd="tools.licenses"]').click();
  await expect(page.locator('.fp [data-fs="licenses"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.fp-lic-sum')).toContainText(/\d+ компонент/);
  // Сразу выбрана Slideria: её текст справа; Electron нет — нет и его лицензии (не программа)
  await expect(page.locator('.lc-row[aria-selected="true"]')).toContainText('Slideria');
  await expect(page.locator('.lc-name')).toHaveText('Slideria');
  await expect(page.locator('.lc-text')).toContainText('Permission is hereby granted');
  await expect(page.locator('.lc-row', { hasText: 'Electron' })).toHaveCount(0);
  const all = await page.locator('.lc-row').count();
  expect(all).toBeGreaterThan(40);
  // Фильтр по лицензии: только OFL — шрифты, их текст
  await page.locator('.lc-chip[data-f="ofl"]').click();
  await expect(page.locator('.lc-row')).toHaveCount(1);
  await page.locator('.lc-row').click();
  await expect(page.locator('.lc-text')).toContainText('SIL OPEN FONT LICENSE');
  await expect(page.locator('.lc-fonts span', { hasText: 'Unbounded' })).toHaveCount(1);
  await page.locator('.lc-chip[data-f="all"]').click();
  await expect(page.locator('.lc-row')).toHaveCount(all);
  // Ctrl+K — поиск по лицензиям (не поиск команд студии), стрелка вниз — в список, Enter — выбрать
  await page.keyboard.press('Control+k');
  await expect(page.locator('.lc-q')).toBeFocused();
  await page.keyboard.type('qrcode');
  await expect(page.locator('.lc-row')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.lc-name')).toHaveText('qrcode-generator');
  // Esc в поиске — очистить (раздел остаётся открытым), стрелки — по строкам, текст следует за выбором
  await page.locator('.lc-q').press('Escape');
  await expect(page.locator('.lc-row')).toHaveCount(all);
  await expect(page.locator('.fp')).toBeVisible();
  await page.locator('.lc-row[aria-selected="true"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.lc-name')).not.toHaveText('qrcode-generator');
  await expect(page.locator('.lc-row[aria-selected="true"]')).toBeFocused();
  // Окно поуже (список — узкой колонкой): длинное имя обрезается, а версия — целиком
  await page.setViewportSize({ width: 1093, height: 614 });
  expect(await page.locator('.lc-row .lc-ver').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > e.parentElement!.getBoundingClientRect().right + 1).map((e) => e.textContent))).toEqual([]);
  // Узкое окно: один список, текст — вместо него, Esc — обратно к списку, ещё Esc — к слайдам
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(page.locator('.lc-pane')).toBeHidden();
  await page.locator('.lc-row[data-id^="yaml@"]').click();
  await expect(page.locator('.lc-side')).toBeHidden();
  await expect(page.locator('.lc-name')).toHaveText('yaml');
  await page.keyboard.press('Escape');
  await expect(page.locator('.lc-side')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.fp')).toBeHidden();
  // Открывается снова на той же записи
  await page.locator('#st-file').click();
  await page.locator('.fp [data-fs="licenses"]').click();
  await expect(page.locator('.lc-row[aria-selected="true"]')).toContainText('yaml');
  expect(errors).toEqual([]);

  // Страница выбора («Справка → Лицензии» в программе): своя страница в том же окне, «Все презентации» — обратно
  await page.goto('/?licenses');
  await expect(page).toHaveTitle('Лицензии · Slideria');
  await expect(page.locator('.lc-sum h1')).toContainText(/\d+ компонент/);
  await expect(page.locator('.lc-text')).toContainText('Permission is hereby granted');
  await page.locator('#lc-home').click();
  await expect(page).toHaveURL(/\?all/);
  expect(errors).toEqual([]);
});
