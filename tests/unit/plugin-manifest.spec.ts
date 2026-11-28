// Описание плагина (src/engine/plugin-manifest.ts): что разбирается, что отклоняется и что плагин просит
import { expect, test } from '@playwright/test';
import { missing, permissionsOf, PLUGIN_PATH, readManifest } from '../../src/engine/plugin-manifest';

const ok = (raw: Record<string, unknown>) => {
  const r = readManifest(raw);
  if ('error' in r) throw new Error(r.error);
  return r.manifest;
};
const err = (raw: unknown) => {
  const r = readManifest(raw);
  return 'error' in r ? r.error : '';
};
const base = { name: 'Фото и иконки', api: 1, panel: { file: 'panel.html' } };

test('plugin.json: значения по умолчанию, ширина панели в пределах, кнопка — по названию', () => {
  const m = ok({ ...base, panel: { file: 'ui/panel.html', width: 900 } });
  expect(m.panel).toEqual({ file: 'ui/panel.html', width: 480 });
  expect(m.button).toEqual({ label: 'Фото и иконки', title: 'Фото и иконки' });
  expect(m.icon).toBe('plug');
  expect(m.edit).toBe(false);
  expect(ok({ ...base, panel: { file: 'p.html', width: 10 } }).panel!.width).toBe(260);
  expect(ok({ ...base, icon: 'image', button: { label: 'Фото', title: 'Поиск фото' } }).button).toEqual({ label: 'Фото', title: 'Поиск фото' });
  // Значок — только имя значка студии
  expect(ok({ ...base, icon: '<svg onload=x>' }).icon).toBe('plug');
});

test('plugin.json: что отклоняется — и почему, понятным текстом', () => {
  expect(err(null)).toMatch(/не объект/);
  expect(err([])).toMatch(/не объект/);
  expect(err({ api: 1, panel: { file: 'p.html' } })).toMatch(/названия/);
  expect(err({ ...base, api: 2 })).toMatch(/другой версии/);
  expect(err({ name: 'x', api: 1 })).toMatch(/нет панели/);
  // Файл панели — HTML внутри папки плагина
  for (const file of ['../p.html', 'a/../../p.html', '/etc/p.html', 'C:\\p.html', 'p.js', '', './p.html']) expect(err({ ...base, panel: { file } }), file).toMatch(/panel\.file/);
  // Сеть — имена сайтов: не свой компьютер, не адрес по номеру, без порта и пути
  for (const h of ['localhost', '127.0.0.1', 'example.local', 'api.example.com:8080', 'https://api.example.com', 'api.example.com/x', 'intranet', '*.example.com']) {
    expect(err({ ...base, network: [h] }), h).toMatch(/network/);
  }
  expect(err({ ...base, network: 'api.example.org' })).toMatch(/network/);
});

test('разрешения: правка, панель, каждый адрес сети; новое в обновлении — снова вопрос', () => {
  const m = ok({ ...base, edit: true, network: ['API.Unsplash.com', 'api.unsplash.com', 'api.pexels.com'] });
  expect(m.network).toEqual(['api.unsplash.com', 'api.pexels.com']);
  expect(permissionsOf(m)).toEqual(['edit', 'panel', 'net:api.unsplash.com', 'net:api.pexels.com']);
  expect(missing(m, ['edit', 'panel', 'net:api.unsplash.com', 'net:api.pexels.com'])).toEqual([]);
  // Обновление попросило ещё адрес — его нет среди разрешённых
  const next = ok({ ...base, edit: true, network: ['api.unsplash.com', 'api.pexels.com', 'api.iconify.design'] });
  expect(missing(next, ['edit', 'panel', 'net:api.unsplash.com', 'net:api.pexels.com'])).toEqual(['net:api.iconify.design']);
  // Файлы презентации — только по явной просьбе
  expect(m.files).toBe(false);
  const media = ok({ ...base, edit: true, files: true });
  expect(permissionsOf(media)).toEqual(['edit', 'files', 'panel']);
  expect(missing(media, ['edit', 'panel'])).toEqual(['files']);
  expect(PLUGIN_PATH.test('img/logo.png')).toBe(true);
  expect(PLUGIN_PATH.test('img/../logo.png')).toBe(false);
});
