// Автотесты Slideria: yarn test (всё), yarn test:unit (быстрые, без браузера)
//   unit — функции движка и сервера без браузера;
//   e2e  — сервер разработки на временной копии презентаций (.tmp/test-decks) и браузер;
//   app  — приложение Electron во временных папках;
//   perf — скорость студии и показа (yarn test:perf), только по запросу.
// Браузер: на Windows — установленный Microsoft Edge (качать ничего не нужно),
// в остальных системах — Chromium Playwright (npx playwright install chromium).
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const PORT = 5190;
// Какой сервер под тестами:
//   по умолчанию — yarn dev (Vite с исходниками страниц);
//   SLIDERIA_SERVE=1 — сервер программы без Vite на собранной студии (scripts/serve.mjs, server/serve.ts);
//   SLIDERIA_STAGE=папка — он же на коде из копии для установщика (node scripts/app-stage.mjs): так
//   проверяется, что установщик работает так же. Пути — полные: «Экспорт» и шаблоны берутся из папки копии
const stage = process.env.SLIDERIA_STAGE;
const serve = process.env.SLIDERIA_SERVE === '1' || !!stage;
const tmp = (p: string) => (stage ? path.resolve(p) : p);
const channel = process.env.SLIDERIA_TEST_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined);
const server = stage
  ? `node scripts/serve.mjs --port=${PORT} --root="${stage}" --code="${path.join(stage, 'app')}"`
  : serve ? `node scripts/serve.mjs --port=${PORT}` : `npx vite --port ${PORT} --strictPort`;

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
    // Скорость студии и показа (yarn test:perf): только по запросу, в yarn test не входит
    { name: 'perf', testDir: 'tests/perf', timeout: 300_000 },
  ],
  webServer: {
    // Копия презентаций для тестов, затем сервер на ней: правки тестов не трогают presentations/.
    // Код программы (.tmp/app) — заранее: его берут тесты программы (tests/app), если он поменялся
    command: `node tests/prepare.mjs && node scripts/build.mjs --app && ${server}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      SLIDERIA_DECKS: tmp('.tmp/test-decks'), SLIDERIA_FONTS: tmp('.tmp/test-fonts'), SLIDERIA_LIBRARY: tmp('.tmp/test-library'), BROWSER: 'none',
      // Чат «Агент»: подставной Claude (tests/mock-claude.ts, его поднимает tests/e2e/chat.spec.ts), ключ — только введённый в тесте
      SLIDERIA_ANTHROPIC_URL: 'http://127.0.0.1:5191', ANTHROPIC_API_KEY: '',
      // package.json программы — не в папке сжатого кода, как и в установленной программе
      ...(stage ? { SLIDERIA_PACKAGE: path.resolve('package.json') } : {}),
    },
  },
});
