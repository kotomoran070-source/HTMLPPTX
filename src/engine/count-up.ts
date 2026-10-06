/**
 * «Число набегает»: у объекта с count: true числа в тексте при появлении слайда отсчитываются
 * от нуля до своего значения — с тем же видом записи («17 234», «2,4», «$12.84M», «−5 %»).
 * Только при показе и в «Просмотре»: в правке текст не трогается. Конец — ровно исходный текст.
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
  // Объекты с галочкой «Число набегает» и числа блока «Цифры»
  const els = [...slide.querySelectorAll<HTMLElement>('.free[data-count], [data-count-num]')];
  // Вложенное в уже выбранное — не считать дважды
  for (const el of els.filter((x) => !els.some((o) => o !== x && o.contains(x)))) {
    const delay = parseFloat(getComputedStyle(el).getPropertyValue('--fx-d')) || 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const text = node.data;
      const nums: Part['nums'] = [];
      for (const m of text.matchAll(NUM)) {
        const p = parse(m[0]);
        if (p) nums.push({ ...p, start: m.index!, end: m.index! + m[0].length });
      }
      if (nums.length) { parts.push({ node, text, nums }); delays.push(delay); }
    }
  }
  if (!parts.length) return () => {};
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
  };
}
