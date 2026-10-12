/**
 * Эффекты текста у свободного объекта (поле textFx): глитч, неон, блик, волна, печатная машинка,
 * расшифровка. Неон — только CSS (base.css), он виден и в правке. Остальным нужен текст по буквам или
 * его копия (data-text для слоёв глитча и блика) — это делается здесь, только при показе и в «Просмотре»,
 * как у «Числа набегает»: в правке текст не трогается. Остановка возвращает разметку как была.
 */
export const TEXT_FX = ['glitch', 'neon', 'shine', 'wave', 'type', 'scramble'] as const;
export type TextFx = typeof TEXT_FX[number];

export const TEXT_FX_NAMES: Record<TextFx, string> = {
  glitch: 'Глитч', neon: 'Неон', shine: 'Блик', wave: 'Волна', type: 'Печатная машинка', scramble: 'Расшифровка',
};

/** Элемент с текстом объекта: надпись или текст фигуры */
const HOLDER = ':is(p[data-type="text"], .shape-t)';
const GLYPHS = '!<>-_\\/[]{}=+*^?#%&$01ЖЯШЩЮ';
const TYPE_MS = 42;
const SCRAMBLE_MS = 26;

/** Буквы текста — в отдельные span с номером (--i); пробелы и переносы остаются текстом */
function split(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) nodes.push(n);
  for (const node of nodes) {
    const frag = document.createDocumentFragment();
    for (const ch of node.data) {
      if (/\s/.test(ch)) { frag.append(ch); continue; }
      const s = document.createElement('span');
      s.className = 'tfx-c';
      s.textContent = ch;
      s.style.setProperty('--i', String(out.length));
      out.push(s);
      frag.append(s);
    }
    node.replaceWith(frag);
  }
  return out;
}

/** Запустить эффекты на слайде; возвращает остановку */
export function textFx(slide: HTMLElement | undefined): () => void {
  if (!slide) return () => {};
  const body = document.body.classList;
  if ((body.contains('editing') && !body.contains('st-previewing')) || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  return run([...slide.querySelectorAll<HTMLElement>('.free[data-tfx]')]);
}

/** Примерка эффекта на одном объекте (студия, наведение на пункт меню) — и в правке */
export function textFxPreview(obj: HTMLElement): () => void {
  return run([obj], 0);
}

function run(objs: HTMLElement[], wait?: number): () => void {
  const undo: (() => void)[] = [];
  const ticks: ((now: number) => boolean)[] = [];
  let raf = 0;
  for (const obj of objs) {
    const fx = obj.dataset.tfx as TextFx;
    const delay = wait ?? (parseFloat(getComputedStyle(obj).getPropertyValue('--fx-d')) || 0) + 250;
    for (const el of obj.querySelectorAll<HTMLElement>(HOLDER)) {
      if (fx === 'glitch' || fx === 'shine') {
        // Копия текста для слоёв ::before / ::after
        el.dataset.text = el.innerText;
        undo.push(() => { delete el.dataset.text; });
        continue;
      }
      if (fx !== 'wave' && fx !== 'type' && fx !== 'scramble') continue;
      // «Число набегает» держит свои текстовые узлы — по буквам такой текст не делится
      if (obj.hasAttribute('data-count')) continue;
      const html = el.innerHTML;
      const chars = split(el);
      undo.push(() => { if (el.isConnected) el.innerHTML = html; });
      if (fx === 'type') ticks.push(typing(chars, performance.now() + delay));
      else if (fx === 'scramble') ticks.push(scrambling(chars, performance.now() + delay));
    }
  }
  if (ticks.length) {
    const loop = (now: number) => {
      for (let k = ticks.length - 1; k >= 0; k--) if (!ticks[k](now)) ticks.splice(k, 1);
      if (ticks.length) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  return () => {
    cancelAnimationFrame(raf);
    undo.forEach((f) => f());
  };
}

/** Печатная машинка: буквы по одной, за последней — мигающий курсор, потом гаснет */
function typing(chars: HTMLElement[], t0: number): (now: number) => boolean {
  chars.forEach((c) => c.classList.add('tfx-off'));
  let shown = 0;
  return (now) => {
    const n = Math.min(chars.length, Math.max(0, Math.floor((now - t0) / TYPE_MS)));
    for (; shown < n; shown++) {
      chars[shown].classList.remove('tfx-off');
      chars[shown - 1]?.classList.remove('tfx-caret');
      chars[shown].classList.add('tfx-caret');
    }
    if (n === chars.length && now - t0 > chars.length * TYPE_MS + 1800) { chars[n - 1]?.classList.remove('tfx-caret'); return false; }
    return true;
  };
}

/** Расшифровка: на месте букв перебираются символы, слева направо встают настоящие */
function scrambling(chars: HTMLElement[], t0: number): (now: number) => boolean {
  const real = chars.map((c) => c.textContent ?? '');
  let last = 0;
  return (now) => {
    // Символы меняются не каждый кадр — так читается «перебор»
    const step = now - last > 50;
    if (step) last = now;
    let busy = false;
    chars.forEach((c, k) => {
      if (now >= t0 + k * SCRAMBLE_MS + 350) {
        if (c.textContent !== real[k]) c.textContent = real[k];
        c.classList.remove('tfx-dim');
        return;
      }
      busy = true;
      if (step) { c.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]; c.classList.add('tfx-dim'); }
    });
    return busy;
  };
}
