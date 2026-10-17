// Временная копия презентаций для автотестов: .tmp/test-decks
//   tpl      — стартовый шаблон, как «Новая презентация → с примерами»;
//   slideria — витрина из проекта (только чтение);
//   morph    — два слайда с переходом «Морф»;
//   schemes  — новые блоки-схемы (tests/e2e/schemes.yaml);
//   design   — стартовый шаблон для вкладки «Дизайн»;
//   math     — пустой слайд для формул;
//   find     — поиск по тексту и коду;
//   save     — сохранение: контрольные точки, два окна одной презентации;
//   table    — таблица (ячейки, как в PowerPoint) и фигуры для порядка «вперёд / назад»;
//   origin   — как после импорта из PowerPoint: цвета файла и тема «Как в файле»;
//   audio    — вставка, которой нужен микрофон (аудиовизуализатор): рамка со своего адреса;
//   tidy     — ошибки для «Привести в порядок»: копия поверх, ссылки в никуда, скрытое без кнопки;
//   mirror   — мышь докладчика у зрителей: кнопки, ссылки, переход, прожектор, наведение.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.tmp', 'test-decks');
fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(path.join(root, '.tmp', 'test-fonts'), { recursive: true, force: true });
fs.rmSync(path.join(root, '.tmp', 'test-library'), { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

fs.cpSync(path.join(root, 'templates', 'basic'), path.join(dir, 'tpl'), { recursive: true });
const file = path.join(dir, 'tpl', 'deck.yaml');
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('{{title}}', 'Тестовая презентация'));
fs.cpSync(path.join(root, 'presentations', 'slideria'), path.join(dir, 'slideria'), { recursive: true });
// morph — два слайда с переходом «Морф»: заголовок (пара по тексту) и фигура (пара по имени), на втором — повёрнута
fs.mkdirSync(path.join(dir, 'morph'));
fs.writeFileSync(path.join(dir, 'morph', 'deck.yaml'), `title: Морф
slides:
  - template: canvas
    free:
      - {type: text, text: "Архитектура", styles: {text: {size: 64}}, place: {x: 80, y: 280, w: 700}}
      - {type: shape, id: box, kind: round, fill: "#2563EB", place: {x: 900, y: 120, w: 200, h: 200}}
  - template: canvas
    transition: morph
    free:
      - {type: text, text: "Архитектура", styles: {text: {size: 40}}, place: {x: 60, y: 40, w: 600}}
      - {type: shape, id: box, kind: round, fill: "#DC2626", angle: 30, place: {x: 200, y: 260, w: 700, h: 300}}
`);
// design — стартовый шаблон для вкладки «Дизайн» (темы меняют всю презентацию)
fs.cpSync(path.join(root, 'templates', 'basic'), path.join(dir, 'design'), { recursive: true });
const dfile = path.join(dir, 'design', 'deck.yaml');
// В конце — титул шаблоном cover с живым фоном: его разбирают на объекты
fs.writeFileSync(dfile, `${fs.readFileSync(dfile, 'utf8').replaceAll('{{title}}', 'Темы').trimEnd()}
  - id: classic
    template: cover
    backdrop: aurora
    title: Титул шаблоном
    lead: Разбирается на объекты
`);
// schemes — новые блоки-схемы, по слайду на каждый
fs.mkdirSync(path.join(dir, 'schemes'));
fs.copyFileSync(path.join(root, 'tests', 'e2e', 'schemes.yaml'), path.join(dir, 'schemes', 'deck.yaml'));
// math — пустой слайд: формулы вставляются из «Вставка → Уравнение»
fs.mkdirSync(path.join(dir, 'math'));
fs.writeFileSync(path.join(dir, 'math', 'deck.yaml'), `title: Формулы
slides:
  - template: canvas
    free: []
  - template: canvas
    free:
      - {type: math, tex: "2x + 6 = 10\\n2x = 4\\nx = [[2]]", steps: lines, place: {x: 80, y: 80, w: 440}}
      - {type: math, tex: "(a+b)^2\\n= (a+b)(a+b)", steps: morph, place: {x: 560, y: 120, w: 640}}
  - template: canvas
    free: [{type: text, text: Конец, place: {x: 80, y: 80, w: 400}}]
  - template: canvas
    free:
      - {type: control, name: a, label: Амплитуда, min: 0.5, max: 3, step: 0.5, value: 1, place: {x: 60, y: 420, w: 360}}
      - {type: math, tex: "y = a sin x", place: {x: 60, y: 180, w: 480}}
      - {type: math, tex: "F = m*a", place: {x: 60, y: 40, w: 300}}
  - template: canvas
    free:
      - {type: text, text: Заголовок, place: {x: 60, y: 40, w: 600}}
      - {type: card, title: Второй, click: true, delay: 300, place: {x: 480, y: 200, w: 340}}
      - {type: card, title: Первый, click: true, place: {x: 60, y: 200, w: 340}}
`);
// find — поиск: текст на трёх слайдах и в заметках, цвет — только в коде (YAML и стили)
fs.mkdirSync(path.join(dir, 'find'));
fs.writeFileSync(path.join(dir, 'find', 'deck.yaml'), `title: Поиск
css: |
  .free { border-color: #2563EB; }
slides:
  - template: canvas
    free:
      - {type: text, text: Альфа и бета, place: {x: 80, y: 80, w: 500}}
  - template: canvas
    notes: бета в заметках
    free:
      - {type: text, text: Бета, place: {x: 80, y: 80, w: 500}}
      - {type: shape, kind: round, fill: "#2563EB", place: {x: 640, y: 80, w: 200, h: 200}}
  - template: canvas
    free:
      - {type: card, title: Гамма, text: бета-версия, place: {x: 80, y: 80, w: 400}}
`);
// save — два слайда без заметок
fs.mkdirSync(path.join(dir, 'save'));
fs.writeFileSync(path.join(dir, 'save', 'deck.yaml'), `title: Сохранение
slides:
  - template: canvas
    free:
      - {type: text, text: Первый, place: {x: 80, y: 80, w: 500}}
  - template: canvas
    free:
      - {type: text, text: Второй, place: {x: 80, y: 80, w: 500}}
`);
// table — слайды 1, 2, 5, 6 и 7: одинаковые таблицы (ячейки, клавиши), 3: пустой (вставка из Excel),
// 4: фигуры для порядка — back и top перекрываются, mid и far в стороне
fs.mkdirSync(path.join(dir, 'table'));
fs.writeFileSync(path.join(dir, 'table', 'deck.yaml'), `title: Таблица
slides:
  - template: canvas
    free:
      - type: table
        header: [Показатель, План, Факт]
        rows:
          - [Выручка, "100", "120"]
          - [Расходы, "80", "70"]
          - [Прибыль, "20", "50"]
        place: {x: 80, y: 80, w: 700}
  - template: canvas
    free:
      - type: table
        header: [Показатель, План, Факт]
        rows:
          - [Выручка, "100", "120"]
          - [Расходы, "80", "70"]
          - [Прибыль, "20", "50"]
        place: {x: 80, y: 80, w: 700}
  - template: canvas
    free: []
  - template: canvas
    free:
      - {type: shape, id: back, kind: rect, fill: "#2563EB", place: {x: 900, y: 400, w: 200, h: 200}}
      - {type: shape, id: mid, kind: rect, fill: "#CA8A04", place: {x: 80, y: 80, w: 200, h: 200}}
      - {type: shape, id: far, kind: rect, fill: "#16A34A", place: {x: 1100, y: 40, w: 100, h: 100}}
      - {type: shape, id: top, kind: rect, fill: "#DC2626", place: {x: 950, y: 450, w: 200, h: 200}}
  - template: canvas
    free:
      - type: table
        header: [Показатель, План, Факт]
        rows:
          - [Выручка, "100", "120"]
          - [Расходы, "80", "70"]
          - [Прибыль, "20", "50"]
        place: {x: 80, y: 80, w: 700}
  - template: canvas
    free:
      - type: table
        header: [Показатель, План, Факт]
        rows:
          - [Выручка, "100", "120"]
          - [Расходы, "80", "70"]
          - [Прибыль, "20", "50"]
        place: {x: 80, y: 80, w: 700}
  - template: canvas
    free:
      - type: table
        header: [Показатель, План, Факт]
        rows:
          - [Выручка, "100", "120"]
          - [Расходы, "80", "70"]
          - [Прибыль, "20", "50"]
        place: {x: 80, y: 80, w: 700}
`);
// origin — как после импорта PowerPoint: цвета файла в слайдах, их палитра и тема «Как в файле»
fs.mkdirSync(path.join(dir, 'origin'));
fs.writeFileSync(path.join(dir, 'origin', 'deck.yaml'), `title: Импорт
theme:
  preset: file
  accent: "#3C388D"
  mode: light
  light: {bg: "#FFFFFF", tx: "#000000"}
  font: Arial
  bg: plain
origin:
  bg: "#FFFFFF"
  tx: "#000000"
  accents: ["#3C388D"]
  colors: ["#3C388D", "#000000", "#FFFFFF"]
  theme:
    accent: "#3C388D"
    mode: light
    light: {bg: "#FFFFFF", tx: "#000000"}
    font: Arial
    bg: plain
slides:
  - template: canvas
    free:
      - {type: text, text: "Цели проекта", styles: {text: {size: 40, color: "#3C388D", weight: 700}}, place: {x: 60, y: 60, w: 900}}
      - {type: shape, id: bar, kind: rect, fill: "#3C388D", width: 0, place: {x: 1100, y: 660, w: 180, h: 60}}
`);
// audio — вставка просит микрофон, а заодно пробует дотянуться до студии и её команд
fs.mkdirSync(path.join(dir, 'audio'));
fs.writeFileSync(path.join(dir, 'audio', 'deck.yaml'), `title: Звук
slides:
  - template: canvas
    free:
      - type: embed
        code: |
          <p id="mic">…</p><p id="up">…</p><p id="api">…</p>
          <script>
            navigator.mediaDevices.getUserMedia({ audio: true })
              .then((s) => { mic.textContent = 'микрофон: ' + s.getAudioTracks().length; })
              .catch((e) => { mic.textContent = 'микрофон: ' + e.name; });
            try { up.textContent = 'студия: ' + parent.document.title; } catch (e) { up.textContent = 'студия: ' + e.name; }
            fetch(location.protocol + '//' + document.baseURI.split('/')[2] + '/__htmlpptx/delete?deck=audio', { method: 'POST', mode: 'no-cors' })
              .then(() => { api.textContent = 'команда: отправлена'; }, () => { api.textContent = 'команда: не дошла'; });
          </script>
        place: {x: 40, y: 40, w: 600, h: 240}
`);
// tidy — копия карточки поверх такой же, кнопки на удалённый слайд и объект, скрытое без кнопки
fs.mkdirSync(path.join(dir, 'tidy'));
fs.writeFileSync(path.join(dir, 'tidy', 'deck.yaml'), `title: Порядок
slides:
  - id: one
    template: canvas
    free:
      - {type: shape, kind: round, text: Карточка, place: {x: 100, y: 100, w: 300, h: 120}}
      - {type: shape, kind: round, text: Карточка, place: {x: 100, y: 100, w: 300, h: 120}}
      - {type: text, text: Дальше, action: "slide:gone", place: {x: 100, y: 400, w: 200}}
      - {type: text, text: Открыть, action: "show:lost", place: {x: 400, y: 400, w: 200}}
      - {type: text, id: tip, text: Сюрприз, hidden: true, place: {x: 100, y: 500, w: 200}}
`);
// mirror — что делает щелчок докладчика у зрителей: переключатель, ссылка, «дальше», прожектор, наведение
fs.mkdirSync(path.join(dir, 'mirror'));
fs.writeFileSync(path.join(dir, 'mirror', 'deck.yaml'), `title: Повтор мыши
slides:
  - id: one
    template: canvas
    free:
      - {type: shape, kind: round, text: Переключить, action: "toggle:box", place: {x: 60, y: 60, w: 240, h: 80}}
      - {type: shape, id: box, kind: rect, text: Коробка, place: {x: 60, y: 200, w: 240, h: 120}}
      - {type: shape, kind: round, text: Сайт, action: "https://example.com/", place: {x: 400, y: 60, w: 200, h: 80}}
      - {type: shape, kind: round, text: Дальше, action: next, place: {x: 700, y: 60, w: 200, h: 80}}
      - {type: card, title: Карточка, place: {x: 400, y: 300, w: 400, h: 200}}
      - {type: shape, kind: round, text: Показать, action: "show:tip", place: {x: 900, y: 300, w: 200, h: 80}}
      - {type: shape, id: tip, kind: round, text: Подсказка, hidden: true, place: {x: 900, y: 420, w: 200, h: 80}}
  - id: two
    template: canvas
    free:
      - {type: shape, kind: round, text: Второй, place: {x: 400, y: 300, w: 400, h: 200}}
  - id: three
    title: Вопросы
    body: {type: faq, items: [{title: "Первый вопрос", text: "Ответ один."}, {title: "Второй вопрос", text: "Ответ два."}]}
  - id: four
    template: canvas
    free:
      - type: embed
        interactive: true
        code: |
          <style>html,body{margin:0;height:100%}button{width:100%;height:50%;font:40px sans-serif}</style>
          <div id="n" style="height:50%;font:40px sans-serif">0</div><button id="b">0</button>
          <script>let m = 0, c = 0; addEventListener('mousemove', () => { n.textContent = ++m; }); b.onclick = () => { b.textContent = ++c; };</script>
        place: {x: 200, y: 100, w: 800, h: 500}
`);
console.log('Тестовые презентации:', fs.readdirSync(dir).join(', '));
