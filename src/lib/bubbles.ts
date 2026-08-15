/** 背景气泡：随机尺寸/位置/时长的上升气泡，负 delay 让画面开局即分布 */

export function initBubbles(container: HTMLElement, count = 14): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const b = document.createElement('span');
    b.className = 'bubble';
    const size = 6 + Math.random() * 16;
    b.style.width = `${size}px`;
    b.style.height = `${size}px`;
    b.style.left = `${(Math.random() * 100).toFixed(2)}%`;
    b.style.setProperty('--bx', `${(Math.random() - 0.5) * 90}px`);
    b.style.animationDuration = `${(14 + Math.random() * 18).toFixed(1)}s`;
    b.style.animationDelay = `${(-Math.random() * 30).toFixed(1)}s`;
    frag.appendChild(b);
  }
  container.appendChild(frag);
}
