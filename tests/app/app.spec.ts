// Приложение Electron: первый запуск, страница выбора, экспорт (сборка идёт через сам Electron),
// вход для телефона. Папки — временные: настоящие «Документы/Slideria» и данные приложения не трогаются.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('первый запуск: «Моя первая презентация», экспорт и вход для телефона', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-app-test-'));
  const docs = path.join(tmp, 'docs');
  const app = await electron.launch({
    args: ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, SLIDERIA_DOCS_DIR: docs, SLIDERIA_USER_DATA: path.join(tmp, 'data') },
    timeout: 60_000,
  });
  try {
    const win = await app.firstWindow();
    await win.waitForURL(/\/\?all$/, { timeout: 90_000 });
    await expect(win.locator('.pk-card[data-name="moya-pervaya-prezentaciya"]')).toBeVisible();
    await expect(win.locator('.pk-hero')).toContainText('Документы/Slideria');
    expect(fs.existsSync(path.join(docs, 'moya-pervaya-prezentaciya', 'deck.yaml'))).toBe(true);
    // Подсказки внизу — без команд терминала
    await expect(win.locator('.pk-foot')).not.toContainText('yarn');

    // Экспорт: сборка во втором процессе Electron в роли Node (ELECTRON_RUN_AS_NODE)
    const exp = await win.evaluate(async () => {
      const r = await fetch('/__htmlpptx/export?deck=moya-pervaya-prezentaciya&mode=clean', { method: 'POST' });
      return { status: r.status, size: (await r.text()).length };
    });
    expect(exp.status).toBe(200);
    expect(exp.size).toBeGreaterThan(200_000);

    // Вход для телефона открывается по запросу и пускает только к этой презентации.
    // На Windows пропускаем: первый выход в сеть вызывает окно брандмауэра
    if (process.platform !== 'win32') {
      const info = await win.evaluate(() => fetch('/__slideria/remote/info?deck=moya-pervaya-prezentaciya').then((r) => r.json()));
      expect(info.app).toBe(true);
      if (info.urls.length) {
        const lan = info.urls[0];
        expect((await fetch(`${lan}/?deck=moya-pervaya-prezentaciya`)).status).toBe(200);
        expect((await fetch(`${lan}/__htmlpptx/list`, { method: 'POST' })).status).toBe(403);
      }
    }
  } finally {
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
