/**
 * Заставка программы «Колода»: за знаком Slideria веером раскрываются три слайда — титульный, с диаграммой и с
 * фотографией. Лежит слоем поверх окна (desktop/main.mjs), пока под ней запускается программа; полоска под
 * названием идёт по настоящим шагам запуска (step), запуск дольше секунды — подпись, что сейчас происходит.
 * Уходя (done), слайды разлетаются, а заставка раскрывается кругом от знака — под ней уже готовая страница.
 *
 * Ничего не грузит: всё нарисовано стилями, страница — data:-адрес. Запуск не задерживает: веер раскрывается
 * за ~0,45 с; программа готова раньше — заставка дожидается только конца веера.
 * «Уменьшить движение» в системе — просто появляется и растворяется.
 */

const GLYPH = '<path class="p1" pathLength="1" d="M20.5 3.5H8.25a4.25 4.25 0 0 0 0 8.5"/><path class="p2" pathLength="1" d="M8.25 12h7.5a4.25 4.25 0 0 1 0 8.5H3.5"/><circle class="d1" cx="20.5" cy="3.5" r="1.4"/><circle class="d2" cx="3.5" cy="20.5" r="1.4"/>';

/** Цвета темы: фон — как у страницы программы, чтобы под заставкой не было вспышки */
const THEMES = {
  light: {
    bg: '#F8FAFC', tx: '#0F172A', mu: '#64748B', track: 'rgba(15,23,42,.08)',
    glow1: 'rgba(99,102,241,.20)', glow2: 'rgba(236,72,153,.10)', glow3: 'rgba(14,165,233,.12)',
    card: '#FFFFFF', cardBd: 'rgba(15,23,42,.08)', ink: '#0F172A', ink2: '#CBD5E1', shadow: 'rgba(30,41,99,.28)',
  },
  dark: {
    bg: '#0F172A', tx: '#F1F5F9', mu: '#94A3B8', track: 'rgba(148,163,184,.16)',
    glow1: 'rgba(99,102,241,.34)', glow2: 'rgba(236,72,153,.16)', glow3: 'rgba(14,165,233,.18)',
    card: '#172235', cardBd: 'rgba(148,163,184,.16)', ink: '#E2E8F0', ink2: '#334155', shadow: 'rgba(0,0,0,.55)',
  },
};

const css = (c) => `
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
*{box-sizing:border-box}
.c{position:fixed;inset:0;display:grid;place-items:center;background:${c.bg};color:${c.tx};
  font:600 clamp(9px,min(1.05vw,1.75vh),15px)/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--cy:46%}
/* Фон: мягкое свечение трёх цветов */
.bg{position:absolute;inset:-10%;pointer-events:none;opacity:0;animation:fade .5s ease-out forwards;
  background:radial-gradient(38% 34% at 42% 40%,${c.glow1},transparent 70%),radial-gradient(30% 30% at 62% 52%,${c.glow2},transparent 70%),radial-gradient(34% 30% at 50% 66%,${c.glow3},transparent 70%)}
.m,.id{position:relative;display:grid;justify-items:center}
.id{transition:transform .42s cubic-bezier(.2,.8,.2,1),opacity .26s ease-in}
/* Колода: три слайда 16:9 веером, с глубиной */
.deck{position:relative;width:17em;height:9.56em;perspective:900px;margin-bottom:-1.9em}
.s{position:absolute;inset:0;border-radius:.8em;overflow:hidden;border:1px solid ${c.cardBd};background:${c.card};
  box-shadow:0 1.6em 3em -1.2em ${c.shadow},0 .3em .8em -.3em ${c.shadow};opacity:0;transform:translateY(2.2em) scale(.9);
  transition:transform .44s cubic-bezier(.2,.8,.2,1) var(--d,0s),opacity .3s ease-out var(--d,0s)}
.s1{--d:.04s;z-index:1}.s2{--d:0s;z-index:3}.s3{--d:.08s;z-index:2}
.on .s{opacity:1}
.on .s1{transform:translate3d(-10.2em,1.1em,0) rotate(-11deg) rotateY(14deg)}
.on .s2{transform:translateY(-.9em) scale(1.04)}
.on .s3{transform:translate3d(10.2em,1.1em,0) rotate(11deg) rotateY(-14deg)}
/* Слайды ждут: веер чуть дышит */
.on .deck{animation:float 3.2s ease-in-out .6s infinite alternate}
/* 1 — титульный: градиент, надзаголовок, заголовок в две строки, круг */
.s1{background:radial-gradient(circle at 82% 30%,rgba(255,255,255,.35) 0 14%,transparent 15%),radial-gradient(circle at 82% 30%,rgba(255,255,255,.14) 0 26%,transparent 27%),linear-gradient(135deg,#4338CA,#7C3AED 55%,#DB2777)}
.s1 i{position:absolute;left:9%;border-radius:.25em;background:#fff}
.s1 .e{top:24%;width:20%;height:6.5%;opacity:.55;border-radius:1em}
.s1 .t1{top:40%;width:56%;height:10%}.s1 .t2{top:56%;width:38%;height:10%;opacity:.9}
.s1 .l{top:76%;width:26%;height:5%;opacity:.5}
/* 2 — диаграмма: заголовок и столбики, которые растут */
.s2 .h{position:absolute;left:8%;top:12%;width:44%;height:8.5%;border-radius:.25em;background:${c.ink}}
.s2 .h2{position:absolute;left:8%;top:26%;width:30%;height:5%;border-radius:.25em;background:${c.ink2}}
.s2 .ch{position:absolute;left:8%;right:8%;bottom:12%;height:52%;display:flex;align-items:flex-end;gap:5%;border-bottom:2px solid ${c.ink2}}
.s2 .ch b{flex:1;height:var(--h);border-radius:.3em .3em 0 0;background:linear-gradient(180deg,var(--a),var(--b));transform-origin:bottom;transform:scaleY(.08);transition:transform .7s cubic-bezier(.2,.8,.2,1) var(--bd)}
.on .s2 .ch b{transform:none}
.s2::after{content:"";position:absolute;inset:-30%;background:linear-gradient(110deg,transparent 40%,rgba(255,255,255,.55) 50%,transparent 60%);transform:translateX(-120%)}
.on .s2::after{animation:sheen 1.1s ease-out .55s forwards}
/* 3 — фотография: закат, горы, подпись */
.s3 .ph{position:absolute;inset:0 0 26% 0;background:radial-gradient(circle at 70% 58%,#FDE68A 0 9%,transparent 10%),linear-gradient(180deg,#6366F1,#EC4899 62%,#F59E0B)}
.s3 .ph::before,.s3 .ph::after{content:"";position:absolute;inset:0}
.s3 .ph::before{background:#3B2A6B;opacity:.7;clip-path:polygon(0 78%,18% 52%,32% 68%,50% 40%,68% 66%,82% 50%,100% 72%,100% 100%,0 100%)}
.s3 .ph::after{background:#1E1B4B;clip-path:polygon(0 92%,24% 70%,42% 86%,62% 64%,80% 84%,100% 74%,100% 100%,0 100%)}
.s3 .cap{position:absolute;left:8%;bottom:9%;width:46%;height:7%;border-radius:.25em;background:${c.ink}}
.s3 .cap2{position:absolute;right:8%;bottom:9%;width:16%;height:7%;border-radius:1em;background:#EC4899;opacity:.85}
/* Знак: плитка, росчерк, кольцо свечения */
.t{position:relative;z-index:4;width:5.4em;height:5.4em;border-radius:1.5em;display:grid;place-items:center;color:#fff;
  background:linear-gradient(145deg,#7AA7F7,#2F6BEA 52%,#1D4ED8);
  box-shadow:0 0 0 .45em ${c.bg},0 0 0 .5em rgba(99,102,241,.25),0 1.2em 2.6em -.6em rgba(37,99,235,.6),inset 0 1px 0 rgba(255,255,255,.45);
  opacity:0;transform:scale(.82)}
.on .t{animation:pop .42s cubic-bezier(.2,.8,.2,1) .1s forwards}
.t svg{width:3.2em;height:3.2em;overflow:visible}
.t path{fill:none;stroke:currentColor;stroke-width:2.8;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1}
.t .p2,.t .d2{opacity:.6}
.t circle{fill:currentColor;transform-box:fill-box;transform-origin:center;transform:scale(0)}
.on .t .p1{animation:draw .24s cubic-bezier(.45,0,.25,1) .16s forwards}
.on .t .p2{animation:draw .26s cubic-bezier(.45,0,.25,1) .36s forwards}
.on .t .d1{animation:dot .24s cubic-bezier(.3,1.5,.5,1) .12s forwards}
.on .t .d2{animation:dot .24s cubic-bezier(.3,1.5,.5,1) .58s forwards}
.w{margin-top:1.1em;display:flex;font-size:2.1em;font-weight:650;letter-spacing:-.02em}
.w span{display:inline-block;opacity:0;transform:translateY(.35em)}
.on .w span{animation:rise .4s cubic-bezier(.2,.8,.2,1) calc(.2s + var(--i) * .022s) forwards}
.bar{position:relative;margin-top:1.15em;width:9.5em;height:3px;border-radius:2px;background:${c.track};overflow:hidden;opacity:0}
.on .bar{animation:fade .3s ease-out .3s forwards}
.bar i{position:absolute;inset:0;transform-origin:left;transform:scaleX(var(--p,0));border-radius:inherit;background:linear-gradient(90deg,#818CF8,#2563EB,#EC4899);background-size:200% 100%;animation:shim 1.6s linear infinite}
.n{position:absolute;top:calc(100% + 1em);left:50%;transform:translateX(-50%);white-space:nowrap;font-size:.95em;font-weight:500;color:${c.mu};opacity:0;transition:opacity .25s}
.long .n{opacity:1}
/* Уход: слайды разлетаются, знак приближается и гаснет, заставка раскрывается кругом от знака */
@property --r{syntax:"<length>";inherits:false;initial-value:-80px}
.out .s{opacity:0;transition:transform .46s cubic-bezier(.5,0,.2,1),opacity .34s ease-in .1s}
.out .s1{transform:translate3d(-42em,-4em,0) rotate(-32deg) rotateY(30deg)}
.out .s2{transform:translateY(-3em) scale(1.7)}
.out .s3{transform:translate3d(42em,-4em,0) rotate(32deg) rotateY(-30deg)}
.out .deck{animation:none}
.out .id{transform:scale(1.12);opacity:0}
.out.c{--r:var(--rend,1600px);-webkit-mask:radial-gradient(circle at 50% var(--cy),transparent var(--r),#000 calc(var(--r) + 70px));mask:radial-gradient(circle at 50% var(--cy),transparent var(--r),#000 calc(var(--r) + 70px));transition:--r .5s cubic-bezier(.55,0,.25,1) .08s}
@keyframes fade{to{opacity:1}}
@keyframes pop{to{opacity:1;transform:none}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes dot{to{transform:scale(1)}}
@keyframes rise{to{opacity:1;transform:none}}
@keyframes sheen{to{transform:translateX(120%)}}
@keyframes shim{to{background-position:-200% 0}}
@keyframes float{to{transform:translateY(-.35em)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:1ms!important;animation-delay:0s!important;transition-duration:1ms!important;transition-delay:0s!important}.on .deck{animation:none}}
`;

const BARS = [['46%', '#93C5FD', '#3B82F6', '.30s'], ['72%', '#A5B4FC', '#6366F1', '.36s'], ['58%', '#C4B5FD', '#8B5CF6', '.42s'], ['88%', '#F9A8D4', '#EC4899', '.48s'], ['66%', '#93C5FD', '#2563EB', '.54s']];

/** Подписи шагов — только если запуск дольше секунды */
const NOTES = ['Запуск Slideria…', 'Подготовка презентаций…', 'Открытие студии…', 'Почти готово…'];

const script = `
(function(){
  var c=document.querySelector('.c'),bar=document.querySelector('.bar i'),note=document.querySelector('.n');
  var shown=0,target=.12,next=.3,since=performance.now(),t0=performance.now(),leaving=null;
  var NOTES=${JSON.stringify(NOTES)};
  requestAnimationFrame(function(){c.classList.add('on')});
  setTimeout(function(){if(!leaving)c.classList.add('long')},1000);
  (function frame(now){
    var cap=target+(next-target)*.7*(1-Math.exp(-(now-since)/900));
    shown+=(Math.max(cap,shown)-shown)*.12;
    bar.style.setProperty('--p',shown.toFixed(4));
    if(!leaving)requestAnimationFrame(frame);
  })(t0);
  /** Шаг запуска: p — доля пути (0…1), k — номер подписи */
  window.step=function(p,k){if(p>target){target=p;next=Math.min(1,p+.25);since=performance.now()}if(k!=null&&NOTES[k])note.textContent=NOTES[k]};
  /** Программа готова: веер дораскрывается (не дольше ~0,45 с от появления), слайды разлетаются; ответ — когда ушла */
  window.done=function(){
    if(leaving)return leaving;
    leaving=new Promise(function(resolve){
      var wait=Math.max(0,460-(performance.now()-t0));
      setTimeout(function(){
        bar.style.setProperty('--p','1');
        var r=c.getBoundingClientRect();
        c.style.setProperty('--rend',Math.ceil(Math.hypot(r.width/2,r.height*.54))+80+'px');
        c.classList.remove('long');
        c.classList.add('out');
        setTimeout(resolve,matchMedia('(prefers-reduced-motion: reduce)').matches?60:600);
      },wait);
    });
    return leaving;
  };
})();`;

/** Разметка заставки (для data:-адреса и для демо) */
export function splashHtml(dark) {
  const c = THEMES[dark ? 'dark' : 'light'];
  const bars = BARS.map(([h, a, b, d]) => `<b style="--h:${h};--a:${a};--b:${b};--bd:${d}"></b>`).join('');
  const word = 'Slideria'.split('').map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>${css(c)}</style>
<div class="c"><div class="bg"></div><div class="m">
<div class="deck"><div class="s s1"><i class="e"></i><i class="t1"></i><i class="t2"></i><i class="l"></i></div><div class="s s3"><div class="ph"></div><i class="cap"></i><i class="cap2"></i></div><div class="s s2"><i class="h"></i><i class="h2"></i><div class="ch">${bars}</div></div></div>
<div class="id"><span class="t"><svg viewBox="0 0 24 24">${GLYPH}</svg></span>
<span class="w">${word}</span>
<span class="bar"><i></i><span class="n">${NOTES[0]}</span></span></div>
</div></div>
<script>${script}</script>`;
}

/** Заставка data:-адресом — для слоя поверх окна */
export const splashPage = (dark) => `data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(dark))}`;
