// Градиенты с промежуточными точками: акцент темы и слайда, заливка фигур
import { expect, test } from '@playwright/test';
import { accentMid, accentTail, accentTokens, contrast, slideAccent, uiAccentTokens, uiSafeAccent } from '../../src/engine/accent';
import { gradientCss, gradientMid, gradientOn, parseTextGradient, sameGradient, textGradientCode, textGradientCss } from '../../src/engine/gradients';
import { t } from '../../src/engine/html';

test('градиент акцента: точки между акцентом и вторым цветом — в --ac-g, --ac-stops и в переливании', () => {
  const { light, dark } = accentTokens('#000000', { to: '#FFFFFF', mid: [{ c: '#FF0000', at: 40 }] });
  expect(light['--ac-stops']).toBe('#000000, #FF0000 40%, #FFFFFF');
  expect(light['--ac-g']).toBe('linear-gradient(135deg, #000000, #FF0000 40%, #FFFFFF)');
  // Туда и обратно: точка в первой половине и зеркально во второй
  expect(light['--ac-loop']).toBe('#000000, #FF0000 20%, #FFFFFF 50%, #FF0000 80%, #000000');
  // У тёмных точки светлее, как акцент и второй цвет
  expect(dark['--ac-stops']).toMatch(/^#\w{6}, #FF1F1F 40%, #FFFFFF$/);
  // Без точек — как раньше
  expect(accentTokens('#000000', '#FFFFFF').light['--ac-g']).toBe('linear-gradient(135deg, #000000, #FFFFFF)');
});

test('точки в порядке: неверные убираются, места 1–99 %, по возрастанию, не больше четырёх; без второго цвета точек нет', () => {
  expect(accentMid([{ c: '#ff0000', at: 70 }, { c: 'red', at: 10 }, { c: '#00FF00', at: 0 }, null])).toEqual([{ c: '#00FF00', at: 1 }, { c: '#FF0000', at: 70 }]);
  expect(accentMid(Array.from({ length: 6 }, (_, i) => ({ c: '#111111', at: i * 10 + 5 })))).toHaveLength(4);
  expect(accentTail({ accentMid: [{ c: '#FF0000', at: 50 }] })).toEqual({ to: null, mid: [] });
  expect(accentTail({ accent2: '#FFFFFF', accentMid: [{ c: '#FF0000', at: 50 }] }).mid).toHaveLength(1);
  // Свои цвета слайда с точками — своё сочетание
  expect(slideAccent({ accent: '#000000', accent2: '#FFFFFF', accentMid: [{ c: '#FF0000', at: 40 }] })).toBe('#000000 #FFFFFF #FF0000@40');
});

test('градиент фигуры: точки — цвета темы или постоянные; от акцента ко второму цвету — все точки темы', () => {
  const g = { from: '#000000', to: '#FFFFFF', mid: [{ c: 'accent', at: 50 }], angle: 90 };
  expect(gradientCss(g)).toBe('linear-gradient(90deg, #000000, var(--ac) 50%, #FFFFFF)');
  expect(gradientCss({ ...g, type: 'radial' })).toBe('radial-gradient(circle at 50% 40%, #000000, var(--ac) 50%, #FFFFFF)');
  expect(gradientCss({ from: 'accent', to: 'accent2', angle: 135 })).toBe('linear-gradient(135deg, var(--ac-stops, var(--ac), var(--ac2)))');
  expect(gradientMid([{ c: 'accent', at: 120 }])).toEqual([{ c: 'accent', at: 99 }]);
  expect(sameGradient(g, { ...g, mid: [{ c: 'accent', at: 60 }] })).toBe(false);
  expect(sameGradient(g, { ...g })).toBe(true);
  // Текст поверх — по яркости всех точек
  expect(gradientOn({ from: '#FFFFFF', to: '#FFFFFF', mid: [{ c: '#000000', at: 50 }] })).toBe('#111827');
  expect(gradientOn({ from: '#FFFFFF', to: '#000000', mid: [{ c: '#000000', at: 50 }] })).toBe('#FFFFFF');
});

test('свой градиент текста в разметке: цвета, места, направление, цвета темы; готовые — по имени', () => {
  expect(parseTextGradient('g:#F97316,#EC4899@40,#7C3AED')).toEqual({ from: '#F97316', to: '#7C3AED', mid: [{ c: '#EC4899', at: 40 }], angle: 90 });
  // Без мест — поровну; направление первым
  expect(parseTextGradient('g:180deg,accent,#FFFFFF,#000000,accent2')).toEqual({ from: 'accent', to: 'accent2', mid: [{ c: '#FFFFFF', at: 33 }, { c: '#000000', at: 67 }], angle: 180 });
  expect(parseTextGradient('g:ocean')?.from).toBe('#06B6D4');
  for (const bad of ['g:#F97316', 'g:#F97316,url(x)', 'g:nope,#FFFFFF', 'g:1,2,3,4,5,6,7']) expect(parseTextGradient(bad)).toBeNull();
  // Код из градиента — обратно тот же; совпал с готовым — его имя
  const g = { from: '#F97316', to: 'accent2', mid: [{ c: '#EC4899', at: 40 }], angle: 45 };
  expect(textGradientCode(g)).toBe('g:45deg,#F97316,#EC4899@40,accent2');
  expect(parseTextGradient(textGradientCode(g))).toEqual(g);
  expect(textGradientCode({ from: '#F97316', to: '#DB2777', angle: 90 })).toBe('g:sunset');
  expect(textGradientCss('g:#000000,#FFFFFF')).toBe('--g:linear-gradient(90deg, #000000, #FFFFFF);color:#000000');
  // В тексте — кусок с градиентом
  expect(t('Это {g:#F97316,#EC4899@40,#7C3AED|радуга}')).toContain('<span class="md-c md-g" data-c="g:#F97316,#EC4899@40,#7C3AED" style="--g:linear-gradient(90deg, #F97316, #EC4899 40%, #7C3AED);color:#F97316">радуга</span>');
});

test('цвет интерфейса: слишком светлый темнеет, в тёмной теме слишком тёмный светлеет; тон тот же, обычный не меняется', () => {
  expect(uiSafeAccent('#2563EB', 'light')).toBe('#2563EB');
  expect(uiSafeAccent('#2563EB', 'dark')).toBe('#2563EB');
  expect(uiAccentTokens('#2563EB')).toEqual(accentTokens('#2563EB'));
  for (const c of ['#FFFFFF', '#FDE047', '#A7F3D0', '#94A3B8', '#000000', '#1E1B4B', '#0000FF']) {
    // Белый текст на кнопке и значки на панели видны (3 : 1)
    const { light, dark } = uiAccentTokens(c);
    expect(contrast(light['--ac'], '#FFFFFF')).toBeGreaterThanOrEqual(2.99);
    expect(contrast(dark['--ac'], '#FFFFFF')).toBeGreaterThanOrEqual(2.99);
    expect(contrast(dark['--ac'], '#162033')).toBeGreaterThanOrEqual(2.99);
  }
  // Чёрный в светлой теме читается — остаётся; жёлтый остаётся жёлтым, только темнее
  expect(uiSafeAccent('#000000', 'light')).toBe('#000000');
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(uiSafeAccent('#FFFF00', 'light').slice(i, i + 2), 16));
  expect(r).toBe(g);
  expect(b).toBe(0);
  expect(r).toBeLessThan(160);
  // Второй цвет градиента — тоже читаемый
  expect(contrast(uiAccentTokens('#2563EB', '#FFFFFF').light['--ac2'], '#FFFFFF')).toBeGreaterThanOrEqual(2.99);
});
