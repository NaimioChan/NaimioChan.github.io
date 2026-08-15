/**
 * 水声引擎：Web Audio 合成的柔和"水泡"音。
 * dropEnvelope 为纯函数（音高/时长/音量映射），可单测；
 * WaterAudio 负责 AudioContext 生命周期与播放。
 */

/** 五声音阶（C 大调五声），保证任意点击都协和 */
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0] as const;

export interface DropSpec {
  /** 起始频率 */
  freq0: number;
  /** 目标频率 */
  freq1: number;
  /** 总时长（秒） */
  dur: number;
  /** 峰值增益 */
  gain: number;
}

/** 按点击序号映射到五声音阶上的音高（纯函数） */
export function dropEnvelope(index: number): DropSpec {
  const i = ((index % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length;
  const f = PENTATONIC[i];
  return { freq0: f * 0.9, freq1: f, dur: 0.24, gain: 0.045 };
}

export class WaterAudio {
  enabled = true;
  private ctx: AudioContext | null = null;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on && this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend();
    } else if (on) {
      void this.ensureCtx();
    }
  }

  private ensureCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 播放一个水泡音。index 决定音高（五声音阶轮转）。 */
  drop(index = 0): void {
    if (!this.enabled) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;

    const { freq0, freq1, dur, gain } = dropEnvelope(index);
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq0, t);
    osc.frequency.exponentialRampToValueAtTime(freq1, t + dur * 0.55);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.022);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}
