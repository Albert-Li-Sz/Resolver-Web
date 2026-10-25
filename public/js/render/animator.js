/**
 * Port of ICPC Tools' Animator (PresContest/.../internal/Animator.java).
 *
 * The animator produces a smooth acceleration/coast/deceleration curve towards
 * a target value. It is used for team row movement, scoreboard scrolling and
 * the scroll-to-team focus.
 *
 * This is a direct, line-for-line port; keep the math identical.
 */
export class Movement {
  constructor(acceleration, maxSpeed) {
    this.acceleration = acceleration;
    this.maxSpeed = maxSpeed;
  }
}

export class Animator {
  /**
   * @param {number} x initial value
   * @param {Movement} move movement parameters
   */
  constructor(x, move) {
    this.move = move;
    this.acc = move.acceleration;
    this.xInitial = x;
    this.xTarget = x;
    this.vTarget = 0;
    this.t1 = 0;
    this.tCoast = 0;
    this.tScale = 1.0;
    this.t = 0;
  }

  incrementTimeMs(dt) {
    this.t += dt;
  }

  /** Projected movement time; only valid immediately after setTarget(). */
  getMoveTime() {
    return this.t1 * 2 + this.tCoast;
  }

  getValue() {
    let tt = (this.t * this.tScale) / 1000.0;
    if (tt < this.t1) {
      return this.xInitial + (this.acc * tt * tt) / 2.0 + this.vTarget * tt;
    } else if (tt < this.t1 + this.tCoast) {
      tt = tt - this.t1;
      return (
        this.xInitial +
        (this.acc * this.t1 * this.t1) / 2.0 +
        tt * this.move.maxSpeed * Math.sign(this.xTarget - this.xInitial) +
        this.vTarget * (this.t1 + tt)
      );
    } else if (tt < this.t1 * 2 + this.tCoast) {
      tt = this.t1 * 2 + this.tCoast - tt;
      return this.xTarget - (this.acc * tt * tt) / 2.0 + this.vTarget * (this.t1 * 2 + this.tCoast - tt);
    }
    return this.xTarget + this.vTarget * tt;
  }

  getVelocity() {
    let tt = (this.t * this.tScale) / 1000.0;
    if (tt < this.t1) {
      return this.acc * tt * this.tScale;
    } else if (tt < this.t1 + this.tCoast) {
      return this.move.maxSpeed * Math.sign(this.xTarget - this.xInitial) * this.tScale;
    } else if (tt < this.t1 * 2 + this.tCoast) {
      tt = this.t1 * 2 + this.tCoast - tt;
      return this.acc * tt * this.tScale;
    }
    return 0;
  }

  resetToTarget() {
    this.reset(this.xTarget, 0);
  }

  reset(x, v = 0) {
    this.xInitial = x;
    this.xTarget = x;
    this.t1 = 0;
    this.tCoast = 0;
    this.vTarget = v;
    this.tScale = 1.0;
  }

  setTimeScale(ts) {
    this.tScale = Math.min(1.0, Math.max(0.1, ts));
  }

  getTarget() {
    return this.xTarget;
  }

  setTarget(x, v = 0) {
    if (x === this.xTarget && v === this.vTarget) return;

    const vInitial = this.getVelocity();

    // set the start and end points and reset time
    this.xInitial = this.getValue();
    this.xTarget = x;
    this.vTarget = v;
    this.t = 0;
    this.tScale = 1.0;
    this.acc = this.move.acceleration;
    if (this.xTarget < this.xInitial) this.acc = -this.move.acceleration;

    // adjust the curve if we were already moving
    if (vInitial !== 0) {
      const dt = Math.abs(vInitial / this.move.acceleration); // time to stop
      const a2 = -Math.sign(vInitial) * this.move.acceleration; // acceleration needed to stop
      const xx = this.xInitial + vInitial * dt + (a2 * dt * dt) / 2.0; // value once stopped
      if (xx < Math.min(this.xInitial, this.xTarget) || xx > Math.max(this.xInitial, this.xTarget)) {
        // need to reverse direction. set zero time ahead of us
        this.t = -Math.trunc(dt * 1000.0);
        if (Math.sign(this.xTarget - xx) !== Math.sign(this.xTarget - this.xInitial)) this.acc = -this.acc;
      } else {
        // already going in the right direction. set zero time behind us
        this.t = Math.trunc(dt * 1000.0);
      }
      this.xInitial = this.xInitial - (this.acc * dt * dt) / 2.0 - (this.t * v) / 1000.0;
    }

    this.t1 = Math.sqrt(Math.abs(this.xTarget - this.xInitial) / this.move.acceleration);

    // if we exceed the max speed, insert a section of constant velocity
    const mt = this.move.maxSpeed / this.move.acceleration;
    if (this.t1 > mt) {
      // distance travelled while reaching and decelerating from max speed
      const d = this.move.acceleration * mt * mt;
      this.tCoast = (Math.abs(this.xTarget - this.xInitial) - d) / this.move.maxSpeed;
      this.t1 = mt;
    } else {
      this.tCoast = 0;
    }
  }

  toString() {
    return `Animator: ${this.getValue()} ${this.xTarget}`;
  }
}
