// «Экспорт → Видео»: длина ролика по данным, звуковая дорожка по ходу трека в кадрах, уровень H.264 и поток
import { expect, test } from '@playwright/test';
import type { Deck } from '../../src/types';
import { clockText, shownSlides, videoLength, videoTail } from '../../src/engine/video-plan';
import { TrackMixer } from '../../src/studio/video-audio';
import { avcCodec, videoBitrate } from '../../src/studio/video-encode';

const slides = (n: number, extra: Record<string, unknown> = {}) => Array.from({ length: n }, () => ({ template: 'canvas', free: [], ...extra }));

test('длина ролика: по музыке — до конца трека и затухания, по таймеру — время слайдов и шаги', () => {
  const music = { src: './a.m4a', fadeOut: 2.4, end: 66.677 } as Deck['music'];
  const byMusic = { title: 'm', music, autoplay: { music: true }, slides: [{ template: 'canvas', at: 0.01, free: [] }, ...slides(2)] } as unknown as Deck;
  // От первого слайда (0,01) до конца трека и 2,4 с затухания
  expect(videoLength(byMusic)).toBeCloseTo((66.677 - 0.01) * 1000 + 2400, 3);
  expect(videoTail(byMusic)).toBe(2400);
  // «По 5 с»: не по музыке — 3 слайда по 5 с и затухание
  expect(videoLength(byMusic, 5)).toBe(15_000 + 2400);
  // По музыке, но конец не записан: длина файла трека; не знаем её — null
  const noEnd = { ...byMusic, music: { src: './a.m4a' } } as Deck;
  expect(videoLength(noEnd, 0, 30)).toBeCloseTo((30 - 0.01) * 1000 + 500, 3);
  expect(videoLength(noEnd)).toBeNull();
  // По таймеру: своё время слайда, общее, по умолчанию 5 с; шаг по щелчку — 1,5 с; скрытый не считается; без музыки — секунда в конце
  const timer = {
    title: 't', autoplay: { after: 2 },
    slides: [
      { template: 'canvas', after: 3, free: [] },
      { template: 'canvas', free: [{ type: 'text', text: 'a', click: true }, { type: 'text', text: 'b', click: true, clickWith: true }] },
      { template: 'canvas', hidden: true, free: [] },
    ],
  } as unknown as Deck;
  expect(videoLength(timer)).toBe(3000 + (1500 + 2000) + 1000);
  expect(shownSlides(timer)).toBe(2);
  expect(clockText(69_067)).toBe('1:09');
  expect(clockText(4_000)).toBe('0:04');
});

test('звуковая дорожка: трек со своей секунды, громкость между кадрами плавно, до начала и после конца — тишина', () => {
  const rate = 1000;
  const src = [Float32Array.from({ length: 5000 }, (_, i) => i / 5000)];
  const m = new TrackMixer(src, rate);
  // Первый кадр: трек ещё молчит — звука нет
  expect(m.push({ t: 0, pos: null, vol: 1 })[0].length).toBe(0);
  // До следующего кадра (100 мс) трек молчал — 100 сэмплов тишины
  const a = m.push({ t: 100, pos: 0.5, vol: 1 });
  expect(a).toHaveLength(2);
  expect(a[0].length).toBe(100);
  expect(Math.max(...a[0])).toBe(0);
  // Трек играет с 0,5 с: сэмплы 500…599, оба канала из одного
  const b = m.push({ t: 200, pos: 0.6, vol: 0.5 });
  expect(b[0][0]).toBeCloseTo(500 / 5000, 6);
  expect(b[1][10]).toBeCloseTo(b[0][10], 6);
  // Громкость от 1 к 0,5 — плавно внутри кадра
  expect(b[0][50]).toBeCloseTo((550 / 5000) * 0.75, 4);
  // Трек замолк: громкость сходит к нулю, а не возвращается к полной
  const c = m.push({ t: 300, pos: null, vol: 1 });
  expect(c[0][0]).toBeCloseTo((600 / 5000) * 0.5, 4);
  expect(c[0][99]).toBeLessThan(0.01);
  expect(m.samples).toBe(300);
  // Трек кончился раньше ролика — дальше тишина, а не ошибка
  const end = new TrackMixer([new Float32Array(10).fill(1)], rate);
  end.push({ t: 0, pos: 0, vol: 1 });
  const tail = end.push({ t: 20, pos: 0.02, vol: 1 });
  expect([...tail[0].slice(0, 10)].every((v) => v === 1)).toBe(true);
  expect([...tail[0].slice(10)].every((v) => v === 0)).toBe(true);
});

test('H.264: профиль High и уровень по размеру и частоте кадров; поток — по числу пикселей', () => {
  expect(avcCodec(720, 30)).toBe('avc1.64001F');
  expect(avcCodec(1080, 30)).toBe('avc1.640028');
  expect(avcCodec(1080, 60)).toBe('avc1.64002A');
  expect(avcCodec(1440, 60)).toBe('avc1.640033');
  expect(avcCodec(2160, 30)).toBe('avc1.640033');
  expect(avcCodec(2160, 60)).toBe('avc1.640034');
  // Не меньше 6 Мбит/с, не больше 80
  expect(videoBitrate(1280, 720, 30)).toBe(6e6);
  expect(videoBitrate(1920, 1080, 60)).toBe(Math.round(1920 * 1080 * 60 * 0.15));
  expect(videoBitrate(3840, 2160, 60)).toBeLessThanOrEqual(80e6);
});
