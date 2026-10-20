---
name: slideria-deck
description: Делает презентацию для Slideria — файл deck.yaml из родных блоков (схемы, графики, таблицы, морф, эффекты текста), который открывается в студии и доводится там. Используй, когда просят презентацию, слайды или доклад для Slideria или файл deck.yaml.
---

# Презентация для Slideria

Slideria показывает презентацию из `deck.yaml`: это данные, а не вёрстка. Цвета, шрифты, фон и карточки даёт тема, поэтому в файле — только содержание и раскладка. Готовый файл кладут в `presentations/<имя>/deck.yaml` и открывают в студии: там меняют тему, двигают объекты, настраивают анимацию.

Полный справочник полей — `docs/COMPONENTS.md` в репозитории Slideria. Если он приложен, сверяйся с ним; ниже — то, что нужно чаще всего.

## Каркас

```yaml
title: Итоги квартала
lang: ru
brand:
  name: Компания
  logo: ./assets/logo.svg     # одноцветный знак с прозрачным фоном
  tint: true                  # знак в цветах темы
theme:
  preset: standard            # standard, graphite, midnight, aurora, editorial, terminal, pop, forest, sand, mint,
                              # notebook, winter, autumn, sakura, marshmallow, party, tender, waves, deepsea, medical, luxe, neon
slides:
  - id: cover
    template: cover
    title: Итоги квартала
    lead: Подзаголовок одним предложением
    meta: Октябрь 2026, команда
  - id: numbers
    title: Цифры и {g:duo|динамика}   # обычный слайд (content): заголовок и блоки body
    badge: Графики
    body:
      - type: grid
        columns: 3
        items: [...]
    notes: Что сказать на этом слайде.
```

Каждому слайду — короткий `id` латиницей и `notes` для докладчика. `{g:duo|слово}` — слово градиентом акцента, `**жирный**` — жирный.

## Шаблоны слайдов

- `content` (по умолчанию) — заголовок, `badge`, блоки `body`; `gap` — промежуток, px.
- `cover` — титул: `title`, `lead`, `meta`, `visual` — блок справа.
- `canvas` — пустой холст 1280×720: всё — свободные объекты `free` (см. ниже).
- `finale` — финал: `title`, `lead`, `link: {label, url}` (QR строится сам), `buttons`.

## Блоки

| Что показать | Блок и поля |
|---|---|
| Раскладка | `grid` (`columns: 3` или `1.6fr 1fr`, `items`), `stack` (`items`) |
| Текст | `text` (`text`, `size: lead`), `list` (`items`), `chips` (`items`, звёздочка в конце — выделить), `quote` (`text`, `author`, `role`), `marquee` — бегущая строка (`items`, `variant: chips/outline`, `speed`, `dir: right`), `ring` — текст по кругу (`text`, `center`, `variant: badge`, `spin`) |
| Карточка | `card` (`title`, `text`, `body` — блоки внутри), `kv` (`rows: {Ключ: значение}`) |
| Число | `stat` (`value`, `label`, `delta: +12 %`, `note`) |
| Графики | `line-chart` (`values`, `start`, `end`, `unit`), `bars` (`values`, `labels`), `donut` / `hbars` / `columns` / `lines` (`values`, `labels`) |
| Таблица | `table` (`header`, `rows`, `variant: stripes`, `highlight`) |
| Схемы из пунктов | `items: [{title, text}]` у `cycle`, `funnel`, `pyramid`, `numbers`, `compare`, `matrix`, `icons`, `stats`, `faq`, `timeline` (`date`, `done`), `roadmap` (`text` — срок, `done`), `ladder`, `orbit` (`center` или `logo: true`), `venn` (`center` — общее в пересечении, `variant: filled`), `nested` (первый — самый большой круг, `text` — пояснение справа, `variant: target` — мишень); `pipeline` — `steps: [{title, sub}]`; `hub` — итоги вокруг логотипа |
| Формула | `math` (`x^2 + y^2 = r^2` или LaTeX), график функции — `plot` |
| Медиа | `image` (`src`, `caption`), `video` (`src` — файл или ссылка YouTube), `model` (`src` — GLB) |
| Код | `sandbox` (`code`, `theme: true`, `console: true`) — правится при показе |

## Холст и свободные объекты

```yaml
- id: idea
  template: canvas
  backdrop: aurora          # анимированный фон слайда; backdropOpacity: 0.5 — заметность
  free:
    - type: text
      text: Заголовок {g:duo|слайда}
      styles: {text: {size: 42, weight: 800}}
      place: {x: 48, y: 48, w: 1000}        # без h — высота по тексту
      enter: rise                           # appear, fade, rise, drop, left, right, scale, pop, swivel, growturn, blur, ripple, wipe, split, circle, diamond, wheel, mask, words, letters (текст), draw (линии, фигуры)
      delay: 150                            # мс
    - type: shape
      kind: round                           # round, rect, pill, ellipse, line, arrow
      fill: gradient                        # surface, soft, accent, gradient, none…
      text: "**Главное**\nодна мысль"
      place: {x: 48, y: 180, w: 360, h: 200}
      click: true                           # появится по «Далее»; clickWith: true — на том же щелчке, что предыдущий шаг
      textFx: shine                         # glitch, neon, shine, wave, type, scramble, liquid
```

- **Переход к слайду**: `transition` у слайда — `fade`, `push`, `cover`, `uncover`, `wipe`, `split`, `circle`, `clock`, `flash`, `zoom`, `blur`, объёмные `cube`, `flip`, `gallery`, `switch`, `doors`, `fall`, `morph`, `none`; `transitionDir: right|left|top|bottom` (у push, cover, uncover, wipe, cube, flip, gallery, switch), `transitionMs`.
- **Морф**: следующий слайд — копия с теми же `id` у объектов на других местах и `transition: morph`. Объекты перелетают, меняют размер, цвет и поворот (`angle`).
- **Своя анимация**: `@keyframes` в поле `css` в начале файла, у объекта — `style: "animation: имя 4s infinite"`.
- **По щелчку дальше**: `exit` (+ `exitAt`) — уход, `emphasis` (+ `emphAt`) — выделение; стойкие `dim`, `grow`, `recolor` держатся. Список по пунктам — `byItem: true`, длительность — `tempo: fast|slow|slower`.
- **Число набегает**: `count: true` у объекта с числом (отсчёт от нуля), `count: odometer` — цифры крутятся барабаном.

## Правила

- Не пиши цвета и CSS для оформления — их даёт тема. Цвета по ролям: `accent`, `text`, `text2`, `soft`, `surface`.
- Текст — текстом, не картинкой. Один смысловой блок — один объект.
- На слайде — одна мысль; цифры и схемы бери живыми блоками, а не списком.
- Верни только содержимое `deck.yaml`.
