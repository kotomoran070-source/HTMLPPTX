/**
 * Ответы на тесты презентации. При показе (show.ts, окно докладчика) запоминаются в браузере —
 * перезагрузили страницу, ответы на месте; «Пройти заново» на итоге их стирает. В студии — только в памяти:
 * проба при правке не попадает в настоящий урок.
 * Окна показа и докладчика: ответ в одном (QUIZ) другое повторяет (QUIZ_SET, от show.ts / presenter.ts)
 */
import { gateOf, quizKey, type QuizState } from './check';

export const QUIZ = 'slideria:quiz';
export const QUIZ_SET = 'slideria:quiz-set';
/** Листают дальше, а на слайде вопрос «дальше только после ответа» без ответа: тест напоминает о себе */
export const QUIZ_NUDGE = 'slideria:quiz-nudge';
/** «Дальше» после ответа (кнопка теста): окно листает, как стрелкой вперёд, — по ветке ответа */
export const QUIZ_NEXT = 'slideria:quiz-next';
/** Ответ изменился (здесь или в другом окне): тесты и итог обновляются */
const CHANGE = 'slideria:quiz-change';
/** key '*' и st null — стереть все ответы. Ответ теста — QuizState, у карточек (flashcards) — их состояние */
export interface QuizMsg { key: string; st: unknown }

/** Ключ на «~» — только на время показа (перевёрнутые карточки сетки): в браузере не запоминается */
class Store {
  private map = new Map<string, unknown>();
  private scope: string | null = null;

  /** Запоминать ответы в браузере: scope — презентация (её название или путь) */
  persist(scope: string): void {
    this.scope = `slideria-quiz:${scope}`;
    try {
      const raw = JSON.parse(localStorage.getItem(this.scope) ?? '{}') as Record<string, unknown>;
      this.map = new Map(Object.entries(raw).filter(([k, v]) => !k.startsWith('~') && v && typeof v === 'object'));
    } catch { this.map = new Map(); }
  }

  get<T = QuizState>(key: string): T | undefined {
    return this.map.get(key) as T | undefined;
  }

  /** remote — пришло из другого окна: не пересылать обратно */
  set(key: string, st: unknown, remote = false): void {
    if (key === '*') this.map.clear();
    else if (st) this.map.set(key, st);
    else this.map.delete(key);
    this.save();
    window.dispatchEvent(new CustomEvent<QuizMsg>(CHANGE, { detail: { key, st } }));
    if (!remote) window.dispatchEvent(new CustomEvent<QuizMsg>(QUIZ, { detail: { key, st } }));
  }

  reset(): void {
    this.set('*', null);
  }

  /** Подписка на изменения; возвращает отписку */
  on(cb: (m: QuizMsg) => void): () => void {
    const fn = (e: Event) => cb((e as CustomEvent<QuizMsg>).detail);
    window.addEventListener(CHANGE, fn);
    return () => window.removeEventListener(CHANGE, fn);
  }

  private save(): void {
    if (!this.scope) return;
    try { localStorage.setItem(this.scope, JSON.stringify(Object.fromEntries([...this.map].filter(([k]) => !k.startsWith('~'))))); } catch { /* без хранилища — только в памяти */ }
  }
}

export const quizStore = new Store();

/** Листать дальше со слайда index: нельзя (вопрос без ответа, «дальше только после ответа») или куда ведёт ответ */
export function quizGate(deck: { slides: unknown[] }, index: number): { locked: boolean; go: string | null } {
  const s = deck.slides[index];
  return s ? gateOf(s, (q) => quizKey(deck, q), (k) => quizStore.get(k)) : { locked: false, go: null };
}

// Ответ из другого окна
if (typeof window !== 'undefined') {
  window.addEventListener(QUIZ_SET, (e) => {
    const m = (e as CustomEvent<QuizMsg>).detail;
    if (m && typeof m.key === 'string') quizStore.set(m.key, m.st, true);
  });
}
