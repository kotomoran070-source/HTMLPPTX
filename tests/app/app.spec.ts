// Приложение Electron: первый запуск, страница выбора, экспорт (сборка — служебным процессом Electron),
// вход для телефона. Папки — временные: настоящие «Документы/Slideria» и данные приложения не трогаются.
// SLIDERIA_APP_EXE=путь — то же для собранной программы (SLIDERIA_FUSES_TEST=1 node scripts/app-build.mjs --linux dir):
// сжатый код рядом с app.asar, предохранители Electron, а изменённый код программа не запускает
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { _electron as electron, expect, test } from '@playwright/test';

const EXE = process.env.SLIDERIA_APP_EXE;
const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];

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
    const win = await app.firstWindow();
    await win.waitForURL(/\/\?all$/, { timeout: 90_000 });
    await expect(win.locator('.pk-card[data-name="moya-pervaya-prezentaciya"]')).toBeVisible();
    await expect(win.locator('.pk-hero')).toContainText('Документы/Slideria');
    expect(fs.existsSync(path.join(docs, 'moya-pervaya-prezentaciya', 'deck.yaml'))).toBe(true);
    // Подсказки внизу — без команд терминала; какая это сборка программы
    await expect(win.locator('.pk-foot')).not.toContainText('yarn');
    await expect(win.locator('.pk-build')).toContainText(EXE ? 'сборка от' : 'запуск из проекта');
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
    // Окно с листами для PDF не появляется на экране
    await app.evaluate(({ app: a }) => {
      const g = globalThis as { shown?: number };
      g.shown = 0;
      a.on('browser-window-created', (_e, w) => w.once('show', () => { g.shown = (g.shown ?? 0) + 1; }));
    });
    await win.locator('[data-cmd="file.export"]').first().click();
    await win.locator('[data-x="pdf"]').click();
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
    // «Справка → Лицензии» — окно программы с той же страницей, что у кнопки на вкладке «Инструменты»
    const [lic] = await Promise.all([app.waitForEvent('window'), app.evaluate(({ Menu }) => {
      const help = Menu.getApplicationMenu()!.items.find((i) => i.label === 'Справка')!;
      help.submenu!.items.find((i) => i.label === 'Лицензии')!.click();
    })]);
    await expect(lic).toHaveTitle('Slideria — лицензии');
    const licText = (await lic.locator('body').textContent()) ?? '';
    for (const t of ['Slideria — MIT', 'Electron — MIT', 'SIL OPEN FONT LICENSE', 'qrcode-generator', 'лицензии Chromium']) expect(licText).toContain(t);
    expect(await lic.evaluate(() => fetch('/__slideria/licenses/chromium').then((r) => r.status))).toBe(200);
    // У страницы свой фон: тёмная подложка окна программы не просвечивает под тёмным текстом
    expect(await lic.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await lic.close();
    // Показ — крупным окном (80 % экрана), в заголовке без значка
    const [show] = await Promise.all([app.waitForEvent('window'), win.keyboard.press('F5')]);
    await expect(show).toHaveTitle(/^Показ — /);
    const size = await app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.getTitle().startsWith('Показ'))!;
      return { w: w.getBounds().width, area: screen.getPrimaryDisplay().workArea.width };
    });
    expect(size.w).toBeGreaterThan(size.area * 0.7);
    await show.close();
    // PowerPoint — скачиванием: сохраняется файлом
    await win.locator('[data-cmd="file.export"]').first().click();
    await win.locator('[data-x="pptx"]').click();
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
    const win = await app.firstWindow();
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

test('собранная программа: изменённый код не запускается', async () => {
  test.skip(!EXE, 'только для собранной программы (SLIDERIA_APP_EXE)');
  const file = path.join(path.dirname(EXE!), 'resources', 'app.asar.unpacked', 'src', 'main.ts');
  const was = fs.readFileSync(file);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-app-tamper-'));
  const env = { ...process.env, SLIDERIA_DOCS_DIR: path.join(tmp, 'docs'), SLIDERIA_USER_DATA: path.join(tmp, 'data') };
  try {
    fs.writeFileSync(file, Buffer.concat([was, Buffer.from('\nconsole.log(1);')]));
    const r = spawnSync(EXE!, sandbox, { env, timeout: 60_000, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(fs.readFileSync(path.join(tmp, 'data', 'slideria.log'), 'utf8')).toContain('Код программы изменён, запуск остановлен: src/main.ts');
    // Сам Electron в роли Node не запускается: предохранитель выключен
    const node = spawnSync(EXE!, ['-e', 'console.log("node-mode")'], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 20_000, encoding: 'utf8' });
    expect(node.stdout ?? '').not.toContain('node-mode');
  } finally {
    fs.writeFileSync(file, was);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
