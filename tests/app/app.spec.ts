// Приложение Electron: первый запуск, страница выбора, экспорт (сборка — служебным процессом Electron),
// вход для телефона. Папки — временные: настоящие «Документы/Slideria» и данные приложения не трогаются.
// SLIDERIA_APP_EXE=путь — то же для собранной программы (SLIDERIA_FUSES_TEST=1 node scripts/app-build.mjs --linux dir):
// сжатый код рядом с app.asar, предохранители Electron, а изменённый код программа не запускает
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { startMockClaude } from '../mock-claude';

const EXE = process.env.SLIDERIA_APP_EXE;
const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];

/** Окно программы со страницей своего сервера: первой может появиться заставка (отдельный слой поверх окна) */
async function mainWindow(app: ElectronApplication): Promise<Page> {
  let win: Page | undefined;
  await expect.poll(() => (win = app.windows().find((w) => w.url().startsWith('http://127.'))) !== undefined, { timeout: 90_000 }).toBe(true);
  return win!;
}

test('первый запуск: «Моя первая презентация», экспорт и вход для телефона', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-app-test-'));
  const docs = path.join(tmp, 'docs');
  // Сохранённые файлы (PDF, PPTX) — сюда, без окна «Сохранить как»
  const saves = path.join(tmp, 'saves');
  fs.mkdirSync(saves, { recursive: true });
  const app = await electron.launch({
    ...(EXE ? { executablePath: EXE, args: sandbox } : { args: ['.', ...sandbox] }),
    env: { ...process.env, SLIDERIA_DOCS_DIR: docs, SLIDERIA_USER_DATA: path.join(tmp, 'data'), SLIDERIA_SAVE_DIR: saves },
    timeout: 60_000,
  });
  try {
    const win = await mainWindow(app);
    await win.waitForURL(/\/\?all$/, { timeout: 90_000 });
    await expect(win.locator('.pk-card[data-name="moya-pervaya-prezentaciya"]')).toBeVisible();
    // Заставка ушла, когда страница выбора готова: остаётся одно окно со страницей программы
    await expect.poll(() => app.windows().map((w) => w.url().slice(0, 5))).toEqual(['http:']);
    await expect(win.locator('#pk-where')).toContainText('Документы/Slideria');
    // Свой заголовок окна: шапка страницы выбора перетаскивает окно; кнопки окна (кроме Mac) рисует страница —
    // высотой с шапку (48 px), без фокуса и перетаскивания
    const WC = process.platform === 'darwin' ? [] : ['Свернуть', 'Развернуть', 'Закрыть'];
    const bar = () => win.evaluate(() => {
      const el = document.querySelector('[data-titlebar]')!;
      const wc = [...document.querySelectorAll<HTMLElement>('.app-wc button')];
      return {
        frame: document.documentElement.classList.contains('app-frame'),
        el: el.className,
        drag: getComputedStyle(el).getPropertyValue('-webkit-app-region'),
        wc: wc.map((b) => b.getAttribute('aria-label')),
        wcH: wc.map((b) => Math.round(b.getBoundingClientRect().height)),
        wcDrag: wc.map((b) => getComputedStyle(b).getPropertyValue('-webkit-app-region')),
      };
    });
    await expect.poll(bar).toMatchObject({ frame: true, el: 'pk-top', drag: 'drag', wc: WC, wcH: WC.map(() => 48), wcDrag: WC.map(() => 'no-drag') });
    expect(fs.existsSync(path.join(docs, 'moya-pervaya-prezentaciya', 'deck.yaml'))).toBe(true);
    // Подсказки внизу — без команд терминала; какая это сборка программы
    await expect(win.locator('.pk-foot')).not.toContainText('yarn');
    await expect(win.locator('.pk-build')).toContainText(EXE ? 'сборка от' : 'Slideria');
    await expect(win.locator('.pk-build')).not.toContainText('запуск');
    // «⋯ → Показать в папке» — папка этой презентации (Проводник в тесте подменён: окно не открывается)
    await app.evaluate(({ shell }) => {
      const g = globalThis as { revealed?: string };
      shell.showItemInFolder = (p: string) => { g.revealed = p; };
    });
    await win.locator('.pk-more[data-more="moya-pervaya-prezentaciya"]').click();
    await win.locator('.pk-menu [data-a="folder"]').click();
    await expect.poll(() => app.evaluate(() => (globalThis as { revealed?: string }).revealed ?? '')).toMatch(/moya-pervaya-prezentaciya[\\/]deck\.yaml$/);
    await expect(win.locator('.pk-menu')).toHaveCount(0);
    // Шрифты компьютера: своему серверу доступ дан без вопроса — список шрифтов в студии полный
    const fonts = await win.evaluate(async () => ({
      state: (await navigator.permissions.query({ name: 'local-fonts' as PermissionName })).state,
      n: (await (window as unknown as { queryLocalFonts: () => Promise<unknown[]> }).queryLocalFonts()).length,
    }));
    expect(fonts).toMatchObject({ state: 'granted' });
    expect(fonts.n).toBeGreaterThan(0);

    // Экспорт: сборка служебным процессом Electron (в роли Node Electron в собранной программе не запускается)
    const exp = await win.evaluate(async () => {
      const r = await fetch('/__htmlpptx/export?deck=moya-pervaya-prezentaciya&mode=clean', { method: 'POST' });
      return { status: r.status, size: (await r.text()).length };
    });
    expect(exp.status).toBe(200);
    expect(exp.size).toBeGreaterThan(200_000);

    // «Экспорт → PDF» в приложении — файл PDF средствами Electron (а не окно печати), окно печати закрывается само
    await win.goto(win.url().replace(/\?all$/, '?deck=moya-pervaya-prezentaciya&studio'));
    await expect(win.locator('#st-canvas .slide')).not.toHaveCount(0);
    // В студии заголовок окна — тонкая полоса над шапкой, шапка под ней не перетаскивает окно
    await expect.poll(bar).toMatchObject({ frame: true, el: 'st-tbar', drag: 'drag', wc: WC, wcH: WC.map(() => 40) });
    expect(await win.evaluate(() => [document.querySelector('.studio-app')!.getBoundingClientRect().top, getComputedStyle(document.querySelector('.st-top')!).getPropertyValue('-webkit-app-region')])).toEqual([40, 'none']);
    // Окно с листами для PDF не появляется на экране
    await app.evaluate(({ app: a }) => {
      const g = globalThis as { shown?: number };
      g.shown = 0;
      a.on('browser-window-created', (_e, w) => w.once('show', () => { g.shown = (g.shown ?? 0) + 1; }));
    });
    // «Файл → Экспорт»: формат и «Сохранить»
    const exportAs = async (kind: string) => {
      await win.locator('#st-file').click();
      await win.locator('.fp [data-fs="export"]').click();
      await win.locator(`.fp [data-x="${kind}"]`).click();
      await win.locator('.fp [data-a="export"]').click();
    };
    await exportAs('pdf');
    const pdf = path.join(saves, 'Моя первая презентация.pdf');
    await expect.poll(() => fs.existsSync(pdf), { timeout: 60_000 }).toBe(true);
    const head = fs.readFileSync(pdf);
    expect(head.subarray(0, 5).toString()).toBe('%PDF-');
    // Страниц — по слайдам (скрытых в шаблоне нет)
    const pages = (head.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThan(10);
    await expect.poll(() => app.windows().length).toBe(1);
    expect(await app.evaluate(() => (globalThis as { shown?: number }).shown)).toBe(0);
    // Редактор говорит, что PDF готов и где он
    await expect(win.locator('#ed-toast')).toContainText('PDF сохранён');
    // «Справка → Лицензии» в студии — раздел «Файл → Лицензии», как у кнопки на вкладке «Инструменты»: без нового окна
    const lic = win;
    const windows = app.windows().length;
    await app.evaluate(({ Menu }) => {
      const help = Menu.getApplicationMenu()!.items.find((i) => i.label === 'Справка')!;
      help.submenu!.items.find((i) => i.label === 'Лицензии')!.click();
    });
    await expect(lic.locator('.fp [data-fs="licenses"]')).toHaveAttribute('aria-selected', 'true');
    expect(app.windows().length).toBe(windows);
    // Slideria, Electron, Chromium, шрифты, библиотеки
    await expect(lic.locator('.lc-text')).toContainText('Permission is hereby granted');
    for (const t of ['Electron', 'Chromium', 'Шрифты тем и формул', 'qrcode-generator']) await expect(lic.locator('.lc-row', { hasText: t }).first()).toBeVisible();
    await lic.locator('.lc-row', { hasText: 'Electron' }).click();
    await expect(lic.locator('.lc-name')).toHaveText('Electron');
    await expect(lic.locator('.lc-text')).toContainText('Electron');
    await lic.locator('.lc-row', { hasText: 'Chromium' }).click();
    await expect(lic.locator('.lc-pane a[href="/__slideria/licenses/chromium"]')).toBeVisible();
    expect(await lic.evaluate(() => fetch('/__slideria/licenses/chromium').then((r) => r.status))).toBe(200);
    await lic.keyboard.press('Escape');
    await expect(lic.locator('.fp')).toBeHidden();
    // Показ — крупным окном (80 % экрана), в заголовке без значка
    const [show] = await Promise.all([app.waitForEvent('window'), win.keyboard.press('F5')]);
    await expect(show).toHaveTitle(/^Показ — /);
    const size = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('Показ'))!;
      return { w: w.getBounds().width, area: screen.getPrimaryDisplay().workArea.width };
    });
    expect(size.w).toBeGreaterThan(size.area * 0.7);
    // …с системной рамкой: свой заголовок — только у главного окна
    await expect(show.locator('.slide').first()).toBeAttached();
    expect(await show.evaluate(() => [(window as { slideriaApp?: { frame?: boolean } }).slideriaApp?.frame, document.documentElement.classList.contains('app-frame')])).toEqual([false, false]);
    await show.close();
    // PowerPoint — скачиванием: сохраняется файлом
    await exportAs('pptx');
    const pptx = path.join(saves, 'moya-pervaya-prezentaciya.pptx');
    await expect.poll(() => fs.existsSync(pptx) && fs.statSync(pptx).size > 50_000, { timeout: 150_000 }).toBe(true);
    await expect(win.locator('#ed-toast')).toContainText('Сохранено: saves/moya-pervaya-prezentaciya.pptx');

    // Вход для телефона открывается по запросу и пускает только к этой презентации.
    // На Windows пропускаем: первый выход в сеть вызывает окно брандмауэра
    if (process.platform !== 'win32') {
      const info = await win.evaluate(() => fetch('/__slideria/remote/info?deck=moya-pervaya-prezentaciya').then((r) => r.json()));
      expect(info.app).toBe(true);
      if (info.urls.length) {
        const lan = info.urls[0];
        // Без пропуска из сети — ничего; одноразовая ссылка из QR даёт пропуск
        expect((await fetch(`${lan}/?deck=moya-pervaya-prezentaciya`)).status).toBe(403);
        const ticket = await win.evaluate(() => fetch('/__slideria/remote/open?room=apptestroom1', { method: 'POST', body: JSON.stringify({ next: '/?deck=moya-pervaya-prezentaciya&view=presenter&remote=apptestroom1' }) }).then((r) => r.json()).then((j) => j.ticket));
        const pair = await fetch(`${lan}/__slideria/remote/pair?t=${ticket}`, { redirect: 'manual' });
        expect(pair.status).toBe(302);
        const cookie = (pair.headers.get('set-cookie') ?? '').split(';')[0];
        expect((await fetch(`${lan}/?deck=moya-pervaya-prezentaciya`, { headers: { cookie } })).status).toBe(200);
        expect((await fetch(`${lan}/__htmlpptx/list`, { method: 'POST', headers: { cookie } })).status).toBe(403);
      }
    }
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('визуализатор в программе: микрофон и звук компьютера — каждый со своим вопросом', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-app-audio-'));
  // Поддельный микрофон Chromium: без устройства браузер отказывает сразу, не спрашивая
  const fake = ['--use-fake-device-for-media-stream'];
  const app = await electron.launch({
    ...(EXE ? { executablePath: EXE, args: [...sandbox, ...fake] } : { args: ['.', ...sandbox, ...fake] }),
    env: { ...process.env, SLIDERIA_DOCS_DIR: path.join(tmp, 'docs'), SLIDERIA_USER_DATA: path.join(tmp, 'data') },
    timeout: 60_000,
  });
  try {
    const win = await mainWindow(app);
    await win.waitForURL(/\/\?all$/, { timeout: 90_000 });
    // Вопросы программы записываются и запрещаются: окно не ждёт ответа
    await app.evaluate(({ dialog }) => {
      const g = globalThis as { asked?: string[] };
      g.asked = [];
      dialog.showMessageBox = (async (...a: unknown[]) => { g.asked!.push((a.at(-1) as { message: string }).message); return { response: 1, checkboxChecked: false }; }) as typeof dialog.showMessageBox;
    });
    // Слайд «Галерея и звук» стартового шаблона
    await win.goto(win.url().replace(/\?all$/, '?deck=moya-pervaya-prezentaciya#22'));
    const frame = win.locator('.slide.on .embed-frame');
    const viz = win.frameLocator('.slide.on .embed-frame');
    // Вставка загрузилась, слайд доиграл появление
    await expect(frame).toHaveClass(/\bon\b/);
    let last = '';
    await expect.poll(async () => { const b = JSON.stringify(await frame.boundingBox()); const same = b === last; last = b; return same; }).toBe(true);
    for (const id of ['mic', 'pc']) {
      // Слайд вписан в окно масштабом: щелчок — по месту кнопки на экране (звук экрана просит настоящий щелчок)
      const box = (await frame.boundingBox())!;
      const r = await viz.locator(`#${id}`).evaluate((b) => { const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, w: innerWidth }; });
      const k = box.width / r.w;
      await win.mouse.click(box.x + r.x * k, box.y + r.y * k);
      await expect(viz.locator(`#${id}`)).toHaveAttribute('title', /^Нет доступа к звуку/);
    }
    expect(await app.evaluate(() => (globalThis as { asked?: string[] }).asked)).toEqual(['Слайд просит доступ к микрофону', 'Слайд просит звук компьютера']);
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Закрыли окно или вышли из программы с правками — «Сохранить изменения?»: «Отмена» — окно остаётся; «Сохранить» —
// правка (даже за долю секунды до закрытия) в файле и точка «Когда закрыли»; «Не сохранять» — файл как при открытии
for (const how of ['кнопкой окна', 'выходом из программы'] as const) {
  test(`закрытие ${how}: вопрос о правках, «Отмена» — остаёмся, ${how === 'кнопкой окна' ? '«Сохранить»' : '«Не сохранять»'}`, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-app-close-'));
    const docs = path.join(tmp, 'docs');
    const name = 'moya-pervaya-prezentaciya';
    const file = path.join(docs, name, 'deck.yaml');
    const points = (dir: string, end: string) => {
      const d = path.join(docs, '.checkpoints', name, dir);
      return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(end)) : [];
    };
    const app = await electron.launch({
      ...(EXE ? { executablePath: EXE, args: sandbox } : { args: ['.', ...sandbox] }),
      env: { ...process.env, SLIDERIA_DOCS_DIR: docs, SLIDERIA_USER_DATA: path.join(tmp, 'data') },
      timeout: 60_000,
    });
    try {
      const win = await mainWindow(app);
      await win.waitForURL(/\/\?all$/, { timeout: 90_000 });
      await win.goto(win.url().replace(/\?all$/, `?deck=${name}&studio#1`));
      await expect(win.locator('#st-canvas .slide.on')).toBeVisible();
      await expect.poll(() => points('session', '.open.yaml').length).toBe(1);
      const original = fs.readFileSync(file, 'utf8');
      const slides = await win.locator('.st-slides-list > *').count();
      const close = () => (how === 'выходом из программы'
        ? app.evaluate(({ app: a }) => a.quit())
        // Кнопка окна на странице; на Mac — системная: закрываем окно из программы
        : process.platform === 'darwin'
          ? app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
          : win.locator('.app-wc button[aria-label="Закрыть"]').click());
      // Новый слайд — и сразу закрыть, не дожидаясь автосохранения
      await win.locator('#st-canvas').click({ position: { x: 4, y: 4 } });
      await win.keyboard.press('Control+m');
      await expect(win.locator('.st-slides-list > *')).toHaveCount(slides + 1);
      await close();
      const ask = win.locator('.lv');
      await expect(ask).toContainText('Добавлен слайд 2');
      // «Отмена» — окно и программа на месте, правка записана
      await win.keyboard.press('Escape');
      await expect(ask).toHaveCount(0);
      await expect.poll(() => fs.readFileSync(file, 'utf8').match(/^ {2}- /gm)?.length).toBe(slides + 1);
      expect(app.windows().filter((w) => w.url().startsWith('http'))).toHaveLength(1);
      // Ещё раз — и ответ
      const gone = win.waitForEvent('close');
      await close();
      await ask.locator(how === 'кнопкой окна' ? '[data-a="save"]' : '[data-a="discard"]').click();
      await gone;
      if (how === 'кнопкой окна') {
        expect(fs.readFileSync(file, 'utf8').match(/^ {2}- /gm)?.length).toBe(slides + 1);
        expect(points('session', '.close.yaml')).toHaveLength(1);
      } else {
        expect(fs.readFileSync(file, 'utf8')).toBe(original);
        expect(points('dropped', '.yaml')).toHaveLength(1);
        expect(points('session', '.close.yaml')).toHaveLength(0);
      }
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}

test('чат «Агент» в программе: ключ — зашифрованным в данных программы, после перезапуска Claude подключён', async () => {
  const mock = await startMockClaude();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-app-chat-'));
  const data = path.join(tmp, 'data');
  const env = { ...process.env, SLIDERIA_DOCS_DIR: path.join(tmp, 'docs'), SLIDERIA_USER_DATA: data, SLIDERIA_ANTHROPIC_URL: mock.url, ANTHROPIC_API_KEY: '' };
  const launch = () => electron.launch({ ...(EXE ? { executablePath: EXE, args: sandbox } : { args: ['.', ...sandbox] }), env, timeout: 60_000 });
  const studio = async (app: ElectronApplication) => {
    const win = await mainWindow(app);
    await win.waitForURL(/\/\?all$/, { timeout: 90_000 });
    await win.goto(win.url().replace(/\?all$/, '?deck=moya-pervaya-prezentaciya&studio#1'));
    await expect(win.locator('#st-canvas .slide.on')).toBeVisible();
    // Панель агента программа помнит открытой с прошлого раза
    if (await win.locator('#st-chat').isHidden()) await win.keyboard.press('Control+j');
    await expect(win.locator('#st-chat')).toBeVisible();
    return win;
  };
  let app = await launch();
  try {
    const win = await studio(app);
    // Linux без хранилища паролей (как в тестах) — честная оговорка; в остальных системах — «в зашифрованном виде»
    await expect(win.locator('.ac-key')).toContainText(process.platform === 'linux' ? 'зашифрованным' : 'в зашифрованном виде');
    await win.locator('#ac-key-in').fill('sk-ant-test-app-12345');
    await win.locator('.ac-key button[type=submit]').click();
    await expect(win.locator('.ac-ta')).toBeEnabled();
    const file = path.join(data, 'claude-key.bin');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file).toString('latin1')).not.toContain('sk-ant-test-app');
    // Страница ключа не видит: в ответе сервера его нет
    expect(JSON.stringify(await win.evaluate(() => fetch('/__htmlpptx/chat-status', { method: 'POST' }).then((r) => r.json())))).not.toContain('sk-ant');
    await app.close();
    // Перезапуск — Claude подключён: запрос агенту уходит с тем же ключом
    app = await launch();
    const again = await studio(app);
    await expect(again.locator('.ac-ta')).toBeEnabled();
    mock.queue({ text: 'Привет из программы.' });
    await again.locator('.ac-ta').fill('Привет');
    await again.locator('.ac-ta').press('Enter');
    await expect(again.locator('.ac-txt')).toHaveText('Привет из программы.');
    expect(mock.lastAuth()).toBe('sk-ant-test-app-12345');
    // «Отключить ключ Claude» — файла ключа нет
    await again.locator('.ac-model').click();
    await again.locator('.ac-menu [data-a="disconnect"]').click();
    await expect(again.locator('.ac-key')).toBeVisible();
    expect(fs.existsSync(file)).toBe(false);
  } finally {
    await app.close().catch(() => {});
    await mock.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('собранная программа: изменённый код не запускается', async () => {
  test.skip(!EXE, 'только для собранной программы (SLIDERIA_APP_EXE)');
  const file = path.join(path.dirname(EXE!), 'resources', 'app.asar.unpacked', 'app', 'server.mjs');
  const was = fs.readFileSync(file);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-app-tamper-'));
  const env = { ...process.env, SLIDERIA_DOCS_DIR: path.join(tmp, 'docs'), SLIDERIA_USER_DATA: path.join(tmp, 'data') };
  try {
    fs.writeFileSync(file, Buffer.concat([was, Buffer.from('\nconsole.log(1);')]));
    const r = spawnSync(EXE!, sandbox, { env, timeout: 60_000, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(fs.readFileSync(path.join(tmp, 'data', 'slideria.log'), 'utf8')).toContain('Код программы изменён, запуск остановлен: app/server.mjs');
    // Сам Electron в роли Node не запускается: предохранитель выключен
    const node = spawnSync(EXE!, ['-e', 'console.log("node-mode")'], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 20_000, encoding: 'utf8' });
    expect(node.stdout ?? '').not.toContain('node-mode');
  } finally {
    fs.writeFileSync(file, was);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
