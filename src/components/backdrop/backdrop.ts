import { ACCENT_EVENT } from '../../engine/accent';
import { defineBlock, getBlock } from '../../engine/component';
import { onThemeChange } from '../../engine/theme';
import type { Block } from '../../types';
import './backdrop.css';

/**
 * Анимированный фон слайда (slide.backdrop или theme.backdrop): переливы, сияние, шёлк, волны,
 * рельеф, лучи, боке, частицы, звёзды, точки, сеть, соты, орбиты, сетка. Чистый WebGL, без
 * библиотек, в цветах темы (акцент и второй цвет). Бережно к компьютеру: контекст — только пока
 * слайд на экране, мягкие сцены рисуются в половинном размере и 30 кадров в секунду; в окне
 * докладчика — облегчённо; миниатюры, печать и «уменьшить движение» — статичный CSS того же вида.
 */

import type { BackdropKind } from '../../engine/backdrops';
export { BACKDROPS, isBackdrop, type BackdropKind } from '../../engine/backdrops';

interface BackdropProps extends Block {
  kind: BackdropKind;
}

const QUAD_VS = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const HEAD = `precision mediump float;uniform vec2 r;uniform float t;uniform vec3 c1;uniform vec3 c2;uniform float k;`;

const NOISE = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p*=2.02;a*=.5;}return v;}`;

/** Сцены на весь слайд: фрагментный шейдер; выход — цвет, умноженный на прозрачность */
const FS: Partial<Record<BackdropKind, string>> = {
  // Переливы: четыре мягких пятна цвета медленно плывут — «живой» градиент
  mesh: `${HEAD}
void main(){vec2 uv=gl_FragCoord.xy/r;float ar=r.x/r.y;vec2 p=uv*vec2(ar,1.);
  vec2 b1=vec2(ar*(.22+.14*sin(t*.11)),.28+.16*cos(t*.13));
  vec2 b2=vec2(ar*(.78+.12*cos(t*.09)),.72+.14*sin(t*.12));
  vec2 b3=vec2(ar*(.56+.2*sin(t*.07+2.)),.12+.1*cos(t*.1+1.));
  vec2 b4=vec2(ar*(.12+.1*cos(t*.08+3.)),.88+.08*sin(t*.09));
  float f1=exp(-dot(p-b1,p-b1)*4.5),f2=exp(-dot(p-b2,p-b2)*4.),f3=exp(-dot(p-b3,p-b3)*6.),f4=exp(-dot(p-b4,p-b4)*7.);
  float s=f1+f2+f3+f4;vec3 c=(c1*(f1+f3)+c2*(f2+f4))/max(s,1e-3);
  float a=smoothstep(0.,1.2,s)*k;gl_FragColor=vec4(c*a,a);}`,
  // Сияние: мягкие полосы цвета медленно текут по слайду
  aurora: `${HEAD}${NOISE}
void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.)*1.5;
  float w=fbm(p*1.2-vec2(t*.02,t*.015));
  float n=fbm(p+vec2(t*.035,-t*.025)+w*1.6);
  float band=smoothstep(.42,.9,n)*(.6+.4*sin(uv.x*2.6+t*.15+w*3.));
  vec3 c=mix(c1,c2,clamp(uv.y+.25*sin(t*.08+uv.x*2.),0.,1.));
  float a=band*k*(1.-uv.y*.3);gl_FragColor=vec4(c*a,a);}`,
  // Шёлк: складки ткани переливаются на свету
  silk: `${HEAD}
void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.)*2.2;
  float s=sin(p.x*1.4+t*.11+sin(p.y*2.1+t*.08)*1.5)+sin(p.y*1.2-t*.09+sin(p.x*1.6-t*.06)*1.3);
  float f=.5+.5*sin(s*2.4);float hl=pow(f,8.);
  vec3 c=mix(c1,c2,.5+.5*sin(s*.8+t*.05));c+=hl*.4*(1.-c);
  float a=(.12+.5*f+.25*hl)*k*(.55+.45*uv.y);gl_FragColor=vec4(c*a,a);}`,
  // Волны: тонкие линии бегут волной через слайд, от акцента ко второму цвету
  waves: `${HEAD}
void main(){vec2 uv=gl_FragCoord.xy/r;vec3 col=vec3(0.);float a=0.;
  for(int i=0;i<16;i++){float fi=float(i)/15.;
    float y=.42+.17*sin(uv.x*2.6+t*.22+fi*1.9)+.07*sin(uv.x*6.3-t*.31+fi*3.1)+(fi-.5)*.16;
    float d=abs(uv.y-y)*r.y/(1.+.0007*r.y);float l=smoothstep(1.7,.2,d)*(.3+.7*fi)+exp(-d*.09)*.05;
    col+=mix(c1,c2,fi)*l;a+=l;}
  float m=min(1.,1./max(a,1e-3));gl_FragColor=vec4(col*m*k,a*m*k);}`,
  // Рельеф: линии высот, как на топографической карте, медленно перетекают
  topo: `#extension GL_OES_standard_derivatives : enable
${HEAD}${NOISE}
void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.);
  float n=fbm(p*1.5+vec2(t*.018,t*.012))+.15*fbm(p*3.-t*.025);
  float v=n*16.;
  // Линии ровной толщины: расстояние до ближайшей горизонтали в пикселях
  float d=abs(fract(v-.5)-.5)/max(fwidth(v),1e-4);
  // Каждая четвёртая линия — толще и ярче, как основные горизонтали на карте
  float major=1.-step(.01,mod(floor(v+.5),4.));
  float l=1.-smoothstep(.4+major*.6,1.3+major*.8,d);
  vec3 c=mix(c1,c2,smoothstep(.3,.75,n));
  float a=l*(.35+.65*major)*k;gl_FragColor=vec4(c*a,a);}`,
  // Лучи: мягкий свет из угла, лучи медленно поворачиваются
  rays: `${HEAD}
void main(){vec2 uv=gl_FragCoord.xy/r;float ar=r.x/r.y;vec2 p=uv*vec2(ar,1.);
  vec2 d=p-vec2(-.15*ar,1.2);float ang=atan(d.y,d.x);float dist=length(d);
  float ray=.5+.25*sin(ang*17.+t*.18)+.25*sin(ang*29.-t*.12+1.3);
  ray=pow(ray,2.5)*(.7+.3*sin(ang*7.+t*.07));
  vec3 c=mix(c1,c2,clamp(dist/2.2,0.,1.));
  float a=(ray*.85+.15)*exp(-dist*.75)*k;gl_FragColor=vec4(c*a,a);}`,
  // Точки: сетка точек, по ней катится волна — точки растут и светлеют
  dots: `${HEAD}
void main(){vec2 g=gl_FragCoord.xy/(r.y/34.);vec2 id=floor(g);vec2 f=fract(g)-.5;
  float w=.5+.5*sin(id.x*.21+id.y*.16-t*.8)*cos(id.y*.19-id.x*.05-t*.45);
  float rad=.07+.25*w;float d=length(f);float l=smoothstep(rad,rad-.09,d);
  vec3 c=mix(c1,c2,w);float a=l*(.18+.82*w)*k;gl_FragColor=vec4(c*a,a);}`,
  // Соты: шестиугольники, по ним расходятся мягкие волны света
  hex: `${HEAD}
const vec2 S=vec2(1.,1.7320508);
vec4 hc(vec2 p){vec4 c=floor(vec4(p,p-vec2(.5,1.))/S.xyxy)+.5;vec4 h=vec4(p-c.xy*S,p-(c.zw+.5)*S);
  return dot(h.xy,h.xy)<dot(h.zw,h.zw)?vec4(h.xy,c.xy):vec4(h.zw,c.zw+.5);}
float hd(vec2 p){p=abs(p);return max(dot(p,S*.5),p.x);}
void main(){vec2 uv=gl_FragCoord.xy/r;float ar=r.x/r.y;vec2 p=uv*vec2(ar,1.)*10.;
  vec4 h=hc(p);float e=hd(h.xy);
  vec2 cen=vec2(ar*(.5+.35*sin(t*.09)),.5+.3*cos(t*.11))*10.;
  float pulse=pow(.5+.5*sin(length(h.zw*S-cen)*.55-t*1.1),4.);
  float edge=smoothstep(.45,.49,e);
  vec3 c=mix(c1,c2,pulse);float a=(edge*(.1+.7*pulse)+(1.-edge)*.12*pulse)*k*(.35+.65*smoothstep(1.,.2,length(uv-vec2(.75,.4))));gl_FragColor=vec4(c*a,a);}`,
  // Орбиты: кольца вокруг точки справа, по ним идут спутники
  orbits: `${HEAD}
void main(){vec2 uv=gl_FragCoord.xy/r;float ar=r.x/r.y;vec2 q=uv*vec2(ar,1.)-vec2(ar*.8,.42);
  float d=length(q);float ang=atan(q.y,q.x);float N=6.;float x=d*N;float rid=floor(x+.5);
  float px=1./r.y*N;float ring=smoothstep(px*1.6,0.,abs(x-rid))*step(.5,rid)*step(rid,7.5);
  float dash=.65+.35*step(.5,fract(ang*(3.+rid*2.)/6.2832+t*.01*rid));
  float a0=t*(.35/rid)*(mod(rid,2.)>.5?1.:-1.)+rid*1.7;
  float da=abs(mod(ang-a0+3.14159,6.28318)-3.14159)*rid/N;
  float sat=smoothstep(.022,.008,length(vec2(da,(x-rid)/N)))*step(.5,rid)*step(rid,7.5);
  float glow=exp(-d*3.)*.35;
  vec3 c=mix(c1,c2,clamp(rid/7.,0.,1.));float a=(ring*dash*.55+sat+glow)*k*smoothstep(1.6,.6,d);gl_FragColor=vec4(c*a,a);}`,
  // Сетка: пол в перспективе уходит к горизонту, линии плывут навстречу
  grid: `${HEAD}
void main(){vec2 uv=gl_FragCoord.xy/r;float hz=.38;float a=0.;
  if(uv.y<hz){float d=hz-uv.y;float z=.28/d;float x=(uv.x-.5)*z*2.2*r.x/r.y;float zz=z+t*.35;
    float w=clamp(.012*z,.012,.16);
    float lx=smoothstep(.5-w*1.6,.5,abs(fract(x)-.5));
    float lz=smoothstep(.5-w*1.6,.5,abs(fract(zz)-.5));
    a=max(lx,lz)*smoothstep(0.,.18,d)*(.55+.45*smoothstep(.5,0.,d));}
  a+=exp(-abs(uv.y-hz)*22.)*.35;
  vec3 c=mix(c1,c2,uv.y/hz);a*=k;gl_FragColor=vec4(c*a,a);}`,
};

/** Сцены из точек: вершинный шейдер двигает их, фрагментный рисует мягкий круг */
const POINT_FS = `precision mediump float;uniform float k;varying float va;varying vec3 vc;
void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,.08,d)*va*k;gl_FragColor=vec4(vc*a,a);}`;
const POINTS: Partial<Record<BackdropKind, { vs: string; count: [lite: number, full: number] }>> = {
  // Частицы: точки медленно поднимаются, мерцают и покачиваются
  particles: { count: [260, 900], vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;
void main(){float sp=.008+.022*s.z;
  vec2 q=vec2(fract(s.x+sin(t*.07+s.y*6.283)*.02+sin(t*.23+s.z*20.)*.008),fract(s.y+t*sp));
  gl_Position=vec4(q*2.-1.,0.,1.);float tw=.55+.45*sin(t*(.5+s.z*1.2)+s.x*40.);
  gl_PointSize=(1.3+3.2*s.z*s.z)*px;vc=c1;
  va=(.22+.6*s.z)*tw*smoothstep(0.,.12,q.y)*smoothstep(1.,.85,q.y);}` },
  // Боке: крупные размытые круги света медленно дрейфуют
  bokeh: { count: [16, 34], vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;
void main(){vec2 q=vec2(fract(s.x+t*(.004+.006*s.z)+.03*sin(t*.1+s.y*9.)),fract(s.y+.04*sin(t*.07+s.x*7.)));
  gl_Position=vec4(q*2.2-1.1,0.,1.);gl_PointSize=(40.+150.*s.z*s.z)*px;
  vc=mix(c1,c2,fract(s.x*3.7+s.y*1.3));va=(.16+.22*(1.-s.z))*(.7+.3*sin(t*.3+s.z*30.));}` },
  // Звёзды: полёт сквозь звёздное поле — звёзды плывут из глубины и мерцают
  stars: { count: [320, 900], vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;
void main(){float z=fract(s.z-t*.018);vec2 q=(s.xy-.5)/(.25+z*1.6);
  gl_Position=vec4(q*vec2(r.y/r.x,1.)*1.6,0.,1.);
  float near=1.-z;gl_PointSize=(1.6+4.5*near*near)*px;
  vc=mix(c1,c2,s.y);va=(.25+.75*near)*smoothstep(1.,.8,z)*(.65+.35*sin(t*2.+s.x*60.));}` },
};

/** Как рисовать: доля размера (мягкие — меньше), кадров в секунду, сила на светлом и тёмном */
const LOOK: Record<BackdropKind, { scale: number; fps: number; k: [light: number, dark: number] }> = {
  mesh: { scale: 0.35, fps: 30, k: [0.3, 0.4] },
  aurora: { scale: 0.5, fps: 30, k: [0.5, 0.6] },
  silk: { scale: 0.5, fps: 30, k: [0.32, 0.45] },
  waves: { scale: 1, fps: 30, k: [0.55, 0.75] },
  topo: { scale: 1, fps: 30, k: [0.35, 0.45] },
  rays: { scale: 0.5, fps: 30, k: [0.45, 0.6] },
  bokeh: { scale: 0.5, fps: 30, k: [0.75, 1.1] },
  particles: { scale: 1, fps: 60, k: [0.8, 1] },
  stars: { scale: 1, fps: 60, k: [0.75, 1] },
  dots: { scale: 1, fps: 30, k: [0.3, 0.42] },
  network: { scale: 1, fps: 30, k: [0.55, 0.75] },
  hex: { scale: 0.75, fps: 30, k: [0.35, 0.45] },
  orbits: { scale: 1, fps: 30, k: [0.6, 0.8] },
  grid: { scale: 1, fps: 30, k: [0.24, 0.4] },
};

/** Сеть: узлы плывут, близкие соединены линиями — считается на процессоре, рисуется видеокартой */
const NET_VS = `attribute vec3 v;uniform vec2 r;uniform float px;varying float va;void main(){gl_Position=vec4(v.xy*2.-1.,0.,1.);gl_PointSize=4.5*px;va=v.z;}`;
const NET_FS = `precision mediump float;uniform vec3 c1;uniform vec3 c2;uniform float k;uniform float dot;varying float va;
void main(){float a=va*k;if(dot>.5){float d=length(gl_PointCoord-.5);a*=smoothstep(.5,.2,d);}vec3 c=mix(c1,c2,va);gl_FragColor=vec4(c*a,a);}`;

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

type Pal = () => { c1: Rgb; c2: Rgb; k: number };

function makeScene(gl: WebGLRenderingContext, kind: BackdropKind, colors: Pal, lite: boolean): Scene | null {
  if (kind === 'network') return networkScene(gl, colors, lite);
  const pts = POINTS[kind];
  // Ровные линии рельефа — по производным (есть почти везде; без них сцена не соберётся — фон останется статичным)
  if (kind === 'topo') gl.getExtension('OES_standard_derivatives');
  const prog = pts ? program(gl, pts.vs, POINT_FS) : FS[kind] ? program(gl, QUAD_VS, FS[kind]!) : null;
  if (!prog) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  let count = 0;
  if (pts) {
    count = pts.count[lite ? 0 : 1];
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
      if (uC1) gl.uniform3fv(uC1, c1);
      if (uC2) gl.uniform3fv(uC2, c2);
      gl.uniform1f(uK, k);
      if (uPx) gl.uniform1f(uPx, gl.drawingBufferHeight / 720);
      if (pts) gl.drawArrays(gl.POINTS, 0, count);
      else gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

/** Сеть: узлы с линиями между близкими; координаты — доли слайда */
function networkScene(gl: WebGLRenderingContext, colors: Pal, lite: boolean): Scene | null {
  const prog = program(gl, NET_VS, NET_FS);
  if (!prog) return null;
  gl.useProgram(prog);
  const n = lite ? 34 : 64;
  const nodes = Array.from({ length: n }, () => ({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.012, vy: (Math.random() - 0.5) * 0.012 }));
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const a = gl.getAttribLocation(prog, 'v');
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const u = (s: string) => gl.getUniformLocation(prog, s);
  const lines = new Float32Array(n * n * 6);
  const dots = new Float32Array(n * 3);
  let prev = 0;
  return {
    draw(t) {
      const { c1, c2, k } = colors();
      const dt = prev ? Math.min(0.1, t - prev) : 0;
      prev = t;
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      const ar = W / H;
      for (const p of nodes) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < -0.05 || p.x > 1.05) p.vx *= -1;
        if (p.y < -0.05 || p.y > 1.05) p.vy *= -1;
      }
      let m = 0;
      const R = 0.2;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = (nodes[i].x - nodes[j].x) * ar;
          const dy = nodes[i].y - nodes[j].y;
          const d = Math.hypot(dx, dy);
          if (d > R) continue;
          const al = (1 - d / R) * 0.85;
          lines.set([nodes[i].x, nodes[i].y, al, nodes[j].x, nodes[j].y, al], m);
          m += 6;
        }
      }
      nodes.forEach((p, i) => dots.set([p.x, p.y, 0.9], i * 3));
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u('r'), W, H);
      gl.uniform1f(u('px'), H / 720);
      gl.uniform3fv(u('c1'), c1);
      gl.uniform3fv(u('c2'), c2);
      gl.uniform1f(u('k'), k);
      gl.uniform1f(u('dot'), 0);
      gl.bufferData(gl.ARRAY_BUFFER, lines.subarray(0, m), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINES, 0, m / 3);
      gl.uniform1f(u('dot'), 1);
      gl.bufferData(gl.ARRAY_BUFFER, dots, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, n);
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
      const look = LOOK[p.kind] ?? LOOK.aurora;
      // Второй цвет — второй цвет темы (градиент акцента), без него — акцент со сдвигом оттенка
      const two = getComputedStyle(el).getPropertyValue('--ac2').trim() ? cssRgb(el, 'var(--ac2)') : shiftHue(ac, p.kind === 'grid' ? -25 : 40);
      pal = { c1: dark ? lift(ac, 0.25) : ac, c2: dark ? lift(two, 0.15) : two, k: look.k[dark ? 1 : 0] };
    };

    const size = () => {
      if (!canvas) return;
      const r = el.getBoundingClientRect();
      // Мягкие сцены (пятна, сияние, лучи) — в меньшем размере: глаз разницы не видит, видеокарта отдыхает
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * (lite ? 0.6 : 1) * (LOOK[p.kind]?.scale ?? 1);
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
      // Медленные сцены, окно докладчика и редактор — 30 кадров в секунду
      const slow = lite || document.body.classList.contains('editing') || (LOOK[p.kind]?.fps ?? 60) <= 30;
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
        el.classList.add('bd-live');
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
        el.classList.remove('bd-live');
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

/**
 * Примерка фона в студии: на открытом слайде поверх его фона — живой выбранный (null — убрать).
 * Данные не меняются; выбор — отдельной правкой
 */
let trial: { el: HTMLElement; off: (() => void) | void; added: boolean } | null = null;
export function previewBackdrop(stage: HTMLElement, kind: BackdropKind | 'none' | null): void {
  const slide = stage.querySelector<HTMLElement>('.slide.on');
  if (trial) {
    trial.off?.();
    if (trial.added) trial.el.parentElement?.classList.remove('has-backdrop');
    trial.el.remove();
    trial = null;
  }
  stage.querySelectorAll('.backdrop.bd-off').forEach((b) => b.classList.remove('bd-off'));
  if (!slide || !kind) return;
  slide.querySelectorAll(':scope > .backdrop').forEach((b) => b.classList.add('bd-off'));
  if (kind === 'none') return;
  const def = getBlock('backdrop');
  if (!def?.mount) return;
  const box = document.createElement('div');
  box.innerHTML = def.render({ type: 'backdrop', kind }, {} as never);
  const el = box.firstElementChild as HTMLElement;
  el.classList.add('bd-trial');
  const added = !slide.classList.contains('has-backdrop');
  slide.classList.add('has-backdrop');
  slide.prepend(el);
  trial = { el, added, off: def.mount(el, { type: 'backdrop', kind }, { stage, slide, reducedMotion: false }) };
}
