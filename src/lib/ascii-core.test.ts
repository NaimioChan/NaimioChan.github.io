import { describe, expect, it } from 'vitest';
import {
  adjustLum,
  buildGrid,
  charForLum,
  circleMask,
  hash2,
  mixStops,
  relativeLuminance,
  scanRow,
  DEFAULT_RAMP,
} from './ascii-core';

describe('relativeLuminance', () => {
  it('把纯黑与纯白映射到 0 与 1', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 6);
  });

  it('绿色权重高于蓝色', () => {
    expect(relativeLuminance(0, 255, 0)).toBeGreaterThan(relativeLuminance(0, 0, 255));
  });
});

describe('adjustLum', () => {
  it('black/white 之外的取值被夹到 0..1', () => {
    expect(adjustLum(0.02, 1, 0.1, 0.9)).toBe(0);
    expect(adjustLum(0.98, 1, 0.1, 0.9)).toBe(1);
  });

  it('gamma 大于 1 时整体压暗', () => {
    expect(adjustLum(0.5, 2, 0, 1)).toBeLessThan(0.5);
  });

  it('black 等于 white 时不会产生 NaN', () => {
    expect(Number.isFinite(adjustLum(0.5, 1, 0.5, 0.5))).toBe(true);
  });
});

describe('charForLum', () => {
  it('两端取 ramp 的首尾字符', () => {
    expect(charForLum(0)).toBe(DEFAULT_RAMP[0]);
    expect(charForLum(1)).toBe(DEFAULT_RAMP[DEFAULT_RAMP.length - 1]);
  });

  it('越界输入被夹住而不是返回 undefined', () => {
    expect(charForLum(-3)).toBe(' ');
    expect(charForLum(9)).toBe('@');
  });

  it('接受自定义 ramp', () => {
    expect(charForLum(1, 'ab')).toBe('b');
  });
});

describe('buildGrid', () => {
  it('保持行优先顺序并应用对比度参数', () => {
    const grid = buildGrid([0, 0.5, 1, 0.25], 2, 2, { gamma: 1, black: 0, white: 1 });
    expect(grid.cols).toBe(2);
    expect(grid.rows).toBe(2);
    expect(grid.lum[0]).toBe(0);
    expect(grid.lum[2]).toBe(1);
    expect(grid.lum[3]).toBeCloseTo(0.25, 5);
  });
});

describe('hash2', () => {
  it('同样的输入永远得到同样的输出', () => {
    expect(hash2(3, 7, 11)).toBe(hash2(3, 7, 11));
  });

  it('输出落在 [0,1) 且分布有区分度', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const v = hash2(i % 37, Math.floor(i / 37), 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      seen.add(v);
    }
    expect(seen.size).toBeGreaterThan(450);
  });
});

describe('scanRow', () => {
  it('随时间单调下移', () => {
    expect(scanRow(1000, 40, 10)).toBeGreaterThan(scanRow(0, 40, 10));
  });

  it('循环后仍落在合理区间', () => {
    const rows = 40;
    for (let t = 0; t < 20000; t += 250) {
      const r = scanRow(t, rows, 9);
      expect(r).toBeGreaterThanOrEqual(-5.001);
      expect(r).toBeLessThan(rows + 5);
    }
  });
});

describe('circleMask', () => {
  it('中心不透明、四角完全透明', () => {
    expect(circleMask(25, 25, 50, 50)).toBe(1);
    expect(circleMask(0, 0, 50, 50)).toBe(0);
    expect(circleMask(49, 49, 50, 50)).toBe(0);
  });

  it('羽化带内的取值介于 0 和 1 之间', () => {
    const m = circleMask(50, 25, 50, 50, 0.5, 0.2);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(1);
  });
});

describe('mixStops', () => {
  it('两端返回 stops 的首尾颜色', () => {
    expect(mixStops(0, ['#000000', '#808080', '#ffffff'])).toBe('rgb(0,0,0)');
    expect(mixStops(1, ['#000000', '#808080', '#ffffff'])).toBe('rgb(255,255,255)');
  });

  it('中点返回中间色', () => {
    expect(mixStops(0.5, ['#000000', '#808080', '#ffffff'])).toBe('rgb(128,128,128)');
  });
});
