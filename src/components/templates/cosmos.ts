import { showTime } from '../../engine/show-clock';

/** Повторяемая «случайность»: одно зерно — одна и та же последовательность в любом окне */
export function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export const W = 1280;
export const H = 720;
/** Центр логотипа в варианте «орбита»: отсюда расходятся импульсы */
const PULSE: [number, number] = [640, 232];
/** Импульс от логотипа — раз в столько секунд */
const PULSE_EVERY = 3.8;
/** Узлы расступаются от курсора на этом расстоянии */
const CLEAR = 150;
const NODE_COLORS = ['56, 189, 248', '129, 140, 248', '52, 211, 153', '96, 165, 250', '167, 139, 250'];

/** Цвета неба на canvas: тёмное (всегда) и светлое (tone: theme в светлой теме) */
const SKY = {
  dark: { star: '255,255,255', w1: '56,189,248', w2: '129,140,248', link: '96,165,250', nodes: NODE_COLORS },
  light: { star: '71,85,105', w1: '37,99,235', w2: '99,102,241', link: '37,99,235', nodes: ['14, 165, 233', '99, 102, 241', '16, 185, 129', '59, 130, 246', '139, 92, 246'] },
};

export interface SkyNode { x: number; y: number; vx: number; vy: number; rad: number; c: string; glow: number }
export interface SkyStar { x: number; y: number; rad: number; a: number; sp: number; ph: number }

/** Звёзды и узлы неба: из одного зерна — одни и те же у зрителей, у докладчика и на телефоне */
export function skyModel(): { stars: SkyStar[]; nodes: SkyNode[] } {
  const r = rng(7);
  const stars = Array.from({ length: 120 }, () => ({ x: r() * W, y: r() * H, rad: r() * 1.5 + 0.3, a: r() * 0.7 + 0.2, sp: r() * 0.03 + 0.01, ph: r() * 6.28 }));
  // Скорости — в точках за кадр при 60 кадрах в секунду (как было рассчитано небо)
  const nodes = Array.from({ length: 16 }, () => ({
    x: r() * W, y: r() * H, vx: (r() - 0.5) * 0.24, vy: (r() - 0.5) * 0.24,
    rad: r() * 1.6 + 1.3, c: NODE_COLORS[Math.floor(r() * NODE_COLORS.length)], glow: r() * 6 + 5,
  }));
  return { stars, nodes };
}

const wrap = (v: number, lo: number, hi: number) => lo + ((((v - lo) % (hi - lo)) + (hi - lo)) % (hi - lo));

/** Где узел в момент t (секунды показа): дрейф по кругу через края слайда, без накопления кадр за кадром */
export function nodeAt(n: SkyNode, t: number): { x: number; y: number } {
  return { x: wrap(n.x + n.vx * 60 * t, -10, W + 10), y: wrap(n.y + n.vy * 60 * t, -10, H + 10) };
}

/** Волна: радиус и яркость через age секунд после рождения (расширение 2,8 точки и угасание 2,8 % за кадр при 60 кадрах) */
export function waveAt(age: number, from: number, alpha: number): { rad: number; a: number } {
  return { rad: from + 2.8 * 60 * age, a: alpha * 0.972 ** (60 * age) };
}

/** Импульс от логотипа в момент t: он раз в PULSE_EVERY секунд у всех окон одновременно */
export function pulseAt(t: number): { rad: number; a: number } | null {
  if (t < PULSE_EVERY) return null;
  const w = waveAt(t % PULSE_EVERY, 20, 0.75);
  return w.a < 0.015 || w.rad > 960 ? null : w;
}

/**
 * Небо «орбиты»: мерцающие звёзды, медленно дрейфующие узлы со связями, узлы расступаются от
 * курсора, от логотипа раз в ~4 с расходится волна, щелчок — своя волна. Всё считается от общего
 * времени показа (engine/show-clock): у зрителей и на пульте небо одно и то же, на экране любой
 * частоты — с одной скоростью. Анимация идёт только пока слайд показан. light — небо светлое
 * (tone: theme в светлой теме), проверяется каждый кадр: переключили тему — небо сразу в новых цветах
 */
export function cosmos(el: HTMLElement, cv: HTMLCanvasElement, stage: HTMLElement, still: boolean, light: () => boolean = () => false): () => void {
  const g = cv.getContext('2d');
  if (!g) return () => {};
  g.scale(cv.width / W, cv.height / H);
  const { stars, nodes } = skyModel();
  // Сдвиг узлов от курсора: плавно к цели и плавно обратно, когда курсор ушёл
  const push = nodes.map(() => ({ x: 0, y: 0 }));
  const waves: { x: number; y: number; t: number }[] = [];
  const mouse = { x: 0, y: 0, on: false };
  let raf = 0;
  let last = 0;

  const frame = () => {
    const t = still ? 0 : showTime() / 1000;
    const dt = last ? Math.min(0.1, Math.max(0, t - last)) : 0;
    last = t;
    const P = light() ? SKY.light : SKY.dark;
    g.clearRect(0, 0, W, H);
    for (const s of stars) {
      g.beginPath();
      g.arc(s.x, s.y, s.rad, 0, 6.2832);
      g.fillStyle = `rgba(${P.star},${s.a * (0.6 + 0.4 * Math.sin(s.ph + s.sp * 60 * t))})`;
      g.fill();
    }
    const drawWave = (x: number, y: number, w: { rad: number; a: number }) => {
      g.lineWidth = 1.6;
      g.strokeStyle = `rgba(${P.w1},${w.a * 0.75})`;
      g.beginPath(); g.arc(x, y, w.rad, 0, 6.2832); g.stroke();
      if (w.rad > 40) {
        g.lineWidth = 0.9;
        g.strokeStyle = `rgba(${P.w2},${w.a * 0.35})`;
        g.beginPath(); g.arc(x, y, w.rad * 0.82, 0, 6.2832); g.stroke();
      }
    };
    const pulse = still ? null : pulseAt(t);
    if (pulse) drawWave(PULSE[0], PULSE[1], pulse);
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waveAt(t - waves[i].t, 10, 1);
      if (w.a < 0.015 || w.rad > 380 || t < waves[i].t) waves.splice(i, 1);
      else drawWave(waves[i].x, waves[i].y, w);
    }
    // Плавность сдвига не зависит от частоты кадров
    const ease = 1 - Math.exp(-dt * 6);
    const at = nodes.map((n, i) => {
      const b = nodeAt(n, t);
      let tx = 0;
      let ty = 0;
      if (mouse.on && !still) {
        const dx = b.x - mouse.x;
        const dy = b.y - mouse.y;
        const d = Math.hypot(dx, dy);
        if (d < CLEAR && d > 1) { const k = ((CLEAR - d) * 0.9) / d; tx = dx * k; ty = dy * k; }
      }
      const p = push[i];
      p.x += (tx - p.x) * ease;
      p.y += (ty - p.y) * ease;
      return { x: b.x + p.x, y: b.y + p.y };
    });
    nodes.forEach((n, i) => {
      const p = at[i];
      g.beginPath();
      g.arc(p.x, p.y, n.rad, 0, 6.2832);
      const c = P.nodes[NODE_COLORS.indexOf(n.c)] ?? n.c;
      g.fillStyle = `rgba(${c},.95)`;
      g.shadowColor = `rgba(${c},.8)`;
      g.shadowBlur = n.glow;
      g.fill();
      g.shadowBlur = 0;
      for (let j = i + 1; j < nodes.length; j++) {
        const q = at[j];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < 170) {
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y);
          g.strokeStyle = `rgba(${P.link},${(1 - d / 170) * 0.24})`;
          g.lineWidth = 0.85;
          g.stroke();
        }
      }
    });
    raf = !still && el.classList.contains('on') ? requestAnimationFrame(frame) : 0;
  };
  frame();
  if (still) return () => {};

  const toSlide = (e: MouseEvent) => {
    const b = stage.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * W, y: ((e.clientY - b.top) / b.height) * H };
  };
  const onMove = (e: MouseEvent) => { Object.assign(mouse, toSlide(e), { on: true }); };
  const onLeave = () => { mouse.on = false; };
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('a, button, .sp-panel') || document.body.classList.contains('editing')) return;
    waves.push({ ...toSlide(e), t: showTime() / 1000 });
  };
  el.addEventListener('mousemove', onMove);
  el.addEventListener('mouseleave', onLeave);
  el.addEventListener('click', onClick);
  // Слайд показан — анимация идёт, скрыт — стоит
  const mo = new MutationObserver(() => { if (el.classList.contains('on') && !raf) { last = 0; raf = requestAnimationFrame(frame); } });
  mo.observe(el, { attributes: true, attributeFilter: ['class'] });
  return () => {
    cancelAnimationFrame(raf);
    mo.disconnect();
    el.removeEventListener('mousemove', onMove);
    el.removeEventListener('mouseleave', onLeave);
    el.removeEventListener('click', onClick);
  };
}
