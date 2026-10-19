// Скорость показа: yarn test:perf. Слайды с живой анимацией — небо «орбиты» (canvas), анимированные
// фоны (WebGL) — 4 секунды в окне показа: сколько кадров вышло и сколько работы браузера на них ушло
// (скрипты, всё вместе) по CDP. Итог — таблицей в консоли и в .tmp/perf-show.json: сравнивать версии на одной машине
import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test.setTimeout(180_000);

const SLIDES: [string, string][] = [
  ['небо «орбиты»', '/?deck=space#1'],
  ['фон «Сеть»', '/?deck=space#2'],
  ['фон «Частицы»', '/?deck=slideria#2'],
  ['фон «Сияние»', '/?deck=slideria#1'],
];

test('скорость показа', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const get = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m: { name: string; value: number }) => [m.name, m.value]));
  const out: Record<string, Record<string, number>> = {};
  for (const [name, url] of SLIDES) {
    await page.goto(url);
    await expect(page.locator('.slide.on')).toHaveCount(1);
    // Слайд с живой анимацией на месте (а не страница «нет такой презентации»)
    await expect(page.locator('.slide.on canvas')).not.toHaveCount(0);
    await page.waitForTimeout(1500);
    const a = await get();
    const frames = await page.evaluate(() => new Promise<number>((done) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else done(n); };
      requestAnimationFrame(tick);
    }));
    const b = await get();
    out[name] = {
      fps: Math.round(frames / 4),
      task: Math.round((b.TaskDuration - a.TaskDuration) * 1000),
      script: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000),
    };
  }
  fs.writeFileSync(process.env.PERF_OUT ?? '.tmp/perf-show.json', JSON.stringify(out, null, 1));
  const pad = (v: unknown, n: number) => String(v ?? '').padStart(n);
  console.log(`\n${'слайд (4 с показа)'.padEnd(24)}${pad('кадров/с', 10)}${pad('работа, мс', 12)}${pad('скрипты, мс', 13)}`);
  for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(24)}${pad(v.fps, 10)}${pad(v.task, 12)}${pad(v.script, 13)}`);
});
