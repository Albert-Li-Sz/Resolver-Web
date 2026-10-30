import { Animator, Movement } from "./animator.js";
/** Official scoreboard row acceleration (4 rows/s²) and maximum speed (7 rows/s). */
export class StandingsMotion {
  constructor() {
    this.rows = new Map();
    this.lastNow = null;
  }
  update(standings, now) {
    const dt = this.lastNow === null ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;
    const ids = new Set(standings.map((r) => r.teamId));
    for (const id of this.rows.keys()) if (!ids.has(id)) this.rows.delete(id);
    let moving = false;
    standings.forEach((row, index) => {
      let anim = this.rows.get(row.teamId);
      if (!anim)
        this.rows.set(
          row.teamId,
          (anim = new Animator(index, new Movement(4, 7))),
        );
      else {
        anim.setTarget(index);
        anim.incrementTimeMs(dt);
      }
      if (Math.abs(anim.getValue() - index) > 0.00001) moving = true;
    });
    return moving;
  }
  position(id) {
    return this.rows.get(id)?.getValue() || 0;
  }
}
/** Original Judge Queue lifetimes and movement; all inputs are already public. */
export class JudgeQueueState {
  constructor() {
    this.records = [];
    this.seen = new Set();
    this.initial = true;
    this.lastNow = 0;
  }
  update(data, now) {
    const submissions = data?.contest?.submissions || [],
      byId = new Map(submissions.map((s) => [s.id, s])),
      dt = this.lastNow ? Math.max(0, now - this.lastNow) : 0;
    this.lastNow = now;
    this.records = this.records.filter((r) => byId.has(r.submission.id));
    for (const id of this.seen) if (!byId.has(id)) this.seen.delete(id);
    if (this.initial) {
      for (const s of submissions) {
        this.seen.add(s.id);
        if (s.status === "pending" && !data?.frozen)
          this.records.push({
            submission: s,
            anim: new Animator(this.records.length, new Movement(5, 9)),
            changedAt: now,
          });
      }
      this.initial = false;
    } else
      for (const s of submissions)
        if (!this.seen.has(s.id)) {
          this.seen.add(s.id);
          const target = this.records.length;
          this.records.push({
            submission: s,
            anim: new Animator(Math.max(target, 14), new Movement(5, 9)),
            changedAt: now,
          });
        }
    for (const r of this.records) {
      const next = byId.get(r.submission.id);
      if (next && r.submission.status !== next.status) r.changedAt = now;
      if (next) r.submission = next;
    }
    let index = 0;
    this.records = this.records
      .filter((r) => {
        const status = r.submission.status,
          age = now - r.changedAt,
          expired =
            status === "solved"
              ? age > 11000
              : status === "failed"
                ? age > 8000
                : false;
        const target = expired ? (status === "solved" ? -12 : 24) : index++;
        r.anim.setTarget(target);
        r.anim.incrementTimeMs(dt);
        return !expired || Math.abs(r.anim.getValue() - target) > 0.01;
      })
      .slice(-48);
    return this.records;
  }
}
