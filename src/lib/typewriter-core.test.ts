import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  nextTick,
  type TypewriterOptions,
} from './typewriter-core';

const phrases = ['hello', 'world!'] as const;
const opts: TypewriterOptions = { typeMs: 100, deleteMs: 50, holdMs: 500 };

/** 打满当前短语（恰好达到长度，不触发 hold） */
function typeFull(s: ReturnType<typeof createInitialState>) {
  return nextTick(s, phrases, opts, opts.typeMs * phrases[s.phrase].length).state;
}

describe('typewriter-core', () => {
  it('初始状态为空文本', () => {
    const s = createInitialState();
    expect(s).toEqual({ phrase: 0, char: 0, deleting: false, hold: 0 });
    expect(nextTick(s, phrases, opts, 0).text).toBe('');
  });

  it('按 typeMs 逐字推进', () => {
    const s = createInitialState();
    const r1 = nextTick(s, phrases, opts, 100);
    expect(r1.state.char).toBe(1);
    expect(r1.text).toBe('h');
    const r2 = nextTick(r1.state, phrases, opts, 300);
    expect(r2.state.char).toBe(4);
    expect(r2.text).toBe('hell');
  });

  it('不会超过短语长度', () => {
    const s = createInitialState();
    const r = nextTick(s, phrases, opts, opts.typeMs * 5); // 恰好打满
    expect(r.state.char).toBe(5);
    expect(r.text).toBe('hello');
    expect(r.state.deleting).toBe(false);
    const r2 = nextTick(r.state, phrases, opts, 300); // 再多时间也停在 len
    expect(r2.state.char).toBe(5);
    expect(r2.text).toBe('hello');
  });

  it('完整显示后进入 hold 计时，hold 结束才开始删除', () => {
    let s = typeFull(createInitialState());
    expect(s.deleting).toBe(false);
    expect(s.hold).toBe(0);
    s = nextTick(s, phrases, opts, 400).state; // hold 400 < 500
    expect(s.deleting).toBe(false);
    s = nextTick(s, phrases, opts, 200).state; // hold 600 ≥ 500：仅翻转标志
    expect(s.deleting).toBe(true);
    expect(s.char).toBe(5);
    s = nextTick(s, phrases, opts, 100).state; // 删除开始推进：100/50 = 2 字符
    expect(s.char).toBe(3);
    expect(nextTick(s, phrases, opts, 0).text).toBe('hel');
  });

  it('删除到 0 后切换到下一短语', () => {
    let s = typeFull(createInitialState());
    s = nextTick(s, phrases, opts, 500).state; // hold 满，进入删除
    expect(s.deleting).toBe(true);
    s = nextTick(s, phrases, opts, 250).state; // 5 字符删完
    expect(s.deleting).toBe(false);
    expect(s.phrase).toBe(1);
    expect(s.char).toBe(0);
  });

  it('短语列表循环回到第一个', () => {
    let s = createInitialState();
    s = typeFull(s); // hello 打满
    s = nextTick(s, phrases, opts, 500).state; // hold → 删除
    s = nextTick(s, phrases, opts, 250).state; // 删完 → phrase 1
    expect(s.phrase).toBe(1);
    s = typeFull(s); // world! 打满
    expect(s.phrase).toBe(1);
    s = nextTick(s, phrases, opts, 500).state; // hold → 删除
    s = nextTick(s, phrases, opts, 300).state; // 6 字符删完 → phrase 0
    expect(s.phrase).toBe(0);
    expect(s.deleting).toBe(false);
  });

  it('空短语列表安全返回空文本', () => {
    const s = createInitialState();
    const r = nextTick(s, [], opts, 100);
    expect(r.text).toBe('');
    expect(r.state).toEqual(s);
  });

  it('loop=false：单句打满后保持完整显示，不进入删除', () => {
    const single = ['hello'];
    const o = { ...opts, loop: false };
    let s = nextTick(createInitialState(), single, o, 500).state; // 打满
    expect(s.deleting).toBe(false);
    s = nextTick(s, single, o, 10_000).state; // hold 远超上限
    expect(s.deleting).toBe(false);
    expect(s.char).toBe(5);
    expect(nextTick(s, single, o, 0).text).toBe('hello');
  });

  it('loop=false：多句时前句正常删除切换，最后一句保持', () => {
    const o = { ...opts, loop: false };
    let s = createInitialState();
    s = nextTick(s, phrases, o, 500).state; // hello 打满
    s = nextTick(s, phrases, o, 500).state; // hold 满 → 删除
    expect(s.deleting).toBe(true);
    s = nextTick(s, phrases, o, 250).state; // 删完 → phrase 1
    expect(s.phrase).toBe(1);
    s = nextTick(s, phrases, o, 600).state; // world! 打满
    expect(s.deleting).toBe(false);
    s = nextTick(s, phrases, o, 10_000).state; // hold 远超
    expect(s.deleting).toBe(false); // 最后一短语不删除
    expect(s.char).toBe(6);
    expect(nextTick(s, phrases, o, 0).text).toBe('world!');
  });
});
