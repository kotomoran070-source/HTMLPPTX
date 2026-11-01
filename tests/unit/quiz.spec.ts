// Тест на слайде: проверка ответа, попытки, ключи вопросов, счёт с ветками, уровни, переходы по ответу
import { expect, test } from '@playwright/test';
import {
  answerChoice, answerInput, answerKey, branchOf, choiceOk, gateOf, inputOk, isMulti, levelOf, quizKey, quizzesOf, scoreOf, type QuizData, type QuizState,
} from '../../src/components/quiz/check';

const ONE: QuizData = { type: 'quiz', question: 'Устойчивая?', options: [{ text: 'Быстрая' }, { text: 'Слиянием', correct: true }, { text: 'Пирамидальная' }] };
const MANY: QuizData = { type: 'quiz', question: 'O(n log n)?', options: [{ text: 'Быстрая', correct: true }, { text: 'Пузырьком' }, { text: 'Слиянием', correct: true }] };
const INPUT: QuizData = { type: 'quiz', kind: 'input', question: 'Сколько?', answer: '7\nсемь' };

test('ответ вводом: регистр, ё, пробелы и точка в конце не важны; числа — по значению', () => {
  expect(inputOk(INPUT, ' Семь. ')).toBe(true);
  expect(inputOk(INPUT, '7,0')).toBe(true);
  expect(inputOk(INPUT, '8')).toBe(false);
  expect(inputOk(INPUT, '')).toBe(false);
  expect(inputOk({ answer: 'Ёж' }, 'еж')).toBe(true);
  expect(inputOk({ answer: 3.5 }, '3,50')).toBe(true);
  expect(inputOk({ answer: ['Москва', 'Moscow'] }, 'moscow')).toBe(true);
});

test('выбор: ровно верные варианты; несколько верных — тест с «Проверить»', () => {
  expect(isMulti(ONE)).toBe(false);
  expect(isMulti(MANY)).toBe(true);
  expect(choiceOk(ONE, [1])).toBe(true);
  expect(choiceOk(MANY, [0])).toBe(false);
  expect(choiceOk(MANY, [2, 0])).toBe(true);
  expect(choiceOk(MANY, [0, 1, 2])).toBe(false);
});

test('попытки: неверный вариант помечается и выбор снимается, пока попытки есть; кончились — вопрос закрыт', () => {
  const q = { ...ONE, tries: 2 };
  const a = answerChoice(q, undefined, [0]);
  expect(a).toEqual({ picked: [], tried: [0], ok: false, done: false, tries: 1 });
  expect(answerChoice(q, a, [1])).toMatchObject({ picked: [1], ok: true, done: true, tries: 2 });
  expect(answerChoice(q, a, [2])).toMatchObject({ picked: [2], ok: false, done: true, tries: 2 });
  // Одна попытка (по умолчанию) — сразу итог
  expect(answerChoice(ONE, undefined, [0])).toMatchObject({ ok: false, done: true });
  expect(answerInput(INPUT, undefined, 'семь')).toEqual({ picked: [], text: 'семь', ok: true, done: true, tries: 1 });
});

test('ключи вопросов: по содержимому, повтор того же вопроса — с номером; скрытый слайд помечен', () => {
  const deck = { slides: [{ body: ONE }, { free: [{ ...ONE }] }, { hidden: true, body: INPUT }] };
  const list = quizzesOf(deck);
  expect(list).toHaveLength(3);
  expect(list[1].key).toBe(`${list[0].key}-2`);
  expect(list[2].hidden).toBe(true);
  expect(quizKey(deck, deck.slides[1].free![0] as QuizData)).toBe(list[1].key);
  // Ключ не зависит от места: тот же вопрос в другой презентации — тот же ключ
  expect(quizzesOf({ slides: [{ x: [{ y: ONE }] }] })[0].key).toBe(list[0].key);
});

test('счёт: баллы верных из возможных; вопрос скрытой ветки — в счёт, только если на него ответили', () => {
  const list = [{ key: 'a', points: 1, hidden: false }, { key: 'b', points: 2, hidden: false }, { key: 'c', points: 1, hidden: true }];
  const st = new Map<string, QuizState>([['a', { picked: [1], ok: true, done: true, tries: 1 }], ['b', { picked: [0], ok: false, done: true, tries: 1 }]]);
  expect(scoreOf(list, (k) => st.get(k))).toEqual({ got: 1, total: 3, answered: 2, count: 2 });
  st.set('c', { picked: [0], ok: true, done: true, tries: 1 });
  expect(scoreOf(list, (k) => st.get(k))).toEqual({ got: 2, total: 4, answered: 3, count: 3 });
});

test('уровни итога: наибольший порог не выше процента; свои уровни вместо стандартных', () => {
  expect(levelOf(undefined, 95)).toBe('Отлично!');
  expect(levelOf(undefined, 60)).toBe('Неплохо, но тему стоит повторить');
  expect(levelOf([{ min: 80, text: 'Сдано' }, { text: 'Пересдача' }], 79)).toBe('Пересдача');
  expect(levelOf([{ min: 80, text: 'Сдано' }, { text: 'Пересдача' }], 80)).toBe('Сдано');
});

test('переходы: вариант со своим переходом, иначе «если верно / неверно»; «дальше только после ответа»', () => {
  const q: QuizData = { ...ONE, right: 'slide:next-topic', wrong: 'slide:repeat', options: [{ text: 'А', go: 'slide:why-a' }, { text: 'Б', correct: true }] };
  const done = (picked: number[], ok: boolean): QuizState => ({ picked, ok, done: true, tries: 1 });
  expect(branchOf(q, done([0], false))).toBe('slide:why-a');
  expect(branchOf(q, done([1], true))).toBe('slide:next-topic');
  expect(branchOf({ ...q, options: [{ text: 'А' }, { text: 'Б', correct: true }] }, done([0], false))).toBe('slide:repeat');
  expect(branchOf(q, undefined)).toBeNull();
  const slide = { body: { ...q, lock: true } };
  expect(gateOf(slide, () => 'k', () => undefined)).toEqual({ locked: true, go: null });
  expect(gateOf(slide, () => 'k', () => done([1], true))).toEqual({ locked: false, go: 'slide:next-topic' });
});

test('ключ ответов для заметок: буква и текст, несколько верных, ответ вводом', () => {
  expect(answerKey({ body: [ONE, MANY, INPUT] })).toBe('Ответ: B — Слиянием\nВерные ответы: A — Быстрая; C — Слиянием\nОтвет: 7 / семь');
});

test('тест из текста: варианты «+» и «-», пояснения, ответ вводом, Aiken; ошибки — с номером вопроса', async () => {
  const { parseQuizText, quizSlides } = await import('../../src/components/quiz/parse');
  const p = parseQuizText(`# Сортировки
// комментарий
1. Какая сортировка устойчивая?
- Быстрая :: меняет порядок равных
+ Слиянием
> Слияние берёт равные по порядку

Сколько бит в double?
= 64
= шестьдесят четыре

Столица Австралии?
A. Сидней
B) Канберра
Ответ: Б

Вопрос без верного
- Раз
- Два`);
  expect(p.title).toBe('Сортировки');
  expect(p.questions).toEqual([
    { type: 'quiz', question: 'Какая сортировка устойчивая?', options: [{ text: 'Быстрая', note: 'меняет порядок равных' }, { text: 'Слиянием', correct: true }], note: 'Слияние берёт равные по порядку' },
    { type: 'quiz', question: 'Сколько бит в double?', kind: 'input', answer: '64\nшестьдесят четыре' },
    { type: 'quiz', question: 'Столица Австралии?', options: [{ text: 'Сидней' }, { text: 'Канберра', correct: true }] },
  ]);
  expect(p.errors).toEqual(['Вопрос 4: нет верного варианта — отметьте его «+»']);
  const slides = quizSlides(p);
  expect(slides.map((s) => s.label)).toEqual(['Вопрос 1', 'Вопрос 2', 'Вопрос 3', 'Итог теста']);
  expect(slides[3]).toMatchObject({ title: 'Сортировки: итог', body: { type: 'score' } });
});
