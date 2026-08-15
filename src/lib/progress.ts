/** 顶部滚动进度条：rAF 节流的 scroll 监听 */

export function initProgress(bar: HTMLElement): void {
  let ticking = false;

  const update = (): void => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = max > 0 ? `${(window.scrollY / max) * 100}%` : '0%';
    ticking = false;
  };

  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  update();
}
