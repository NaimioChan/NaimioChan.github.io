/**
 * 3D 倾斜：指针位置驱动卡片轻微 rotateX/rotateY + 上浮。
 * 用 transform（父容器 perspective 提供景深）；
 * work-card 的滚动入场由 reveal 系统承担，避免与 tilt 冲突。
 */

const MAX_TILT = 8; // 最大倾斜角度
const LIFT = 3; // 悬停上浮像素

export function initTilt(root: ParentNode = document): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const cards = [...root.querySelectorAll<HTMLElement>('[data-tilt]')];
  for (const card of cards) {
    card.addEventListener('pointermove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const rx = (0.5 - py) * MAX_TILT;
      const ry = (px - 0.5) * MAX_TILT;
      card.style.transform =
        `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(${LIFT}px)`;
    });
    card.addEventListener('pointerleave', () => {
      card.style.transform = '';
    });
  }
}
