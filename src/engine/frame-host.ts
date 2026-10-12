/**
 * Живой слайд или вставка со звуком (микрофон, звук вкладки или экрана, звук Wallpaper Engine):
 * рамка со своего адреса — отдельного сервера-рамки (plugins/frame-host.ts). Без адреса браузер
 * к звуку не пускает, а с адресом студии слайд получил бы доступ к её странице.
 * Нет такого адреса (собранный файл, телефон в сети) — рамка как обычно, без адреса: слайд работает,
 * только без звука (аудиовизуализаторы переходят на свой демо-ритм).
 */
const AUDIO = /\b(?:getUserMedia|getDisplayMedia|wallpaperRegisterAudioListener)\b/;

export function audioFrameHost(html: string): string | null {
  if (!AUDIO.test(html)) return null;
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return null;
  return document.querySelector<HTMLMetaElement>('meta[name="slideria-frame-host"]')?.content || null;
}

/** Документ — в рамку: со своего адреса (host), иначе как раньше, srcdoc в песочнице без адреса */
export function loadFrame(f: HTMLIFrameElement, html: string, host: string | null): void {
  if (!host) {
    f.srcdoc = html;
    return;
  }
  // Свой адрес отделён от студии портом: доступ к своему адресу рамке не даёт доступа к странице студии
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  f.setAttribute('allow', 'microphone; display-capture');
  // Картинки и файлы слайда — по адресам студии, как у рамки без адреса
  const base = `<base href="${document.baseURI.replace(/"/g, '&quot;')}">`;
  const doc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + base) : base + html;
  const onReady = (e: MessageEvent) => {
    if (e.source !== f.contentWindow || !(e.data as { slideriaFrameReady?: unknown } | null)?.slideriaFrameReady) return;
    removeEventListener('message', onReady);
    f.contentWindow?.postMessage({ slideriaDoc: doc }, new URL(host).origin);
  };
  addEventListener('message', onReady);
  f.removeAttribute('srcdoc');
  f.src = host;
}
