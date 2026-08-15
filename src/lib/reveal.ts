/** 滚动入场：IntersectionObserver 为 .reveal 添加 .in，支持 stagger（CSS --d） */

export function initReveal(root: ParentNode = document): void {
  const els = [...root.querySelectorAll<HTMLElement>('.reveal')];
  if (els.length === 0) return;

  if (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    !('IntersectionObserver' in window)
  ) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
  );

  els.forEach((el) => io.observe(el));
}
