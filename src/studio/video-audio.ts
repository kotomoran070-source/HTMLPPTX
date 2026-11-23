/**
 * Звуковая дорожка ролика «Экспорт → Видео»: трек показа так, как он звучал при записи. На каждом кадре запись
 * сообщает, где трек (секунда или молчит) и его громкость (затухание к концу — тоже громкостью); между кадрами
 * трек идёт дальше со своей секунды, громкость меняется плавно. Перемотка трека — с ближайшего кадра.
 */
export interface TrackState {
  /** Время кадра от начала ролика, мс */
  t: number;
  /** Секунда трека; null — трек молчит */
  pos: number | null;
  /** Громкость 0…1 */
  vol: number;
}

export class TrackMixer {
  /** Выдано сэмплов (от начала ролика) */
  private done = 0;
  private prev: TrackState | null = null;

  /** src — каналы трека (одного канала хватит: он идёт в оба), rate — частота и трека, и дорожки */
  constructor(private src: Float32Array[], readonly rate: number, readonly channels = 2) {}

  /** Кадр записан: звук от прошлого кадра до этого. Ответ — каналы, по channels штук (пустые — нечего добавить) */
  push(s: TrackState): Float32Array[] {
    const prev = this.prev;
    this.prev = s;
    const upTo = Math.round((s.t / 1000) * this.rate);
    const n = Math.max(0, upTo - this.done);
    const out = Array.from({ length: this.channels }, () => new Float32Array(n));
    if (!prev || !n) {
      this.done += n;
      return out;
    }
    if (prev.pos !== null) {
      const from = Math.round(prev.pos * this.rate);
      // Трек замолк к этому кадру — громкость сходит к нулю, а не возвращается к прежней (пауза её восстанавливает)
      const v0 = prev.vol;
      const v1 = s.pos === null ? 0 : s.vol;
      for (let c = 0; c < this.channels; c++) {
        const src = this.src[Math.min(c, this.src.length - 1)];
        const dst = out[c];
        for (let i = 0; i < n; i++) {
          const j = from + i;
          if (j < 0 || j >= src.length) continue;
          dst[i] = src[j] * (v0 + ((v1 - v0) * i) / n);
        }
      }
    }
    this.done += n;
    return out;
  }

  /** Сколько сэмплов уже выдано: метка времени следующего куска — done / rate */
  get samples(): number {
    return this.done;
  }
}
