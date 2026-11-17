import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';

import { mountAvatarAscii } from './lib/ascii-avatar';
import { NAME_ART } from './lib/name-art';

function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
}

/** NAIMIO 大字：逐行插入 span，靠 CSS animation-delay 做错位淡入 */
function renderNameArt(): void {
  const host = $('.name-art-lines');
  const frag = document.createDocumentFragment();
  NAME_ART.forEach((line, i) => {
    const span = document.createElement('span');
    span.textContent = line;
    span.style.animationDelay = `${120 + i * 70}ms`;
    frag.append(span);
  });
  host.append(frag);
}

const canvas = document.querySelector<HTMLCanvasElement>('.ascii-canvas');
if (!canvas) throw new Error('missing element: .ascii-canvas');

renderNameArt();

mountAvatarAscii({
  canvas,
  imageSrc: `${import.meta.env.BASE_URL}avatar.png`,
  maxCols: 140,
  frameMs: 80,
  noise: 0.05,
  gamma: 1,
});
