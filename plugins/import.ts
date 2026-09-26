import fs from 'node:fs';
import path from 'node:path';
import { Document, isMap, isPair, isScalar, visit } from 'yaml';
import { AssetStore } from './assets';
import { fromDesign, isDesignExport } from './design-import';
import { fromSlidesHtml, isSlidesHtml } from './html-import';
import { bindDeck, readDataUrl, toDataUrl, type BindReport } from './theme-bind';
import { readYaml } from './decks';
import { deepEqual, merge3, type Conflict } from './merge3';
import { unpackDeck } from '../src/engine/pack';
import { mergeYaml } from './yaml-merge';

export const DATA_ID = 'htmlpptx-deck';
/** Версия данных проекта на момент сборки: база для трёхстороннего слияния */
export const BASE_ID = 'htmlpptx-base';

type Deck = { title?: string; slides?: Slide[]; [k: string]: unknown };
type Slide = { id?: string; title?: string; label?: string; [k: string]: unknown };

export interface ImportOptions {
  /** Папка presentations */
  dir: string;
  /** В какую презентацию импортировать (по умолчанию — из файла) */
  name?: string;
  /** Имя импортируемого файла: запасной вариант для имени новой презентации */
  fileName?: string;
  /** Только показать, что изменится */
  dryRun?: boolean;
  /** Привязать цвета вёрстки к теме (для Claude Design и своего HTML; по умолчанию да) */
  theme?: boolean;
}

export interface ImportResult {
  name: string;
  /** Откуда файл: сборка этого проекта, экспорт Claude Design или свой HTML по правилам */
  source: 'htmlpptx' | 'design' | 'html';
  /** Привязка цветов к теме (если выполнялась) */
  theme?: BindReport;
  /** Что стоит поправить в исходном файле */
  warnings: string[];
  /** create — новая презентация; merge — слияние с исходной версией; replace — без исходной версии */
  mode: 'create' | 'merge' | 'replace';
  changed: boolean;
  dryRun: boolean;
  slides: number;
  added: string[];
  removed: string[];
  edited: string[];
  other: string[];
  conflicts: Conflict[];
  newAssets: string[];
  backup?: string;
}

function extract(html: string, id: string): unknown {
  const m = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`).exec(html);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    throw new Error('Данные презентации в файле повреждены');
  }
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slug(s: string): string {
  return s.toLowerCase().split('').map((c) => TRANSLIT[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

const slideName = (s: Slide | undefined, i: number) => {
  const l = s?.label ?? s?.title;
  return typeof l === 'string' && l.trim() ? `«${l.trim().slice(0, 50)}»` : `слайд ${i + 1}`;
};

/** Что поменялось в презентации: для отчёта перед записью. */
function describe(before: Deck, after: Deck): Pick<ImportResult, 'added' | 'removed' | 'edited' | 'other'> {
  const b = before.slides ?? [];
  const a = after.slides ?? [];
  const key = (s: Slide, i: number) => (typeof s?.id === 'string' ? `id:${s.id}` : `i:${i}`);
  const B = new Map(b.map((s, i) => [key(s, i), s] as const));
  const A = new Map(a.map((s, i) => [key(s, i), s] as const));
  const added = a.map((s, i) => (B.has(key(s, i)) ? null : slideName(s, i))).filter(Boolean) as string[];
  const removed = b.map((s, i) => (A.has(key(s, i)) ? null : slideName(s, i))).filter(Boolean) as string[];
  const edited = a.map((s, i) => {
    const old = B.get(key(s, i));
    return old && !deepEqual(old, s) ? slideName(s, i) : null;
  }).filter(Boolean) as string[];
  const orderChanged = !added.length && !removed.length
    && b.map((s, i) => key(s, i)).join() !== a.map((s, i) => key(s, i)).join();
  const other: string[] = [];
  if (orderChanged) other.push('порядок слайдов');
  const NAMES: Record<string, string> = { title: 'название', brand: 'логотип', theme: 'цвет', lang: 'язык' };
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k !== 'slides' && !deepEqual(before[k], after[k])) other.push(NAMES[k] ?? k);
  }
  return { added, removed, edited, other };
}

/** YAML новой презентации: координаты и оформление — в одну строку, { x: 64, y: 144, w: 88 } */
function compactYaml(v: unknown): string {
  const doc = new Document(v);
  visit(doc, {
    Pair(_, pair) {
      if (isPair(pair) && isScalar(pair.key) && ['place', 'styles'].includes(String(pair.key.value)) && isMap(pair.value)) {
        pair.value.flow = true;
      }
    },
  });
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Импорт HTML-файла презентации обратно в проект.
 * Правки из файла переносятся в deck.yaml (с сохранением комментариев), встроенные картинки —
 * в assets/. Перед записью старый deck.yaml копируется в .backup/.
 */
export function importHtml(html: string, o: ImportOptions): ImportResult {
  let theirsRaw = unpackDeck(extract(html, DATA_ID));
  let origin: ImportResult['source'] = 'htmlpptx';
  // Экспорт Claude Design: слайды превращаются в холсты со свободными объектами
  let warnings: string[] = [];
  if (!theirsRaw && isDesignExport(html)) {
    theirsRaw = fromDesign(html);
    origin = 'design';
  } else if (!theirsRaw && isSlidesHtml(html)) {
    ({ deck: theirsRaw, warnings } = fromSlidesHtml(html));
    origin = 'html';
  }
  // Цвета вёрстки → цвета темы: работают тёмная тема и смена акцента
  let theme: BindReport | undefined;
  if (theirsRaw && origin !== 'htmlpptx' && o.theme !== false) {
    theme = bindDeck(theirsRaw as Deck, { read: readDataUrl, write: (_src, text) => toDataUrl(text) });
  }
  if (!theirsRaw || typeof theirsRaw !== 'object') {
    // Самая первая версия движка собирала файл без данных для правки
    if (/id="?ovbd|htmlpptx/i.test(html)) {
      throw new Error('Файл собран старой версией проекта: в нём ещё нет данных для импорта. Соберите презентацию заново (yarn build), правьте новый файл из dist/ — его можно будет импортировать.');
    }
    throw new Error('Формат файла не распознан. Импортируются: файл, собранный этим проектом (yarn build → dist/<имя>.html), HTML-экспорт из Claude Design и свой HTML со слайдами <section class="slide"> (правила — docs/HTML.md).');
  }
  const baseRaw = extract(html, BASE_ID) as { name?: string; deck?: Deck } | undefined;
  const fromFile = o.fileName ? slug(path.basename(o.fileName).replace(/\.html?$/i, '')) : '';
  const name = o.name || baseRaw?.name || fromFile || slug(String((theirsRaw as Deck).title ?? '')) || 'imported';
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) throw new Error(`Неподходящее имя презентации «${name}»: латиница, цифры, дефис`);

  const deckDir = path.join(o.dir, name);
  const file = path.join(deckDir, 'deck.yaml');
  const exists = fs.existsSync(file);
  const assets = new AssetStore(deckDir);
  const theirs = assets.normalize(theirsRaw) as Deck;
  const conflicts: Conflict[] = [];
  const result = (mode: ImportResult['mode'], before: Deck, after: Deck, changed: boolean): ImportResult => ({
    name, source: origin, mode, changed, dryRun: !!o.dryRun, slides: after.slides?.length ?? 0,
    ...describe(before, after), conflicts, newAssets: assets.added, theme, warnings,
  });

  if (!exists) {
    const res = result('create', {}, theirs, true);
    if (!o.dryRun) {
      fs.mkdirSync(deckDir, { recursive: true });
      assets.flush();
      const what = origin === 'design' ? 'экспорта Claude Design' : origin === 'html' ? 'HTML' : 'HTML-файла';
      fs.writeFileSync(file, `# Импортировано из ${what} ${o.fileName ?? ''}. Справочник компонентов: docs/COMPONENTS.md\n\n${compactYaml(theirs)}`);
    }
    return res;
  }

  const source = fs.readFileSync(file, 'utf8');
  const ours = readYaml(file, source) as Deck;
  // База есть, если файл собран из этой же презентации
  const base = baseRaw?.deck && (!baseRaw.name || baseRaw.name === name) ? baseRaw.deck : undefined;
  const merged = (base ? merge3(base, ours, theirs, conflicts) : theirs) as Deck;
  const next = mergeYaml(source, merged);
  const changed = next !== source;
  const res = result(base ? 'merge' : 'replace', ours, merged, changed);
  if (changed && !o.dryRun) {
    const backupDir = path.join(deckDir, '.backup');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `deck-${stamp()}.yaml`);
    fs.writeFileSync(backup, source);
    res.backup = path.relative(process.cwd(), backup);
    assets.flush();
    fs.writeFileSync(file, next);
  }
  return res;
}

export interface BindResult {
  name: string;
  changed: boolean;
  dryRun: boolean;
  theme: BindReport;
  backup?: string;
}

/**
 * Привязка цветов к теме у презентации, которая уже есть в проекте (импортированной раньше
 * или без привязки). Меняет deck.yaml (с резервной копией) и документы вставок в assets/.
 */
export function bindProject(dir: string, name: string, dryRun = false): BindResult {
  const deckDir = path.join(dir, name);
  const file = path.join(deckDir, 'deck.yaml');
  if (!fs.existsSync(file)) throw new Error(`Презентация «${name}» не найдена`);
  const source = fs.readFileSync(file, 'utf8');
  const deck = readYaml(file, source) as Deck;
  const inside = (src: string) => {
    const abs = path.resolve(deckDir, src);
    return abs.startsWith(deckDir + path.sep) ? abs : null;
  };
  const writes = new Map<string, string>();
  const theme = bindDeck(deck, {
    read: (src) => {
      if (src.startsWith('data:')) return readDataUrl(src);
      const abs = inside(src);
      return abs && fs.existsSync(abs) ? writes.get(abs) ?? fs.readFileSync(abs, 'utf8') : null;
    },
    write: (src, text) => {
      if (src.startsWith('data:')) return toDataUrl(text);
      const abs = inside(src);
      if (abs) writes.set(abs, text);
      return src;
    },
  });
  const next = mergeYaml(source, deck);
  const changed = next !== source || writes.size > 0;
  const res: BindResult = { name, changed, dryRun, theme };
  if (changed && !dryRun) {
    const backupDir = path.join(deckDir, '.backup');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `deck-${stamp()}.yaml`);
    fs.writeFileSync(backup, source);
    res.backup = path.relative(process.cwd(), backup);
    for (const [abs, text] of writes) fs.writeFileSync(abs, text);
    fs.writeFileSync(file, next);
  }
  return res;
}

/** Отчёт о привязке цветов к теме. */
export function themeLines(t: BindReport): string[] {
  const out = [`Цвета привязаны к теме: ${t.bound}`];
  if (t.accent) out.push(`Акцентный цвет макета: ${t.accent} (записан в theme.accent)`);
  const kept = Object.entries(t.kept).sort((a, b) => b[1] - a[1]);
  if (kept.length) {
    const top = kept.slice(0, 8).map(([c, n]) => `${c} ×${n}`).join(', ');
    out.push(`Без пары в теме, остаются как есть (${kept.length}): ${top}${kept.length > 8 ? ', …' : ''}`);
  }
  if (t.darkSlides.length) out.push(`Тёмные слайды остаются тёмными: ${t.darkSlides.join(', ')}`);
  return out;
}

/** Список новых файлов; длинный — числом: «12 картинок, 3 вставки». */
export function filesSummary(files: string[]): string {
  if (files.length <= 6) return files.map((f) => f.replace('./assets/', '')).join(', ');
  const embeds = files.filter((f) => f.endsWith('.htm')).length;
  const images = files.length - embeds;
  return [images && `картинок: ${images}`, embeds && `живых вставок: ${embeds}`].filter(Boolean).join(', ');
}

/** Текстовый отчёт об импорте (для командной строки). */
export function report(r: ImportResult): string {
  const lines: string[] = [];
  const where = `presentations/${r.name}/deck.yaml`;
  const from = r.source === 'design' ? ' из экспорта Claude Design' : r.source === 'html' ? ' из HTML' : '';
  if (r.mode === 'create') lines.push(`${r.dryRun ? 'Будет создана' : 'Создана'} презентация ${where}${from}: ${r.slides} слайдов`);
  else if (!r.changed) lines.push(`Изменений нет: ${where} уже содержит эти данные`);
  else lines.push(`${r.dryRun ? 'Будет обновлена' : 'Обновлена'} ${where}${r.mode === 'merge' ? ' (слияние с исходной версией)' : ''}`);
  if (r.mode === 'replace' && r.changed) {
    lines.push(r.source === 'design'
      ? '  Презентация уже есть: слайды из экспорта заменят её содержимое (правки, сделанные здесь, не сохранятся).'
      : '  В файле нет исходной версии проекта: данные из файла заменяют данные проекта.');
  }
  if (r.mode !== 'create') {
    if (r.edited.length) lines.push(`  Изменены: ${r.edited.join(', ')}`);
    if (r.added.length) lines.push(`  Добавлены: ${r.added.join(', ')}`);
    if (r.removed.length) lines.push(`  Удалены: ${r.removed.join(', ')}`);
    if (r.other.length) lines.push(`  Также: ${r.other.join(', ')}`);
  }
  if (r.newAssets.length) lines.push(`  Новые файлы в assets/: ${filesSummary(r.newAssets)}`);
  if (r.conflicts.length) {
    lines.push('  Конфликты — изменено и в проекте, и в файле (взята версия из файла):');
    for (const c of r.conflicts) {
      const why = c.kind === 'both-changed' ? '' : c.kind === 'deleted-in-file' ? ' (в файле удалено, в проекте изменено — оставлено)' : ' (в проекте удалено, в файле изменено — восстановлено)';
      lines.push(`    • ${c.path}${why}`);
    }
  }
  if (r.theme) lines.push(...themeLines(r.theme).map((l) => `  ${l}`));
  if (r.warnings.length) {
    lines.push('  Стоит поправить в исходном файле:');
    for (const w of r.warnings) lines.push(`    • ${w}`);
  }
  if (r.backup) lines.push(`  Прежняя версия сохранена: ${r.backup}`);
  return lines.join('\n');
}
