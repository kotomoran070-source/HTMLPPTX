/**
 * Тест на слайде (quiz.ts) без вёрстки: варианты, проверка ответа, счёт, уровни итога, переходы по ответу.
 * Ответ запоминается по ключу вопроса — хешу его содержимого (одинаковые вопросы в одной презентации
 * различаются номером по порядку): правка порядка слайдов и объектов ответов не теряет
 */
export interface QuizOption {
  text?: string;
  /** Верный вариант (несколько верных — выбирают все) */
  correct?: boolean;
  /** Пояснение, когда выбрали этот вариант */
  note?: string;
  /** Переход после ответа этим вариантом: slide:<id>, next, prev, first, last */
  go?: string;
}

export interface QuizData {
  type?: unknown;
  question?: string;
  /** input — ответ вводом (answer — допустимые ответы, по строке) */
  kind?: string;
  options?: QuizOption[];
  answer?: unknown;
  /** Баллы за верный ответ (по умолчанию 1; 0 — вопрос не в счёт) */
  points?: number;
  /** Попыток (по умолчанию 1): после неверной — ещё раз, пока не кончатся */
  tries?: number;
  /** Пояснение после ответа (если у выбранного варианта нет своего) */
  note?: string;
  /** Переходы после ответа: верного и неверного */
  right?: string;
  wrong?: string;
  /** Дальше — только после ответа */
  lock?: boolean;
  /** grid — варианты плитками в два столбца */
  layout?: string;
}

export interface QuizState {
  /** Выбранные варианты (у одного ответа — один; у нескольких — отмеченные, пока не проверили) */
  picked: number[];
  /** Неверные варианты прошлых попыток */
  tried?: number[];
  /** Введённый ответ */
  text?: string;
  ok: boolean;
  done: boolean;
  /** Сделано попыток */
  tries: number;
}

export const optionsOf = (p: QuizData): QuizOption[] => (Array.isArray(p.options) ? p.options.filter((o) => o && typeof o === 'object') : []);
export const isInput = (p: QuizData): boolean => p.kind === 'input' || (!optionsOf(p).length && p.answer !== undefined && p.answer !== null && p.answer !== '');
export const rightOf = (p: QuizData): number[] => optionsOf(p).map((o, k) => (o.correct === true ? k : -1)).filter((k) => k >= 0);
export const isMulti = (p: QuizData): boolean => !isInput(p) && rightOf(p).length > 1;
export const pointsOf = (p: QuizData): number => { const n = Number(p.points); return p.points === undefined || !Number.isFinite(n) ? 1 : Math.max(0, n); };
export const triesOf = (p: QuizData): number => Math.max(1, Math.min(9, Math.round(Number(p.tries)) || 1));

/** Допустимые ответы при вводе: строка (по строкам или через «;»), число или список */
export function variants(p: QuizData): string[] {
  const a = p.answer;
  const list = Array.isArray(a) ? a : typeof a === 'string' ? a.split(/\n|;/) : a === undefined || a === null ? [] : [a];
  return list.map((x) => String(x).trim()).filter(Boolean);
}

/** Ответ без мелочей: регистр, ё, лишние пробелы и точка в конце не важны */
export function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim().replace(/[.!?…]+$/, '').trim();
}

const num = (s: string): number | null => {
  const t = s.replace(/\s/g, '').replace(',', '.');
  return /^[-−]?\d*\.?\d+$/.test(t) ? Number(t.replace('−', '-')) : null;
};

/** Введённый ответ верен: совпал с одним из допустимых (числа — по значению: «3,50» = «3.5») */
export function inputOk(p: QuizData, text: string): boolean {
  const v = norm(text);
  if (!v) return false;
  const n = num(v);
  return variants(p).some((a) => {
    const m = num(norm(a));
    return n !== null && m !== null ? Math.abs(n - m) < 1e-9 : norm(a) === v;
  });
}

/** Выбор верен: отмечены ровно верные варианты */
export function choiceOk(p: QuizData, picked: number[]): boolean {
  const right = rightOf(p);
  return right.length > 0 && picked.length === right.length && right.every((k) => picked.includes(k));
}

/**
 * Ответ на выбор: щелчок по варианту (один ответ) или «Проверить» (несколько). Неверно, а попытки
 * остались — вариант помечается, отвечают ещё раз; иначе вопрос закрыт и верный ответ виден
 */
export function answerChoice(p: QuizData, st: QuizState | undefined, picked: number[]): QuizState {
  const ok = choiceOk(p, picked);
  const tries = (st?.tries ?? 0) + 1;
  const done = ok || tries >= triesOf(p);
  const tried = ok || isMulti(p) ? st?.tried : [...new Set([...(st?.tried ?? []), ...picked])];
  // Неверно, попытки остались: у одного ответа выбор снимается (вариант помечен как неверный), у нескольких — остаётся поправить
  return { picked: done || isMulti(p) ? picked : [], ...(tried?.length ? { tried } : {}), ok, done, tries };
}

export function answerInput(p: QuizData, st: QuizState | undefined, text: string): QuizState {
  const ok = inputOk(p, text);
  const tries = (st?.tries ?? 0) + 1;
  return { picked: [], text, ok, done: ok || tries >= triesOf(p), tries };
}

// ---------------- ключи и счёт по всей презентации ----------------

const hash = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};
const contentKey = (p: QuizData) => `q${hash(JSON.stringify([p.question ?? '', p.kind ?? '', optionsOf(p).map((o) => [o.text ?? '', !!o.correct]), variants(p)]))}`;

/** Все тесты презентации по порядку, где бы они ни лежали на слайде (в раскладке, свободно, в группе) */
function collect(v: unknown, out: QuizData[]): void {
  if (Array.isArray(v)) { v.forEach((x) => collect(x, out)); return; }
  if (!v || typeof v !== 'object') return;
  if ((v as QuizData).type === 'quiz') { out.push(v as QuizData); return; }
  for (const x of Object.values(v)) if (x && typeof x === 'object') collect(x, out);
}
export function quizzesIn(slide: unknown): QuizData[] {
  const out: QuizData[] = [];
  collect(slide, out);
  return out;
}

export interface QuizEntry { key: string; points: number; hidden: boolean; slide: number; quiz: QuizData }
interface DeckLike { slides: unknown[] }

/** Тесты презентации с ключами (повтор того же вопроса — с номером) */
export function quizzesOf(deck: DeckLike): QuizEntry[] {
  return indexOf(deck).entries;
}
/** Проход по всей презентации каждый раз: редактор меняет данные на месте, запомненное устарело бы */
function indexOf(deck: DeckLike): { entries: QuizEntry[]; keys: Map<object, string> } {
  const seen = new Map<string, number>();
  const keys = new Map<object, string>();
  const entries: QuizEntry[] = [];
  (Array.isArray(deck.slides) ? deck.slides : []).forEach((s, i) => {
    for (const q of quizzesIn(s)) {
      const base = contentKey(q);
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      const key = n > 1 ? `${base}-${n}` : base;
      keys.set(q, key);
      entries.push({ key, points: pointsOf(q), hidden: (s as { hidden?: unknown })?.hidden === true, slide: i, quiz: q });
    }
  });
  return { entries, keys };
}

/** Ключ вопроса в этой презентации (копия блока, которой нет в данных, — по содержимому) */
export function quizKey(deck: DeckLike, p: QuizData): string {
  return indexOf(deck).keys.get(p) ?? contentKey(p);
}

export interface Score { got: number; total: number; answered: number; count: number }

/**
 * Счёт: баллы верных ответов из возможных. В возможные входят вопросы видимых слайдов и отвеченные
 * на скрытых (ветки по ответу: не попал в ветку — её вопрос не в счёт)
 */
export function scoreOf(list: Pick<QuizEntry, 'key' | 'points' | 'hidden'>[], get: (key: string) => QuizState | undefined): Score {
  let got = 0;
  let total = 0;
  let answered = 0;
  let count = 0;
  for (const q of list) {
    const st = get(q.key);
    if (q.hidden && !st?.done) continue;
    count++;
    total += q.points;
    if (st?.done) answered++;
    if (st?.done && st.ok) got += q.points;
  }
  return { got, total, answered, count };
}

export interface Level { min?: number; text?: string }
export const LEVELS: Level[] = [
  { min: 90, text: 'Отлично!' },
  { min: 70, text: 'Хороший результат' },
  { min: 50, text: 'Неплохо, но тему стоит повторить' },
  { min: 0, text: 'Тему стоит разобрать ещё раз' },
];

/** Сообщение итога по проценту: уровень с наибольшим порогом, не выше процента */
export function levelOf(levels: Level[] | undefined, pct: number): string {
  const list = (Array.isArray(levels) && levels.length ? levels : LEVELS).filter((l) => l && typeof l === 'object' && typeof l.text === 'string');
  const fit = list.filter((l) => (Number(l.min) || 0) <= pct + 1e-9).sort((a, b) => (Number(b.min) || 0) - (Number(a.min) || 0));
  return fit[0]?.text ?? '';
}

/** Ответы к тестам слайда — для заметок докладчика в PowerPoint (там проверки ответа нет) */
export function answerKey(slide: unknown): string {
  const L = 'ABCDEFGHIJKL';
  const plain = (s: unknown) => String(s ?? '').replace(/\*\*|__|\{[^{}|]+\||\}/g, '').replace(/\s+/g, ' ').trim();
  return quizzesIn(slide).map((q) => {
    if (isInput(q)) return `Ответ: ${variants(q).join(' / ') || '—'}`;
    const right = rightOf(q).map((k) => `${L[k] ?? k + 1} — ${plain(optionsOf(q)[k]?.text)}`);
    return `${right.length > 1 ? 'Верные ответы' : 'Ответ'}: ${right.join('; ') || '—'}`;
  }).join('\n');
}

// ---------------- переходы по ответу ----------------

const ACTION = /^(next|prev|first|last|slide:[\w-]+)$/;
const act = (v: unknown): string | null => (typeof v === 'string' && ACTION.test(v.trim()) ? v.trim() : null);

/** Куда вести после ответа: переход выбранного варианта, иначе — «если верно / неверно» */
export function branchOf(p: QuizData, st: QuizState | undefined): string | null {
  if (!st?.done) return null;
  const opts = optionsOf(p);
  if (!isInput(p) && st.picked.length === 1) {
    const go = act(opts[st.picked[0]]?.go);
    if (go) return go;
  }
  return act(st.ok ? p.right : p.wrong);
}

/** Слайд с тестами: можно ли листать дальше (lock — только после ответа) и куда ведёт ответ */
export function gateOf(slide: unknown, key: (q: QuizData) => string, get: (key: string) => QuizState | undefined): { locked: boolean; go: string | null } {
  let locked = false;
  let go: string | null = null;
  for (const q of quizzesIn(slide)) {
    const st = get(key(q));
    if (q.lock === true && !st?.done) locked = true;
    go ??= branchOf(q, st);
  }
  return { locked, go };
}
