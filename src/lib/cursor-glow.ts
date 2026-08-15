/** 光标水色光晕：pointermove 驱动 CSS 变量，rAF 节流 */

export function initCursorGlow(glow: HTMLElement): void {
  if (
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return;
  }

  let raf = 0;
  window.addEventListener(
    'pointermove',
    (e) => {
      cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        glow.style.setProperty('--gx', `${e.clientX}px`);
        glow.style.setProperty('--gy', `${e.clientY}px`);
        document.body.classList.add('has-glow');
      });
    },
    { passive: true },
  );

  document.documentElement.addEventListener('pointerleave', () => {
    document.body.classList.remove('has-glow');
  });
}
