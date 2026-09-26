import {
  isMap, isScalar, isSeq, parseDocument,
  type Document, type Node, type Pair, type YAMLMap, type YAMLSeq,
} from 'yaml';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const isObj = (v: unknown): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v);

function keyOf(pair: Pair): string {
  const k = pair.key as unknown;
  return String(isScalar(k) ? k.value : k);
}

function idOf(node: unknown): string | undefined {
  if (!isMap(node)) return undefined;
  const v = node.get('id');
  return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
}

/**
 * Переносит новое значение в существующий узел YAML, по возможности сохраняя
 * узлы (а с ними комментарии, стиль списков в [скобках], блоки notes: |).
 */
function merge(doc: Document, node: unknown, value: Json): Node {
  if (isObj(value) && isMap(node)) {
    const map = node as YAMLMap;
    const keys = Object.keys(value);
    const byKey = new Map(map.items.map((p) => [keyOf(p as Pair), p as Pair]));
    const items: Pair[] = [];
    for (const k of keys) {
      const pair = byKey.get(k);
      if (pair) {
        pair.value = merge(doc, pair.value, value[k]);
        items.push(pair);
      } else {
        items.push(doc.createPair(k, value[k]) as Pair);
      }
    }
    map.items = items;
    return map;
  }

  if (Array.isArray(value) && isSeq(node)) {
    const seq = node as YAMLSeq;
    const old = seq.items as unknown[];
    const ids = value.map((v) => (isObj(v) && (typeof v.id === 'string' || typeof v.id === 'number') ? String(v.id) : undefined));
    const byId = new Map<string, unknown>();
    old.forEach((n) => {
      const id = idOf(n);
      if (id !== undefined && !byId.has(id)) byId.set(id, n);
    });
    // Элементы с id (слайды) сопоставляются по id: перестановка не путает комментарии
    const useIds = ids.some((id) => id !== undefined && byId.has(id));
    const used = new Set<unknown>();
    // Если элементы списка разделены пустыми строками (слайды), новые получают такую же
    const spaced = old.some((n, i) => i > 0 && (n as { spaceBefore?: boolean })?.spaceBefore);
    seq.items = value.map((v, i) => {
      let prev: unknown;
      if (useIds) {
        const id = ids[i];
        prev = id !== undefined ? byId.get(id) : undefined;
        if (prev && used.has(prev)) prev = undefined;
      } else {
        prev = old[i];
      }
      if (prev === undefined) {
        const node = doc.createNode(v) as Node & { spaceBefore?: boolean };
        if (spaced && i > 0) node.spaceBefore = true;
        return node;
      }
      used.add(prev);
      return merge(doc, prev, v);
    });
    return seq;
  }

  if (!isObj(value) && !Array.isArray(value) && isScalar(node)) {
    if (node.value !== value) {
      node.value = value;
      // Многострочный текст в однострочном стиле — пусть библиотека выберет подходящий
      if (typeof value === 'string' && value.includes('\n') && node.type !== 'BLOCK_LITERAL' && node.type !== 'BLOCK_FOLDED') {
        node.type = 'BLOCK_LITERAL';
      }
    }
    return node;
  }

  return doc.createNode(value) as Node;
}

/** Возвращает новый текст deck.yaml: старый файл с перенесёнными изменениями. */
export function mergeYaml(source: string, value: unknown): string {
  const doc = parseDocument(source);
  if (doc.errors.length) throw new Error(`deck.yaml содержит ошибку, сохранение отменено: ${doc.errors[0].message}`);
  doc.contents = merge(doc, doc.contents, value as Json) as typeof doc.contents;
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}
