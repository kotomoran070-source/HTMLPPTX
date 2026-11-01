/**
 * Диаграммы из текста — разбор без вёрстки. Строка — одно действие; пустые строки и «# …», «// …» пропускаются.
 *
 * Последовательность (kind: sequence):
 *   участник Клиент              — порядок участников (необязательно: появляются по первому упоминанию)
 *   актёр Пользователь           — участник-человек
 *   Клиент -> Сервер: запрос     — сообщение; --> — ответ (пунктир); Сервер <- Клиент — то же, что Клиент -> Сервер
 *   Сервер -> Сервер: проверка   — сообщение самому себе
 *   заметка Сервер: текст        — заметка над участником; «заметка Клиент, Сервер: …» — над двумя
 *   == Оплата ==                 — раздел
 *   нумерация                    — номера сообщений
 *
 * Блок-схема и состояния (kind: flow, state):
 *   [Начало] -> {Данные верны?}  — узлы задаются по ходу: имя в скобках задаёт форму
 *   {Данные верны?} -> [Сохранить]: да     — подпись стрелки после двоеточия; --> — пунктир
 *   Данные верны? -> (Ошибка): нет          — без скобок — тот же узел по имени
 *   формы: [прямоугольник] (скруглённый) {ромб — решение} ((круг)) [/данные/]; [*] — начало и конец (у состояний)
 *   направление: вправо          — раскладка слева направо (по умолчанию у схемы — сверху вниз, у состояний — вправо)
 * Англоязычные слова тоже понимаются: participant, actor, note, autonumber, direction: right|down
 */

export type Shape = 'rect' | 'round' | 'diamond' | 'circle' | 'data' | 'dot';

export interface SeqParticipant { name: string; actor: boolean }
export type SeqStep =
  | { kind: 'msg'; from: number; to: number; text: string; dashed: boolean; n: number }
  | { kind: 'note'; over: number[]; text: string }
  | { kind: 'div'; text: string };
export interface Sequence { participants: SeqParticipant[]; steps: SeqStep[]; numbered: boolean }

export interface FlowNode { id: string; text: string; shape: Shape }
export interface FlowEdge { from: string; to: string; text: string; dashed: boolean }
export interface Flow { nodes: FlowNode[]; edges: FlowEdge[]; dir: 'down' | 'right' }

const lines = (code: unknown) => String(code ?? '').replace(/\r/g, '').split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));

/** Стрелка между двумя именами: «А -> Б: текст», «А --> Б», «А <- Б»; имена могут содержать дефисы */
const ARROW = /^(.+?)\s*(<--|<-|-->>|->>|-->|->|→|⇢)\s*(.+?)(?:\s*:\s*(.*))?$/;

function arrow(l: string): { a: string; b: string; text: string; dashed: boolean } | null {
  const m = ARROW.exec(l);
  if (!m) return null;
  let [a, b] = [m[1].trim(), m[3].trim()];
  const op = m[2];
  if (!a || !b) return null;
  if (op.startsWith('<')) [a, b] = [b, a];
  return { a, b, text: (m[4] ?? '').trim(), dashed: op.startsWith('--') || op.startsWith('<--') || op === '⇢' };
}

export function parseSequence(code: unknown): Sequence {
  const participants: SeqParticipant[] = [];
  const steps: SeqStep[] = [];
  let numbered = false;
  let n = 0;
  const at = (name: string, actor = false): number => {
    const k = participants.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    if (k >= 0) { if (actor) participants[k].actor = true; return k; }
    participants.push({ name, actor });
    return participants.length - 1;
  };
  for (const l of lines(code)) {
    let m: RegExpExecArray | null;
    if (/^(нумерация|autonumber)$/i.test(l)) { numbered = true; continue; }
    if ((m = /^(участник|participant)\s+(.+)$/i.exec(l))) { at(m[2].trim()); continue; }
    if ((m = /^(актёр|актер|actor|человек)\s+(.+)$/i.exec(l))) { at(m[2].trim(), true); continue; }
    if ((m = /^==+\s*(.*?)\s*==+$/.exec(l))) { steps.push({ kind: 'div', text: m[1] }); continue; }
    if ((m = /^(заметка|note)(?:\s+(?:над|over|у))?\s+([^:]+):\s*(.*)$/i.exec(l))) {
      const over = m[2].split(',').map((s) => s.trim()).filter(Boolean).map((s) => at(s));
      steps.push({ kind: 'note', over, text: m[3].trim() });
      continue;
    }
    const a = arrow(l);
    if (a) steps.push({ kind: 'msg', from: at(a.a), to: at(a.b), text: a.text, dashed: a.dashed, n: ++n });
  }
  return { participants, steps, numbered };
}

/** Узел по записи: форма — по скобкам, имя — без них */
export function nodeOf(raw: string, state = false): { text: string; shape: Shape | null } {
  const s = raw.trim();
  if (s === '[*]' || s === '(*)' || s === '*') return { text: '*', shape: 'dot' };
  const pairs: [RegExp, Shape][] = [
    [/^\(\((.*)\)\)$/, 'circle'], [/^\[\/(.*)\/\]$/, 'data'], [/^\{(.*)\}$/, 'diamond'],
    [/^\[(.*)\]$/, 'rect'], [/^\((.*)\)$/, 'round'],
  ];
  for (const [re, shape] of pairs) {
    const m = re.exec(s);
    if (m) return { text: m[1].trim(), shape };
  }
  return { text: s, shape: state ? 'round' : null };
}

export function parseFlow(code: unknown, kind: 'flow' | 'state' = 'flow', dir?: unknown): Flow {
  const state = kind === 'state';
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let d: 'down' | 'right' = dir === 'right' || dir === 'down' ? dir : state ? 'right' : 'down';
  // [*] в начале цепочки — начало, в конце — конец: это два разных узла
  const node = (raw: string, end: boolean): string => {
    const { text, shape } = nodeOf(raw, state);
    if (shape === 'dot') {
      const id = end ? '*end' : '*start';
      if (!nodes.some((x) => x.id === id)) nodes.push({ id, text: '', shape: 'dot' });
      return id;
    }
    const id = text.toLowerCase();
    const have = nodes.find((x) => x.id === id);
    if (have) { if (shape) have.shape = shape; return id; }
    nodes.push({ id, text, shape: shape ?? (state ? 'round' : 'rect') });
    return id;
  };
  for (const l of lines(code)) {
    let m: RegExpExecArray | null;
    if ((m = /^(направление|direction)\s*:?\s*(.+)$/i.exec(l))) {
      d = /прав|right|lr|гориз/i.test(m[2]) ? 'right' : 'down';
      continue;
    }
    // Цепочка: «А -> Б -> В: подпись» — подпись у последней стрелки
    const parts = l.split(/\s*(<--|<-|-->|->|→|⇢)\s*/);
    if (parts.length >= 3) {
      let label = '';
      const last = parts[parts.length - 1];
      // Двоеточие внутри скобок узла — часть имени, после них — подпись
      const cm = /^(\[[^\]]*\]|\(\([^)]*\)\)|\([^)]*\)|\{[^}]*\}|[^:]+?)\s*:\s*(.*)$/.exec(last);
      if (cm) { parts[parts.length - 1] = cm[1]; label = cm[2].trim(); }
      for (let i = 0; i + 2 < parts.length; i += 2) {
        const op = parts[i + 1];
        let a = node(parts[i], false);
        let b = node(parts[i + 2], true);
        if (op.startsWith('<')) [a, b] = [b, a];
        edges.push({ from: a, to: b, text: i + 3 >= parts.length ? label : '', dashed: op.startsWith('--') || op.startsWith('<--') || op === '⇢' });
      }
      continue;
    }
    // Отдельный узел: «{Решение?}» — чтобы задать форму или узел без связей
    node(l, false);
  }
  return { nodes, edges, dir: d };
}
