/** 点击涟漪：全局 pointerdown 在点击处生成扩散圆环，动画结束后移除 */

export function initRipple(layer: HTMLElement, onRipple?: () => void): void {
  let last = 0;

  document.addEventListener(
    'pointerdown',
    (e) => {
      const now = performance.now();
      if (now - last < 90) return; // 节流：连点只留一朵涟漪
      last = now;

      const r = document.createElement('span');
      r.className = 'ripple';
      const size = 56 + Math.random() * 74;
      r.style.width = `${size}px`;
      r.style.height = `${size}px`;
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      layer.appendChild(r);
      onRipple?.();
      r.addEventListener('animationend', () => r.remove());
    },
    { passive: true },
  );
}
