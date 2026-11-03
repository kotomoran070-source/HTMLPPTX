# Сервер Slideria

Всё, что страницы студии делают с презентациями на диске, — в `server/`, без Vite. Им пользуются сервер
разработки (`yarn dev`) и программа, дальше — программа без Vite, команды для MCP и облако. Vite к серверу
только подключается (`plugins/decks.ts`): модули `deck.yaml`, список `virtual:decks`, наблюдение за файлами,
горячая перезагрузка, сборка в один файл.

```
server/core.ts        ядро: презентации, запись со слиянием, точки, файлы, шрифты, библиотека, импорт, экспорт
server/http.ts        HTTP: защита адреса, пульт, «Лицензии», команды /__htmlpptx/* — обработчик node:http
server/player.ts      готовый проигрыватель для экспорта в HTML: варианты, кэш, сборка недостающего
server/mcp.ts         MCP для агентов: инструменты и протокол без транспорта (docs/MCP.md)
server/running.ts     какой сервер студии работает с папкой презентаций (для MCP)
server/integrations.ts агенты на связи, что им можно, журнал правок, скрипты (docs/INTEGRATIONS.md)
server/deck-files.ts  файлы презентаций: папки, deck.yaml, пути к файлам в данных
server/host-guard.ts  защита от подмены адреса (DNS rebinding)
```

Сторож в `tests/unit/server.spec.ts`: в `server/` нет Vite, а сервер поднимается на голом `node:http` и отвечает.

## Подключить к любому серверу

```ts
import http from 'node:http';
import { createDecksCore } from './server/core';
import { createHandler } from './server/http';

const core = createDecksCore({ dir: 'presentations', root: process.cwd() });
const handle = createHandler(core);
http.createServer((req, res) => handle(req, res, () => { res.statusCode = 404; res.end(); })).listen(5190, '127.0.0.1');
```

`createHandler` пропускает дальше (`next`) всё, что не его: страницы и код отдаёт хозяин.

## Ядро

`createDecksCore({ dir, root, fonts?, library?, urlOf?, playerCache?, hooks? })`:

| Что | Методы |
|---|---|
| Презентации | `names()`, `has(name)`, `list()` — с временем правки, `read(name, { urls })` — данные (с `urls` — пути к файлам адресами для страницы), `create(title, sample)` — из `templates/basic`, `trash(name)` — в `.trash`, не насовсем |
| Операции правки | `outline(name, { slide? })` — краткое содержание для агента: слайды с ревизиями, объекты с номерами; `apply(name, { ops, expect?, from? })` — пакет операций, все или ни одной ([OPS.md](OPS.md)) |
| Запись | `save(name, { deck, base, from })` — трёхстороннее слияние с файлом: из окна берётся только то, что оно поменяло само; чужие правки возвращаются окну; комментарии в YAML сохраняются |
| Контрольные точки | `checkpoint(name)`, `checkpoints(name)`, `readCheckpoint(name, id)` — копии в `.checkpoints`, последние 30 |
| Файлы презентации | `assets(name)`, `addAsset(name, fileName, data)` — тот же файл не повторяется, STL и STEP — в GLB, `writeAssetText` — код живой вставки, `trashAssets` |
| Шрифты | `fonts()`, `addFont(fileName, data)`, `useFont(name, file)` — только разрешённые автором к встраиванию |
| Своя библиотека | `library()`, `putLibrary(kind, id, value)`, `deleteLibrary(kind, id)` — темы, шаблоны, эффекты, образы |
| Импорт | `importPage(html, …)` — HTML, `importPowerPoint(data, …)` — PPTX, `bindTheme(name, dry)` |
| Экспорт | `exportHtml(name, { clean, compact, look, motion })` — один HTML-файл из готового проигрывателя; `fileHtml(html, name)` — данные и файлы внутрь страницы; `warmPlayers()` — собрать недостающие варианты заранее |
| Записи сервера | `wrote(file)`, `ownWrite(file, now)` — изменение файла сделал сам сервер: страницу не перезагружать |

Ошибки — исключения с понятным текстом для человека; неудачная сборка экспорта — `ExportError`.

**События** (`core.on(type, fn)`): `saved` — `{ name, from }`, записали презентацию (`from` — окно, которое
записало); `removed` — `{ name }`, презентацию убрали в корзину; `agents` — список агентов (подключился, замолчал,
правил); `journal` — новая запись журнала правок. Хозяин рассылает их страницам.

**Крючки хозяина** (`hooks`, все необязательны): `release(paths)` — отпустить наблюдение за папкой на время
переноса в корзину (Windows не даёт переименовать папку под наблюдением), возвращает функцию «снова следить»;
`run(script, args, opts)` — чем запускать сборку недостающего варианта проигрывателя (в программе — служебным
процессом Electron).

## Экспорт: готовый проигрыватель

Файл экспорта — страница проигрывателя (код показа, стили, шрифты интерфейса) и данные презентации со встроенными
файлами. Код показа не зависит от презентации, поэтому собирается не на каждый экспорт, а один раз на **вариант**:

| | |
|---|---|
| `show` / `edit` | только показ или с режимом правки в файле |
| `-3d` | 3D-модели (около 1 МБ) — только если в презентации есть `type: model` |
| `-math` | формулы (около 350 КБ с шрифтами) — только если есть `type: math` |

Восемь вариантов: `show`, `show-math`, `show-3d`, `show-3d-math`, `edit`, … `edit-3d-math`. Экспорт:

1. **Вариант** — по `deck.yaml` и режиму (`variantOf`). Где он берётся, по порядку: `<root>/player/` — собранные
   вместе с программой (установщик, `scripts/app-stage.mjs`); кэш `playerCache` (по умолчанию
   `node_modules/.cache/slideria-player`, в программе — в её данных), если отпечаток исходников (`sourceHash`:
   `src/`, `index.html`, конфиг Vite, плагины сборки, `package.json`, `yarn.lock`) тот же; иначе вариант собирается
   отдельным процессом (`scripts/build.mjs --player=<вариант>`, Vite) — один раз, одновременные экспорты ждут одну
   сборку. Код поменялся — варианты в кэше собираются заново по мере надобности, устаревшие удаляются.
2. **Данные** (`fileHtml`): данные презентации и исходная версия — в `<body>`, файлы — внутрь (`data:`), с «Компактным» —
   картинки в WebP; заголовок, язык и `<meta name="slideria-deck">` — имя, под которым проигрыватель хранит своё
   (ответы теста, правки в копии файла). Теги ищутся вне `<script>` и `<style>`: в коде проигрывателя такие строки тоже есть.
3. **Отделка** (`finishFile`): «Как на этом компьютере» — `data-slideria-look` у `<html>` (вид слайдов) и запросы
   «Уменьшить движение» во всём файле отвечают «движение можно»; блок лицензий — библиотеки варианта (список рядом
   с ним, `<вариант>.json`) и шрифты комплекта, которые оказались в файле.

`yarn build` делает то же из командной строки; `yarn build --players --out=папка` — все варианты сразу.

## HTTP

`createHandler(core, { allowedHosts?, address?, lan?, firewall?, log? })`, по порядку:

1. **Защита адреса.** Чужое имя сервера (DNS rebinding) — отказ раньше всех обработчиков. Свои — `localhost`
   и IP-адреса, остальные — `allowedHosts`.
2. **Пульт с телефона** (`/__slideria/remote/*`). Из сети пускает только телефон с пропуском (одноразовая
   ссылка из QR). В программе вход для телефона открывает `lan(deck)`, только к показываемой презентации.
3. **«Лицензии»** (`/__slideria/licenses`) — только этому компьютеру.
4. **Команды проекта** `/__htmlpptx/<команда>?deck=…`: только `POST`, только с этого компьютера, только со
   страниц этого же сервера (`Origin`). Ответ — JSON; ошибка — `{ error }` с кодом 400, сбой сборки — 500.

| Команда | Что делает |
|---|---|
| `list`, `create`, `read`, `save`, `delete` | презентации |
| `outline`, `apply` | операции правки для агента, MCP и плагинов ([OPS.md](OPS.md)) |
| `integrations`, `integrations-set`, `agent`, `journal`, `journal-add`, `scripts`, `script-read`, `script-save` | интеграции: кто на связи, что можно агентам, журнал, скрипты ([INTEGRATIONS.md](INTEGRATIONS.md)) |
| `checkpoint`, `checkpoints`, `checkpoint-read` | контрольные точки |
| `asset`, `asset-text`, `assets-list`, `assets-trash` | файлы презентации |
| `font-list`, `font-save`, `font-use` | библиотека шрифтов |
| `library`, `library-put`, `library-delete` | своя библиотека студии |
| `import`, `import-pptx`, `bind-theme` | импорт |
| `export` | один HTML-файл |
| `firewall` | программа под Windows: разрешить пульт в брандмауэре |
