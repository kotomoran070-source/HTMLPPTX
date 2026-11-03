import http from 'node:http';

/**
 * Свой адрес для живых слайдов и вставок, которым нужен звук (микрофон, звук вкладки или экрана).
 * Рамка без адреса (srcdoc в песочнице) браузер к звуку не пускает, а рамка с адресом самой студии
 * получила бы доступ к странице и командам проекта. Поэтому — отдельный сервер на другом порту только
 * этого компьютера: он отдаёт одну пустую страницу, а документ слайда она получает сообщением от студии.
 * Команды проекта с этого адреса не проходят: сервер студии принимает их только со своего (server/http.ts).
 * Адрес страницы узнают из <meta name="slideria-frame-host"> (src/engine/frame-host.ts).
 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Слайд</title><script>
(function () {
  var done = false;
  addEventListener('message', function (e) {
    if (done || e.source !== parent || !e.data || typeof e.data.slideriaDoc !== 'string') return;
    done = true;
    document.open(); document.write(e.data.slideriaDoc); document.close();
  });
  parent.postMessage({ slideriaFrameReady: 1 }, '*');
})();
</script>`;

export type FrameHost = ReturnType<typeof startFrameHost>;

/** Запустить; onError — адрес не открылся (страницы работают и без него, только без звука во вставках) */
export function startFrameHost(onError?: (message: string) => void) {
  let port = 0;
  const host = http.createServer((req, res) => {
    if (req.method !== 'GET' || (req.url ?? '/').split('?')[0] !== '/') {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(PAGE);
  });
  host.on('error', (e) => onError?.(`Адрес для слайдов со звуком не открылся: ${e.message}`));
  const ready = new Promise<void>((resolve) => {
    host.listen(0, '127.0.0.1', () => {
      const a = host.address();
      port = a && typeof a === 'object' ? a.port : 0;
      resolve();
    });
    host.once('error', () => resolve());
  });
  return {
    ready,
    /** Тег для страницы (пусто, пока адрес не открылся) */
    meta: () => (port ? `<meta name="slideria-frame-host" content="http://127.0.0.1:${port}/">` : ''),
    url: () => (port ? `http://127.0.0.1:${port}/` : ''),
    close: () => new Promise<void>((resolve) => host.close(() => resolve())),
  };
}
