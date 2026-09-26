import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { AssetStore } from './assets';
import { readYaml } from './decks';
import { deepEqual, merge3, type Conflict } from './merge3';
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
}

export interface ImportResult {
  name: string;
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
  const theirsRaw = extract(html, DATA_ID);
  if (!theirsRaw || typeof theirsRaw !== 'object') {
    // Самая первая версия движка собирала файл без данных для правки
    if (/id="?ovbd|htmlpptx/i.test(html)) {
      throw new Error('Файл собран старой версией проекта: в нём ещё нет данных для импорта. Соберите презентацию заново (yarn build), правьте новый файл из dist/ — его можно будет импортировать.');
    }
    throw new Error('Это не файл HTMLPPTX. Импортировать можно только файл, собранный этим проектом (yarn build → dist/<имя>.html), в том числе сохранённый после правок в браузере. Исходную HTML-презентацию или экспорт из другого сервиса так импортировать нельзя.');
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
    name, mode, changed, dryRun: !!o.dryRun, slides: after.slides?.length ?? 0,
    ...describe(before, after), conflicts, newAssets: assets.added,
  });

  if (!exists) {
    const res = result('create', {}, theirs, true);
    if (!o.dryRun) {
      fs.mkdirSync(deckDir, { recursive: true });
      assets.flush();
      fs.writeFileSync(file, `# Импортировано из ${o.fileName ?? 'HTML-файла'}. Справочник компонентов: docs/COMPONENTS.md\n\n${stringify(theirs, { lineWidth: 0 })}`);
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

/** Текстовый отчёт об импорте (для командной строки). */
export function report(r: ImportResult): string {
  const lines: string[] = [];
  const where = `presentations/${r.name}/deck.yaml`;
  if (r.mode === 'create') lines.push(`${r.dryRun ? 'Будет создана' : 'Создана'} презентация ${where}: ${r.slides} слайдов`);
  else if (!r.changed) lines.push(`Изменений нет: ${where} уже содержит эти данные`);
  else lines.push(`${r.dryRun ? 'Будет обновлена' : 'Обновлена'} ${where}${r.mode === 'merge' ? ' (слияние с исходной версией)' : ''}`);
  if (r.mode === 'replace' && r.changed) lines.push('  В файле нет исходной версии проекта: данные из файла заменяют данные проекта.');
  if (r.mode !== 'create') {
    if (r.edited.length) lines.push(`  Изменены: ${r.edited.join(', ')}`);
    if (r.added.length) lines.push(`  Добавлены: ${r.added.join(', ')}`);
    if (r.removed.length) lines.push(`  Удалены: ${r.removed.join(', ')}`);
    if (r.other.length) lines.push(`  Также: ${r.other.join(', ')}`);
  }
  if (r.newAssets.length) lines.push(`  Новые картинки: ${r.newAssets.join(', ')}`);
  if (r.conflicts.length) {
    lines.push('  Конфликты — изменено и в проекте, и в файле (взята версия из файла):');
    for (const c of r.conflicts) {
      const why = c.kind === 'both-changed' ? '' : c.kind === 'deleted-in-file' ? ' (в файле удалено, в проекте изменено — оставлено)' : ' (в проекте удалено, в файле изменено — восстановлено)';
      lines.push(`    • ${c.path}${why}`);
    }
  }
  if (r.backup) lines.push(`  Прежняя версия сохранена: ${r.backup}`);
  return lines.join('\n');
}
