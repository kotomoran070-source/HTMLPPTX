// Защита от подмены адреса (DNS rebinding): свои — localhost и IP-адреса, чужие имена — нет
import { expect, test } from '@playwright/test';
import { hostAllowed } from '../../plugins/host-guard';

test('Host: localhost и IP-адреса — свои, имена чужих сайтов — нет', () => {
  for (const h of ['localhost:5173', 'LOCALHOST', 'app.localhost:47320', '127.0.0.1:47320', '192.168.1.20:5180', '[::1]:5173', '[fe80::1]', '10.0.0.5']) expect(hostAllowed(h)).toBe(true);
  for (const h of [undefined, '', 'evil.example:47320', 'localhost.evil.example', '127.0.0.1.nip.io:5173', 'evil.example.', '[evil]:80', 'mypc.local:5173']) expect(hostAllowed(h)).toBe(false);
  // Свои имена из server.allowedHosts; true — без проверки, как у самого Vite
  expect(hostAllowed('mypc.local:5173', ['mypc.local'])).toBe(true);
  expect(hostAllowed('a.studio.example', ['.studio.example'])).toBe(true);
  expect(hostAllowed('studio.example', ['.studio.example'])).toBe(true);
  expect(hostAllowed('evil.example', true)).toBe(true);
});
