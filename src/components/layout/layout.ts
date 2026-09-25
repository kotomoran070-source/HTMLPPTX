import { defineBlock } from '../../engine/component';
import { asArray, esc, styleAttr, t } from '../../engine/html';
import type { Block } from '../../types';
import './layout.css';

interface GridItem extends Block {
  /** Сколько колонок / строк занимает элемент сетки */
  cols?: number;
  rows?: number;
}

interface GridProps extends Block {
  /** Колонки в синтаксисе CSS grid: "1fr 1fr", "1.6fr 1fr" или число колонок */
  columns?: string | number;
  rows?: string;
  gap?: number;
  /** Высота сетки в пикселях (по умолчанию по содержимому) */
  height?: number;
  /** Выравнивание элементов по вертикали: start | center | end | stretch */
  align?: string;
  items: GridItem[];
}

/** Сетка: раскладывает блоки по колонкам. */
defineBlock<GridProps>('grid', {
  render(p, ctx) {
    const cols = typeof p.columns === 'number' ? `repeat(${p.columns}, 1fr)` : p.columns ?? '1fr 1fr';
    const css = [
      `grid-template-columns:${cols}`,
      p.rows && `grid-template-rows:${p.rows}`,
      p.gap != null && `gap:${p.gap}px`,
      p.height && `height:${p.height}px`,
      p.align && `align-items:${p.align}`,
      p.style,
    ];
    const items = asArray(p.items).map((it) => {
      const span = [
        it.cols && `grid-column:span ${it.cols}`,
        it.rows && `grid-row:span ${it.rows}`,
      ];
      return `<div class="gi"${styleAttr(...span)}>${ctx.block(it)}</div>`;
    });
    return `<div class="grid"${styleAttr(...css)}>${items.join('')}</div>`;
  },
});

interface StackProps extends Block {
  gap?: number;
  items: Block[];
}

/** Столбик: блоки друг под другом. */
defineBlock<StackProps>('stack', {
  render(p, ctx) {
    return `<div class="stack"${styleAttr(p.gap != null && `gap:${p.gap}px`, p.style)}>${ctx.block(p.items)}</div>`;
  },
});

interface TextProps extends Block {
  text: string;
  size?: 'lead' | 'small' | 'normal';
}

/** Абзац текста. **жирный** и переносы строк поддерживаются. */
defineBlock<TextProps>('text', {
  render(p) {
    const cls = p.size === 'lead' ? 'lead' : p.size === 'small' ? 'mu' : '';
    return `<p class="${cls}"${styleAttr(p.style)}>${t(p.text)}</p>`;
  },
});

/** Мелкая приглушённая подпись. */
defineBlock<TextProps>('note', {
  render(p) {
    return `<p class="mu note"${styleAttr(p.style)}>${t(p.text)}</p>`;
  },
});

interface ListProps extends Block {
  items: string[];
}

defineBlock<ListProps>('list', {
  render(p) {
    return `<ul class="list"${styleAttr(p.style)}>${asArray(p.items).map((i) => `<li>${t(i)}</li>`).join('')}</ul>`;
  },
});

interface ImageProps extends Block {
  src: string;
  alt?: string;
  fit?: 'cover' | 'contain';
  caption?: string;
}

/** Картинка из папки презентации: src: ./assets/photo.jpg */
defineBlock<ImageProps>('image', {
  render(p) {
    const img = `<img src="${esc(p.src)}" alt="${esc(p.alt ?? p.caption ?? '')}" style="object-fit:${p.fit ?? 'cover'}">`;
    const cap = p.caption ? `<figcaption class="mu">${t(p.caption)}</figcaption>` : '';
    return `<figure class="image r"${styleAttr(p.style)}>${img}${cap}</figure>`;
  },
});

interface SpacerProps extends Block { size?: number }

defineBlock<SpacerProps>('spacer', {
  render(p) {
    return `<div style="height:${p.size ?? 16}px"></div>`;
  },
});
