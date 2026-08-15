/** 明暗主题：localStorage 持久化 + View Transitions 圆形扩散过渡 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'aqua-theme';
const META_COLORS: Record<Theme, string> = { light: '#e9f1f3', dark: '#0e1c21' };

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* localStorage 不可用时回退 */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(t: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = t;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', META_COLORS[t]);
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* 忽略 */
  }
}

export function setTheme(t: Theme, origin?: { x: number; y: number }): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };

  if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const x = origin ? `${((origin.x / window.innerWidth) * 100).toFixed(1)}%` : '50%';
    const y = origin ? `${((origin.y / window.innerHeight) * 100).toFixed(1)}%` : '50%';
    document.documentElement.style.setProperty('--vt-x', x);
    document.documentElement.style.setProperty('--vt-y', y);
    doc.startViewTransition(() => applyTheme(t));
  } else {
    applyTheme(t);
  }
}

export function initTheme(toggle: HTMLElement): void {
  setTheme(getTheme());
  toggle.addEventListener('click', (e) => {
    const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    setTheme(next, { x: e.clientX, y: e.clientY });
  });
}
