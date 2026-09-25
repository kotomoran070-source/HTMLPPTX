# Справочник компонентов

Слайд — элемент списка `slides` в `deck.yaml`. Поле `template` выбирает шаблон слайда, поле `body` содержит блоки. Каждый блок — объект с полем `type`.

Общие поля любого слайда:

| Поле | Что это |
|---|---|
| `id` | Короткое имя слайда (необязательно) |
| `template` | `content` (по умолчанию), `cover`, `finale`, `space` |
| `label` | Название в обзоре и в окне докладчика, если отличается от `title` |
| `notes` | Заметки докладчика. Многострочный текст пишите после `notes: \|` |

Любому блоку можно добавить `style: "margin-top: 12px"`: это CSS для корневого элемента, запасной выход, если нужной настройки нет.

---

## Шаблоны слайдов

### `content` — обычный слайд

```yaml
- title: Результаты эксплуатации
  badge: демо-данные      # чип рядом с заголовком (необязательно)
  gap: 8                  # расстояние между блоками тела, px (по умолчанию 22)
  logo: false             # скрыть логотип в углу
  body:
    - type: chips
      items: [...]
    - type: grid
      items: [...]
```

### `cover` — титульный

```yaml
- template: cover
  title: Результаты применения комплекса
  lead: Подзаголовок
  meta: Сентябрь 2026, команда Palorax
  visual:                 # блок справа (необязательно)
    type: network
    nodes: 7
```

Логотип берётся из `brand.logo` в начале файла.

### `finale` — финальный: кольца, луч, слова по одному

```yaml
- template: finale
  caption: Комплекс контроля микроклимата   # мелкая надпись сверху
  title: Спасибо за внимание
  lead: Готовы ответить на вопросы
  link:
    label: Сайт проекта
    url: https://example.com/     # QR-код строится из этой ссылки автоматически
    text: example.com             # необязательно: по умолчанию url без https://
    qr: true                      # false — без QR-кода
  buttons:                        # кнопки с подписью, которая выезжает при наведении
    - icon: mail
      label: Почта
      url: mailto:hello@example.com   # без url кнопка просто показывает подпись
```

### `space` — «космический» финальный, всегда тёмный

Те же поля, что у `finale`, плюс `badge` — надпись в «пилюле» над логотипом. Звёзды слегка сдвигаются за мышью.

---

## Раскладка

### `grid` — сетка

```yaml
type: grid
columns: 1.6fr 1fr    # CSS grid или число колонок: 3
rows: 1fr 1fr         # необязательно
gap: 20               # px, по умолчанию 22
height: 540           # px, по умолчанию по содержимому
align: center         # start | center | end | stretch
items:
  - type: tile
    rows: 2           # элемент занимает 2 строки
    cols: 1           # или несколько колонок
```

### `stack` — столбик

```yaml
type: stack
gap: 16
items: [...]
```

### `text`, `note`, `list`, `spacer`

```yaml
- type: text
  text: Обычный абзац. **Жирный** тоже можно.
  size: lead          # lead — крупнее, small — мелко и серым
- type: note
  text: Мелкая серая подпись
- type: list
  items: [Пункт один, Пункт два]
- type: spacer
  size: 24
```

### `image` — картинка

```yaml
type: image
src: ./assets/photo.jpg   # файл рядом с deck.yaml
fit: cover                # cover — заполнить, contain — вписать целиком
caption: Подпись
```

---

## Карточки и данные

### `card`

```yaml
type: card
title: Эксплуатация
text: Абзац под заголовком (необязательно)
body:                  # любые блоки внутри
  type: kv
  rows: ...
```

### `panel` — выделенная панель с ячейками

```yaml
type: panel
title: Серверный ПК, Proxmox
columns: 2
cells:
  - title: GitLab
    sub: репозитории и CI
  - Redis                 # ячейка без подписи — просто строка
  - title: HashiCorp Vault
    cols: 2               # на всю ширину
```

### `kv` — «ключ — значение»

```yaml
type: kv
keyWidth: 110            # ширина колонки ключей, px
rows:
  Доступ: TLS с self-signed сертификатами
  Секреты: хранятся в Vault, не в коде
```

### `chips` — ряд чипов

```yaml
type: chips
items: [24 устройства в работе, "Сообщений: 3,4 млн", Важное*]
```

Звёздочка в конце выделяет чип. Если в тексте есть двоеточие с пробелом, возьмите его в кавычки.

### `progress` — прогресс-бар, заполняется при открытии слайда

```yaml
type: progress
label: Версия 1.4.2
value: 24 из 24 устройств
percent: 100
```

### `sliders` — настройки с ползунками

```yaml
type: sliders
rows:
  - label: Интервал отправки
    value: 60 с
    position: 0.74        # положение ползунка от 0 до 1
```

---

## Живая графика

### `network` — схема сети с бегущими импульсами

```yaml
type: network
nodes: 7                  # число устройств вокруг станции
```

### `hub` — список итогов и схема вокруг логотипа

Наведение на пункт подсвечивает узел схемы, и наоборот.

```yaml
type: hub
items:
  - title: Собран рабочий комплекс      # пункт списка
    text: Пояснение под пунктом
    node: Оборудование                  # подпись узла (по умолчанию title)
    sub: устройства и станция           # мелкая подпись узла
```

Для 4 пунктов узлы стоят слева, сверху, справа и снизу, для другого числа — по кругу.

### `tile` — плитка с иллюстрацией или фото

```yaml
type: tile
illustration: assembly    # встроенные: assembly, endpoints, station (с мигающими индикаторами)
image: ./assets/photo.jpg # или своё фото вместо иллюстрации
fit: cover
caption: Комплекс в сборке
```

### `system` — схема «Из чего состоит система»

Оборудование → сервер и базы данных → интерфейсы, внизу серверный ПК. По проводам бегут импульсы, наведение на блок подсвечивает связанные с ним.

```yaml
type: system
hardware:
  title: Оборудование
  flow:                   # цепочка, соединённая импульсом
    - { icon: sensor, title: Оконечные устройства, text: Собирают данные }
    - { icon: station, title: Базовая станция, text: Приём данных }
  items:                  # компактные пункты под цепочкой
    - { icon: chip, title: Прошивки, chips: [C*, C++*] }
server:
  title: Сервер
  text: Управление сетью
  groups:
    - { label: Backend, chips: [Go*, REST API] }
database:
  title: Базы данных
  text: Хранение и история
  chips: [PostgreSQL*, Redis*]
interfaces:
  title: Интерфейсы
  items:
    - { icon: browser, title: Лендинг, text: Сайт проекта }
host:
  title: Серверный ПК
  chips: [Proxmox*, GitLab*]
```

### `pipeline` — шаги, которые подсвечиваются по очереди

```yaml
type: pipeline
stepSeconds: 1            # сколько секунд горит каждый шаг
steps:
  - title: Коммит
    sub: GitLab
```

### `line-chart` — график, который прорисовывается

```yaml
type: line-chart
values: [53501, 53906, 57302, ...]
start: начало эксплуатации   # подпись слева под осью
end: сегодня                 # подпись справа
scale: 1000                  # делитель подписей оси (по умолчанию 1000 для больших чисел)
unit: тыс
min: 42000                   # границы оси (необязательно)
max: 67000
```

### `uptime` — полоса доступности по дням

```yaml
type: uptime
threshold: 99.5           # дни ниже порога бледнее
values: [99.66, 99.7, 98.83, ...]
```

### `bars` — столбцы, вырастающие по очереди

```yaml
type: bars
values: [1.9, 1.7, 1.6, 1.4]
labels: [Янв, Фев, Мар, Апр]   # необязательно
max: 2                         # значение для полной высоты
height: 100
```

---

## Иконки

Для полей `icon`: `sensor`, `station`, `chip`, `tool`, `browser`, `sliders`, `chart`, `mail`, `link`, `phone`, `check`, `presenter`, `grid`. Список и сами иконки лежат в `src/components/icons.ts`.
