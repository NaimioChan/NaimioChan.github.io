import './styles/tokens.css';
import './styles/base.css';
import './styles/name-art.css';
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

/**
 * 按容器宽度反算字号：先量出字符画在当前字体下每 1px 字号对应的宽度，
 * 再缩放铺满可用宽度。这样即使字体回退成别的度量，也不会溢出或裁掉。
 */
function fitNameArt(): void {
  const host = $('.name-art');
  const side = host.parentElement;
  if (!side) return;
  const available = side.clientWidth;
  if (available <= 0) return;

  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return;
  probe.font = `100px ${getComputedStyle(host).fontFamily}`;
  // 用最长的一行做基准，量出 1px 字号下的宽度
  const longest = NAME_ART.reduce((a, b) => (b.length > a.length ? b : a), '');
  const perPx = probe.measureText(longest).width / 100;
  if (!(perPx > 0)) return;

  const size = Math.min(17, Math.max(4, available / perPx));
  host.style.fontSize = `${size.toFixed(2)}px`;
}

const canvas = document.querySelector<HTMLCanvasElement>('.ascii-canvas');
if (!canvas) throw new Error('missing element: .ascii-canvas');

renderNameArt();
fitNameArt();

// 字体异步下载，就绪后再量一次，避免用回退字体的宽度算错
void document.fonts.ready.then(fitNameArt);
document.fonts.addEventListener('loadingdone', fitNameArt);

const sideEl = $('.name-art').parentElement;
if (sideEl) new ResizeObserver(fitNameArt).observe(sideEl);
window.addEventListener('resize', fitNameArt);
// 手机横竖屏切换后布局会变，字号要跟着重算
window.addEventListener('orientationchange', fitNameArt);

mountAvatarAscii({
  canvas,
  imageSrc: `${import.meta.env.BASE_URL}avatar.png`,
  maxCols: 140,
  frameMs: 80,
  noise: 0.05,
  gamma: 1,
});
