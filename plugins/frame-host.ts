import http from 'node:http';
import type { Plugin } from 'vite';

/**
 * Свой адрес для живых слайдов и вставок, которым нужен звук (микрофон, звук вкладки или экрана).
 * Рамка без адреса (srcdoc в песочнице) браузер к звуку не пускает, а рамка с адресом самой студии
 * получила бы доступ к странице и командам проекта. Поэтому — отдельный сервер на другом порту только
 * этого компьютера: он отдаёт одну пустую страницу, а документ слайда она получает сообщением от студии.
 * Команды проекта с этого адреса не проходят: сервер студии принимает их только со своего (decks.ts).
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

export function frameHostPlugin(): Plugin {
  let host: http.Server | null = null;
  let port = 0;
  return {
    name: 'slideria-frame-host',
    apply: 'serve',
    configureServer(s) {
      host = http.createServer((req, res) => {
        if (req.method !== 'GET' || (req.url ?? '/').split('?')[0] !== '/') {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(PAGE);
      });
      host.on('error', (e) => s.config.logger.warn(`Адрес для слайдов со звуком не открылся: ${e.message}`));
      host.listen(0, '127.0.0.1', () => {
        const a = host?.address();
        port = a && typeof a === 'object' ? a.port : 0;
      });
      s.httpServer?.once('close', () => host?.close());
    },
    // Адрес — страницам студии и показа; телефону в сети он недоступен, там звук не нужен
    transformIndexHtml() {
      return port ? [{ tag: 'meta', attrs: { name: 'slideria-frame-host', content: `http://127.0.0.1:${port}/` }, injectTo: 'head' }] : [];
    },
  };
}
