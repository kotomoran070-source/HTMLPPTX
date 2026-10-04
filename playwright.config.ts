// Автотесты Slideria: yarn test (всё), yarn test:unit (быстрые, без браузера)
//   unit — функции движка и сервера без браузера;
//   e2e  — сервер разработки на временной копии презентаций (.tmp/test-decks) и браузер;
//   app  — приложение Electron во временных папках.
// Браузер: на Windows — установленный Microsoft Edge (качать ничего не нужно),
// в остальных системах — Chromium Playwright (npx playwright install chromium).
import { defineConfig } from '@playwright/test';

const PORT = 5190;
const channel = process.env.SLIDERIA_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: 'tests',
  outputDir: '.tmp/test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1600, height: 900 },
    channel,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'unit', testDir: 'tests/unit' },
    { name: 'e2e', testDir: 'tests/e2e' },
    { name: 'app', testDir: 'tests/app', timeout: 120_000 },
  ],
  webServer: {
    // Копия презентаций для тестов, затем сервер на ней: правки тестов не трогают presentations/
    command: `node tests/prepare.mjs && npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { SLIDERIA_DECKS: '.tmp/test-decks', SLIDERIA_FONTS: '.tmp/test-fonts', BROWSER: 'none' },
  },
});
