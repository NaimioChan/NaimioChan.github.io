import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/motion.css';

import { WaterAudio } from './audio/water-audio';
import { initBubbles } from './lib/bubbles';
import { initCursorGlow } from './lib/cursor-glow';
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

// ── 水声引擎：每次涟漪一个音，五声音阶轮转 ──
const water = new WaterAudio();
let noteIndex = 0;

initTheme($('.theme-toggle'));
initReveal();
initTilt();
initProgress($('.scroll-progress'));
initCursorGlow($('.cursor-glow'));
initBubbles($('.bubbles'));
initRipple($('.ripple-layer'), () => water.drop(noteIndex++));

// ── 打字机副标题（单句，打完保持） ──
new Typewriter(
  $('.type-text'),
  ['Discover the sounds.'],
  { typeMs: 110, deleteMs: 45, holdMs: 400, loop: false },
).start();

// ── 水声开关 ──
const soundBtn = $('.sound-toggle') as HTMLButtonElement;
soundBtn.addEventListener('click', () => {
  const next = !water.enabled;
  water.setEnabled(next);
  soundBtn.setAttribute('aria-pressed', String(next));
  if (next) water.drop(noteIndex++); // 开启时给一声反馈
});
