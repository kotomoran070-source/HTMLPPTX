/**
 * Пипетка: цвет любой точки экрана — слайда, картинки, другой программы (EyeDropper в Chromium и программе).
 * Esc или щелчок мимо — null. Где пипетки нет (Firefox, Safari) — null и canPickColor() === false
 */
interface EyeDropperApi { open(): Promise<{ sRGBHex: string }> }

export const canPickColor = (): boolean => 'EyeDropper' in window;

export async function pickScreenColor(): Promise<string | null> {
  const Ctor = (window as { EyeDropper?: new () => EyeDropperApi }).EyeDropper;
  if (!Ctor) return null;
  try {
    const hex = (await new Ctor().open()).sRGBHex;
    // Chromium отдаёт #rrggbb, а с прозрачностью — rgba(…): берём сам цвет
    if (/^#[0-9a-f]{6}$/i.test(hex)) return hex.toUpperCase();
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(hex);
    return m ? `#${m.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase()}` : null;
  } catch {
    return null;
  }
}
