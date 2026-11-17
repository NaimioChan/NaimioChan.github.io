/**
 * ASCII 渲染核心：纯函数，无 DOM 依赖，可单测。
 * 负责「亮度矩阵 → 字符」的映射、确定性伪随机与扫描带位置。
 */

export const DEFAULT_RAMP = ' .:-=+*#%@';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** sRGB 三通道 → 相对亮度 0..1（感知权重） */
export function relativeLuminance(r: number, g: number, b: number): number {
  return clamp01((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
}

/** 对比度整形：按 black/white 归一化后取 gamma */
export function adjustLum(v: number, gamma = 1, black = 0, white = 1): number {
  const span = Math.max(1e-6, white - black);
  return Math.pow(clamp01((v - black) / span), gamma);
}

/** 亮度 → 字符（ramp 从暗到亮） */
export function charForLum(lum: number, ramp: string = DEFAULT_RAMP): string {
  const n = ramp.length - 1;
  return ramp[Math.min(n, Math.max(0, Math.round(clamp01(lum) * n)))];
}

export interface AsciiGrid {
  cols: number;
  rows: number;
  /** 行优先亮度，长度 cols*rows */
  lum: Float32Array;
}

export function buildGrid(
  sample: ArrayLike<number>,
  cols: number,
  rows: number,
  opts: { gamma?: number; black?: number; white?: number } = {},
): AsciiGrid {
  const { gamma = 1, black = 0, white = 1 } = opts;
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < lum.length; i++) lum[i] = adjustLum(sample[i] ?? 0, gamma, black, white);
  return { cols, rows, lum };
}

/** 确定性哈希：同样的 (x,y,seed) 永远得到同样的 [0,1) 随机数 */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 扫描带中心所在行（随时间下移并循环，可越出上下边界） */
export function scanRow(t: number, rows: number, speed: number): number {
  const span = rows + 10;
  const pos = (((t / 1000) * speed) % span + span) % span;
  return pos - 5;
}

/** 圆形蒙版：超出半径的部分按羽化衰减，用于让头像边缘渐隐 */
export function circleMask(
  x: number,
  y: number,
  cols: number,
  rows: number,
  radiusRatio = 0.52,
  featherRatio = 0.12,
): number {
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const radius = Math.min(cols, rows) * radiusRatio;
  const feather = Math.max(1e-6, Math.min(cols, rows) * featherRatio);
  const d = Math.hypot(x - cx, y - cy);
  if (d <= radius) return 1;
  if (d >= radius + feather) return 0;
  return 1 - (d - radius) / feather;
}

/** 三点线性插值配色：0 → 暗，0.5 → 中，1 → 亮 */
export function mixStops(lum: number, stops: readonly [string, string, string]): string {
  const t = clamp01(lum);
  const parse = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const a = parse(stops[0]);
  const b = parse(stops[1]);
  const c = parse(stops[2]);
  const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const from = t < 0.5 ? a : b;
  const to = t < 0.5 ? b : c;
  const r = Math.round(from[0] + (to[0] - from[0]) * k);
  const g = Math.round(from[1] + (to[1] - from[1]) * k);
  const bl = Math.round(from[2] + (to[2] - from[2]) * k);
  return `rgb(${r},${g},${bl})`;
}
