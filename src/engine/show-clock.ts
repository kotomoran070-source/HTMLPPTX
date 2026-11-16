/**
 * Общие часы показа. Анимации, которые должны совпадать у зрителей и на пульте (небо «Космоса»,
 * анимированные фоны), берут время отсюда, а не считают его от момента, когда слайд открылся в этом
 * окне, и не копят кадр за кадром: у окон разная частота кадров, телефон в экономном режиме стоит.
 * Отсчёт задаёт окно показа (сообщение state, поле clock); окно докладчика и телефон подстраиваются.
 */
let offset = -performance.now();
let aligned = false;

/** Время показа, мс: в окне показа — с его открытия, в остальных — как у него */
export function showTime(): number {
  return performance.now() + offset;
}

/**
 * Пауза автопоказа (A) — как в видео: время сцены стоит, потом идёт дальше с того же места.
 * По нему считают живые фоны, эффекты текста и «Число набегает» — после паузы они не прыгают вперёд.
 * Только в этом окне: у остальных окон своя сцена.
 */
let lost = 0;
let since = 0;

export function freezeScene(on: boolean): void {
  const t = performance.now();
  if (on && !since) since = t;
  else if (!on && since) {
    lost += t - since;
    since = 0;
  }
}

/** Сколько мс сцена стояла на паузе (с текущей паузой) */
export function scenePaused(): number {
  return lost + (since ? performance.now() - since : 0);
}

/** Время сцены, мс: как performance.now() (или метка кадра t), но без пауз; на паузе — не меняется */
export function sceneNow(t = performance.now()): number {
  return (since || t) - lost;
}

/**
 * Окно показа прислало своё время. Задержка связи его только запаздывает, поэтому из ответов
 * берётся самый «поздний» (быстрее всех дошедший). Окно показа перезагрузили и отсчёт пошёл
 * заново — его время сильно меньше нашего, оно принимается сразу
 */
export function alignShowTime(remote: number): void {
  if (!Number.isFinite(remote)) return;
  const next = remote - performance.now();
  if (!aligned || next > offset || next < offset - 2000) offset = next;
  aligned = true;
}
