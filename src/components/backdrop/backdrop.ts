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
  // Тоннель: полёт сквозь кольца — они вырастают из глубины и уходят за края
  tunnel: `${HEAD}
void main(){vec2 q=(gl_FragCoord.xy-.5*r)/r.y;q-=vec2(.12*sin(t*.13),.06*cos(t*.11));
  float d=length(q);float a=atan(q.y,q.x);float z=.9/max(d,.001)+t*.55;
  float px=.0018/max(d*d,.001)*800./r.y;
  float ring=smoothstep(.5-.02-px,.5,abs(fract(z)-.5)+.0);
  float spoke=smoothstep(.5-.012-px*.5,.5,abs(fract(a/6.28318*24.+z*.04)-.5));
  float depth=smoothstep(.04,.45,d);
  vec3 c=mix(c2,c1,fract(z*.25));
  float g=max(ring,spoke*.55)*depth*(.4+.6*smoothstep(.9,.2,d))+exp(-d*9.)*.35;
  float al=g*k;gl_FragColor=vec4(c*al,al);}`,
  // Лава: капли жидкости сливаются и расходятся, по краю — блик
  // Блики: солнечный свет на дне бассейна — сетка ярких линий медленно перетекает.
  // Узор считается вдали от нуля (там он без симметрии) — нужна высокая точность, где она есть
  caustics: `${HEAD}
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#endif
void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.)*5.-250.;
  float tt=mod(t,600.)*.28+23.;vec2 i=p;float c=1.;
  for(int n=0;n<4;n++){float q=tt*(1.-3.5/float(n+1));
    i=p+vec2(cos(q-i.x)+sin(q+i.y),sin(q-i.y)+cos(q+i.x));
    c+=1./length(vec2(p.x/(sin(i.x+q)/.005),p.y/(cos(i.y+q)/.005)));}
  c/=4.;c=1.17-pow(abs(c),1.4);float v=clamp(pow(abs(c),8.),0.,1.);
  vec3 w=mix(c1,c2,.15+.15*sin(uv.x*2.+t*.07));
  float m=.35+.65*smoothstep(.15,1.1,length(uv-vec2(0.,1.)));
  float tint=.08*(.6+.4*sin(uv.x*3.-uv.y*2.+t*.05));float lv=v*.9;
  float a=(tint+lv*(1.-tint))*k*m;vec3 col=(w*tint+mix(w,vec3(1.),.15)*lv*(1.-tint))*k*m;
  gl_FragColor=vec4(col,a);}`,
  // Ретро-закат: солнце с полосами над сеткой, уходящей к горизонту
  retrosun: `${HEAD}
void main(){vec2 uv=gl_FragCoord.xy/r;float ar=r.x/r.y;vec2 p=uv*vec2(ar,1.);
  float h=.24;vec2 sc=vec2(ar*.74,.46);float R=.3;float d=length(p-sc);
  float y=(p.y-sc.y)/R;float g=clamp(-y*.42+.04,0.,.5);
  float cut=step(fract(y*7.+t*.18),g);
  float disk=smoothstep(R,R-.004,d)*(1.-cut)*step(h,uv.y);
  vec3 sun=mix(c1,c2,clamp(.5+y*.6,0.,1.));
  float halo=exp(-max(d-R,0.)*9.)*.35*step(h,uv.y);
  float gr=0.;if(uv.y<h){float dy=h-uv.y;float z=1./(dy+.035);
    float vx=fract((p.x-sc.x)*z*.35);float lx=smoothstep(.07,0.,min(vx,1.-vx));
    float vz=fract(z*.55-t*.35);float lz=smoothstep(.09,0.,min(vz,1.-vz));
    gr=max(lx,lz)*smoothstep(0.,.06,dy)*(.35+.65*smoothstep(0.,.24,dy));}
  vec3 col=sun*disk*.85+c2*halo*(1.-disk)+c1*gr*.55;float a=(disk*.85+halo*(1.-disk)+gr*.55)*k;
  gl_FragColor=vec4(col*k,a);}`,
  // Пульс: кардиограмма бежит по слайду, за ней гаснет след
  pulse: `${HEAD}
float ecg(float x){float d;float y=0.;
  d=(x-.18)/.035;y+=.12*exp(-d*d);d=(x-.36)/.012;y-=.1*exp(-d*d);
  d=(x-.40)/.014;y+=exp(-d*d);d=(x-.44)/.014;y-=.25*exp(-d*d);d=(x-.68)/.06;y+=.22*exp(-d*d);return y;}
void main(){vec2 uv=gl_FragCoord.xy/r;float bx=uv.x*2.2;float e=.0015;
  float base=.24;float amp=.16;float yl=base+ecg(fract(bx))*amp;
  float sl=(ecg(fract(bx+e))-ecg(fract(bx-e)))/(2.*e)*amp*2.2*r.y/r.x;
  // Расстояние до линии: по наклону, но не меньше, чем до размаха кривой рядом (иначе у крутого пика — полоса на всю высоту)
  float dx=4./r.x*2.2;float ya=base+ecg(fract(bx-dx))*amp;float yb=base+ecg(fract(bx+dx))*amp;
  float env=max(0.,max(uv.y-max(yl,max(ya,yb)),min(yl,min(ya,yb))-uv.y));
  float dpx=max(abs(uv.y-yl)/sqrt(1.+sl*sl),env)*r.y/max(r.y/720.,.5);
  float line=smoothstep(2.8,1.,dpx);float glow=exp(-dpx*.12)*.25;
  float hx=fract(t*.11)*1.3-.15;float be=hx-uv.x;
  float vis=be>0.?exp(-be*2.6):0.;float head=exp(-be*be*900.)*step(-.02,be);
  vec3 col=mix(c2,c1,vis);float a=((line+glow)*(.2+.8*vis)+head*glow*2.)*k;
  gl_FragColor=vec4(col*a,a);}`,
  lava: `${HEAD}
void main(){vec2 uv=gl_FragCoord.xy/r;float ar=r.x/r.y;vec2 p=uv*vec2(ar,1.);float f=0.;
  for(int i=0;i<7;i++){float fi=float(i);
    vec2 c=vec2(ar*(.5+.42*sin(t*(.07+fi*.013)+fi*2.1)),.5+.4*sin(t*(.09+fi*.011)+fi*1.3));
    float rr=.22+.1*sin(fi*1.7);vec2 d=p-c;f+=rr/dot(d,d);}
  f*=.1;float m=smoothstep(.95,1.05,f);float rim=smoothstep(.95,1.02,f)-smoothstep(1.02,1.4,f);
  float body=smoothstep(1.,3.5,f);
  vec3 c=mix(c1,c2,clamp(uv.y+.2*sin(t*.1),0.,1.));c=mix(c,mix(c,vec3(1.),.25),body);c+=rim*.5*(1.-c);
  float al=(m*(.55+.25*body)+rim*.3)*k;gl_FragColor=vec4(c*al,al);}`,
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
/** Лист: вытянутая капля с прожилкой, крутится (vr.x) и переворачивается в полёте (vr.y — видимая ширина) */
const LEAF_FS = `precision mediump float;uniform float k;varying float va;varying vec3 vc;varying vec2 vr;
void main(){vec2 p=gl_PointCoord-.5;float c=cos(vr.x);float s=sin(vr.x);p=mat2(c,-s,s,c)*p;p.x/=max(vr.y,.15);
  float v=p.y/.44;if(abs(v)>1.)discard;float w=.22*(1.-v*v)*(1.+.3*v);
  float a=smoothstep(.015,-.01,abs(p.x)-w)*va*k;if(a<.004)discard;
  float rib=1.-.3*smoothstep(.02,0.,abs(p.x))*step(-.85,v);
  gl_FragColor=vec4(vc*rib*(.88+.35*p.x)*a,a);}`;
/** Лепесток: округлый, с выемкой на конце, светлее к середине */
const PETAL_FS = `precision mediump float;uniform float k;varying float va;varying vec3 vc;varying vec2 vr;
void main(){vec2 p=gl_PointCoord-.5;float c=cos(vr.x);float s=sin(vr.x);p=mat2(c,-s,s,c)*p;p.x/=max(vr.y,.2);
  float v=p.y/.4;if(abs(v)>1.)discard;float w=.26*sqrt(1.-v*v)*(1.+.25*v);
  float a=smoothstep(.015,-.01,abs(p.x)-w)*(1.-smoothstep(-.01,.015,(v-.62)*.45-abs(p.x)))*va*k;if(a<.004)discard;
  gl_FragColor=vec4(mix(vc,vec3(1.),.35-.3*abs(v))*a,a);}`;
/** Мыльный пузырь: прозрачный внутри, светлый ободок и блик */
const BUBBLE_FS = `precision mediump float;uniform float k;varying float va;varying vec3 vc;
void main(){vec2 p=gl_PointCoord-.5;float d=length(p);if(d>.5)discard;
  float a=smoothstep(.5,.46,d)*(.12+.88*smoothstep(.34,.47,d));
  float h=smoothstep(.1,.03,length(p-vec2(-.17,-.17)));
  a=max(a,h*.9)*va*k;gl_FragColor=vec4(mix(vc,vec3(1.),h*.8)*a,a);}`;
/** Сердечко */
const HEART_FS = `precision mediump float;uniform float k;varying float va;varying vec3 vc;
void main(){vec2 q=(gl_PointCoord-.5)*2.7;q.y=-q.y+.25;float h=q.x*q.x+q.y*q.y-1.;float f=h*h*h-q.x*q.x*q.y*q.y*q.y;
  float a=smoothstep(.04,-.04,f)*va*k;if(a<.004)discard;gl_FragColor=vec4(mix(vc,vec3(1.),.25*smoothstep(.2,-.6,q.x+q.y))*a,a);}`;
/** Конфетти: полоска, крутится и переворачивается */
const CONFETTI_FS = `precision mediump float;uniform float k;varying float va;varying vec3 vc;varying vec2 vr;
void main(){vec2 p=gl_PointCoord-.5;float c=cos(vr.x);float s=sin(vr.x);p=mat2(c,-s,s,c)*p;
  float a=step(abs(p.x),.15*vr.y)*step(abs(p.y),.3)*va*k;if(a<.004)discard;gl_FragColor=vec4(vc*a,a);}`;
const POINTS: Partial<Record<BackdropKind, { vs: string; fs?: string; count: [lite: number, full: number]; seed?: (i: number, n: number) => [number, number, number] }>> = {
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
  // Глобус: сфера из точек медленно вращается справа; передние точки ярче, задние — тише
  globe: { count: [900, 2400], seed: (i, n) => [(i + 0.5) / n, i, Math.random()], vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;
void main(){float y=1.-2.*s.x;float rad=sqrt(max(0.,1.-y*y));float ph=s.y*2.39996;
  vec3 q=vec3(cos(ph)*rad,y,sin(ph)*rad);float ang=t*.12;q.xz=mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*q.xz;
  float tl=.38;q.yz=mat2(cos(tl),-sin(tl),sin(tl),cos(tl))*q.yz;
  float land=step(.15,sin(q.x*5.1+q.y*3.)*sin(q.y*4.3-q.z*3.7)+.3*sin(q.z*9.+q.x*2.));
  vec2 sc=vec2(.85,-.04)+q.xy*.72;gl_Position=vec4(sc.x*r.y/r.x,sc.y,0.,1.);
  float front=.5+.5*q.z;gl_PointSize=(1.5+2.6*front)*px*(1.+.4*land);
  vc=mix(c2,c1,front);va=(.15+.85*front)*(.3+.7*land);}` },
  // Ландшафт: поле точек волнуется до горизонта
  terrain: { count: [1800, 5500], seed: (i, n) => { const w = n > 2000 ? 110 : 60; const h = Math.ceil(n / w); return [(i % w) / (w - 1), Math.floor(i / w) / (h - 1), Math.random()]; }, vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;
void main(){float x=(s.x-.5)*7.;float z=1.2+s.y*9.;
  float h=.45*sin(s.x*7.+t*.5+s.y*3.)*cos(s.y*5.-t*.35)+.25*sin((s.x*1.3+s.y)*11.+t*.8);
  vec2 sc=vec2(x/z,(h-1.35)/z+.08);gl_Position=vec4(sc.x*r.y/r.x*1.9,sc.y*1.9,0.,1.);
  gl_PointSize=(3.4/z+.9)*px*2.;float hh=clamp(h*1.2+.5,0.,1.);
  vc=mix(c1,c2,hh);va=smoothstep(10.2,3.,z)*(.45+.55*hh);}` },
  // Снегопад: хлопья падают и покачиваются; ближние крупнее и быстрее, самые ближние — большие размытые
  snow: { count: [200, 560], vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;
void main(){float z=s.z;float y=fract(s.y-t*(.018+.05*z));
  float x=fract(s.x+sin(t*(.25+.35*z)+s.y*12.)*.012*(.6+z)+t*.004*(1.+z));
  gl_Position=vec4(vec2(x,y)*2.2-1.1,0.,1.);
  float near=step(.93,z);gl_PointSize=mix(2.6+8.*z*z,16.+26.*(z-.93)*14.,near)*px;
  vc=mix(c2,c1,.15+.35*s.x);va=mix(.45+.55*z,.22,near)*(.85+.15*sin(t*1.3+s.x*50.));}` },
  // Листопад: листья в цветах темы кружатся, переворачиваются и плывут вниз
  leaves: { count: [22, 46], fs: LEAF_FS, vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;varying vec2 vr;
void main(){float z=s.z;float y=fract(s.y-t*(.016+.026*z));
  float x=fract(s.x+sin(t*(.45+.35*z)+s.x*20.)*.035+t*.008);
  gl_Position=vec4(vec2(x,y)*2.3-1.15,0.,1.);gl_PointSize=(22.+38.*z)*px;
  float dir=fract(s.x*7.31)>.5?1.:-1.;
  vr=vec2(t*(.5+.8*z)*dir+s.y*6.283,.3+.7*abs(sin(t*(.6+.5*z)+s.x*9.)));
  vc=mix(c1,c2,fract(s.x*3.3+s.y*1.7));va=.5+.5*z;}` },
  // Лепестки: падают с ветром, кружатся и переворачиваются
  petals: { count: [34, 70], fs: PETAL_FS, vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;varying vec2 vr;
void main(){float z=s.z;float y=fract(s.y-t*(.02+.03*z));
  float x=fract(s.x+t*(.012+.02*z)+sin(t*(.5+.4*z)+s.y*15.)*.03);
  gl_Position=vec4(vec2(x,y)*2.3-1.15,0.,1.);gl_PointSize=(14.+24.*z)*px;
  float dir=fract(s.x*5.17)>.5?1.:-1.;
  vr=vec2(t*(.6+.9*z)*dir+s.y*6.283,.35+.65*abs(sin(t*(.8+.5*z)+s.x*11.)));
  vc=mix(c1,c2,.3+.7*fract(s.x*4.1+s.y*2.3));va=.55+.45*z;}` },
  // Пузыри: поднимаются и покачиваются, переливаются цветами темы
  bubbles: { count: [18, 40], fs: BUBBLE_FS, vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;
void main(){float z=s.z;float y=fract(s.y+t*(.012+.022*z));
  float x=fract(s.x+sin(t*(.4+.3*z)+s.y*10.)*.025);
  gl_Position=vec4(vec2(x,y)*2.4-1.2,0.,1.);gl_PointSize=(16.+58.*z*z)*px;
  vc=mix(c1,c2,.5+.5*sin(t*.4+s.x*12.));va=.5+.4*z;}` },
  // Сердечки: всплывают, покачиваются и чуть пульсируют
  hearts: { count: [20, 44], fs: HEART_FS, vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;
void main(){float z=s.z;float y=fract(s.y+t*(.014+.022*z));
  float x=fract(s.x+sin(t*(.6+.4*z)+s.y*12.)*.03);
  gl_Position=vec4(vec2(x,y)*2.3-1.15,0.,1.);gl_PointSize=(12.+26.*z)*px*(1.+.08*sin(t*3.+s.x*30.));
  vc=mix(c1,c2,fract(s.x*3.7+s.y*1.9));va=(.45+.5*z)*smoothstep(1.,.75,y);}` },
  // Конфетти: цветные полоски падают, крутятся и переворачиваются
  confetti: { count: [60, 130], fs: CONFETTI_FS, vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;varying vec2 vr;
void main(){float z=s.z;float y=fract(s.y-t*(.03+.04*z));
  float x=fract(s.x+sin(t*(.7+.5*z)+s.y*13.)*.02);
  gl_Position=vec4(vec2(x,y)*2.2-1.1,0.,1.);gl_PointSize=(14.+20.*z)*px;
  float dir=fract(s.x*6.7)>.5?1.:-1.;
  vr=vec2(t*(1.2+1.6*z)*dir+s.y*6.283,.25+.75*abs(cos(t*(1.4+z)+s.x*9.)));
  float h=fract(s.x*7.3+s.y*3.1);vc=h<.33?c1:h<.66?c2:mix(mix(c1,c2,.5),vec3(1.),.45);va=.6+.4*z;}` },
  // Планктон: светящиеся точки дрейфуют по течению и мерцают; крупные — как медузы вдали
  plankton: { count: [260, 700], vs: `attribute vec3 s;uniform float t;uniform vec2 r;uniform float px;uniform vec3 c1;uniform vec3 c2;varying float va;varying vec3 vc;
void main(){float z=s.z;float tt=t*(.008+.012*z);vec2 q=s.xy;
  q+=vec2(sin(q.y*6.+tt*6.+z*3.)*.03+tt,cos(q.x*5.-tt*5.)*.03+sin(t*.05+s.x*9.)*.012);
  q=fract(q);gl_Position=vec4(q*2.2-1.1,0.,1.);
  float pl=.5+.5*sin(t*(.3+.6*z)+s.x*40.);float big=step(.9,z);
  gl_PointSize=mix(3.+8.*z*z,22.+34.*(z-.9)*10.,big)*px;
  vc=mix(c1,c2,fract(s.x*2.3+s.y*1.7));va=mix((.35+.65*z)*(.35+.65*pl),.2+.14*pl,big);}` },
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
  globe: { scale: 1, fps: 30, k: [0.95, 1.1] },
  terrain: { scale: 1, fps: 30, k: [0.9, 1.1] },
  tunnel: { scale: 0.75, fps: 30, k: [0.4, 0.6] },
  lava: { scale: 0.5, fps: 30, k: [0.32, 0.5] },
  snow: { scale: 1, fps: 60, k: [1.1, 1.05] },
  leaves: { scale: 1, fps: 60, k: [0.8, 0.95] },
  petals: { scale: 1, fps: 60, k: [0.85, 0.95] },
  bubbles: { scale: 1, fps: 60, k: [0.8, 0.9] },
  hearts: { scale: 1, fps: 60, k: [0.7, 0.85] },
  confetti: { scale: 1, fps: 60, k: [0.8, 0.9] },
  caustics: { scale: 0.75, fps: 30, k: [0.55, 0.7] },
  retrosun: { scale: 0.75, fps: 30, k: [0.6, 0.75] },
  plankton: { scale: 1, fps: 30, k: [1, 1.1] },
  pulse: { scale: 1, fps: 60, k: [1, 0.9] },
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
  const prog = pts ? program(gl, pts.vs, pts.fs ?? POINT_FS) : FS[kind] ? program(gl, QUAD_VS, FS[kind]!) : null;
  if (!prog) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  let count = 0;
  if (pts) {
    count = pts.count[lite ? 0 : 1];
    const seeds = new Float32Array(count * 3);
    if (pts.seed) for (let i = 0; i < count; i++) seeds.set(pts.seed(i, count), i * 3);
    else for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
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
