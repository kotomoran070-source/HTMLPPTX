// Голосовой ввод чата «Агент» (docs/AGENT.md → «Голос»): речь распознаётся на этом компьютере, запись никуда
// не уходит. Модель — GigaAM v3 со знаками препинания (Сбер, MIT) в сборке sherpa-onnx. В установщик она не входит
// (163 МБ архивом, 225 МБ на диске): голосом пользуются не все — модель скачивается, когда микрофон нажали впервые.
// Движок — sherpa-onnx-node (Apache-2.0), он в программе.
// Загрузка с распаковкой и распознавание — каждое в своём потоке: сервер студии всё это время отвечает как обычно.
// Модель в памяти (~300 МБ) только пока ей пользуются: через 3 минуты без записи поток завершается и память
// освобождается (на Linux её частью держит распределитель glibc до следующей загрузки — docs/PERF.md).
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';

export interface VoiceModel {
  /** Архив модели (tar.bz2 из релизов sherpa-onnx) */
  url: string;
  sha256: string;
  /** Размер архива, байт */
  size: number;
}

/** GigaAM v3, CTC со знаками препинания: релиз asr-models на github.com/k2-fsa/sherpa-onnx */
export const GIGAAM: VoiceModel = {
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-ctc-punct-giga-am-v3-russian-2025-12-16.tar.bz2',
  sha256: '20e41e160efa6f2460a7ef6554cdbbb9e8fffb2b92e6bc708e9406bd8b9256ea',
  size: 163_282_594,
};
/** Модель на диске после распаковки (model.int8.onnx — 225 МБ) */
const UNPACKED = 225_000_000;
/** Что берём из архива (пример записи — для проверки на настоящей модели, tests/unit/voice.spec.ts); скрипты
 * сборки модели не распаковываются */
const FILES = ['model.int8.onnx', 'tokens.txt', 'LICENSE', 'README.md', 'example.wav'];
/** Сколько ждать новой записи, прежде чем выгрузить модель из памяти */
const IDLE = 3 * 60_000;
export const SAMPLE_RATE = 16_000;

export interface VoiceStatus {
  /** none — модели нет; download — скачивается и распаковывается; ready — можно говорить; error — загрузка не удалась */
  state: 'none' | 'download' | 'ready' | 'error';
  /** Получено и всего, байт. У none — сколько уже скачано до обрыва: загрузка продолжится с этого места */
  got: number;
  total: number;
  error?: string;
  /** Нужно места на диске, байт */
  need: number;
  /** Модель на диске после распаковки, байт */
  unpacked: number;
  /** Движок распознавания есть для этой системы */
  engine: boolean;
  /** Адрес архива: скачать на другом компьютере и указать файл */
  url: string;
  /** Модель сейчас в памяти (поток распознавания запущен) */
  loaded: boolean;
}

export interface Voice {
  status(): VoiceStatus;
  /** Скачать и распаковать модель (оборвалось раньше — с того же места) */
  install(): VoiceStatus;
  /** Модель из архива, скачанного вручную: тело запроса — сам файл */
  installFile(req: IncomingMessage): Promise<VoiceStatus>;
  /** Остановить загрузку: скачанное остаётся, следующая загрузка продолжит с него */
  cancel(): VoiceStatus;
  /** Начали запись — загрузить модель в память заранее, чтобы первая фраза не ждала */
  load(): void;
  /** Запись: 16-битные отсчёты, 16 кГц, моно → текст */
  recognize(pcm: Buffer): Promise<string>;
  /** «Удалить модель» (Файл → Параметры): загрузка останавливается, модель выгружается из памяти, файлы — с диска */
  remove(): Promise<VoiceStatus>;
  /** Закрыть потоки (выход сервера, тесты) */
  close(): Promise<void>;
}

const req = createRequire(import.meta.url);
const mb = (n: number) => `${Math.round(n / 1048576)} МБ`;

/** Движок для этой системы: sherpa-onnx-node и рядом его пакет под систему и процессор (sherpa-onnx-win-x64 …) */
function engineLib(): string | null {
  let main: string;
  try { main = req.resolve('sherpa-onnx-node'); } catch { return null; }
  const plat = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
  return fs.existsSync(path.join(path.dirname(main), '..', `sherpa-onnx-${plat}`, 'sherpa-onnx.node')) ? main : null;
}

function freeSpace(dir: string): number | null {
  try {
    const s = fs.statfsSync(fs.existsSync(dir) ? dir : path.dirname(dir));
    return s.bavail * s.bsize;
  } catch { return null; }
}

/** Отсчёты 16 бит → числа -1…1 для движка (тело запроса не обязательно выровнено по 2 байтам) */
export function pcmToFloat(pcm: Buffer): Float32Array {
  const n = pcm.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = pcm.readInt16LE(i * 2) / 32768;
  return out;
}

export function createVoice(o: {
  dir: string;
  model?: VoiceModel;
  /** Тесты: любая запись — этот текст, без модели и движка */
  stub?: string;
  /** Через сколько мс без записи выгрузить модель из памяти (тесты — быстрее) */
  idle?: number;
  log?: (m: string) => void;
}): Voice {
  const model = o.model ?? GIGAAM;
  const dir = path.resolve(o.dir);
  const home = path.join(dir, 'gigaam-v3');
  const part = path.join(dir, 'download.part');
  const tmp = path.join(dir, 'unpack');
  const fileName = decodeURIComponent(model.url.split('/').pop() ?? 'model.tar.bz2');
  const wrongFile = `Это не архив модели: нужен файл ${fileName} (${mb(model.size)})`;
  const log = (m: string) => o.log?.(`[голос] ${m}`);

  let job: { w: Worker; got: number } | null = null;
  let failed = '';
  /** Загрузку остановили сами («Отмена») — это не ошибка */
  let cancelled = false;

  const ready = () => {
    try { return (JSON.parse(fs.readFileSync(path.join(home, 'ready.json'), 'utf8')) as { sha256?: string }).sha256 === model.sha256; } catch { return false; }
  };
  const partSize = () => { try { return fs.statSync(part).size; } catch { return 0; } };
  const need = () => Math.max(0, model.size - partSize()) + UNPACKED;

  function status(): VoiceStatus {
    const base = { total: model.size, need: need(), unpacked: UNPACKED, engine: !!o.stub || !!engineLib(), url: model.url, loaded: !!rec };
    if (ready()) return { ...base, state: 'ready', got: model.size };
    if (job) return { ...base, state: 'download', got: job.got };
    return { ...base, state: failed ? 'error' : 'none', got: Math.min(partSize(), model.size), ...(failed ? { error: failed } : {}) };
  }

  /** Распаковка и проверка — в потоке (INSTALL); url = null — архив уже целиком в download.part */
  function start(url: string | null): void {
    fs.mkdirSync(dir, { recursive: true });
    const w = new Worker(INSTALL, { eval: true, workerData: { url, part, tmp, home, size: model.size, sha256: model.sha256, files: FILES, bz2: req.resolve('unbzip2-stream') } });
    w.unref();
    const j = job = { w, got: 0 };
    log(url ? `загрузка модели: ${url}` : 'модель из указанного файла');
    w.on('message', (m: { type: string; got?: number; code?: string; message?: string }) => {
      if (m.type === 'progress') return void (j.got = m.got ?? j.got);
      if (m.type === 'done') log('модель установлена');
      else if (m.type === 'error') {
        // Остановили сами — не ошибка: скачанное ждёт следующей загрузки
        failed = m.code === 'cancel' ? '' : m.message ?? 'Загрузка не удалась';
        if (failed) log(`загрузка не удалась: ${failed}`);
      }
      // Итог есть — поток больше не нужен (сам он не завершится: его держит канал сообщений)
      if (job === j) job = null;
      void w.terminate();
    });
    w.on('error', (e) => { failed = `Загрузка не удалась: ${e.message}`; log(failed); });
    w.on('exit', () => {
      if (job !== j) return;
      job = null;
      if (!failed && !cancelled && !ready()) failed = 'Загрузка остановилась';
    });
  }

  function install(): VoiceStatus {
    if (ready() || job) return status();
    failed = '';
    cancelled = false;
    const free = freeSpace(dir);
    if (free !== null && free < need()) {
      failed = `На диске не хватает места: нужно ${mb(need())}, свободно ${mb(free)}`;
      return status();
    }
    start(model.url);
    return status();
  }

  async function installFile(r: IncomingMessage): Promise<VoiceStatus> {
    if (job) throw new Error('Модель уже загружается');
    const len = Number(r.headers['content-length'] ?? 0);
    if (len && len !== model.size) {
      r.resume();
      throw new Error(wrongFile);
    }
    fs.mkdirSync(dir, { recursive: true });
    failed = '';
    cancelled = false;
    let n = 0;
    const limit = new Transform({
      transform(c: Buffer, _e, cb) {
        n += c.length;
        cb(n > model.size ? new Error(wrongFile) : null, c);
      },
    });
    try {
      await pipeline(r, limit, fs.createWriteStream(part));
    } catch (e) {
      fs.rmSync(part, { force: true });
      throw e;
    }
    if (partSize() !== model.size) {
      fs.rmSync(part, { force: true });
      throw new Error(wrongFile);
    }
    start(null);
    return status();
  }

  function cancel(): VoiceStatus {
    const j = job;
    if (!j) return status();
    cancelled = true;
    j.w.postMessage('cancel');
    // Поток не ответил — снять: скачанное к этому моменту уже на диске
    setTimeout(() => { if (job === j) void j.w.terminate(); }, 3000).unref();
    return { ...status(), state: 'none' };
  }

  // ---------------- распознавание ----------------

  const threads = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)));
  interface Rec { w: Worker; next: number; wait: Map<number, { ok: (t: string) => void; fail: (e: Error) => void }>; idle?: NodeJS.Timeout }
  let rec: Rec | null = null;

  function recognizer(): Rec {
    if (rec) return rec;
    if (!ready()) throw new Error('Модель распознавания речи не установлена');
    const lib = engineLib();
    if (!lib) throw new Error('Голосовой ввод на этой системе недоступен');
    const w = new Worker(RECOGNIZE, { eval: true, workerData: { lib, model: path.join(home, 'model.int8.onnx'), tokens: path.join(home, 'tokens.txt'), threads } });
    w.unref();
    const r: Rec = { w, next: 1, wait: new Map() };
    rec = r;
    const t0 = Date.now();
    log(`модель загружается в память (потоков: ${threads})`);
    w.on('message', (m: { id: number; text?: string; error?: string; loaded?: boolean }) => {
      if (m.loaded) return log(`модель в памяти за ${Date.now() - t0} мс`);
      const p = r.wait.get(m.id);
      r.wait.delete(m.id);
      if (m.error !== undefined) p?.fail(new Error(`Не удалось распознать речь: ${m.error}`));
      else p?.ok(m.text ?? '');
      idle(r);
    });
    const drop = (e: Error) => {
      if (rec === r) rec = null;
      for (const p of r.wait.values()) p.fail(e);
      r.wait.clear();
      clearTimeout(r.idle);
    };
    w.on('error', (e) => drop(new Error(`Не удалось распознать речь: ${e.message}`)));
    w.on('exit', () => drop(new Error('Распознавание остановилось')));
    idle(r);
    return r;
  }

  /** Нет записей IDLE — поток с моделью завершается, память освобождается */
  function idle(r: Rec): void {
    clearTimeout(r.idle);
    if (r.wait.size) return;
    r.idle = setTimeout(() => {
      if (rec !== r || r.wait.size) return;
      rec = null;
      log('модель выгружена из памяти');
      void r.w.terminate();
    }, o.idle ?? IDLE);
    r.idle.unref();
  }

  function load(): void {
    if (o.stub) return;
    try { recognizer(); } catch { /* модели нет — скажет recognize */ }
  }

  async function recognize(pcm: Buffer): Promise<string> {
    // Меньше 0,2 с — не речь (щелчок кнопкой)
    if (pcm.length < SAMPLE_RATE * 2 * 0.2) return '';
    if (o.stub) return o.stub;
    const samples = pcmToFloat(pcm);
    const r = recognizer();
    clearTimeout(r.idle);
    const id = r.next++;
    return new Promise<string>((ok, fail) => {
      r.wait.set(id, { ok, fail });
      r.w.postMessage({ id, samples }, [samples.buffer as ArrayBuffer]);
    });
  }

  async function close(): Promise<void> {
    const ws = [job?.w, rec?.w].filter((w): w is Worker => !!w);
    job = null;
    rec = null;
    await Promise.all(ws.map((w) => w.terminate()));
  }

  async function remove(): Promise<VoiceStatus> {
    // Остановленная загрузка — не ошибка; потоки завершаются до удаления: модель в памяти держит свой файл открытым
    cancelled = true;
    await close();
    failed = '';
    for (const p of [home, tmp, part]) fs.rmSync(p, { recursive: true, force: true });
    log('модель удалена');
    return status();
  }

  return { status, install, installFile, cancel, load, recognize, remove, close };
}

/**
 * Поток распознавания (CommonJS, запускается строкой: сервер программы собран одним файлом). Модель загружается при
 * старте потока; записи — по очереди. Отвечает { id, text } или { id, error }
 */
const RECOGNIZE = String.raw`
const { parentPort, workerData: w } = require('node:worker_threads');
const sherpa = require(w.lib);
const ready = sherpa.OfflineRecognizer.createAsync({
  featConfig: { sampleRate: 16000, featureDim: 64 },
  modelConfig: { nemoCtc: { model: w.model }, tokens: w.tokens, numThreads: w.threads, provider: 'cpu', debug: 0 },
});
ready.then(() => parentPort.postMessage({ loaded: true }), () => {});
let queue = Promise.resolve();
parentPort.on('message', (m) => {
  queue = queue.then(async () => {
    try {
      const rec = await ready;
      const s = rec.createStream();
      s.acceptWaveform({ sampleRate: 16000, samples: m.samples });
      await rec.decodeAsync(s);
      parentPort.postMessage({ id: m.id, text: String(rec.getResult(s).text || '').trim() });
    } catch (e) {
      parentPort.postMessage({ id: m.id, error: String((e && e.message) || e) });
    }
  });
});
`;

/**
 * Поток загрузки (CommonJS, строкой — как RECOGNIZE). Архив идёт сразу в три места: дописывается в download.part
 * (оборвалось — следующая загрузка продолжит с этого места, запросом Range), в SHA-256 и в распаковку — поэтому
 * распаковка почти не добавляет времени к загрузке. Из tar берутся только нужные файлы, по имени без папок: пути
 * из архива не используются. Готовая модель переносится на место только после проверки SHA-256.
 * Сообщения: { type: 'progress', got }, { type: 'done' }, { type: 'error', code, message }
 *   code: cancel — остановили; net — нет связи (скачанное остаётся); bad — файл не тот (скачанное удаляется)
 */
const INSTALL = String.raw`
const { parentPort, workerData: w } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { Writable } = require('node:stream');
const { finished } = require('node:stream/promises');
const unbzip2 = require(w.bz2);

const ac = new AbortController();
let cancelled = false;
parentPort.on('message', (m) => { if (m === 'cancel') { cancelled = true; ac.abort(); } });

class Fail extends Error { constructor(code, message) { super(message); this.code = code; } }
const bad = (m) => new Fail('bad', m || 'Файл модели не прошёл проверку — скачайте его заново');
const MB = (n) => Math.round(n / 1048576) + ' МБ';

/** tar: заголовки по 512 байт, содержимое — до кратного 512. Пишем только файлы из списка, в папку dir */
function untar(dir, keep) {
  let head = Buffer.alloc(0);
  let left = 0;
  let pad = 0;
  let out = null;
  let collect = null;
  let collectType = '';
  let nextName = null;
  let zeros = 0;
  let done = false;
  const str = (b, a, n) => { const s = b.subarray(a, a + n); const z = s.indexOf(0); return (z < 0 ? s : s.subarray(0, z)).toString('utf8'); };
  async function endEntry() {
    if (out) { const o = out; out = null; o.end(); await finished(o); }
    if (collect) {
      const text = Buffer.concat(collect).toString('utf8');
      collect = null;
      if (collectType === 'L') nextName = text.replace(/\0+$/, '');
      else {
        const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
        if (m) nextName = m[1];
      }
    }
  }
  return new Writable({
    write(chunk, _enc, cb) {
      (async () => {
        let off = 0;
        while (off < chunk.length && !done) {
          if (left > 0) {
            const n = Math.min(left, chunk.length - off);
            const piece = chunk.subarray(off, off + n);
            if (out) { if (!out.write(piece)) await once(out, 'drain'); }
            else if (collect) collect.push(Buffer.from(piece));
            left -= n;
            off += n;
            if (left === 0) await endEntry();
            continue;
          }
          if (pad > 0) { const n = Math.min(pad, chunk.length - off); pad -= n; off += n; continue; }
          const n = Math.min(512 - head.length, chunk.length - off);
          head = Buffer.concat([head, chunk.subarray(off, off + n)]);
          off += n;
          if (head.length < 512) continue;
          const h = head;
          head = Buffer.alloc(0);
          if (h.every((b) => b === 0)) { if (++zeros >= 2) done = true; continue; }
          zeros = 0;
          let sum = 0;
          for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
          if (sum !== parseInt(str(h, 148, 8).trim(), 8)) throw bad();
          const size = parseInt(str(h, 124, 12).trim() || '0', 8) || 0;
          const type = h[156] ? String.fromCharCode(h[156]) : '0';
          const prefix = str(h, 257, 6).startsWith('ustar') ? str(h, 345, 155) : '';
          const name = nextName ?? (prefix ? prefix + '/' : '') + str(h, 0, 100);
          if (type !== 'x' && type !== 'L') nextName = null;
          left = size;
          pad = (512 - (size % 512)) % 512;
          if (type === 'x' || type === 'L') { collect = []; collectType = type; }
          else if (type === '0' || type === '7') {
            const base = name.split('/').pop();
            if (keep.includes(base) && !base.startsWith('._')) out = fs.createWriteStream(path.join(dir, base));
          }
          if (left === 0) await endEntry();
        }
      })().then(() => cb(), cb);
    },
  });
}

(async () => {
  fs.rmSync(w.tmp, { recursive: true, force: true });
  fs.mkdirSync(w.tmp, { recursive: true });
  const hash = crypto.createHash('sha256');
  let got = 0;
  let told = 0;
  const tell = () => { const t = Date.now(); if (t - told > 150) { told = t; parentPort.postMessage({ type: 'progress', got }); } };
  const bz = unbzip2();
  const tar = untar(w.tmp, w.files);
  bz.pipe(tar);
  const broken = new Promise((_ok, fail) => {
    bz.on('error', (e) => fail(bad('Архив модели повреждён: ' + (e && e.message || e))));
    tar.on('error', (e) => fail(e instanceof Fail ? e : bad('Архив модели повреждён: ' + (e && e.message || e))));
  });
  broken.catch(() => {});
  const feed = async (c) => {
    hash.update(c);
    got += c.length;
    tell();
    if (bz.write(c) === false) await Promise.race([once(bz, 'drain'), broken]);
  };

  let have = 0;
  try { have = fs.statSync(w.part).size; } catch {}
  if (have > w.size) { fs.rmSync(w.part, { force: true }); have = 0; }
  // Скачанное раньше — через проверку и распаковку, затем остальное из сети
  if (have) for await (const c of fs.createReadStream(w.part, { signal: ac.signal })) await feed(c);
  if (w.url && have < w.size) {
    let stall = null;
    let stalled = false;
    const arm = () => { clearTimeout(stall); stall = setTimeout(() => { stalled = true; ac.abort(); }, 30000); };
    const out = fs.createWriteStream(w.part, { flags: 'a' });
    try {
      arm();
      const res = await fetch(w.url, { headers: have ? { Range: 'bytes=' + have + '-' } : {}, signal: ac.signal });
      if (!res.ok || !res.body) throw new Fail('http', 'Сервер с моделью ответил ошибкой ' + res.status + '. Попробуйте позже');
      // Сервер отдал файл целиком, а не с места обрыва — начало уже есть
      let skip = have && res.status !== 206 ? have : 0;
      for await (const raw of res.body) {
        arm();
        let c = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
        if (skip) {
          if (c.length <= skip) { skip -= c.length; continue; }
          c = c.subarray(skip);
          skip = 0;
        }
        if (got + c.length > w.size) throw bad();
        if (!out.write(c)) await once(out, 'drain');
        await feed(c);
      }
    } catch (e) {
      if (e instanceof Fail) throw e;
      if (cancelled) throw new Fail('cancel', 'Остановлено');
      throw new Fail('net', stalled ? 'Загрузка прервалась: сервер с моделью перестал отвечать' : 'Загрузка прервалась: нет связи с сервером модели');
    } finally {
      clearTimeout(stall);
      out.end();
      await finished(out).catch(() => {});
    }
  }
  if (cancelled) throw new Fail('cancel', 'Остановлено');
  if (got < w.size) throw w.url ? new Fail('net', 'Загрузка прервалась: получено ' + MB(got) + ' из ' + MB(w.size)) : bad();
  bz.end();
  await Promise.race([finished(tar), broken]);
  if (hash.digest('hex') !== w.sha256) throw bad();
  for (const f of ['model.int8.onnx', 'tokens.txt']) if (!fs.existsSync(path.join(w.tmp, f))) throw bad('В архиве нет файла ' + f);
  fs.writeFileSync(path.join(w.tmp, 'ready.json'), JSON.stringify({ sha256: w.sha256, date: new Date().toISOString() }));
  fs.rmSync(w.home, { recursive: true, force: true });
  fs.renameSync(w.tmp, w.home);
  fs.rmSync(w.part, { force: true });
  parentPort.postMessage({ type: 'done' });
})().catch((e) => {
  try { fs.rmSync(w.tmp, { recursive: true, force: true }); } catch {}
  let code = e instanceof Fail ? e.code : cancelled ? 'cancel' : 'other';
  let message = e && e.message || String(e);
  if (e && e.code === 'ENOSPC') { code = 'disk'; message = 'На диске не хватает места для модели'; }
  if (code === 'bad') try { fs.rmSync(w.part, { force: true }); } catch {}
  parentPort.postMessage({ type: 'error', code, message });
});
`;
