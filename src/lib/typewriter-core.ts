/**
 * 打字机核心：纯状态机，无 DOM 依赖，可单测。
 * 每次调用 nextTick 推进 dtMs 毫秒，返回新状态与应显示的文本。
 */

export interface TypewriterOptions {
  /** 键入一个字符所需毫秒 */
  typeMs: number;
  /** 删除一个字符所需毫秒 */
  deleteMs: number;
  /** 完整显示后的保持毫秒 */
  holdMs: number;
  /** 打完最后一个短语后是否删除并循环（默认 true；false = 打完保持完整显示） */
  loop?: boolean;
}

export interface TypewriterState {
  /** 当前短语索引 */
  phrase: number;
  /** 已显示字符数（可为小数，渲染时取整） */
  char: number;
  /** 是否处于删除阶段 */
  deleting: boolean;
  /** 删除前剩余保持毫秒 */
  hold: number;
}

export function createInitialState(): TypewriterState {
  return { phrase: 0, char: 0, deleting: false, hold: 0 };
}

export function nextTick(
  state: TypewriterState,
  phrases: readonly string[],
  opts: TypewriterOptions,
  dtMs: number,
): { state: TypewriterState; text: string } {
  if (phrases.length === 0) return { state, text: '' };

  const len = phrases[state.phrase].length;
  let char = state.char;
  let hold = state.hold;
  let deleting = state.deleting;
  let phrase = state.phrase;

  if (!deleting) {
    const before = char;
    char = Math.min(len, char + dtMs / opts.typeMs);
    if (char >= len) {
      // hold 只计"打满之后"的时间：扣除本次溢出量
      const overflowMs = Math.max(0, char - before) * opts.typeMs;
      hold += Math.max(0, dtMs - overflowMs);
      if (hold >= opts.holdMs) {
        const isLast = phrase === phrases.length - 1;
        if (opts.loop === false && isLast) {
          hold = opts.holdMs; // 最后一短语：钉住，保持完整显示
        } else {
          deleting = true;
          hold = 0;
        }
      }
    }
  } else {
    char = Math.max(0, char - dtMs / opts.deleteMs);
    if (char <= 0) {
      phrase = (phrase + 1) % phrases.length;
      deleting = false;
      char = 0;
    }
  }

  const next: TypewriterState = { phrase, char, deleting, hold };
  return { state: next, text: phrases[phrase].slice(0, Math.floor(char)) };
}
