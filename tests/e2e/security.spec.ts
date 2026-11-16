// Безопасность чужой презентации: разметка HTML-блока и SVG-определений (engine/sanitize.ts) не исполняет ничего
// ни в показе, ни в студии — ни сама (mXSS, обработчики), ни по щелчку (javascript: в адресах, SVG-анимация адреса);
// незакрытая разметка одного слайда не «съедает» следующие (engine/deck-view.ts, build); политика CSP страниц (PAGE_CSP)
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { DECKS, watchErrors } from './helpers';

const PWN = 'top.__pwn=(top.__pwn||0)+1';
const VECTORS = [
  `<math><mtext><table><mglyph><style><img src="data:image/png;base64,AA==" onerror="${PWN}">`,
  `<a id="v-tab" href="java&#9;script:${PWN}">таб</a>`,
  `<a id="v-nl" href="java&#10;script:${PWN}">строка</a>`,
  `<a id="v-ctl" href="&#1;javascript:${PWN}">символ</a>`,
  `<svg width="60" height="30"><a id="v-anim"><animate attributeName="href" values="javascript:${PWN}"/><text y="20">анимация</text></a></svg>`,
  `<svg width="60" height="30"><a id="v-set"><set attributeName="href" to="javascript:${PWN}"/><text y="20">set</text></a></svg>`,
  `<template><img src="data:image/png;base64,AA==" onerror="${PWN}"></template>`,
  `<div><template shadowrootmode="open"><img src="data:image/png;base64,AA==" onerror="${PWN}"></template></div>`,
  `<img src="data:image/png;base64,AA==" onerror="${PWN}">`,
  `<a id="v-ok" href="https://example.com/">обычная ссылка</a>`,
];
const DEFS = `<linearGradient id="g"/></defs></svg><img src="data:image/png;base64,AA==" onerror="${PWN}"><a id="v-defs" href="java&#9;script:${PWN}">defs</a><svg><defs>`;

/** Ничего исполняемого в слайдах и определениях: обработчики, скрипты, адреса javascript:, анимация адреса */
const risky = (page: Page) => page.evaluate(() => {
  const bad: string[] = [];
  const walk = (root: ParentNode) => root.querySelectorAll('*').forEach((el) => {
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) bad.push(`${el.tagName}[${a.name}]`);
      if (/href$|^src$/i.test(a.name)) {
        try { if (new URL(a.value, location.href).protocol === 'javascript:') bad.push(`${el.tagName}[${a.name}=javascript:]`); } catch { /* не адрес */ }
      }
    }
    if (/^(animate|set)$/i.test(el.tagName) && /href/i.test(el.getAttribute('attributeName') ?? '')) bad.push(`${el.tagName}→href`);
    if (el.tagName === 'PLAINTEXT') bad.push('PLAINTEXT');
    if (el.tagName === 'TEMPLATE' && el.closest('.slide')) bad.push('TEMPLATE в слайде');
    if (el.shadowRoot) walk(el.shadowRoot);
  });
  walk(document);
  return { bad, pwn: (window as unknown as { __pwn?: number }).__pwn ?? 0 };
});

test('чужая вёрстка: ничего не исполняется ни в показе, ни в студии, слайды на месте', async ({ page }) => {
  const errors = watchErrors(page);
  const dir = path.join(DECKS, 'secure');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'deck.yaml'), stringify({
    title: 'Чужая вёрстка',
    defs: DEFS,
    slides: [
      {
        template: 'canvas',
        free: VECTORS.map((html, i) => ({ type: 'html', html, place: { x: 40 + (i % 5) * 240, y: 60 + Math.floor(i / 5) * 200, w: 220, h: 160 } })),
      },
      { template: 'canvas', free: [{ type: 'html', html: '<p>до</p><plaintext>всё дальше — текст' , place: { x: 80, y: 80, w: 600, h: 200 } }] },
      { template: 'canvas', free: [{ type: 'text', text: 'Третий слайд на месте', place: { x: 80, y: 80, w: 800 } }] },
    ],
  }));
  try {
    for (const url of ['/?deck=secure', '/?deck=secure&studio']) {
      await page.goto(url);
      await expect(page.locator('#v-ok').first()).toBeAttached();
      await page.waitForTimeout(400);
      // Ссылки на месте, но без опасных адресов: щелчок по ним ничего не исполняет
      for (const id of ['v-tab', 'v-nl', 'v-ctl', 'v-anim', 'v-set']) {
        const a = page.locator(`#${id}`).first();
        if (await a.count()) await a.evaluate((el) => (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
      }
      const r = await risky(page);
      expect(r.bad, url).toEqual([]);
      expect(r.pwn, url).toBe(0);
      // Обычная ссылка не тронута
      await expect(page.locator('#v-ok').first()).toHaveAttribute('href', 'https://example.com/');
      // Все три слайда — и третий после <plaintext> во втором
      const stage = url.includes('studio') ? '#st-canvas .stage' : '.stage';
      await expect(page.locator(`${stage} > .slide`)).toHaveCount(3);
    }
    expect(errors).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('файлы презентации на адресе программы: HTML и SVG открываются без скриптов, картинка SVG видна', async ({ page }) => {
  const dir = path.join(DECKS, 'secfiles');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#2563EB"/><script>top.__pwn=1;fetch("/__htmlpptx/save?deck=secfiles",{method:"POST",body:"{}"})</script></svg>';
  fs.writeFileSync(path.join(dir, 'assets', 'evil.svg'), svg);
  fs.writeFileSync(path.join(dir, 'assets', 'evil.html'), '<!doctype html><title>чужая</title><script>window.__pwn=1</script><p>страница</p>');
  fs.writeFileSync(path.join(dir, 'deck.yaml'), stringify({
    title: 'Файлы',
    slides: [{ template: 'canvas', free: [{ type: 'image', src: './assets/evil.svg', place: { x: 80, y: 80, w: 320, h: 160 } }] }],
  }));
  const url = (f: string) => '/' + path.relative(process.cwd(), path.join(dir, 'assets', f)).split(path.sep).join('/');
  try {
    for (const f of ['evil.svg', 'evil.html']) {
      const r = await page.goto(url(f));
      expect(r?.status(), f).toBe(200);
      expect(r?.headers()['content-security-policy'], f).toBe('sandbox');
      // Страница открылась, но её скрипт не исполнился (и до API программы не дотянулся)
      expect(await page.evaluate(() => (window as unknown as { __pwn?: number }).__pwn ?? 0), f).toBe(0);
    }
    // Картинка SVG на слайде показывается как обычно
    await page.goto('/?deck=secfiles');
    const img = page.locator('.slide.on img').first();
    await expect(img).toBeVisible();
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('страницы студии и показа: политика CSP; внутри чужой страницы студия не открывается, внутри своей — да', async ({ page, baseURL }) => {
  const r = await page.goto('/?deck=tpl&studio');
  const csp = r?.headers()['content-security-policy'] ?? '';
  for (const d of ["object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'"]) expect(csp).toContain(d);
  await expect(page.locator('#st-canvas .slide').first()).toBeAttached();
  // Тот же сервер под другим именем — другой адрес (чужая страница): рамка со студией не открывается
  const own = new URL(baseURL!);
  const other = `${own.protocol}//127.0.0.1:${own.port}`;
  const frameIn = async (host: string) => {
    await page.goto(`${host}/?deck=tpl`);
    await page.evaluate((u) => new Promise<void>((done) => {
      const f = Object.assign(document.createElement('iframe'), { src: u, id: 'zz-frame' });
      f.addEventListener('load', () => done());
      document.body.appendChild(f);
    }), `${own.origin}/?deck=tpl&studio`);
    return page.frameLocator('#zz-frame').locator('#st-canvas');
  };
  await expect(await frameIn(own.origin)).toBeAttached();
  const blocked = await frameIn(other);
  await page.waitForTimeout(1000);
  await expect(blocked).toHaveCount(0);
});
