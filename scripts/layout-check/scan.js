// Сканер раскладки интерфейса студии (yarn layout, scripts/layout-check.mjs) — подключается в страницу до её кода.
// Ищет то, что портит вид в тесноте и с длинными именами: вылезает за свой блок, срезано сбоку или без «…»,
// уходит за край окна, текст наезжает на текст. Содержимое слайдов (вёрстку автора) не проверяет: там выход
// за рамки — норма. Не находка и то, что задумано: ленты, которые листаются стрелками или колесом, ручки размера
window.__layoutScan = () => {
  const vw = innerWidth, vh = innerHeight;
  const cs = (e) => getComputedStyle(e);
  // Слайды (и сцена показа: «Крупнее» нарочно растит слайд), миниатюры и превью слайдов, образцы переходов и эффектов (мини-сцены: их части нарочно за краем
  // плитки), холст правки (рамка выделения и ручки выходят за объект нарочно), служебное
  const SKIP = '#st-canvas, .stage, .slide, .thumb, .thumb-stage, .st-trv, .st-fxv, svg, canvas, video, iframe, .layout-mark, #boot';
  // Задумано выходить за край: ручка высоты заметок, стрелки листания поверх края ленты
  const OWN = '.st-split, .st-bdnav';
  const alpha = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return c === 'transparent' ? 0 : 1;
    const p = m[1].split(/[ ,/]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]) : 1;
  };
  const clips = (s) => s.overflowX !== 'visible' || s.overflowY !== 'visible';
  const scrolls = (s) => /auto|scroll/.test(s.overflowX + s.overflowY);
  /** Блок — то, что видно рамкой, фоном или тенью, или что обрезает содержимое */
  const isBox = (a) => {
    const s = cs(a);
    // Обёртка без своего прямоугольника (display: contents): её размеры нулевые, блоком она не бывает
    if (s.display === 'contents') return false;
    if (clips(s)) return true;
    if (alpha(s.backgroundColor) > 0.05 || s.backgroundImage !== 'none') return true;
    if (['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(s[`border${k}Width`]) > 0 && alpha(s[`border${k}Color`]) > 0.05)) return true;
    return s.boxShadow !== 'none';
  };
  /** Лента вбок, так задуманная: со стрелками [data-nav] рядом или ужатая лентой ([data-shrink], листается колесом) */
  const rail = (box, s) => /auto|scroll|hidden/.test(s.overflowX) && (box.matches('[data-shrink]') || !!box.parentElement?.querySelector(':scope > [data-nav]'));
  const name = (e) => {
    const parts = [];
    for (let a = e; a && a !== document.body && parts.length < 4; a = a.parentElement) {
      const c = typeof a.className === 'string' ? a.className.trim().split(/\s+/).filter((x) => x && !/^(on|sel|active|open|hid|over|fl|fr)$/.test(x))[0] : '';
      parts.unshift(`${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''}${c ? `.${c}` : ''}${a.dataset?.cmd ? `[${a.dataset.cmd}]` : ''}`);
      if (a.id) break;
    }
    return parts.join(' > ');
  };
  const own = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  /** Живой образец (переход, эффект) движется внутри своей плитки — выход за неё и есть анимация */
  const moving = (e, box) => {
    for (let a = e; a && a !== box; a = a.parentElement) if (a.getAnimations().some((x) => x.playState === 'running')) return true;
    return false;
  };
  /** Рамка поля нарочно шире колонки (отрицательные поля), чтобы текст стоял вровень с соседями */
  const bleed = (s) => Math.max(0, ...['Left', 'Right', 'Top', 'Bottom'].map((k) => -parseFloat(s[`margin${k}`]) || 0));
  const text = (e) => (e.textContent || e.getAttribute?.('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const out = [];
  // Вылезло целое — его части уже не перечисляются
  const flagged = new Set();
  const under = (e) => { for (let a = e.parentElement; a; a = a.parentElement) if (flagged.has(a)) return true; return false; };
  const add = (kind, e, over, r) => {
    flagged.add(e);
    out.push({ kind, path: name(e), text: text(e), over: Math.round(over), r: [r.left, r.top, r.width, r.height].map(Math.round) });
  };
  for (const e of document.body.querySelectorAll('*')) {
    if (e.closest(SKIP) || e.closest(OWN) || /^(SCRIPT|STYLE|TEMPLATE|OPTION|BR)$/.test(e.tagName)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (!e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const s = cs(e);
    // Всплывающее (меню, окно, подсказка) — целиком в окне
    if (s.position === 'fixed' && e.parentElement === document.body) {
      const over = Math.max(r.right - vw, r.bottom - vh, -r.left, -r.top);
      if (over > 1 && !under(e)) add('за краем окна', e, over, r);
      continue;
    }
    if (under(e)) continue;
    let box = e.parentElement;
    while (box && box !== document.body && !isBox(box)) box = box.parentElement;
    if (!box || box === document.body || box === document.documentElement) {
      const over = Math.max(r.right - vw, r.bottom - vh, -r.left, -r.top);
      if (over > 1) add('за краем окна', e, over, r);
      continue;
    }
    const c = box.getBoundingClientRect();
    const bs = cs(box);
    const over = Math.max(r.right - c.right, c.left - r.left, r.bottom - c.bottom, c.top - r.top);
    if (over > bleed(s) + 1 && !moving(e, box)) {
      const side = Math.max(r.right - c.right, c.left - r.left);
      // Лента, что листается только вбок, — так задумано; остальное, что шире своей области, срезано или уезжает вбок
      const hs = /auto|scroll/.test(bs.overflowX) && !/auto|scroll/.test(bs.overflowY);
      // Поставленное поверх (меню у кнопки, подпись у полосы, значок) выходит за свой блок нарочно — ему только
      // целиком в окне
      if (!clips(bs) && s.position === 'absolute') {
        const out = Math.max(r.right - vw, r.bottom - vh, -r.left, -r.top);
        if (out > 1) add('за краем окна', e, out, r);
      } else if (!clips(bs)) add('вылезает за блок', e, over, r);
      else if (side > 2 && !hs && !rail(box, bs)) add(own(e) ? 'текст срезан рамкой' : 'срезано сбоку', e, side, r);
    }
    // Текст не влез в свой блок и срезан без «…»
    if (own(e) && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) && !e.isContentEditable) {
      if (s.overflowX !== 'visible' && !scrolls(s) && e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== 'ellipsis' && s.webkitLineClamp === 'none') add('текст срезан без «…»', e, e.scrollWidth - e.clientWidth, r);
      else if (s.overflowY !== 'visible' && !scrolls(s) && e.scrollHeight > e.clientHeight + 2 && s.webkitLineClamp === 'none') add('текст срезан снизу', e, e.scrollHeight - e.clientHeight, r);
    }
  }
  // Текст на тексте внутри одного блока (разные блоки друг над другом — это слои: меню поверх ленты)
  const runs = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const p = n.parentElement;
    if (!n.textContent.trim() || !p || p.closest(SKIP) || p.closest('script, style')) continue;
    if (!p.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    let box = p;
    while (box && box !== document.body && !isBox(box)) box = box.parentElement;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const q of range.getClientRects()) if (q.width > 2 && q.height > 2) runs.push({ p, box, q });
  }
  const seen = new Set();
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const a = runs[i], b = runs[j];
    if (a.p === b.p || a.box !== b.box || a.p.contains(b.p) || b.p.contains(a.p)) continue;
    const w = Math.min(a.q.right, b.q.right) - Math.max(a.q.left, b.q.left);
    const h = Math.min(a.q.bottom, b.q.bottom) - Math.max(a.q.top, b.q.top);
    if (w < 2 || h < Math.min(a.q.height, b.q.height) * 0.35) continue;
    const k = `${name(a.p)}|${name(b.p)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const l = Math.min(a.q.left, b.q.left), t = Math.min(a.q.top, b.q.top);
    out.push({ kind: 'текст на тексте', path: `${name(a.p)}  ×  ${name(b.p)}`, text: `${text(a.p).slice(0, 28)} × ${text(b.p).slice(0, 28)}`, over: Math.round(w),
      r: [l, t, Math.max(a.q.right, b.q.right) - l, Math.max(a.q.bottom, b.q.bottom) - t].map(Math.round) });
  }
  const sw = document.documentElement.scrollWidth - vw;
  if (sw > 1) out.push({ kind: 'страница прокручивается вбок', path: 'html', text: '', over: sw, r: [0, 0, vw, vh] });
  return out;
};

/** Рамки с номерами вокруг находок — для снимка */
window.__layoutMark = (list) => {
  document.querySelectorAll('.layout-mark').forEach((m) => m.remove());
  list.forEach((it, n) => {
    const m = document.createElement('div');
    m.className = 'layout-mark';
    m.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${it.r[0] - 2}px;top:${it.r[1] - 2}px;width:${it.r[2] + 4}px;height:${it.r[3] + 4}px;outline:2px solid #ff1744;font:700 11px system-ui;color:#fff`;
    m.innerHTML = `<span style="position:absolute;left:-2px;top:-16px;background:#ff1744;padding:0 4px;border-radius:3px">${n + 1}</span>`;
    document.body.appendChild(m);
  });
};
