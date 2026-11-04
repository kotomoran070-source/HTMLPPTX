/**
 * Работа «в запас», пока студия простаивает: то, что иначе делалось бы при первом открытии галереи и было
 * видно (замирание, фоны волнами). Начинается, когда студия открылась и успокоилась; идёт малыми задачами в
 * свободное время браузера — человек, который сразу начал работать, этого не замечает: следующая задача
 * ждёт, пока браузер снова свободен.
 */
export function warmLater(tasks: (() => void)[], delay = 1500): void {
  if (!tasks.length) return;
  const idle = 'requestIdleCallback' in window
    ? (fn: (d: { timeRemaining(): number }) => void) => requestIdleCallback(fn)
    : (fn: (d: { timeRemaining(): number }) => void) => setTimeout(() => fn({ timeRemaining: () => 10 }), 60);
  const run = (d: { timeRemaining(): number }) => {
    // Хотя бы одна задача за раз; дальше — пока у браузера есть свободное время
    do {
      try { tasks.shift()!(); } catch (e) { console.warn('Подготовка в запас:', e); }
    } while (tasks.length && d.timeRemaining() > 12);
    if (tasks.length) idle(run);
  };
  setTimeout(() => idle(run), delay);
}
