/**
 * Заставка программы «Колода»: за знаком Slideria веером раскрываются три слайда — титульный, с диаграммой и с
 * фотографией. Лежит слоем поверх окна (desktop/main.mjs), пока под ней запускается программа; полоска под
 * названием идёт по настоящим шагам запуска (step), запуск дольше секунды — подпись, что сейчас происходит.
 * Уходя (done), слайды разлетаются, а заставка растворяется — под ней уже готовая страница.
 *
 * Движется только то, что видеокарта двигает сама: сдвиг, поворот, масштаб и прозрачность готовых слоёв. Каждая
 * движущаяся часть — свой слой, нарисованный ещё до вступления: части стоят на местах почти прозрачными (.001 —
 * полностью прозрачное не рисуется), а вступление начинается со второго кадра, когда всё уже нарисовано. Так
 * во время движения ничего не дорисовывается и части не отстают одна от другой, пока рядом грузится программа:
 * раньше росчерк знака, бегущий блик полоски и раскрытие кругом перерисовывались на каждом кадре и дёргались
 * каждое по-своему. Росчерк знака теперь «проявляется» шторкой (рамка едет в одну сторону, рисунок — в другую).
 * Что заставляет видеокарту рисовать слой заново посреди движения (замер — кадры с недорисованным слоем):
 * увеличение сверх того, каким слой нарисован, и смена наклона в глубину. Поэтому на вступлении слои только
 * растут до своего размера, а на уходе разлетаются, не меняя ни размера, ни наклона.
 *
 * Ничего не грузит: всё нарисовано стилями, страница — data:-адрес. Вступление всегда идёт в своём темпе (~1,25 с,
 * до последнего столбика) и держится не меньше MIN_SHOW: на быстром компьютере программа готова раньше, но заставка
 * не ускоряется и не обрывается — это первое, что видно от программы.
 * «Уменьшить движение» в системе — просто появляется и растворяется.
 */

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

/**
 * Веер: где лежит каждый слайд и откуда он въезжает (одинаковый состав функций — поворот идёт плавно). Глубина —
 * у каждого слайда своя (perspective() в его же сдвиге): с общей у колоды наклонённый слайд на ходу меняет вид и
 * его приходится перерисовывать. Средний — без поворотов: с ними (даже нулевыми) видеокарта не знает заранее его
 * масштаб и тоже перерисовывает его на ходу
 */
const FAN = {
  s1: 'translate3d(-10.2em,1.1em,0) rotate(-11deg) perspective(900px) rotateY(18deg) scale(1)',
  s2: 'translate3d(0,-.9em,0) scale(1.04)',
  s3: 'translate3d(10.2em,1.1em,0) rotate(11deg) perspective(900px) rotateY(-18deg) scale(1)',
};
const FROM = 'translate3d(0,2.2em,0) rotate(0deg) perspective(900px) rotateY(0deg) scale(.9)';
const FROM2 = 'translate3d(0,2.2em,0) scale(.9)';
/** Куда слайды разлетаются на уходе: боковые — в стороны, средний — вверх; наклон и размер те же */
const AWAY = {
  s1: 'translate3d(-42em,-4em,0) rotate(-32deg) perspective(900px) rotateY(18deg) scale(1)',
  s2: 'translate3d(0,-12em,0) scale(1.04)',
  s3: 'translate3d(42em,-4em,0) rotate(32deg) perspective(900px) rotateY(-18deg) scale(1)',
};

const css = (c) => `
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
*{box-sizing:border-box}
.c{position:fixed;inset:0;display:grid;place-items:center;background:${c.bg};color:${c.tx};will-change:opacity;
  font:600 clamp(9px,min(1.05vw,1.75vh),15px)/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
/* Фон: мягкое свечение трёх цветов — с первого кадра, как фон страницы */
.bg{position:absolute;inset:-10%;pointer-events:none;
  background:radial-gradient(38% 34% at 42% 40%,${c.glow1},transparent 70%),radial-gradient(30% 30% at 62% 52%,${c.glow2},transparent 70%),radial-gradient(34% 30% at 50% 66%,${c.glow3},transparent 70%)}
.m,.id{position:relative;display:grid;justify-items:center}
/* Движущиеся части — свои слои, нарисованные заранее; до вступления почти прозрачные */
.s,.t,.w span,.bar,.id,.deck,.k,.k>svg,.ch b,.s2::after,.bar b{will-change:transform,opacity}
.s,.t,.w span,.bar{opacity:.001}
.on .s,.on .t,.on .w span,.on .bar{opacity:1}
/* Колода: три слайда 16:9 веером, с глубиной */
.deck{position:relative;width:17em;height:9.56em;margin-bottom:-1.9em}
.s{position:absolute;inset:0;border-radius:.8em;overflow:hidden;border:1px solid ${c.cardBd};background:${c.card};
  box-shadow:0 1.6em 3em -1.2em ${c.shadow},0 .3em .8em -.3em ${c.shadow}}
.s1{z-index:1;transform:${FAN.s1}}.s2{z-index:3;transform:${FAN.s2}}.s3{z-index:2;transform:${FAN.s3}}
.on .s1{animation:s1in .44s cubic-bezier(.2,.8,.2,1) .04s both,show .3s ease-out .04s both}
.on .s2{animation:s2in .44s cubic-bezier(.2,.8,.2,1) both,show .3s ease-out both}
.on .s3{animation:s3in .44s cubic-bezier(.2,.8,.2,1) .08s both,show .3s ease-out .08s both}
/* Слайды ждут: веер чуть дышит (и на уходе тоже — без рывка к началу) */
.on .deck{animation:float 3.2s ease-in-out .6s infinite alternate}
/* 1 — титульный: градиент, надзаголовок, заголовок в две строки, круг */
.s1{background:radial-gradient(circle at 82% 30%,rgba(255,255,255,.35) 0 14%,transparent 15%),radial-gradient(circle at 82% 30%,rgba(255,255,255,.14) 0 26%,transparent 27%),linear-gradient(135deg,#4338CA,#7C3AED 55%,#DB2777)}
.s1 i{position:absolute;left:9%;border-radius:.25em;background:#fff}
.s1 .e{top:24%;width:20%;height:6.5%;opacity:.55;border-radius:1em}
.s1 .t1{top:40%;width:56%;height:10%}.s1 .t2{top:56%;width:38%;height:10%;opacity:.9}
.s1 .l{top:76%;width:26%;height:5%;opacity:.5}
/* 2 — диаграмма: заголовок и столбики, которые растут; по слайду пробегает блик */
.s2 .h{position:absolute;left:8%;top:12%;width:44%;height:8.5%;border-radius:.25em;background:${c.ink}}
.s2 .h2{position:absolute;left:8%;top:26%;width:30%;height:5%;border-radius:.25em;background:${c.ink2}}
.s2 .ch{position:absolute;left:8%;right:8%;bottom:12%;height:52%;display:flex;align-items:flex-end;gap:5%;border-bottom:2px solid ${c.ink2}}
.s2 .ch b{flex:1;height:var(--h);border-radius:.3em .3em 0 0;background:linear-gradient(180deg,var(--a),var(--b));transform-origin:bottom}
.on .s2 .ch b{animation:grow .7s cubic-bezier(.2,.8,.2,1) var(--bd) both}
.s2::after{content:"";position:absolute;inset:-30%;background:linear-gradient(110deg,transparent 40%,rgba(255,255,255,.55) 50%,transparent 60%);opacity:.001}
.on .s2::after{animation:sheen 1.1s ease-out .55s both}
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
.on .t{animation:pop .42s cubic-bezier(.2,.8,.2,1) .1s both}
/* Росчерк: каждая часть — рамка со своим кусочком знака; рамка едет, рисунок в ней — навстречу, и он проявляется */
.gl{position:relative;width:3.2em;height:3.2em}
.g2{position:absolute;inset:0;opacity:.6}
.k{position:absolute;overflow:hidden}
.k>svg{position:absolute;inset:0;width:100%;height:100%}
.k path{fill:none;stroke:currentColor;stroke-width:2.8;stroke-linecap:round}
.k circle{fill:currentColor}
.on .k1{animation:fromR .24s cubic-bezier(.45,0,.25,1) .16s both}.on .k1>svg{animation:fromL .24s cubic-bezier(.45,0,.25,1) .16s both}
.on .k2{animation:fromL .17s cubic-bezier(.45,0,.6,1) .36s both}.on .k2>svg{animation:fromR .17s cubic-bezier(.45,0,.6,1) .36s both}
.on .k3{animation:fromR .12s cubic-bezier(.3,0,.25,1) .52s both}.on .k3>svg{animation:fromL .12s cubic-bezier(.3,0,.25,1) .52s both}
.on .d1{animation:dot .24s cubic-bezier(.3,1.5,.5,1) .12s both}
.on .d2{animation:dot .24s cubic-bezier(.3,1.5,.5,1) .58s both}
.w{margin-top:1.1em;display:flex;font-size:2.1em;font-weight:650;letter-spacing:-.02em}
.w span{display:inline-block}
.on .w span{animation:rise .4s cubic-bezier(.2,.8,.2,1) calc(.2s + var(--i) * .022s) both}
.bar{position:relative;margin-top:1.15em;width:9.5em;height:3px;border-radius:2px;background:${c.track};overflow:hidden}
.on .bar{animation:show .3s ease-out .3s both}
/* Полоска: длина — от шагов запуска; цвет бежит сдвигом полосы вдвое длиннее, а не перерисовкой */
.bar i{position:absolute;inset:0;overflow:hidden;transform-origin:left;transform:scaleX(var(--p,0));border-radius:inherit}
.bar b{position:absolute;inset:0 auto 0 0;width:400%;background:linear-gradient(90deg,#818CF8,#2563EB,#EC4899) 0 0/50% 100%;animation:shim 1.6s linear infinite}
.n{position:absolute;top:calc(100% + 1em);left:50%;transform:translateX(-50%);white-space:nowrap;font-size:.95em;font-weight:500;color:${c.mu};opacity:0;transition:opacity .25s}
.long .n{opacity:1}
/* Уход: слайды разлетаются, знак чуть приближается и гаснет, заставка растворяется */
.out .s1{animation:s1out .46s cubic-bezier(.5,0,.2,1) forwards,hide .34s ease-in .1s forwards}
.out .s2{animation:s2out .46s cubic-bezier(.5,0,.2,1) forwards,hide .34s ease-in .1s forwards}
.out .s3{animation:s3out .46s cubic-bezier(.5,0,.2,1) forwards,hide .34s ease-in .1s forwards}
.out .id{animation:grow-out .42s cubic-bezier(.2,.8,.2,1) forwards,hide .26s ease-in forwards}
.out.c{animation:hide .34s ease-in .14s forwards}
@keyframes s1in{from{transform:${FROM}}to{transform:${FAN.s1}}}
@keyframes s2in{from{transform:${FROM2}}to{transform:${FAN.s2}}}
@keyframes s3in{from{transform:${FROM}}to{transform:${FAN.s3}}}
@keyframes s1out{from{transform:${FAN.s1}}to{transform:${AWAY.s1}}}
@keyframes s2out{from{transform:${FAN.s2}}to{transform:${AWAY.s2}}}
@keyframes s3out{from{transform:${FAN.s3}}to{transform:${AWAY.s3}}}
@keyframes show{from{opacity:0}to{opacity:1}}
@keyframes hide{to{opacity:0}}
@keyframes pop{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:none}}
@keyframes fromR{from{transform:translateX(100%)}to{transform:none}}
@keyframes fromL{from{transform:translateX(-100%)}to{transform:none}}
@keyframes dot{from{transform:scale(.01)}to{transform:none}}
@keyframes rise{from{opacity:0;transform:translateY(.35em)}to{opacity:1;transform:none}}
@keyframes grow{from{transform:scaleY(.08)}to{transform:none}}
@keyframes sheen{from{opacity:1;transform:translateX(-120%)}to{opacity:1;transform:translateX(120%)}}
@keyframes shim{from{transform:none}to{transform:translateX(-50%)}}
@keyframes float{from{transform:none}to{transform:translateY(-.35em)}}
@keyframes grow-out{to{transform:scale(1.12)}}
@media (prefers-reduced-motion:reduce){*,*::after{animation:none!important}.out.c{animation:hide .34s ease-in forwards!important}}
`;

const BARS = [['46%', '#93C5FD', '#3B82F6', '.30s'], ['72%', '#A5B4FC', '#6366F1', '.36s'], ['58%', '#C4B5FD', '#8B5CF6', '.42s'], ['88%', '#F9A8D4', '#EC4899', '.48s'], ['66%', '#93C5FD', '#2563EB', '.54s']];

/**
 * Знак по частям — для росчерка шторкой. Рамка каждой части — по её очертанию (в единицах знака 24×24, с толщиной
 * линии), чтобы шторка шла по самой линии, а не по пустому месту. Нижняя дуга — двумя частями: сначала вправо и
 * вниз, потом влево, как её рисует перо; приглушённые части — общей группой, без тёмного пятна на стыке
 */
const pct = (v) => `${(v / 24 * 100).toFixed(3)}%`;
const part = (cls, [x, y, w, h], body) => `<span class="k ${cls}" style="left:${pct(x)};top:${pct(y)};width:${pct(w)};height:${pct(h)}"><svg viewBox="${x} ${y} ${w} ${h}">${body}</svg></span>`;
const GLYPH = '<span class="gl">'
  + part('k1', [2.4, 1.9, 19.7, 11.7], '<path d="M20.5 3.5H8.25a4.25 4.25 0 0 0 0 8.5"/>')
  + part('d1', [18.9, 1.9, 3.2, 3.2], '<circle cx="20.5" cy="3.5" r="1.4"/>')
  + '<span class="g2">'
  + part('k2', [6.6, 10.4, 15, 11.7], '<path d="M8.25 12h7.5a4.25 4.25 0 0 1 0 8.5"/>')
  + part('k3', [1.9, 18.9, 15.5, 3.2], '<path d="M15.75 20.5H3.5"/>')
  + part('d2', [1.9, 18.9, 3.2, 3.2], '<circle cx="3.5" cy="20.5" r="1.4"/>')
  + '</span></span>';

/**
 * Сколько заставка видна самое малое, мс: вступление (последний столбик вырастает к ~1,25 с) и миг, чтобы увидеть
 * собранную колоду. Уход — ещё 0,5 с
 */
const MIN_SHOW = 1500;

/** Подписи шагов — только если запуск дольше секунды */
const NOTES = ['Запуск Slideria…', 'Подготовка презентаций…', 'Открытие студии…', 'Почти готово…'];

const script = `
(function(){
  var c=document.querySelector('.c'),bar=document.querySelector('.bar i'),note=document.querySelector('.n');
  var shown=0,target=.12,next=.3,since=performance.now(),last=performance.now(),started=false,startedAt=0,leaving=null;
  var MIN_SHOW=${MIN_SHOW};
  var NOTES=${JSON.stringify(NOTES)};
  /**
   * Вступление — когда окно уже на экране (desktop/main.mjs зовёт start после показа окна); на всякий случай — само.
   * Начинается через кадр: к нему все части уже нарисованы, и первые кадры движения не ждут отрисовки
   */
  window.start=function(){
    if(started)return;
    started=true;
    startedAt=performance.now();
    requestAnimationFrame(function(){requestAnimationFrame(function(){c.classList.add('on')})});
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
   * Программа готова: вступление доигрывает в своём темпе (на быстром компьютере готово раньше, чем веер раскрылся),
   * заставка держится не меньше MIN_SHOW от начала, затем слайды разлетаются. Ответ — когда заставка ушла
   */
  window.done=function(){
    if(leaving)return leaving;
    window.start();
    leaving=new Promise(function(resolve){
      var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Движения вступления: конечные, ещё не доигравшие; блик по слайду (::after) — украшение, его не ждём
      var intro=document.getAnimations().filter(function(a){
        var t=a.effect&&a.effect.getComputedTiming&&a.effect.getComputedTiming();
        return t&&t.iterations!==Infinity&&a.playState!=='finished'&&!(a.effect.pseudoElement);
      });
      var left=0;
      intro.forEach(function(a){var t=a.effect.getComputedTiming();left=Math.max(left,(t.endTime||0)-(a.currentTime||0))});
      // Вступление только началось (класс on — через кадр): его движения ещё не созданы
      left=Math.max(left,MIN_SHOW-(performance.now()-startedAt));
      setTimeout(function(){
        bar.style.setProperty('--p','1');
        c.classList.remove('long');
        c.classList.add('out');
        setTimeout(resolve,reduce?360:500);
      },reduce?0:Math.max(0,left));
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
<div class="id"><span class="t">${GLYPH}</span>
<span class="w">${word}</span>
<span class="bar"><i><b></b></i><span class="n">${NOTES[0]}</span></span></div>
</div></div>
<script>${script}</script>`;
}

/** Заставка data:-адресом — для слоя поверх окна */
export const splashPage = (dark) => `data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(dark))}`;
