/**
 * Переход «Морф», как в PowerPoint: одинаковые объекты соседних слайдов перелетают на новое
 * место и размер, старый вид растворяется в новом (так меняется и цвет); остальное — растворение.
 * Пара — объект с тем же именем (id, «Область выделения»), а без имени — с тем же содержимым
 * (тот же текст или картинка): «дублировал слайд, подвинул» работает сразу.
 *
 * Как устроено: настоящий новый слайд уже на месте; поверх — снимок старого (растворяется)
 * и летящие копии пар. Живые части (видео, 3D, вставки) в снимок не попадают — только растворение.
 */

interface Box { x: number; y: number; w: number; h: number }

const box = (el: HTMLElement): Box => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth || 1, h: el.offsetHeight || 1 });

/** Ключ пары: имя объекта, иначе вид и содержимое */
function key(el: HTMLElement): string {
  if (el.dataset.obj) return `id:${el.dataset.obj}`;
  const type = el.querySelector<HTMLElement>('[data-type]')?.dataset.type ?? '';
  const media = el.querySelector('img, video')?.getAttribute('src') ?? '';
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return text || media ? `${type}|${text}|${media}` : '';
}

/** Объекты слайда по ключу — только те, у кого ключ на слайде один */
function objects(slide: HTMLElement): Map<string, HTMLElement> {
  const all = new Map<string, HTMLElement[]>();
  for (const el of slide.querySelectorAll<HTMLElement>(':scope > .free:not(.trig-hid)')) {
    const k = key(el);
    if (k) all.set(k, [...(all.get(k) ?? []), el]);
  }
  return new Map([...all].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
}

/** Копия для полёта и снимка: без анимаций и без живых частей */
function still<T extends HTMLElement>(el: T): T {
  const c = el.cloneNode(true) as T;
  c.querySelectorAll('video, iframe, canvas, model-viewer').forEach((x) => x.remove());
  c.removeAttribute('id');
  c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
  return c;
}

const place = (el: HTMLElement, b: Box) => Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, margin: '0' });
const flip = (from: Box, to: Box) => `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.w / to.w}, ${from.h / to.h})`;

/** Запустить морф от prev к next внутри stage; возвращает завершение (убрать слои, показать объекты) */
export function morph(stage: HTMLElement, prev: HTMLElement, next: HTMLElement, ms: number): () => void {
  const a = objects(prev);
  const b = objects(next);
  const pairs = [...a].filter(([k]) => b.has(k)).map(([k, el]) => ({ from: el, to: b.get(k)!, fb: box(el), tb: box(b.get(k)!) }));
  const ease = 'cubic-bezier(.65, 0, .35, 1)';

  // Снимок старого слайда без перелетающих объектов — растворяется поверх нового
  const ghost = still(prev);
  ghost.classList.remove('out', 'on');
  ghost.classList.add('morph-ghost');
  const gone = new Set(pairs.map((p) => p.from));
  [...prev.querySelectorAll<HTMLElement>(':scope > .free')].forEach((el, i) => {
    if (gone.has(el)) (ghost.querySelectorAll<HTMLElement>(':scope > .free')[i] as HTMLElement | undefined)?.setAttribute('data-morph-gone', '');
  });
  ghost.querySelectorAll('[data-morph-gone]').forEach((x) => x.remove());
  // Слой полёта — «слайд» с теми же классами и атрибутами, что у нового: цвета и шрифты презентации
  // заданы внутри .slide; фон и украшения шаблона у слоя убраны (morph.css)
  const layer = document.createElement('div');
  for (const at of next.attributes) if (at.name !== 'id' && at.name !== 'style') layer.setAttribute(at.name, at.value);
  layer.classList.remove('on', 'out');
  layer.classList.add('morph-layer');
  stage.append(ghost, layer);
  const anims: Animation[] = [ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms * 0.7, easing: 'ease', fill: 'forwards' })];

  for (const p of pairs) {
    // Настоящий объект ждёт под копией; своё появление не проигрывает — он уже «прилетел»
    p.to.dataset.morphed = '';
    p.to.style.animation = 'none';
    p.to.style.visibility = 'hidden';
    const old = still(p.from);
    const neu = still(p.to);
    neu.style.visibility = '';
    for (const [c, bx] of [[old, p.fb], [neu, p.tb]] as const) {
      c.classList.add('morph-fly');
      place(c, bx);
      layer.append(c);
    }
    const opts = { duration: ms, easing: ease, fill: 'forwards' as const };
    anims.push(
      neu.animate([{ transform: flip(p.fb, p.tb), opacity: 0 }, { opacity: 1, offset: 0.45 }, { transform: 'none', opacity: 1 }], opts),
      old.animate([{ transform: 'none', opacity: 1 }, { opacity: 0, offset: 0.55 }, { transform: flip(p.tb, p.fb), opacity: 0 }], opts),
    );
  }

  let done = false;
  return () => {
    if (done) return;
    done = true;
    anims.forEach((x) => x.cancel());
    ghost.remove();
    layer.remove();
    for (const p of pairs) p.to.style.visibility = '';
  };
}

/** Перед новым показом слайда: объекты, прилетевшие морфом, снова играют своё появление */
export function unmorph(slide: HTMLElement | undefined): void {
  slide?.querySelectorAll<HTMLElement>('[data-morphed]').forEach((el) => {
    delete el.dataset.morphed;
    el.style.animation = '';
  });
}
