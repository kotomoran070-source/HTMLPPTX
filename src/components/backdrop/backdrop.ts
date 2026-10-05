import { ACCENT_EVENT } from '../../engine/accent';
import { defineBlock } from '../../engine/component';
import { onThemeChange } from '../../engine/theme';
import type { Block } from '../../types';
import './backdrop.css';

/**
 * Анимированный фон слайда (поле slide.backdrop): частицы, сияние, перспективная сетка.
 * Чистый WebGL, без библиотек. Контекст создаётся, только пока слайд на экране;
 * в окне докладчика — облегчённый режим; миниатюры, печать и «уменьшить движение» — статичный CSS.
 */

export type BackdropKind = 'particles' | 'aurora' | 'grid';
export const BACKDROPS: [BackdropKind, string][] = [['particles', 'Частицы'], ['aurora', 'Сияние'], ['grid', 'Сетка']];
export const isBackdrop = (v: unknown): v is BackdropKind => BACKDROPS.some(([k]) => k === v);

interface BackdropProps extends Block {
  kind: BackdropKind;
}

const QUAD_VS = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;

const NOISE = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p*=2.02;a*=.5;}return v;}`;

/** Сияние: мягкие полосы цвета акцента медленно текут по слайду */
const AURORA_FS = `precision mediump float;uniform vec2 r;uniform float t;uniform vec3 c1;uniform vec3 c2;uniform float k;${NOISE}
void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.)*1.5;
  float w=fbm(p*1.2-vec2(t*.02,t*.015));
  float n=fbm(p+vec2(t*.035,-t*.025)+w*1.6);
  float band=smoothstep(.42,.9,n)*(.6+.4*sin(uv.x*2.6+t*.15+w*3.));
  vec3 c=mix(c1,c2,clamp(uv.y+.25*sin(t*.08+uv.x*2.),0.,1.));
  float a=band*k*(1.-uv.y*.3);
  gl_FragColor=vec4(c*a,a);}`;

/** Сетка: пол в перспективе уходит к горизонту, линии плывут навстречу */
const GRID_FS = `precision mediump float;uniform vec2 r;uniform float t;uniform vec3 c1;uniform vec3 c2;uniform float k;
void main(){vec2 uv=gl_FragCoord.xy/r;float hz=.38;float a=0.;
  if(uv.y<hz){float d=hz-uv.y;float z=.28/d;float x=(uv.x-.5)*z*2.2*r.x/r.y;float zz=z+t*.35;
    float w=clamp(.012*z,.012,.16);
    float lx=smoothstep(.5-w*1.6,.5,abs(fract(x)-.5));
    float lz=smoothstep(.5-w*1.6,.5,abs(fract(zz)-.5));
    a=max(lx,lz)*smoothstep(0.,.18,d)*(.55+.45*smoothstep(.5,0.,d));}
  a+=exp(-abs(uv.y-hz)*22.)*.35;
  vec3 c=mix(c1,c2,uv.y/hz);
  a*=k;gl_FragColor=vec4(c*a,a);}`;

/** Частицы: точки медленно поднимаются, мерцают и покачиваются; всё движение — в шейдере */
const PARTICLES_VS = `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;varying float va;
void main(){float sp=.008+.022*s.z;
  vec2 q=vec2(fract(s.x+sin(t*.07+s.y*6.283)*.02+sin(t*.23+s.z*20.)*.008),fract(s.y+t*sp));
  gl_Position=vec4(q*2.-1.,0.,1.);
  float tw=.55+.45*sin(t*(.5+s.z*1.2)+s.x*40.);
  gl_PointSize=(1.3+3.2*s.z*s.z)*px;
  va=(.22+.6*s.z)*tw*smoothstep(0.,.12,q.y)*smoothstep(1.,.85,q.y);}`;
const PARTICLES_FS = `precision mediump float;uniform vec3 c1;uniform float k;varying float va;
void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,.08,d)*va*k;gl_FragColor=vec4(c1*a,a);}`;

type Rgb = [number, number, number];

/** Цвет CSS (в т. ч. var(--ac)) → RGB 0..1, как он вычислен на этом элементе */
function cssRgb(el: HTMLElement, css: string): Rgb {
  const probe = document.createElement('i');
  probe.style.cssText = `display:none;color:${css}`;
  el.appendChild(probe);
  const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(probe).color);
  probe.remove();
  const [r, g, b] = (m?.[1] ?? '37,99,235').split(/[,\s/]+/).map(Number);
  return [r / 255, g / 255, b / 255];
}

/** Второй цвет: акцент, сдвинутый по оттенку — полосы не одноцветные */
function shiftHue([r, g, b]: Rgb, deg: number): Rgb {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const m = [
    cos + (1 - cos) / 3, (1 - cos) / 3 - Math.sqrt(1 / 3) * sin, (1 - cos) / 3 + Math.sqrt(1 / 3) * sin,
  ];
  const c = (x: number) => Math.max(0, Math.min(1, x));
  return [c(r * m[0] + g * m[1] + b * m[2]), c(r * m[2] + g * m[0] + b * m[1]), c(r * m[1] + g * m[2] + b * m[0])];
}

function program(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram | null {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const v = sh(gl.VERTEX_SHADER, vs);
  const f = sh(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

interface Scene {
  draw(t: number): void;
}

function makeScene(gl: WebGLRenderingContext, kind: BackdropKind, colors: () => { c1: Rgb; c2: Rgb; k: number }, lite: boolean): Scene | null {
  const prog = kind === 'particles' ? program(gl, PARTICLES_VS, PARTICLES_FS) : program(gl, QUAD_VS, kind === 'aurora' ? AURORA_FS : GRID_FS);
  if (!prog) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  let count = 0;
  if (kind === 'particles') {
    count = lite ? 260 : 900;
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 's');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
  } else {
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  }
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const uR = u('r');
  const uT = u('t');
  const uC1 = u('c1');
  const uC2 = u('c2');
  const uK = u('k');
  const uPx = u('px');
  return {
    draw(t) {
      const { c1, c2, k } = colors();
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uR, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(uT, t);
      gl.uniform3fv(uC1, c1);
      if (uC2) gl.uniform3fv(uC2, c2);
      gl.uniform1f(uK, k);
      if (uPx) gl.uniform1f(uPx, gl.drawingBufferHeight / 720);
      if (kind === 'particles') gl.drawArrays(gl.POINTS, 0, count);
      else gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

defineBlock<BackdropProps>('backdrop', {
  render(p) {
    return `<div class="backdrop bd-${p.kind}" aria-hidden="true"></div>`;
  },

  mount(el, p, ctx) {
    const lite = document.body.classList.contains('presenter');
    const still = ctx.reducedMotion;
    // Пауза сцены (экономный режим пульта, облегчённый режим редактора): один кадр — и стоп
    const frozen = () => still || ctx.stage.classList.contains('paused');
    let canvas: HTMLCanvasElement | null = null;
    let gl: WebGLRenderingContext | null = null;
    let scene: Scene | null = null;
    let raf = 0;
    let last = 0;
    let offTimer = 0;
    // Время фона идёт только на экране: при возвращении на слайд анимация продолжается с того же места
    let clock = Math.random() * 100;
    let pal = { c1: [0, 0, 0] as Rgb, c2: [0, 0, 0] as Rgb, k: 1 };

    const readColors = () => {
      const ac = cssRgb(el, 'var(--ac)');
      const bg = cssRgb(el, 'var(--bg)');
      const dark = bg[0] + bg[1] + bg[2] < 1.2;
      // На тёмном фоне — светлее и заметнее, на светлом — сдержаннее
      const lift = (c: Rgb, x: number): Rgb => [c[0] + (1 - c[0]) * x, c[1] + (1 - c[1]) * x, c[2] + (1 - c[2]) * x];
      const k = p.kind === 'particles' ? (dark ? 1 : 0.8) : p.kind === 'grid' ? (dark ? 0.4 : 0.24) : dark ? 0.6 : 0.5;
      pal = { c1: dark ? lift(ac, 0.25) : ac, c2: shiftHue(dark ? lift(ac, 0.15) : ac, p.kind === 'grid' ? -25 : 40), k };
    };

    const size = () => {
      if (!canvas) return;
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * (lite ? 0.6 : 1);
      // Больше 1920 точек по ширине глаз не заметит, а видеокарта — да
      const w = Math.max(64, Math.min(1920, Math.round(r.width * dpr)));
      const h = Math.round((w * 720) / 1280);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (!scene || !ctx.slide.classList.contains('on')) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      // В окне докладчика и в редакторе — 30 кадров в секунду
      const slow = lite || document.body.classList.contains('editing');
      if (slow && last && now - last < 30) {
        raf = requestAnimationFrame(frame);
        return;
      }
      last = now;
      clock += dt;
      size();
      scene.draw(clock);
      if (!frozen()) raf = requestAnimationFrame(frame);
    };

    const start = () => {
      clearTimeout(offTimer);
      if (!scene) {
        canvas = document.createElement('canvas');
        gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
        if (!gl) {
          canvas = null;
          return;
        }
        readColors();
        scene = makeScene(gl, p.kind, () => pal, lite);
        if (!scene) {
          canvas = null;
          gl = null;
          return;
        }
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          stop(true);
        });
        el.appendChild(canvas);
        el.classList.add('live');
      }
      last = 0;
      if (!raf) raf = requestAnimationFrame(frame);
    };

    /** Ушли со слайда: кадры останавливаются сразу, контекст отдаётся через секунду */
    const stop = (now = false) => {
      cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(offTimer);
      const release = () => {
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        canvas?.remove();
        canvas = null;
        gl = null;
        scene = null;
        el.classList.remove('live');
      };
      if (now) release();
      else offTimer = window.setTimeout(release, 1000);
    };

    const sync = () => (ctx.slide.classList.contains('on') ? start() : stop());
    const recolor = () => {
      if (!scene) return;
      readColors();
      if (frozen() && scene) {
        size();
        scene.draw(clock);
      }
    };
    const mo = new MutationObserver(sync);
    mo.observe(ctx.slide, { attributes: true, attributeFilter: ['class'] });
    // Сняли паузу — кадры идут снова (start() сам ничего не делает, если они уже идут)
    mo.observe(ctx.stage, { attributes: true, attributeFilter: ['class'] });
    const offTheme = onThemeChange(() => requestAnimationFrame(recolor));
    addEventListener(ACCENT_EVENT, recolor);
    sync();
    return () => {
      mo.disconnect();
      offTheme();
      removeEventListener(ACCENT_EVENT, recolor);
      stop(true);
    };
  },
});
