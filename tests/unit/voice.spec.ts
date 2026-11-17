// Голосовой ввод, сервер (server/voice.ts): загрузка модели с продолжением после обрыва, проверка SHA-256 и
// распаковка в потоке, архив вручную, «Отмена», распознавание. Архив — маленький образец с раскладкой настоящего
// (tests/fixtures/voice-model.tar.bz2: лишние файлы, длинный путь в заголовке PAX). Настоящая модель — если она
// скачана для yarn dev (node_modules/.cache/slideria-voice, первое нажатие на микрофон в чате «Агент»)
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createVoice, type Voice, type VoiceModel, type VoiceStatus } from '../../server/voice';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARCHIVE = fs.readFileSync(path.join(ROOT, 'tests/fixtures/voice-model.tar.bz2'));
const SHA = createHash('sha256').update(ARCHIVE).digest('hex');

/** Сервер архива: Range — с места обрыва; cut — первый ответ обрывается после стольких байт; hold — замирает */
async function archiveServer(o: { cut?: number; hold?: number; body?: Buffer } = {}) {
  const body = o.body ?? ARCHIVE;
  const ranges: string[] = [];
  let cut = o.cut ?? 0;
  const srv = http.createServer((req, res) => {
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    const from = m ? Number(m[1]) : 0;
    ranges.push(req.headers.range ?? 'целиком');
    res.writeHead(m ? 206 : 200, { 'Content-Length': body.length - from, ...(m ? { 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}` } : {}) });
    const rest = body.subarray(from);
    if (cut) {
      res.write(rest.subarray(0, cut));
      cut = 0;
      setTimeout(() => res.destroy(), 50);
      return;
    }
    if (o.hold) {
      res.write(rest.subarray(0, o.hold));
      return;
    }
    res.end(rest);
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/model.tar.bz2`;
  return { url, ranges, close: () => new Promise<void>((ok) => { srv.closeAllConnections(); srv.close(() => ok()); }) };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'slideria-voice-'));
const model = (url: string, sha = SHA, size = ARCHIVE.length): VoiceModel => ({ url, sha256: sha, size });

/** Ждать, пока загрузка не закончится (готово, ошибка или остановлено) */
async function settle(v: Voice): Promise<VoiceStatus> {
  await expect.poll(() => v.status().state, { timeout: 20_000 }).not.toBe('download');
  return v.status();
}

test('загрузка обрывается и продолжается с того же места; модель — на месте только после проверки', async () => {
  const dir = tmp();
  const srv = await archiveServer({ cut: 20_000 });
  const v = createVoice({ dir, model: model(srv.url) });
  try {
    expect(v.status()).toMatchObject({ state: 'none', got: 0, total: ARCHIVE.length, engine: true, loaded: false });
    expect(v.install().state).toBe('download');
    const broken = await settle(v);
    expect(broken.state).toBe('error');
    expect(broken.error).toMatch(/^Загрузка прервалась/);
    // Скачанное — на диске, модели ещё нет
    expect(broken.got).toBe(20_000);
    expect(fs.existsSync(path.join(dir, 'gigaam-v3'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'unpack'))).toBe(false);
    // «Повторить» — с места обрыва
    v.install();
    expect((await settle(v)).state).toBe('ready');
    expect(srv.ranges).toEqual(['целиком', 'bytes=20000-']);
    // Из архива — только нужные файлы, по имени без папок; README — из длинного пути (заголовок PAX)
    expect(fs.readdirSync(path.join(dir, 'gigaam-v3')).sort()).toEqual(['LICENSE', 'README.md', 'example.wav', 'model.int8.onnx', 'ready.json', 'tokens.txt']);
    expect(fs.statSync(path.join(dir, 'gigaam-v3', 'model.int8.onnx')).size).toBe(573_440);
    expect(fs.readFileSync(path.join(dir, 'gigaam-v3', 'README.md'), 'utf8')).toBe('# test fixture\n');
    // Архив после распаковки не хранится
    expect(fs.readdirSync(dir)).toEqual(['gigaam-v3']);
    // Уже есть — повторная загрузка ничего не качает
    expect(v.install().state).toBe('ready');
    expect(srv.ranges).toHaveLength(2);
  } finally {
    await v.close();
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('не тот архив: проверка SHA-256 не проходит, скачанное удаляется, модели нет', async () => {
  const dir = tmp();
  const srv = await archiveServer();
  const v = createVoice({ dir, model: model(srv.url, '0'.repeat(64)) });
  try {
    v.install();
    const s = await settle(v);
    expect(s.state).toBe('error');
    expect(s.error).toBe('Файл модели не прошёл проверку — скачайте его заново');
    expect(s.got).toBe(0);
    expect(fs.readdirSync(dir)).toEqual([]);
  } finally {
    await v.close();
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('нет связи с сервером модели — понятная ошибка', async () => {
  const dir = tmp();
  const srv = await archiveServer();
  const url = srv.url;
  await srv.close();
  const v = createVoice({ dir, model: model(url) });
  try {
    v.install();
    expect(await settle(v)).toMatchObject({ state: 'error', error: 'Загрузка прервалась: нет связи с сервером модели', got: 0 });
  } finally {
    await v.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('«Отмена»: загрузка останавливается без ошибки, скачанное остаётся до следующей', async () => {
  const dir = tmp();
  const srv = await archiveServer({ hold: 30_000 });
  const v = createVoice({ dir, model: model(srv.url) });
  try {
    v.install();
    await expect.poll(() => v.status().got, { timeout: 10_000 }).toBe(30_000);
    expect(v.cancel().state).toBe('none');
    const s = await settle(v);
    expect(s).toMatchObject({ state: 'none', got: 30_000 });
    expect(s.error).toBeUndefined();
    expect(fs.existsSync(path.join(dir, 'unpack'))).toBe(false);
  } finally {
    await v.close();
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('архив вручную («Указать файл…»): не тот размер — отказ сразу; тот — та же проверка и распаковка', async () => {
  const dir = tmp();
  const v = createVoice({ dir, model: model('http://127.0.0.1:9/model.tar.bz2') });
  const body = (b: Buffer) => Object.assign(Readable.from([b]), { headers: { 'content-length': String(b.length) } }) as unknown as IncomingMessage;
  try {
    await expect(v.installFile(body(Buffer.from('не архив')))).rejects.toThrow(/^Это не архив модели: нужен файл model\.tar\.bz2/);
    expect(fs.existsSync(path.join(dir, 'download.part'))).toBe(false);
    expect((await v.installFile(body(ARCHIVE))).state).toBe('download');
    expect((await settle(v)).state).toBe('ready');
    expect(fs.existsSync(path.join(dir, 'gigaam-v3', 'model.int8.onnx'))).toBe(true);
  } finally {
    await v.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('распознавание: без модели — понятный отказ; короткий щелчок — пусто; подставной текст тестов', async () => {
  const dir = tmp();
  const none = createVoice({ dir, model: model('http://127.0.0.1:9/none') });
  const stub = createVoice({ dir, model: model('http://127.0.0.1:9/none'), stub: 'Добавь слайд' });
  try {
    const second = Buffer.alloc(16_000 * 2);
    await expect(none.recognize(second)).rejects.toThrow('Модель распознавания речи не установлена');
    expect(await none.recognize(Buffer.alloc(1000))).toBe('');
    expect(await stub.recognize(second)).toBe('Добавь слайд');
  } finally {
    await none.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Настоящая модель — если её уже скачали для yarn dev
const DEV = path.join(ROOT, 'node_modules/.cache/slideria-voice');
test('настоящая модель: запись распознаётся в потоке, в простое модель выгружается', async () => {
  const wav = path.join(DEV, 'gigaam-v3', 'example.wav');
  test.skip(!fs.existsSync(wav) || createVoice({ dir: DEV }).status().state !== 'ready', 'модель не скачана: нажмите микрофон в чате «Агент» (yarn dev)');
  const v = createVoice({ dir: DEV, idle: 1500 });
  try {
    // WAV: 16 бит, 16 кГц, моно — отсчёты после заголовка
    const pcm = fs.readFileSync(wav).subarray(44);
    v.load();
    expect(v.status().loaded).toBe(true);
    const t = Date.now();
    const text = await v.recognize(pcm);
    expect(text).toContain('лукоморья дуб зелёный');
    expect(text).toMatch(/^Ничьих, не требуя похвал/);
    console.log(`распознано ${pcm.length / 32000} с записи за ${Date.now() - t} мс (с загрузкой модели)`);
    await expect.poll(() => v.status().loaded, { timeout: 10_000 }).toBe(false);
  } finally {
    await v.close();
  }
});
