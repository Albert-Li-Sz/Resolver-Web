/** One cancellable timer and one in-flight update, including pause during a network request. */
export class AutomaticAdvance {
  constructor({ next, advance, changed = () => {}, timers = {
    setTimeout: (fn, delay) => setTimeout(fn, delay), clearTimeout: (id) => clearTimeout(id),
  } }) {
    this.next = next; this.advance = advance; this.changed = changed; this.timers = timers;
    this.timer = null; this.running = false; this.paused = true; this.generation = 0;
  }

  get active() { return !this.paused && (this.timer !== null || this.running); }

  stop() {
    this.paused = true; this.generation++;
    this.timers.clearTimeout(this.timer); this.timer = null;
    this.changed();
  }

  start() {
    this.paused = false;
    this.schedule();
  }

  schedule() {
    this.timers.clearTimeout(this.timer); this.timer = null;
    if (this.paused || this.running) return;
    const action = this.next();
    if (!action) { this.changed(); return; }
    const generation = this.generation;
    this.timer = this.timers.setTimeout(async () => {
      this.timer = null; this.running = true; this.changed();
      let success = false;
      try { success = await this.advance(action.index); }
      catch { success = false; }
      finally {
        this.running = false;
        if (!this.paused) {
          if (success || generation !== this.generation) this.schedule();
          else this.stop();
        }
        this.changed();
      }
    }, action.delay);
    this.changed();
  }
}
