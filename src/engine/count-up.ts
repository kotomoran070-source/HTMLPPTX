/**
 * «Число набегает»: у объекта с count: true числа в тексте при появлении слайда отсчитываются
 * от нуля до своего значения — с тем же видом записи («17 234», «2,4», «$12.84M», «−5 %»);
 * count: odometer — цифры прокручиваются барабаном, как на счётчике, и встают на свои места
 * (младшие крутятся дольше). Только при показе и в «Просмотре»: в правке текст не трогается.
 * Конец отсчёта — ровно исходный текст; остановка возвращает разметку как была.
 */
const NUM = /[-−]?\d{1,3}(?:[   ,]\d{3})+(?:[.,]\d+)?|[-−]?\d+(?:[.,]\d+)?/g;
const MS = 1400;

interface Part { node: Text; text: string; nums: { start: number; end: number; value: number; dec: number; sep: string; point: string; minus: string }[] }

function parse(raw: string): Part['nums'][number] | null {
  const minus = /^[-−]/.exec(raw)?.[0] ?? '';
  const body = raw.slice(minus.length);
  // Разделитель разрядов — пробел или запятая перед группой из трёх цифр; дробная часть — после точки или запятой в конце
  const sep = /\d([   ,])\d{3}(?!\d)/.exec(body)?.[1] ?? '';
  const frac = /[.,](\d+)$/.exec(body);
  const isFrac = !!frac && !(sep === ',' && frac[1].length === 3);
  const dec = isFrac ? frac![1].length : 0;
  const point = isFrac ? body[body.length - dec - 1] : '.';
  const digits = (isFrac ? body.slice(0, -dec - 1) : body).split(sep || '￿').join('');
  const value = Number(`${digits}${isFrac ? `.${frac![1]}` : ''}`);
  if (!Number.isFinite(value)) return null;
  return { start: 0, end: 0, value: minus ? -value : value, dec, sep, point, minus };
}

function format(v: number, n: Part['nums'][number]): string {
  const abs = Math.abs(v);
  let [int, frac] = abs.toFixed(n.dec).split('.');
  if (n.sep) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, n.sep);
  return `${v < 0 || (n.minus && v === 0 && n.value < 0) ? n.minus || '-' : ''}${int}${frac ? n.point + frac : ''}`;
}

/** Запустить отсчёт на слайде; возвращает остановку (текст сразу становится исходным) */
export function countUp(slide: HTMLElement | undefined): () => void {
  if (!slide) return () => {};
  const body = document.body.classList;
  if ((body.contains('editing') && !body.contains('st-previewing')) || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const parts: Part[] = [];
  const delays: number[] = [];
  const drums: (() => void)[] = [];
  // Объекты с галочкой «Число набегает» и числа блока «Цифры»
  const els = [...slide.querySelectorAll<HTMLElement>('.free[data-count], [data-count-num]')];
  // Вложенное в уже выбранное — не считать дважды
  for (const el of els.filter((x) => !els.some((o) => o !== x && o.contains(x)))) {
    const delay = parseFloat(getComputedStyle(el).getPropertyValue('--fx-d')) || 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const odo = el.dataset.count === 'odometer';
    const found: Text[] = [];
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const text = node.data;
      const nums: Part['nums'] = [];
      for (const m of text.matchAll(NUM)) {
        const p = parse(m[0]);
        if (p) nums.push({ ...p, start: m.index!, end: m.index! + m[0].length });
      }
      if (!nums.length) continue;
      if (odo) found.push(node);
      else { parts.push({ node, text, nums }); delays.push(delay); }
    }
    // Барабаны — после обхода: замена узлов посреди обхода сбила бы его
    for (const node of found) drums.push(odometer(node, delay));
  }
  if (!parts.length) return () => drums.forEach((f) => f());
  const t0 = performance.now();
  let raf = 0;
  const draw = (now: number) => {
    let running = false;
    parts.forEach((p, i) => {
      const k = Math.min(1, Math.max(0, (now - t0 - delays[i] - 120) / MS));
      if (k < 1) running = true;
      // Плавно в конце: быстро набирает, медленно доходит до значения
      const e = 1 - (1 - k) ** 3;
      let out = '';
      let at = 0;
      for (const n of p.nums) {
        out += p.text.slice(at, n.start) + (k >= 1 ? p.text.slice(n.start, n.end) : format(n.value * e, n));
        at = n.end;
      }
      p.node.data = out + p.text.slice(at);
    });
    if (running) raf = requestAnimationFrame(draw);
  };
  draw(t0);
  raf = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(raf);
    for (const p of parts) if (p.node.isConnected) p.node.data = p.text;
    drums.forEach((f) => f());
  };
}

/**
 * Одометр: каждая цифра чисел в тексте — барабан 0…9, который прокручивается до своей цифры
 * (старшие — один оборот, младшие — два-три и дольше). Остальной текст — как был. Возвращает остановку
 */
function odometer(node: Text, delay: number): () => void {
  const wrap = document.createElement('span');
  wrap.className = 'odo-txt';
  const text = node.data;
  let at = 0;
  for (const m of text.matchAll(NUM)) {
    wrap.append(text.slice(at, m.index));
    // Число целиком на одной строке: между барабанами строка не переносится
    const num = document.createElement('span');
    num.className = 'odo-num';
    const digits = [...m[0]].filter((c) => /\d/.test(c)).length;
    let pos = 0;
    for (const c of m[0]) {
      if (!/\d/.test(c)) { num.append(c); continue; }
      // От правого края: 0 — младшая цифра
      const right = digits - 1 - pos++;
      const turns = right === 0 ? 3 : right === 1 ? 2 : 1;
      const rows = turns * 10 + Number(c) + 1;
      const col = document.createElement('span');
      col.className = 'odo-col';
      col.textContent = Array.from({ length: rows }, (_v, i) => i % 10).join('\n');
      col.style.setProperty('--y', `${(-100 * (rows - 1)) / rows}%`);
      col.style.setProperty('--odo-ms', `${1100 + 260 * (digits - 1 - right)}ms`);
      col.style.setProperty('--odo-d', `${delay + 120}ms`);
      const drum = document.createElement('span');
      drum.className = 'odo';
      drum.dataset.d = c;
      drum.append(col);
      num.append(drum);
    }
    wrap.append(num);
    at = m.index! + m[0].length;
  }
  wrap.append(text.slice(at));
  node.replaceWith(wrap);
  return () => { if (wrap.isConnected) wrap.replaceWith(node); };
}
