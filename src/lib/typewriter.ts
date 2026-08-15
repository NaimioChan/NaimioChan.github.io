import {
  createInitialState,
  nextTick,
  type TypewriterOptions,
} from './typewriter-core';

/** DOM 版打字机：以 60ms 步进驱动纯状态机 */
export class Typewriter {
  private timer: number | null = null;
  private state = createInitialState();

  constructor(
    private readonly el: HTMLElement,
    private readonly phrases: readonly string[],
    private readonly opts: TypewriterOptions,
  ) {}

  start(): void {
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private tick = (): void => {
    const r = nextTick(this.state, this.phrases, this.opts, 60);
    this.state = r.state;
    this.el.textContent = r.text;
    this.timer = window.setTimeout(this.tick, 60);
  };
}
