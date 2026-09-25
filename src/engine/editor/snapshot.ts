// Первый импорт main.ts: снимок исходной разметки до любых изменений страницы.
// Из него режим правки собирает сохранённую копию HTML-файла.
import { captureSnapshot } from './persist';

captureSnapshot();
