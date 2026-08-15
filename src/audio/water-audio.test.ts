import { describe, expect, it } from 'vitest';
import { dropEnvelope } from './water-audio';

const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0];

describe('dropEnvelope', () => {
  it('目标频率落在五声音阶内', () => {
    for (let i = 0; i < 20; i++) {
      const spec = dropEnvelope(i);
      expect(PENTATONIC).toContain(spec.freq1);
    }
  });

  it('按 5 个音符轮转：index 0 与 5 同音', () => {
    expect(dropEnvelope(0).freq1).toBe(dropEnvelope(5).freq1);
    expect(dropEnvelope(1).freq1).toBe(dropEnvelope(6).freq1);
  });

  it('负 index 安全（取模修正）', () => {
    expect(dropEnvelope(-1).freq1).toBe(PENTATONIC[4]);
    expect(dropEnvelope(-5).freq1).toBe(PENTATONIC[0]);
  });

  it('包络参数均为正数且时长合理', () => {
    for (let i = 0; i < 10; i++) {
      const spec = dropEnvelope(i);
      expect(spec.freq0).toBeGreaterThan(0);
      expect(spec.gain).toBeGreaterThan(0);
      expect(spec.dur).toBeGreaterThan(0.1);
      expect(spec.dur).toBeLessThan(0.5);
    }
  });

  it('起始频率低于目标频率（上滑水泡感）', () => {
    const spec = dropEnvelope(3);
    expect(spec.freq0).toBeLessThan(spec.freq1);
  });
});
