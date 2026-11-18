/**
 * Заставка программы «Колода»: за знаком Slideria веером лежат три слайда — титульный, с диаграммой и с
 * фотографией. Лежит слоем поверх окна (desktop/main.mjs), пока под ней запускается программа; полоска под
 * названием идёт по настоящим шагам запуска (step), запуск дольше секунды — подпись, что сейчас происходит.
 *
 * Картинка появляется целиком, одним движением: все части нарисованы сразу в итоговом виде, движется только
 * их общая группа (прозрачность и масштаб — работа видеокарты, без перерисовки). Раньше каждая часть въезжала
 * своим движением (веер, буквы, росчерк знака, столбики, блик), и каждой надо было отрисоваться в те же секунды,
 * когда грузится программа, — части появлялись рывками и не вместе. Пока ждём, движется только полоска.
 * Уходя (done), заставка растворяется; раскрытие кругом перерисовывало весь экран на каждом кадре.
 *
 * Ничего не грузит: всё нарисовано стилями, страница — data:-адрес. Видна не меньше MIN_SHOW: на быстром
 * компьютере программа готова раньше, но заставка не мелькает. «Уменьшить движение» — без движения.
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
.c{position:fixed;inset:0;display:grid;place-items:center;background:${c.bg};color:${c.tx};will-change:opacity;
  font:600 clamp(9px,min(1.05vw,1.75vh),15px)/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
/* Фон: мягкое свечение трёх цветов — с первого кадра, как фон страницы */
.bg{position:absolute;inset:-10%;pointer-events:none;
  background:radial-gradient(38% 34% at 42% 40%,${c.glow1},transparent 70%),radial-gradient(30% 30% at 62% 52%,${c.glow2},transparent 70%),radial-gradient(34% 30% at 50% 66%,${c.glow3},transparent 70%)}
/* Вся картинка — одна группа: появляется и уходит целиком */
.m{position:relative;display:grid;justify-items:center;opacity:0;transform:scale(.96);will-change:opacity,transform}
.on .m{animation:enter .42s cubic-bezier(.2,.8,.2,1) forwards}
.id{position:relative;display:grid;justify-items:center}
/* Колода: три слайда 16:9 веером, с глубиной */
.deck{position:relative;width:17em;height:9.56em;perspective:900px;margin-bottom:-1.9em}
.s{position:absolute;inset:0;border-radius:.8em;overflow:hidden;border:1px solid ${c.cardBd};background:${c.card};
  box-shadow:0 1.6em 3em -1.2em ${c.shadow},0 .3em .8em -.3em ${c.shadow}}
.s1{z-index:1;transform:translate3d(-10.2em,1.1em,0) rotate(-11deg) rotateY(14deg)}
.s2{z-index:3;transform:translateY(-.9em) scale(1.04)}
.s3{z-index:2;transform:translate3d(10.2em,1.1em,0) rotate(11deg) rotateY(-14deg)}
/* 1 — титульный: градиент, надзаголовок, заголовок в две строки, круг */
.s1{background:radial-gradient(circle at 82% 30%,rgba(255,255,255,.35) 0 14%,transparent 15%),radial-gradient(circle at 82% 30%,rgba(255,255,255,.14) 0 26%,transparent 27%),linear-gradient(135deg,#4338CA,#7C3AED 55%,#DB2777)}
.s1 i{position:absolute;left:9%;border-radius:.25em;background:#fff}
.s1 .e{top:24%;width:20%;height:6.5%;opacity:.55;border-radius:1em}
.s1 .t1{top:40%;width:56%;height:10%}.s1 .t2{top:56%;width:38%;height:10%;opacity:.9}
.s1 .l{top:76%;width:26%;height:5%;opacity:.5}
/* 2 — диаграмма: заголовок и столбики */
.s2 .h{position:absolute;left:8%;top:12%;width:44%;height:8.5%;border-radius:.25em;background:${c.ink}}
.s2 .h2{position:absolute;left:8%;top:26%;width:30%;height:5%;border-radius:.25em;background:${c.ink2}}
.s2 .ch{position:absolute;left:8%;right:8%;bottom:12%;height:52%;display:flex;align-items:flex-end;gap:5%;border-bottom:2px solid ${c.ink2}}
.s2 .ch b{flex:1;height:var(--h);border-radius:.3em .3em 0 0;background:linear-gradient(180deg,var(--a),var(--b))}
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
  box-shadow:0 0 0 .45em ${c.bg},0 0 0 .5em rgba(99,102,241,.25),0 1.2em 2.6em -.6em rgba(37,99,235,.6),inset 0 1px 0 rgba(255,255,255,.45)}
.t svg{width:3.2em;height:3.2em;overflow:visible}
.t path{fill:none;stroke:currentColor;stroke-width:2.8;stroke-linecap:round}
.t .p2,.t .d2{opacity:.6}
.t circle{fill:currentColor}
.w{margin-top:1.1em;font-size:2.1em;font-weight:650;letter-spacing:-.02em}
.bar{position:relative;margin-top:1.15em;width:9.5em;height:3px;border-radius:2px;background:${c.track};overflow:hidden}
.bar i{position:absolute;inset:0;transform-origin:left;transform:scaleX(var(--p,0));border-radius:inherit;background:linear-gradient(90deg,#818CF8,#2563EB,#EC4899);background-size:200% 100%;animation:shim 1.6s linear infinite}
.n{position:absolute;top:calc(100% + 1em);left:50%;transform:translateX(-50%);white-space:nowrap;font-size:.95em;font-weight:500;color:${c.mu};opacity:0;transition:opacity .25s}
.long .n{opacity:1}
/* Уход: картинка чуть приближается, заставка растворяется — под ней уже готовая страница */
.out .m{animation:none;opacity:1;transform:scale(1.03);transition:transform .34s cubic-bezier(.4,0,.2,1)}
.out.c{opacity:0;transition:opacity .34s ease-in}
@keyframes enter{to{opacity:1;transform:none}}
@keyframes shim{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.on .m{animation:none;opacity:1;transform:none}.out .m{transform:none}.bar i{animation:none}}
`;

const BARS = [['46%', '#93C5FD', '#3B82F6'], ['72%', '#A5B4FC', '#6366F1'], ['58%', '#C4B5FD', '#8B5CF6'], ['88%', '#F9A8D4', '#EC4899'], ['66%', '#93C5FD', '#2563EB']];

/** Сколько заставка видна самое малое, мс: появление (0,42 с) и миг, чтобы её увидеть. Уход — ещё 0,34 с */
const MIN_SHOW = 1000;

/** Подписи шагов — только если запуск дольше секунды */
const NOTES = ['Запуск Slideria…', 'Подготовка презентаций…', 'Открытие студии…', 'Почти готово…'];

const script = `
(function(){
  var c=document.querySelector('.c'),bar=document.querySelector('.bar i'),note=document.querySelector('.n');
  var shown=0,target=.12,next=.3,since=performance.now(),last=performance.now(),started=false,startedAt=0,leaving=null;
  var MIN_SHOW=${MIN_SHOW};
  var NOTES=${JSON.stringify(NOTES)};
  /** Вступление — когда окно уже на экране (desktop/main.mjs зовёт start после показа окна); на всякий случай — само */
  window.start=function(){
    if(started)return;
    started=true;
    startedAt=performance.now();
    requestAnimationFrame(function(){c.classList.add('on')});
    setTimeout(function(){if(!leaving)c.classList.add('long')},1000);
  };
  setTimeout(window.start,400);
  /** Полоска догоняет цель по времени, а не по кадрам: одинаково на 60 и на 144 Гц */
  (function frame(now){
    var dt=Math.min(64,Math.max(0,now-last));last=now;
    var cap=target+(next-target)*.7*(1-Math.exp(-(now-since)/900));
    shown+=(Math.max(cap,shown)-shown)*(1-Math.exp(-dt/130));
    bar.style.setProperty('--p',shown.toFixed(4));
    if(!leaving)requestAnimationFrame(frame);
  })(last);
  /** Шаг запуска: p — доля пути (0…1), k — номер подписи */
  window.step=function(p,k){if(p>target){target=p;next=Math.min(1,p+.25);since=performance.now()}if(k!=null&&NOTES[k])note.textContent=NOTES[k]};
  /**
   * Программа готова: появление доигрывает, заставка держится не меньше MIN_SHOW от начала, затем растворяется.
   * Ответ — когда заставка ушла
   */
  window.done=function(){
    if(leaving)return leaving;
    window.start();
    leaving=new Promise(function(resolve){
      var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Движение появления: конечное, ещё не доигравшее (бегущий блик полоски — бесконечный, его не ждём)
      var intro=document.getAnimations().filter(function(a){
        var t=a.effect&&a.effect.getComputedTiming&&a.effect.getComputedTiming();
        return t&&t.iterations!==Infinity&&a.playState!=='finished'&&!(a.effect.pseudoElement);
      });
      var left=0;
      intro.forEach(function(a){var t=a.effect.getComputedTiming();left=Math.max(left,(t.endTime||0)-(a.currentTime||0))});
      // Вступление только началось (класс on — со следующего кадра): его движения ещё не созданы
      left=Math.max(left,MIN_SHOW-(performance.now()-startedAt));
      setTimeout(function(){
        bar.style.setProperty('--p','1');
        c.classList.remove('long');
        c.classList.add('out');
        setTimeout(resolve,reduce?60:360);
      },reduce?0:Math.max(0,left));
    });
    return leaving;
  };
})();`;

/** Разметка заставки (для data:-адреса и для демо) */
export function splashHtml(dark) {
  const c = THEMES[dark ? 'dark' : 'light'];
  const bars = BARS.map(([h, a, b]) => `<b style="--h:${h};--a:${a};--b:${b}"></b>`).join('');
  const word = 'Slideria';
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
