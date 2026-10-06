/**
 * Цветокоррекция на видеокарте (WebGL2): один проход шейдера — баланс белого, экспозиция, света
 * и тени, контраст, цветовые круги, насыщенность, HSL по цветам, кривые, 3D LUT, карта градиента,
 * виньетка и зерно. Тот же проход рисует предпросмотр, плитки образов, данные для графиков
 * и запекает картинку в полном размере.
 */
import type { Lut } from './cube';
import { BANDS, curveTable, type Grade, type Wheel } from './grade';

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_img;
uniform sampler2D u_curve;
uniform sampler3D u_lut;
uniform float u_lutMix, u_lutSize;
uniform vec3 u_lutMin, u_lutMax;
uniform vec3 u_wb;
uniform float u_exp, u_con, u_hi, u_sh, u_sat, u_vib;
uniform vec3 u_lift, u_gamma, u_gain;
uniform vec3 u_hsl[8];
uniform float u_hslOn;
uniform vec3 u_d0, u_d1, u_d2;
uniform float u_duo, u_vig, u_grain, u_split;
uniform vec2 u_px;

vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
// Плёночная S-кривая контраста вокруг середины: без жёстких срезов в тенях и светах
float sCurve(float x, float k) {
  float p = exp2(k * 1.25);
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? 0.5 * pow(2.0 * x, p) : 1.0 - 0.5 * pow(2.0 * (1.0 - x), p);
}
vec4 curveAt(float x) { return texture(u_curve, vec2(clamp(x, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
const float CENTERS[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 225.0, 270.0, 315.0);

void main() {
  vec4 src = texture(u_img, v_uv);
  if (u_split > 0.0 && v_uv.x < u_split) { o = src; return; }
  // Баланс белого и экспозиция — в линейном свете, как у камеры
  vec3 lin = toLin(src.rgb) * u_wb * exp2(u_exp);
  // Света и тени: мягкие маски по яркости, до ступени в каждую сторону
  float Y = luma(lin);
  lin *= exp2(u_hi * smoothstep(0.18, 1.0, Y) + u_sh * (1.0 - smoothstep(0.0, 0.3, Y)));
  vec3 c = toSrgb(lin);
  c = vec3(sCurve(c.r, u_con), sCurve(c.g, u_con), sCurve(c.b, u_con));
  // Цветовые круги: тени (lift), полутона (gamma), света (gain)
  c = u_gain * (c + u_lift * (1.0 - c));
  c = pow(max(c, 0.0), 1.0 / max(u_gamma, vec3(0.05)));
  // Насыщенность и красочность: красочность бережёт уже насыщенное
  float l = luma(c);
  float s = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
  c = mix(vec3(l), c, max(0.0, u_sat * (1.0 + u_vib * (1.0 - clamp(s, 0.0, 1.0)))));
  // HSL по цветам: серое не трогаем
  if (u_hslOn > 0.5) {
    vec3 h = rgb2hsv(clamp(c, 0.0, 1.0));
    float deg = h.x * 360.0;
    float gate = smoothstep(0.03, 0.2, h.y);
    vec3 d = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float dist = abs(mod(deg - CENTERS[i] + 180.0, 360.0) - 180.0);
      d += (1.0 - smoothstep(0.0, 42.0, dist)) * gate * u_hsl[i];
    }
    h.x = fract(h.x + d.x * 30.0 / 360.0 + 1.0);
    h.y = clamp(h.y * (1.0 + d.y), 0.0, 1.0);
    c = hsv2rgb(h) * exp2(d.z * 0.8);
  }
  // Кривые: общая (a), затем по каналам
  c = clamp(c, 0.0, 1.0);
  c = vec3(curveAt(c.r).a, curveAt(c.g).a, curveAt(c.b).a);
  c = vec3(curveAt(c.r).r, curveAt(c.g).g, curveAt(c.b).b);
  if (u_lutMix > 0.0) {
    vec3 x = clamp((c - u_lutMin) / max(u_lutMax - u_lutMin, vec3(1e-4)), 0.0, 1.0);
    vec3 t = texture(u_lut, x * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize).rgb;
    c = mix(c, t, u_lutMix);
  }
  // Карта градиента: тени, полутона, света — цветами бренда
  if (u_duo > 0.0) {
    float y = luma(clamp(c, 0.0, 1.0));
    vec3 g = y < 0.5 ? mix(u_d0, u_d1, y * 2.0) : mix(u_d1, u_d2, (y - 0.5) * 2.0);
    c = mix(c, g, u_duo);
  }
  if (u_vig != 0.0) c *= 1.0 - u_vig * smoothstep(0.35, 1.15, length((v_uv - 0.5) * vec2(1.0, 0.82)) * 1.6);
  if (u_grain > 0.0) c += (hash(floor(v_uv * u_px)) - 0.5) * u_grain * 0.16;
  o = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

const hex3 = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Направление в цветовом круге → смещение цвета без изменения яркости */
export function wheelColor(w: Wheel | undefined): [number, number, number] {
  if (!w) return [0, 0, 0];
  const amt = Math.min(1, Math.hypot(w[0], w[1]));
  if (amt < 1e-4) return [0, 0, 0];
  const hue = ((Math.atan2(w[1], w[0]) / (2 * Math.PI)) + 1) % 1;
  const k = (n: number) => { const x = (n + hue * 6) % 6; return 1 - Math.max(0, Math.min(1, Math.min(x, 4 - x))); };
  const rgb = [k(5), k(3), k(1)];
  const y = luma(rgb);
  return rgb.map((v) => (v - y) * amt) as [number, number, number];
}

/** Баланс белого: множители каналов (средняя яркость сохраняется) */
function wb(temp = 0, tint = 0): [number, number, number] {
  const t = temp / 100;
  const m = tint / 100;
  const g = [1 + 0.32 * t + 0.12 * m, 1 - 0.22 * m, 1 - 0.32 * t + 0.12 * m];
  const y = luma(g);
  return g.map((v) => v / y) as [number, number, number];
}

export class GradeGL {
  readonly canvas = document.createElement('canvas');
  readonly gl: WebGL2RenderingContext;
  readonly maxSide: number;
  private prog: WebGLProgram;
  private u = new Map<string, WebGLUniformLocation | null>();
  private img: WebGLTexture;
  private curve: WebGLTexture;
  private lut: WebGLTexture;
  private lutInfo = { size: 2, min: [0, 0, 0], max: [1, 1, 1], on: false };
  private fbo: { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  private curveKey = '';
  /** Размер картинки */
  w = 0;
  h = 0;

  constructor() {
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('нужен WebGL2');
    this.gl = gl;
    this.maxSide = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'шейдер');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'программа');
    this.prog = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.img = gl.createTexture()!;
    this.curve = gl.createTexture()!;
    this.lut = gl.createTexture()!;
    this.setLut(null);
    gl.uniform1i(this.loc('u_img'), 0);
    gl.uniform1i(this.loc('u_curve'), 1);
    gl.uniform1i(this.loc('u_lut'), 2);
  }

  private loc(name: string): WebGLUniformLocation | null {
    if (!this.u.has(name)) this.u.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.u.get(name)!;
  }

  /** Картинка: в полном размере (до maxSide), с уменьшенными копиями для предпросмотра */
  setImage(src: TexImageSource, w: number, h: number): void {
    const { gl } = this;
    this.w = w;
    this.h = h;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /** 3D LUT или null — без него */
  setLut(l: Lut | null): void {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, this.lut);
    const size = l?.size ?? 2;
    const data = l?.data ?? new Float32Array([0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1]);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, size, size, size, 0, gl.RGBA, gl.FLOAT, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    this.lutInfo = { size, min: l?.min ?? [0, 0, 0], max: l?.max ?? [1, 1, 1], on: !!l };
  }

  private setCurves(g: Grade): void {
    const key = JSON.stringify(g.curves ?? null);
    if (key === this.curveKey) return;
    this.curveKey = key;
    const t = (['r', 'g', 'b', 'all'] as const).map((k) => curveTable(g.curves?.[k]));
    const px = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) for (let c = 0; c < 4; c++) px[i * 4 + c] = Math.round(t[c][i] * 255);
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.curve);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
  }

  private uniforms(g: Grade, split: number): void {
    const { gl } = this;
    const f = (n: string, v: number) => gl.uniform1f(this.loc(n), v);
    const v3 = (n: string, v: number[]) => gl.uniform3f(this.loc(n), v[0], v[1], v[2]);
    const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
    this.setCurves(g);
    v3('u_wb', wb(num(g.temp), num(g.tint)));
    f('u_exp', num(g.exposure));
    f('u_con', num(g.contrast) / 100);
    f('u_hi', num(g.highlights) / 100);
    f('u_sh', num(g.shadows) / 100);
    f('u_sat', 1 + num(g.saturation) / 100);
    f('u_vib', num(g.vibrance) / 100);
    const lift = wheelColor(g.lift);
    const gam = wheelColor(g.gamma);
    const gain = wheelColor(g.gain);
    const m = (w: Wheel | undefined) => num(w?.[2]);
    v3('u_lift', lift.map((x) => x * 0.25 + m(g.lift) * 0.25));
    v3('u_gamma', gam.map((x) => 1 + x * 0.5 + m(g.gamma) * 0.6));
    v3('u_gain', gain.map((x) => 1 + x * 0.5 + m(g.gain) * 0.6));
    const bands = BANDS.map((b) => g.hsl?.[b] ?? [0, 0, 0]);
    gl.uniform3fv(this.loc('u_hsl'), new Float32Array(bands.flat()));
    f('u_hslOn', bands.some((b) => b.some((x) => Math.abs(x) > 1e-4)) ? 1 : 0);
    const lutOn = this.lutInfo.on && !!g.lut;
    f('u_lutMix', lutOn ? Math.max(0, Math.min(1, num(g.lutMix, 1))) : 0);
    f('u_lutSize', this.lutInfo.size);
    v3('u_lutMin', this.lutInfo.min);
    v3('u_lutMax', this.lutInfo.max);
    const duo = g.duo ?? ['#000000', '#808080', '#FFFFFF'];
    v3('u_d0', hex3(duo[0]));
    v3('u_d1', hex3(duo[1]));
    v3('u_d2', hex3(duo[2]));
    f('u_duo', g.duo ? Math.max(0, Math.min(1, num(g.duoMix))) : 0);
    f('u_vig', num(g.vignette) / 100);
    f('u_grain', Math.max(0, num(g.grain)) / 100);
    f('u_split', split);
    // Зерно — в долях картинки: одинаковое в предпросмотре и в готовом файле
    gl.uniform2f(this.loc('u_px'), 1600, 1600 * (this.h / Math.max(1, this.w)));
  }

  /** Предпросмотр на своём холсте: w×h пикселей; split — граница «до / после» (0…1), −1 — без неё */
  draw(g: Grade, w: number, h: number, split = -1): void {
    const { gl } = this;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    this.uniforms(g, split);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Картинка с коррекцией в размере w×h — пиксели RGBA, строки снизу вверх */
  read(g: Grade, w: number, h: number): Uint8Array {
    const { gl } = this;
    if (!this.fbo || this.fbo.w !== w || this.fbo.h !== h) {
      if (this.fbo) {
        gl.deleteFramebuffer(this.fbo.fb);
        gl.deleteTexture(this.fbo.tex);
      }
      const tex = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.fbo = { fb, tex, w, h };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.fb);
    gl.viewport(0, 0, w, h);
    this.uniforms(g, -1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }

  /** Холст 2D с картинкой w×h (строки уже сверху вниз) */
  canvasOf(g: Grade, w: number, h: number): HTMLCanvasElement {
    const px = this.read(g, w, h);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const im = ctx.createImageData(w, h);
    const row = w * 4;
    for (let y = 0; y < h; y++) im.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    ctx.putImageData(im, 0, 0);
    return c;
  }

  /** Готовый файл в размере картинки: PNG, если есть прозрачность, иначе JPEG */
  async bake(g: Grade, alpha: boolean): Promise<Blob> {
    const k = Math.min(1, this.maxSide / Math.max(this.w, this.h));
    const c = this.canvasOf(g, Math.max(1, Math.round(this.w * k)), Math.max(1, Math.round(this.h * k)));
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('не удалось сохранить картинку'))), alpha ? 'image/png' : 'image/jpeg', 0.92));
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
