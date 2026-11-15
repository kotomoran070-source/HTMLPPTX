// История правок → sessionStorage: сколько стоит одна запись (настоящий класс History из исходников)
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: process.env.SLIDERIA_CHROMIUM || undefined });
const page = await (await browser.newContext()).newPage();
await page.goto('http://localhost:5193/?deck=tpl&studio');
await page.waitForSelector('#st-canvas .slide.on');
await page.waitForTimeout(2000);
for (const [label, slides, kb, steps] of [['155 слайдов по ~3 КБ, 100 шагов', 155, 3, 100], ['155 слайдов по ~3 КБ, 500 шагов', 155, 3, 500], ['40 слайдов по ~60 КБ (импорт HTML, SVG), 100 шагов', 40, 60, 100], ['40 слайдов по ~60 КБ, 300 шагов', 40, 60, 300]]) {
  const r = await page.evaluate(async ([slides, kb, steps]) => {
    const { History } = await import('/src/engine/editor/history.ts');
    const h = new History('zz-audit');
    const pad = (i, v) => ({ id: `s${i}`, template: 'canvas', v, html: 'д'.repeat(kb * 1000) });
    const deck = { title: 'x', theme: { accent: '#123456' }, slides: Array.from({ length: slides }, (_, i) => pad(i, 0)) };
    const t0 = performance.now();
    let snap = h.snap(deck);
    const tSnap = performance.now() - t0;
    for (let k = 1; k <= steps; k++) { h.push(snap); deck.slides[k % slides] = pad(k % slides, k); snap = h.snap(deck); }
    const ts = [];
    for (let k = 0; k < 3; k++) { const a = performance.now(); h.write(snap); ts.push(Math.round(performance.now() - a)); }
    const a = performance.now(); History.key(snap); const tKey = performance.now() - a;
    const stored = (sessionStorage.getItem('htmlpptx-history:zz-audit') || '').length;
    let kept = 0; try { kept = JSON.parse(sessionStorage.getItem('htmlpptx-history:zz-audit')).past.length; } catch {}
    sessionStorage.removeItem('htmlpptx-history:zz-audit');
    return { 'снимок всей презентации, мс': Math.round(tSnap), 'запись истории, мс (3 раза)': ts, 'отпечаток (hash), мс': Math.round(tKey), 'записано, МБ символов': +(stored / 1e6).toFixed(1), 'шагов уцелело': kept };
  }, [slides, kb, steps]);
  console.log(label, '→', JSON.stringify(r));
}
await browser.close();
