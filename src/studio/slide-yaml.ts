import { stringify } from 'yaml';
import type { SlideData } from '../types';

/** Код слайда — ровно как во вкладке «Код»: позиции совпадений поиска в нём те же */
export function slideYaml(s: SlideData | undefined): string {
  return s ? stringify(s, { lineWidth: 0 }) : '';
}
