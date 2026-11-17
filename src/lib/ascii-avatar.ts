/**
 * 头像 ASCII 渲染：把 avatar.png 采样成字符矩阵，逐帧加噪点 / 扫描带 / 横向撕裂。
 * 采样、字符映射与配色在 ascii-core 里；这里只负责 canvas 绘制与生命周期。
 */

import { buildGrid, charForLum, circleMask, hash2, mixStops, scanRow, type AsciiGrid } from './ascii-core';

const RAMP = ' .:-=+*#%@';

/** 三档配色：暗 → 中 → 亮（Tokyo Night 的灰蓝 / 蓝 / 亮青） */
const STOPS = ['#3b4261', '#7aa2f7', '#a9dcff'] as const;

/** 单字符宽高比：等宽字体的字符大约 0.6 宽 */
const CELL_RATIO = 0.6;

export interface AvatarAsciiOptions {
  canvas: HTMLCanvasElement;
  imageSrc: string;
  /** 字符列数上限 */
  maxCols?: number;
  /** 帧间隔（毫秒），越大越省电 */
  frameMs?: number;
  gamma?: number;
  /** 反锐化强度，0 表示关闭（默认 1.6） */
  sharpen?: number;
  /** 每格随机抖动概率 0..1 */
  noise?: number;
}

export interface AvatarAsciiHandle {
  destroy(): void;
}

/** 把图片按 cols × rows 采样成亮度矩阵，边缘按圆形蒙版渐隐 */
function sampleImage(img: HTMLImageElement, cols: number, rows: number, sharpen: number): Float32Array {
  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const octx = off.getContext('2d', { willReadFrequently: true });
  if (!octx) throw new Error('2d context unavailable');
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(img, 0, 0, cols, rows);
  const data = octx.getImageData(0, 0, cols, rows).data;
  const raw = new Float32Array(cols * rows);
  const mask = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const p = i * 4;
      const alpha = data[p + 3] / 255;
      const l = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
      mask[i] = circleMask(x, y, cols, rows) * alpha;
      raw[i] = l;
    }
  }

  // 反锐化：原图缩到几十列后细节会糊成一片，用 3x3 均值当低频，差分成高频加回去
  const blurred = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= rows || xx < 0 || xx >= cols) continue;
          sum += raw[yy * cols + xx];
          n++;
        }
      }
      blurred[y * cols + x] = sum / n;
    }
  }
  if (sharpen > 0) {
    for (let i = 0; i < raw.length; i++) raw[i] = Math.min(1, Math.max(0, raw[i] + (raw[i] - blurred[i]) * sharpen));
  }

  // 自动色阶：只统计圆内的像素，取分位当作黑白点，避免头像偏暗糊成一团
  const inside: number[] = [];
  for (let i = 0; i < raw.length; i++) if (mask[i] > 0.6) inside.push(raw[i]);
  inside.sort((a, b) => a - b);
  const pick = (q: number): number =>
    inside[Math.min(inside.length - 1, Math.max(0, Math.round((inside.length - 1) * q)))] ?? 0;
  const lo = inside.length ? pick(0.02) : 0;
  const hi = inside.length ? Math.max(lo + 0.05, pick(0.98)) : 1;

  const out = new Float32Array(cols * rows);
  for (let i = 0; i < raw.length; i++) out[i] = Math.min(1, Math.max(0, (raw[i] - lo) / (hi - lo))) * mask[i];
  return out;
}

export function mountAvatarAscii(opts: AvatarAsciiOptions): AvatarAsciiHandle {
  const { canvas, imageSrc } = opts;
  const maxCols = opts.maxCols ?? 140;
  const frameMs = opts.frameMs ?? 80;
  const noise = opts.noise ?? 0.05;

  const got = canvas.getContext('2d');
  if (!got) throw new Error('2d context unavailable');
  const ctx: CanvasRenderingContext2D = got;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let grid: AsciiGrid | null = null;
  let cellW = 0;
  let cellH = 0;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  let start = 0;
  let disposed = false;

  const image = new Image();
  image.decoding = 'async';

  /** 依据容器尺寸决定列数，重算采样矩阵与画布像素尺寸 */
  function layout(): void {
    if (!image.complete || image.naturalWidth === 0) return;
    const host = canvas.parentElement ?? canvas;
    const cssW = Math.max(180, host.clientWidth);
    const cssH = Math.max(180, host.clientHeight || cssW);

    // 目标字符宽度约 4px：格数越多细节越清楚，但过小会糊成噪点
    const cols = Math.min(maxCols, Math.max(32, Math.round(cssW / 4)));
    cellW = cssW / cols;
    cellH = cellW / CELL_RATIO;
    const rows = Math.max(16, Math.round(cols * (cssH / cssW) * CELL_RATIO));

    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(cols * cellW * dpr);
    canvas.height = Math.round(rows * cellH * dpr);
    canvas.style.width = `${cssW.toFixed(1)}px`;
    canvas.style.height = `${(rows * cellH).toFixed(1)}px`;

    grid = buildGrid(sampleImage(image, cols, rows, opts.sharpen ?? 1.6), cols, rows, {
      gamma: opts.gamma ?? 1,
      black: 0,
      white: 1,
    });
  }

  /** 绘制一帧：按颜色分桶后批量 fillText，避免逐字切 fillStyle */
  function draw(t: number): void {
    if (!grid) return;
    const { cols, rows, lum } = grid;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cols * cellW, rows * cellH);
    ctx.font = `${(cellH * 0.98).toFixed(2)}px "JetBrains Mono", "Cascadia Mono", Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const reveal = reduced ? 1 : Math.min(1, (t - start) / 900);
    const revealRow = reveal * (rows + 3) - 2;
    const band = scanRow(t, rows, 9);
    const frameIdx = Math.floor(t / 90);

    const buckets = new Map<string, string[]>();
    const put = (color: string, x: number, y: number, ch: string): void => {
      const cell = `${x.toFixed(1)},${y.toFixed(1)},${ch}`;
      const list = buckets.get(color);
      if (list) list.push(cell);
      else buckets.set(color, [cell]);
    };

    for (let y = 0; y < rows; y++) {
      if (y > revealRow + 1) continue;

      // 偶发整行错位，模拟信号撕裂
      const tear = hash2(y, frameIdx, 41);
      const shift =
        tear < 0.02 ? (hash2(y, frameIdx, 67) < 0.5 ? -1 : 1) * (1 + Math.floor(hash2(y, frameIdx, 83) * 3)) : 0;

      for (let x = 0; x < cols; x++) {
        const sx = Math.min(cols - 1, Math.max(0, x + shift));
        let v = lum[y * cols + sx];

        // 扫描带：经过的行整体提亮
        const d = Math.abs(y - band);
        if (d < 2.4) v = Math.min(1, v * (0.8 + 0.45 * (1 - d / 2.4)) + 0.1 * (1 - d / 2.4));

        // 揭示边缘额外抖动
        const edgeBoost = y > revealRow - 1 ? 0.85 : 0;
        const jitter = hash2(x + shift * 13, y, 101 + frameIdx * 137);
        const ch =
          jitter < Math.min(0.9, noise + edgeBoost)
            ? RAMP[Math.floor(hash2(x + 5, y + 2, 211 + frameIdx * 173) * RAMP.length)]
            : charForLum(v, RAMP);
        if (ch === ' ') continue;

        put(mixStops(v, STOPS), x * cellW + cellW / 2, y * cellH + cellH / 2, ch);
      }
    }

    for (const [color, cells] of buckets) {
      ctx.fillStyle = color;
      for (const cell of cells) {
        const first = cell.indexOf(',');
        const second = cell.indexOf(',', first + 1);
        ctx.fillText(cell.slice(second + 1), Number(cell.slice(0, first)), Number(cell.slice(first + 1, second)));
      }
    }
  }

  function loop(t: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (t - last < frameMs) return;
    last = t;
    draw(t);
  }

  function onResize(): void {
    layout();
    if (reduced) draw(start + 2000);
  }

  function ready(): void {
    if (disposed) return;
    layout();
    start = performance.now();
    if (reduced) {
      draw(start + 2000);
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  if (image.complete && image.naturalWidth > 0) ready();
  else image.addEventListener('load', ready, { once: true });
  image.src = imageSrc;

  const ro = new ResizeObserver(onResize);
  ro.observe(canvas.parentElement ?? canvas);

  return {
    destroy(): void {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    },
  };
}
