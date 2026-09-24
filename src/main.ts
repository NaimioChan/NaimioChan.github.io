import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/motion.css';

import { initProgress } from './lib/progress';
import { initReveal } from './lib/reveal';
import { initRipple } from './lib/ripple';
import { initTheme } from './lib/theme';
import { initTilt } from './lib/tilt';
import { Typewriter } from './lib/typewriter';

function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
}

initTheme($('.theme-toggle'));
initReveal();
initTilt();
initProgress($('.scroll-progress'));
initRipple($('.ripple-layer'));

// ── 作品行：桌面鼠标滚轮转为横向滚动 ──
const workGrid = $('.work-grid');
workGrid.addEventListener(
  'wheel',
  (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      workGrid.scrollLeft += e.deltaY;
    }
  },
  { passive: false },
);

// ── 打字机副标题（单句，打完保持） ──
new Typewriter(
  $('.type-text'),
  ['Discover the sounds.'],
  { typeMs: 110, deleteMs: 45, holdMs: 400, loop: false },
).start();
