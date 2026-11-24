/**
 * Кодирование ролика «Экспорт → Видео» (video-export.ts): кадры от программы — в H.264 (WebCodecs), трек показа —
 * в AAC (где его кодирует система) или Opus, всё — в MP4 (mp4-muxer, MIT). Файл не копится в памяти: готовые куски
 * программа сразу пишет на диск. Модуль подгружается, только когда видео записывают.
 */
import { Muxer, StreamTarget } from 'mp4-muxer';
import { AUDIO_BITRATE, videoBitrate } from '../engine/video-plan';
import { TrackMixer } from './video-audio';
import type { AppFrame, AppVideo, VideoSize } from './video-export';

/**
 * Профиль High и уровень H.264 по размеру и частоте кадров (уровень ограничивает число макроблоков в секунду):
 * 720p — 3.1/3.2, 1080p — 4.0/4.2, 2K — 5.0/5.1, 4K — 5.1/5.2
 */
export function avcCodec(height: VideoSize, fps: number): string {
  const hi = fps > 30;
  const level = height <= 720 ? (hi ? 0x20 : 0x1f) : height <= 1080 ? (hi ? 0x2a : 0x28) : height <= 1440 ? (hi ? 0x33 : 0x32) : (hi ? 0x34 : 0x33);
  return `avc1.6400${level.toString(16).padStart(2, '0').toUpperCase()}`;
}

/** Трек показа — в 48 кГц, как дорожка ролика */
export async function decodeTrack(url: string): Promise<{ channels: Float32Array[]; rate: number }> {
  const buf = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(2, 1, 48000);
  const a = await ctx.decodeAudioData(buf);
  return { channels: Array.from({ length: a.numberOfChannels }, (_, c) => a.getChannelData(c)), rate: a.sampleRate };
}

/** Кодек звука: AAC, если система его кодирует (Windows, macOS), иначе Opus */
async function audioCodec(rate: number): Promise<{ muxer: 'aac' | 'opus'; config: AudioEncoderConfig } | null> {
  for (const [muxer, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']] as const) {
    const config: AudioEncoderConfig = { codec, sampleRate: rate, numberOfChannels: 2, bitrate: AUDIO_BITRATE };
    try {
      if ((await AudioEncoder.isConfigSupported(config)).supported) return { muxer, config };
    } catch { /* не поддерживается */ }
  }
  return null;
}

/** Настройка H.264: сначала как удобнее браузеру (видеокарта), потом программно */
async function videoConfig(width: number, height: number, fps: number): Promise<VideoEncoderConfig> {
  for (const hardwareAcceleration of ['no-preference', 'prefer-software'] as const) {
    const config: VideoEncoderConfig = {
      codec: avcCodec(height as VideoSize, fps), width, height, framerate: fps, bitrate: videoBitrate(width, height, fps),
      hardwareAcceleration, latencyMode: 'quality', avc: { format: 'avc' },
    };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch { /* следующий вариант */ }
  }
  throw new Error('H.264 в этом размере не кодируется');
}

/** Кадры от программы → MP4. onFrame — после каждого кадра; stop() — отменили. Ответ: true — ролик дописан до конца */
export async function encode(
  app: AppVideo,
  o: { width: number; height: number; fps: number; track: { channels: Float32Array[]; rate: number } | null },
  onFrame: (k: number, f: AppFrame) => void,
  stop: () => boolean,
): Promise<boolean> {
  const vcfg = await videoConfig(o.width, o.height, o.fps);
  const acodec = o.track ? await audioCodec(o.track.rate) : null;
  const writes: Promise<unknown>[] = [];
  let failed: Error | null = null;
  const target = new StreamTarget({
    chunked: true,
    chunkSize: 8 * 1024 * 1024,
    onData: (data, position) => { writes.push(app.write(position, data).catch((e: Error) => { failed ??= e; })); },
  });
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: o.width, height: o.height, frameRate: o.fps },
    ...(acodec ? { audio: { codec: acodec.muxer, numberOfChannels: 2, sampleRate: o.track!.rate } } : {}),
    fastStart: false,
    firstTimestampBehavior: 'offset',
  });
  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failed ??= e; } });
  ve.configure(vcfg);
  const ae = acodec ? new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failed ??= e; } }) : null;
  ae?.configure(acodec!.config);
  const mixer = o.track ? new TrackMixer(o.track.channels, o.track.rate) : null;
  const dur = 1e6 / o.fps;
  let k = 0;
  for (; ; k++) {
    if (stop() || failed) break;
    const f = await app.frame(k, o.fps);
    if (f.done) break;
    const frame = new VideoFrame(f.data, { format: 'BGRA', codedWidth: f.width, codedHeight: f.height, timestamp: Math.round(k * dur), duration: Math.round(dur) });
    ve.encode(frame, { keyFrame: k % (o.fps * 2) === 0 });
    frame.close();
    if (mixer && ae) {
      const at = mixer.samples;
      const ch = mixer.push({ t: f.t, ...f.music });
      const n = ch[0].length;
      if (n) {
        const data = new Float32Array(n * 2);
        data.set(ch[0], 0);
        data.set(ch[1], n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: mixer.rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / mixer.rate) * 1e6), data });
        ae.encode(ad);
        ad.close();
      }
    }
    // Кодировщик не успевает — подождать, а не копить кадры в памяти
    while (ve.encodeQueueSize > 4) await new Promise((r) => ve.addEventListener('dequeue', r, { once: true }));
    onFrame(k, f);
  }
  if (failed) throw failed;
  if (stop()) {
    ve.close();
    ae?.close();
    return false;
  }
  if (k === 0) throw new Error('Показ не дал ни одного кадра');
  await ve.flush();
  await ae?.flush();
  muxer.finalize();
  await Promise.all(writes);
  if (failed) throw failed;
  return true;
}
