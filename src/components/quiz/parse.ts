/**
 * Тест из текста: вопросы через пустую строку, под вопросом — варианты.
 *   # Название теста            — заголовок слайдов и итога (необязательно)
 *   Какая сортировка устойчивая?
 *   - Быстрая                    — неверный вариант
 *   + Слиянием :: пояснение      — верный (после «::» — пояснение, если выбрали этот вариант)
 *   > Пояснение после ответа
 *   = 64                         — ответ вводом (по строке на допустимый вариант)
 * Формат Aiken (Moodle): «A. вариант» … и «ANSWER: B» (или «Ответ: Б»). Строки с «//» — комментарии
 */
import type { QuizData, QuizOption } from './check';

export interface ParsedQuiz {
  title: string;
  questions: QuizData[];
  /** «Вопрос 2: не указан верный вариант — …» */
  errors: string[];
}

const LAT = 'ABCDEFGHIJKL';
const CYR = 'АБВГДЕЖЗИКЛМ';
const letterIndex = (c: string): number => {
  const u = c.toUpperCase();
  const k = LAT.indexOf(u);
  return k >= 0 ? k : CYR.indexOf(u);
};

export function parseQuizText(text: string): ParsedQuiz {
  const lines = text.replace(/\r/g, '').split('\n');
  let title = '';
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('//')) continue;
    if (!title && !blocks.length && !cur.length && /^#\s+\S/.test(line)) { title = line.replace(/^#\s+/, ''); continue; }
    if (!line) { if (cur.length) blocks.push(cur); cur = []; continue; }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur);

  const questions: QuizData[] = [];
  const errors: string[] = [];
  blocks.forEach((block, n) => {
    const q: string[] = [];
    const options: QuizOption[] = [];
    const answers: string[] = [];
    const notes: string[] = [];
    let letters: number[] | null = null;
    let aiken = false;
    for (const line of block) {
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^([+\-*])\s+(.+)$/))) {
        const [text, note] = m[2].split(/\s+::\s+/);
        options.push({ text: text.trim(), ...(m[1] !== '-' ? { correct: true } : {}), ...(note?.trim() ? { note: note.trim() } : {}) });
      } else if ((m = line.match(/^=\s*(.+)$/))) {
        answers.push(m[1].trim());
      } else if ((m = line.match(/^>\s*(.+)$/))) {
        notes.push(m[1].trim());
      } else if ((m = line.match(/^(?:answer|ответ)\s*:\s*(.+)$/i))) {
        letters = m[1].split(/[\s,;]+/).map(letterIndex).filter((k) => k >= 0);
      } else if ((aiken || !options.length) && q.length && (m = line.match(/^([A-Za-zА-Яа-я])[.)]\s+(.+)$/))) {
        aiken = true;
        options.push({ text: m[2].trim() });
      } else if (!options.length && !answers.length) {
        q.push(line.replace(/^\d+[.)]\s+/, ''));
      } else {
        errors.push(`Вопрос ${n + 1}: непонятная строка «${line.slice(0, 40)}»`);
      }
    }
    if (letters) for (const k of letters) if (options[k]) options[k].correct = true;
    const question = q.join(' ').trim();
    const no = `Вопрос ${n + 1}`;
    if (!question) { errors.push(`${no}: нет текста вопроса`); return; }
    const quiz: QuizData = { type: 'quiz', question };
    if (answers.length) {
      quiz.kind = 'input';
      quiz.answer = answers.join('\n');
    } else {
      if (options.length < 2) { errors.push(`${no}: нужно хотя бы два варианта`); return; }
      if (!options.some((o) => o.correct)) { errors.push(`${no}: не указан верный вариант — отметьте верный вариант знаком «+»`); return; }
      quiz.options = options;
    }
    if (notes.length) quiz.note = notes.join(' ');
    questions.push(quiz);
  });
  return { title, questions, errors };
}

/** Слайды теста: по вопросу на слайд и итог в конце */
export function quizSlides(p: ParsedQuiz, withScore = true): Record<string, unknown>[] {
  const head = p.title ? { title: p.title } : {};
  const slides: Record<string, unknown>[] = p.questions.map((q, k) => ({ template: 'content', label: `Вопрос ${k + 1}`, ...head, body: q }));
  if (withScore && p.questions.length) slides.push({ template: 'content', label: 'Итог теста', title: p.title ? `${p.title}: итог` : 'Итог', body: { type: 'score' } });
  return slides;
}
