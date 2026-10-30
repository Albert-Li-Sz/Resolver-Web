/* Web port of ICPC Tools v2.6.1331 presentation geometry. See /licenses/icpc-tools.txt. */
import { initFonts, fontsReady, setFont, drawText, textWidth } from "./text.js";
import { fillRoundedRect, strokeRoundedRect } from "./shaded-rect.js";
import { drawDigital, digitalWidth } from "./digital-font.js";
import { metrics } from "./presentation-metrics.js";
import { glyphs } from "./presentation-glyphs.js";
import { JudgeQueueState, StandingsMotion } from "./presentation-state.js";
const trunc = Math.trunc;
export function formatClock(ms, floor = true) {
  const seconds = floor ? Math.floor(ms / 1000) : Math.ceil(ms / 1000),
    hours = trunc(seconds / 3600) % 48;
  return `${ms < 0 && hours === 0 ? "-" : ""}${hours}:${String(trunc(Math.abs(seconds) / 60) % 60).padStart(2, "0")}:${String(Math.abs(seconds) % 60).padStart(2, "0")}`;
}
export function presentationLayout(width, height, problems = 0) {
  const rows = 12,
    title = trunc(height / 30),
    header = trunc(height / 50),
    rowHeight = Math.fround((height - header - title) / rows);
  const size = Math.fround(
    Math.fround(
      Math.fround(Math.fround(height / rows) * 36) * Math.fround(0.95),
    ) / 96,
  );
  let cubeWidth = trunc(
    Math.fround(
      Math.fround(Math.fround(rowHeight / Math.fround(1.8)) - 5) * 10,
    ),
  );
  while (
    cubeWidth > 30 &&
    (cubeWidth + 5) * problems > width - rowHeight * 3 - 70
  )
    cubeWidth -= 2;
  return {
    width,
    height,
    rows,
    title,
    header,
    rowHeight,
    cubeWidth,
    cubeHeight: trunc(Math.fround(rowHeight / 2.5)) - 5,
    size,
  };
}
export function scrollPage(elapsed) {
  if (elapsed < 3750) return 0;
  let t = elapsed - 3000,
    page = trunc(t / 12000);
  t -= page * 12000;
  const f = (x) => (x === 0 ? 0 : Math.exp(-1 / x)),
    smooth = (x) => f(x) / (f(x) + f(1 - x));
  if (t < 750) return page - smooth(0.5 - t / 1500);
  if (t > 11250) return page + smooth(0.5 - (12000 - t) / 1500);
  return page;
}
export class PresentationView {
  constructor() {
    this.queue = new JudgeQueueState();
    this.standingsMotion = new StandingsMotion();
    this.imageRevision = 0;
    this.paths = new Map();
    this.images = new Map();
    this.animations = new Map();
    this.previousOrder = [];
    this.lastTime = 0;
    initFonts();
  }
  image(url) {
    if (!url) return null;
    let image = this.images.get(url);
    if (!image) {
      image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => this.imageRevision++;
      image.onerror = () => this.imageRevision++;
      image.src = url;
      this.images.set(url, image);
      if (this.images.size > 256)
        this.images.delete(this.images.keys().next().value);
    }
    return image.complete && image.naturalWidth ? image : null;
  }
  fit(ctx, url, x, y, w, h) {
    const image = this.image(url);
    if (!image) return null;
    const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight),
      iw = trunc(image.naturalWidth * scale),
      ih = trunc(image.naturalHeight * scale);
    ctx.drawImage(
      image,
      trunc(x + (w - iw) / 2),
      trunc(y + (h - ih) / 2),
      iw,
      ih,
    );
    return { width: iw, height: ih };
  }
  font(ctx, size, bold = true) {
    setFont(ctx, size, { bold });
    const m = ctx.measureText("Mg");
    return {
      size,
      ascent: Math.ceil(m.fontBoundingBoxAscent || size * 0.77),
      descent: Math.ceil(m.fontBoundingBoxDescent || size * 0.18),
      height: Math.ceil(size * 0.965),
    };
  }
  metric(ctx, height, index, size) {
    const m = metrics[height]?.[index];
    if (m) {
      setFont(ctx, m.size, { bold: index !== 2 });
      return m;
    }
    return this.font(ctx, size, index !== 2);
  }
  text(ctx, value, x, y, font, options = {}) {
    const text = String(value ?? ""),
      bold = options.bold !== false,
      face = glyphs[bold ? 1 : 0],
      unicode = [...text];
    if (!unicode.every((c) => face[c.codePointAt(0)]))
      return drawText(ctx, text, trunc(x), trunc(y), {
        size: font.size,
        bold,
        ...options,
      });
    const natural =
      (unicode.reduce((n, c) => n + face[c.codePointAt(0)].advance, 0) *
        font.size) /
      1000;
    let sx = font.size / 1000,
      sy = sx;
    if (options.maxWidth && natural > options.maxWidth)
      sx *= options.maxWidth / natural;
    const width = this.width(ctx, text, font) * (sx / sy),
      align = options.align || "left";
    ctx.save();
    ctx.translate(
      trunc(x) -
        (align === "center" ? trunc(width / 2) : align === "right" ? width : 0),
      trunc(y),
    );
    ctx.scale(sx, sy);
    ctx.fillStyle = options.color || "#fff";
    for (const char of unicode) {
      const id = char.codePointAt(0),
        key = (bold ? "b" : "r") + id;
      let p = this.paths.get(key);
      if (!p) {
        p = new Path2D(face[id].path);
        this.paths.set(key, p);
      }
      ctx.fill(p);
      ctx.translate(face[id].advance, 0);
    }
    ctx.restore();
    return natural;
  }
  width(ctx, value, font) {
    const text = String(value);
    return (
      font.widths?.[text] ??
      (font.chars && [...text].every((c) => c.codePointAt(0) < 256)
        ? [...text].reduce((n, c) => n + font.chars[c.codePointAt(0)], 0)
        : Math.round(textWidth(ctx, text, font.size, { bold: true })))
    );
  }

  clocks(data, now) {
    const c = data?.contest || {},
      meta = data?.clock || {},
      raw = meta.startTime ?? c.startTime,
      start = typeof raw === "number" ? raw : Date.parse(raw),
      multiplier = meta.multiplier || 1;
    const elapsed = Number.isFinite(start) ? (now - start) * multiplier : null;
    return {
      elapsed,
      remaining: elapsed === null ? null : c.durationMs - elapsed,
    };
  }
  header(ctx, data, type, L, now) {
    const { width: w, height: h, title, header, rowHeight } = L;
    const titleFont = this.metric(ctx, h, 4, trunc(h * 0.021) * 2.2),
      clockFont = this.metric(ctx, h, 5, trunc(h * 0.021) * 1.25),
      headerFont = this.metric(ctx, h, 3, trunc(h * 0.021)),
      rowFont = this.metric(ctx, h, 0, L.size * 1.25);
    const titleText = {
      scoreboard: "Current Standings",
      leaders: "Current Medal Contenders",
      queue: "Judge Queue",
      "first-solves": "First to Solve",
    }[type];
    ctx.fillStyle = "#000";
    ctx.fillRect(0, title, w, header + 2);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, title + header - 1, w, 1);
    this.text(ctx, titleText, w / 2, titleFont.ascent, titleFont, {
      align: "center",
    });
    const clock = this.clocks(data, now),
      color = data?.frozen ? "#ffdf36" : "#fff";
    const ended = data?.clock?.ended;
    if (clock.elapsed !== null) {
      this.text(
        ctx,
        ended ? "Contest is over" : formatClock(clock.elapsed),
        w / 12,
        clockFont.ascent + 2,
        clockFont,
        { align: "center", color },
      );
      this.text(
        ctx,
        ended ? "Contest is over" : formatClock(clock.remaining, false),
        (w * 11) / 12,
        clockFont.ascent + 2,
        clockFont,
        { align: "center", color },
      );
    }
    const y = title + header - 3,
      nameX = 8 + this.width(ctx, "199 ", rowFont) + trunc(rowHeight);
    this.text(
      ctx,
      type === "first-solves" ? "Time" : "Rank",
      8 + this.width(ctx, "199", rowFont) / 2,
      y,
      headerFont,
      { align: "center" },
    );
    this.text(ctx, "Name", nameX, y, headerFont);
    if (type === "first-solves")
      this.text(
        ctx,
        "Problem",
        w - 8 - this.width(ctx, "9999", rowFont) / 2,
        y,
        headerFont,
        { align: "center" },
      );
    else {
      this.text(
        ctx,
        "Solved",
        w -
          8 -
          this.width(ctx, " 9999", rowFont) -
          this.width(ctx, "99", rowFont) / 2,
        y,
        headerFont,
        { align: "center" },
      );
      this.text(
        ctx,
        "Time",
        w - 8 - this.width(ctx, "9999", rowFont) / 2,
        y,
        headerFont,
        { align: "center" },
      );
    }
    return { rowFont, nameX };
  }
  cube(ctx, cell, label, x, y, L, now, textOverride) {
    const { cubeWidth: w, cubeHeight: h, height } = L,
      empty = !cell || !cell.attempts;
    const isFirst = cell?.status === "solved" && cell.firstToSolve;
    let fill = empty
      ? "#282828"
      : cell.status === "solved"
        ? isFirst
          ? "rgba(0,82,0,.827451)"
          : "rgba(0,189,0,.827451)"
        : cell.status === "failed"
          ? "rgba(197,0,0,.827451)"
          : "rgba(54,93,202,.827451)";
    fillRoundedRect(
      ctx,
      x + (isFirst ? 1 : 0),
      y + (isFirst ? 1 : 0),
      w - (isFirst ? 2 : 0),
      h - (isFirst ? 2 : 0),
      7,
      fill,
    );
    if (isFirst)
      strokeRoundedRect(ctx, x + 1, y + 1, w - 2, h - 2, 7, "#00e600", 2);
    const font = this.metric(
      ctx,
      height,
      empty ? 2 : 1,
      L.size * (empty ? 0.5 : 0.7),
    );
    let value = empty
      ? label
      : (textOverride ??
        `${cell.attempts}${cell.time > 0 ? "\u200a-\u200a" + cell.time : ""}`);
    this.text(
      ctx,
      value,
      x + w / 2,
      y + h / 2 + font.height / 2 - font.descent + 1,
      font,
      {
        align: "center",
        bold: !empty,
        color: empty ? "rgba(196,196,196,.686275)" : "#fff",
        maxWidth: w - 2,
      },
    );
  }
  scoreboard(ctx, data, type, L, now, elapsed) {
    const { width: w, height: h, title, header, rowHeight } = L,
      { rowFont, nameX } = this.header(ctx, data, type, L, now),
      top = title + header;
    const standings = data?.standings || [],
      teams = data?.contest?.teams || [],
      problems = data?.contest?.problems || [];
    const pages = trunc((standings.length + 12) / 12),
      repeat = pages * 12000 + 4000,
      time = elapsed % repeat;
    const scroll =
      type === "scoreboard" ? trunc(scrollPage(time) * 12 * rowHeight) : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, w, h - top);
    ctx.clip();
    for (let index = 0; index < standings.length + 1; index++) {
      const y = top + trunc(index * rowHeight) - scroll;
      if (index % 2 === 0) {
        ctx.fillStyle = "#3c3c3c";
        ctx.fillRect(0, y, w, trunc(rowHeight));
      }
    }
    // The official renderer draws moving rows back to front over fixed striped bars.
    for (let index = standings.length - 1; index >= 0; index--) {
      const row = standings[index],
        y =
          top +
          trunc(this.standingsMotion.position(row.teamId) * rowHeight) -
          scroll;
      if (y + rowHeight <= top || y >= h) continue;
      const team = teams.find((t) => t.id === row.teamId);
      this.text(
        ctx,
        row.rank || "",
        8 + this.width(ctx, "199", rowFont) / 2,
        y + 5 + rowFont.ascent,
        rowFont,
        { align: "center" },
      );
      this.fit(
        ctx,
        team?.logo,
        8 + this.width(ctx, "199 ", rowFont) + 5,
        y + 5,
        rowHeight - 10,
        rowHeight - 10,
      );
      this.text(
        ctx,
        team?.displayName || team?.name || row.teamId,
        nameX,
        y + 5 + rowFont.ascent,
        rowFont,
        {
          maxWidth:
            w - 16 - this.width(ctx, "199 9 9999 ", rowFont) - rowHeight,
        },
      );
      if (row.solved)
        this.text(
          ctx,
          row.solved,
          w -
            8 -
            this.width(ctx, " 9999", rowFont) -
            this.width(ctx, "99", rowFont) / 2,
          y + 5 + rowFont.ascent,
          rowFont,
          { align: "center" },
        );
      if (row.time)
        this.text(
          ctx,
          row.time,
          w - 8 - this.width(ctx, "9999", rowFont) / 2,
          y + 5 + rowFont.ascent,
          rowFont,
          { align: "center" },
        );
      const cells = data?.results?.[row.teamId] || [];
      for (let j = 0; j < problems.length; j++)
        this.cube(
          ctx,
          cells[j],
          problems[j].label,
          nameX + j * (L.cubeWidth + 5),
          y + trunc(rowHeight * 0.6) + 1,
          L,
          now,
        );
    }
    if (type === "scoreboard") {
      const y = top + trunc(standings.length * rowHeight) - scroll,
        rowH = trunc(Math.fround(rowHeight * Math.fround(0.6))),
        dy = trunc(5 / 2) - 1,
        firstY = y + rowH + dy - trunc((L.cubeHeight * 5) / 4);
      for (let j = 0; j < problems.length; j++) {
        const cells = standings.map((row) => data?.results?.[row.teamId]?.[j]),
          pending = cells.filter((c) => c?.status === "pending").length,
          solved = cells.filter((c) => c?.status === "solved").length;
        for (const [value, status, cubeY] of [
          [pending, "pending", firstY],
          [solved, "solved", y + rowH + dy],
        ])
          this.cube(
            ctx,
            value ? { attempts: value, status } : null,
            "",
            nameX + j * (L.cubeWidth + 5),
            cubeY,
            L,
            now,
            value ? String(value) : "",
          );
      }
    }
    ctx.restore();
  }
  finishFrame(ctx, type, L, phase, repeat) {
    if (type !== "scoreboard") return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const alpha =
      phase < 1000
        ? phase / 1000
        : phase > repeat - 1000
          ? (repeat - phase) / 1000
          : 1;
    if (alpha < 1) {
      ctx.globalAlpha = 1 - alpha;
      ctx.fillStyle = "#000";
      ctx.fillRect(
        0,
        L.title + L.header,
        L.width,
        L.height - L.title - L.header,
      );
      ctx.globalAlpha = 1;
    }
    this.legend(ctx, L.width, L.height);
    ctx.restore();
  }
  legend(ctx, w, h) {
    const f = this.metric(ctx, h, 8, 24),
      fh = f.height,
      fx = fh * 2,
      items = [
        "First to Solve",
        "Solved Problem",
        "Rejected Submission",
        "Pending Submission",
      ];
    const width = 30 + fx + 10 + this.width(ctx, items[2], f),
      height = 30 + 45 + fh * 4,
      x = w - 30 - width,
      y = h - 200;
    ctx.fillStyle = "rgba(0,0,0,.75294)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width, height);
    ["#006400", "#00e600", "#f00000", "#4272f5"].forEach((color, i) => {
      fillRoundedRect(ctx, x + 15, y + 15 + i * (fh + 15), fx, fh, 7, color);
      if (i === 0)
        strokeRoundedRect(ctx, x + 16, y + 16, fx - 2, fh - 2, 7, "#00e600", 2);
      this.text(
        ctx,
        items[i],
        x + 25 + fx,
        y + 16 + i * (fh + 15) + f.ascent,
        f,
      );
    });
  }
  submissionRows(ctx, data, type, L, now) {
    const { width: w, height: h, title, header, rowHeight } = L,
      { rowFont, nameX } = this.header(ctx, data, type, L, now),
      top = title + header,
      problems = data?.contest?.problems || [];
    const records = type === "queue" ? this.queue.update(data, now) : null;
    const rows =
      type === "first-solves"
        ? [...(data?.firstSolves || [])].sort(
            (a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0),
          )
        : records.map((r) => r.submission);
    for (let i = 0; i < 12; i++) {
      const y = top + trunc(i * rowHeight);
      if (i % 2 === 0) {
        ctx.fillStyle = "#3c3c3c";
        ctx.fillRect(0, y, w, trunc(rowHeight));
      }
      const sub = rows[i];
      if (!sub) continue;
      ctx.save();
      if (records)
        ctx.translate(
          0,
          trunc(records[i].anim.getValue() * rowHeight) - trunc(i * rowHeight),
        );
      const t = data?.contest?.teams?.find((t) => t.id === sub.teamId),
        problem = problems.find((p) => p.id === sub.problemId);
      this.text(
        ctx,
        type === "first-solves"
          ? Math.floor(sub.contestTime / 60000)
          : data.standings.find((r) => r.teamId === sub.teamId)?.rank || "",
        8 + this.width(ctx, "199", rowFont) / 2,
        y + 5 + rowFont.ascent,
        rowFont,
        { align: "center" },
      );
      this.fit(
        ctx,
        t?.logo,
        8 + this.width(ctx, "199 ", rowFont) + 5,
        y + 5,
        rowHeight - 10,
        rowHeight - 10,
      );
      this.text(
        ctx,
        t?.displayName || t?.name || sub.teamId,
        nameX,
        y + 5 + rowFont.ascent,
        rowFont,
        { maxWidth: w - nameX - 210 },
      );
      if (type === "queue") {
        const standing = data.standings.find((r) => r.teamId === sub.teamId);
        if (standing?.solved)
          this.text(
            ctx,
            standing.solved,
            w -
              8 -
              this.width(ctx, " 9999", rowFont) -
              this.width(ctx, "99", rowFont) / 2,
            y + 5 + rowFont.ascent,
            rowFont,
            { align: "center" },
          );
        if (standing?.time)
          this.text(
            ctx,
            standing.time,
            w - 8 - this.width(ctx, "9999", rowFont) / 2,
            y + 5 + rowFont.ascent,
            rowFont,
            { align: "center" },
          );
      }
      if (type === "first-solves")
        this.text(
          ctx,
          problem?.label,
          w - 8 - this.width(ctx, "9999", rowFont) / 2,
          y + 5 + rowFont.ascent,
          rowFont,
          { align: "center" },
        );
      for (let j = 0; j < problems.length; j++) {
        const matched = problems[j].id === sub.problemId,
          cubeY = y + trunc(rowHeight / 2) + 5,
          cubeX = nameX + j * (L.cubeWidth + 5);
        if (
          !matched &&
          type === "queue" &&
          data.results?.[sub.teamId]?.[j]?.status === "solved"
        )
          fillRoundedRect(
            ctx,
            cubeX,
            cubeY,
            L.cubeWidth,
            L.cubeHeight,
            7,
            "#005c00",
          );
        else
          this.cube(
            ctx,
            matched
              ? {
                  attempts: 1,
                  status: sub.status,
                  firstToSolve: type === "first-solves",
                  time: Math.floor(sub.contestTime / 60000),
                }
              : null,
            problems[j].label,
            cubeX,
            cubeY,
            L,
            now,
            matched ? String(Math.floor(sub.contestTime / 60000)) : undefined,
          );
      }
      ctx.restore();
    }
  }
  render(
    ctx,
    data,
    item,
    { width: w, height: h, now, elapsed, restore = false },
  ) {
    if (!fontsReady()) return false;
    if (this.lastType !== item.type) {
      this.queue = new JudgeQueueState();
      this.standingsMotion = new StandingsMotion();
      this.lastType = item.type;
    }
    const moving = this.standingsMotion.update(data?.standings || [], now),
      repeat = trunc(((data?.standings?.length || 0) + 12) / 12) * 12000 + 4000,
      phase = elapsed % repeat,
      fading =
        item.type === "scoreboard" && (phase < 1000 || phase > repeat - 1000),
      cacheable = !["queue", "photos"].includes(item.type) && !moving,
      cacheKey = JSON.stringify([
        item,
        w,
        h,
        Math.floor(now / 1000),
        item.type === "scoreboard"
          ? trunc(
              scrollPage(
                elapsed %
                  (trunc(((data?.standings?.length || 0) + 12) / 12) * 12000 +
                    4000),
              ) *
                (h - h / 30 - h / 50),
            )
          : 0,
        this.imageRevision,
      ]);
    if (cacheable && this.cacheData === data && this.cacheKey === cacheKey) {
      if (
        restore ||
        this.cacheCanvas !== ctx.canvas ||
        fading ||
        this.wasFading
      ) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.cache, 0, 0);
        ctx.restore();
        this.finishFrame(
          ctx,
          item.type,
          presentationLayout(w, h),
          phase,
          repeat,
        );
      }
      this.cacheCanvas = ctx.canvas;
      this.wasFading = fading;
      return true;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const L = presentationLayout(w, h, data?.contest?.problems?.length || 0),
      type = item.type;
    if (type === "scoreboard" || type === "leaders")
      this.scoreboard(ctx, data, type, L, now, elapsed);
    else if (type === "queue" || type === "first-solves")
      this.submissionRows(ctx, data, type, L, now);
    else if (type === "clock" || type === "countdown") {
      const banner = this.image(data?.contest?.banner);
      let verticalOffset = 0;
      if (banner) {
        const sf = Math.min(
            (w * 0.7) / banner.width,
            (h * 0.2) / banner.height,
          ),
          bw = trunc(banner.width * sf),
          bh = trunc(banner.height * sf);
        ctx.drawImage(banner, trunc((w - bw) / 2), h - bh - 20, bw, bh);
        verticalOffset = trunc(bh / 2);
      }
      const clocks = this.clocks(data, now);
      let ms =
        type === "clock"
          ? clocks.elapsed
          : item.targetTime
            ? now - item.targetTime
            : clocks.elapsed;
      if (ms !== null) {
        let time = formatClock(ms);
        if (!time.startsWith("-")) time = "+" + time;
        let yh = trunc(Math.min(0.225 * w, 0.55 * h)),
          width = digitalWidth(time, yh);
        if (width > w) {
          yh = trunc((yh * w) / width);
          width = digitalWidth(time, yh);
        }
        drawDigital(
          ctx,
          time,
          trunc((w - width) / 2),
          trunc((h + h / 2.5) / 2 - verticalOffset),
          yh,
        );
      }
    } else if (type === "message") {
      const banner = this.image(data?.contest?.banner);
      let bannerHeight = 0;
      if (banner) {
        const sf = Math.min(
            (w * 0.8) / banner.width,
            (h * 0.25) / banner.height,
          ),
          bw = trunc(banner.width * sf);
        bannerHeight = trunc(banner.height * sf);
        ctx.drawImage(
          banner,
          trunc((w - bw) / 2),
          h - bannerHeight - 20,
          bw,
          bannerHeight,
        );
      }
      const font = this.metric(ctx, h, 6, h / 8),
        lines = [];
      for (const original of String(item.text || "").split("\n")) {
        let line = "";
        for (const word of original.match(/\S+\s*|\s+/g) || [""]) {
          if (line && this.width(ctx, line + word, font) > w * 0.9) {
            lines.push(line.trimEnd());
            line = word;
          } else line += word;
        }
        lines.push(line.trimEnd());
      }
      const top =
        trunc((h - bannerHeight - lines.length * font.height) / 2) - 10;
      lines.forEach((line, i) =>
        this.text(ctx, line, w / 2, top + font.ascent + i * font.height, font, {
          align: "center",
          maxWidth: w * 0.9,
        }),
      );
    } else if (type === "team") {
      const team =
        data?.contest?.teams?.find((t) => t.id === item.teamId) ||
        data?.contest?.teams?.[0];
      if (team) {
        const photo = this.image(team.photo),
          s = photo?.naturalWidth
            ? Math.min(
                (w * 0.7) / photo.naturalWidth,
                ((h - 30) * 0.7) / photo.naturalHeight,
              )
            : 0,
          pw = photo ? trunc(photo.naturalWidth * s) : 0,
          ph = photo ? trunc(photo.naturalHeight * s) : 0;
        if (photo)
          ctx.drawImage(
            photo,
            trunc((w - pw) / 2),
            trunc((h - ph) / 2),
            pw,
            ph,
          );
        const logo = this.image(team.logo);
        if (logo) {
          const sf = Math.min(
              (w * (photo?.naturalWidth ? 0.32 : 0.7)) / logo.naturalWidth,
              ((h - 30) * (photo?.naturalWidth ? 0.32 : 0.7)) /
                logo.naturalHeight,
            ),
            lw = trunc(logo.naturalWidth * sf),
            lh = trunc(logo.naturalHeight * sf);
          ctx.drawImage(
            logo,
            photo ? trunc((w + pw - lw) / 2) : trunc((w - lw) / 2),
            photo ? Math.max(0, trunc((h - ph - lh) / 2)) : trunc((h - lh) / 2),
            lw,
            lh,
          );
        }
        const f = this.metric(ctx, h, 7, h / 16);
        this.text(
          ctx,
          `${team.label || team.id} – ${team.displayName || team.name}`,
          w / 2,
          h - f.descent - 15,
          f,
          { align: "center", maxWidth: w - 30 },
        );
      }
    } else if (type === "photos") {
      const urls = item.images || [],
        index = Math.floor(elapsed / 12000) % Math.max(1, urls.length),
        image = this.image(urls[index]);
      if (image) {
        const t = (elapsed % 12000) / 12000,
          scale = Math.max(w / image.width, h / image.height) * (1.1 - 0.1 * t),
          iw = image.width * scale,
          ih = image.height * scale;
        ctx.drawImage(
          image,
          (w - iw) * (index % 2 ? 1 - t : t),
          (h - ih) * (index % 4 > 1 ? 1 - t : t),
          iw,
          ih,
        );
      }
    } else if (type === "calibration") {
      for (const [num, color] of [
        [40, "#404040"],
        [20, "#c0c0c0"],
        [10, "#fff"],
      ]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= num; i++) {
          const x = trunc(((w - 1) * i) / num) + 0.5,
            y = trunc(((h - 1) * i) / num) + 0.5;
          ctx.moveTo(x, 0.5);
          ctx.lineTo(x, h - 0.5);
          ctx.moveTo(0.5, y);
          ctx.lineTo(w - 0.5, y);
        }
        ctx.stroke();
      }
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      for (let i = 0; i < 10; i++)
        for (let j = 0; j < 10; j++) {
          const x = trunc(((w - 1) * (i + 0.5)) / 10),
            y = trunc(((h - 1) * (j + 0.5)) / 10),
            s = `${i}-${j}`,
            m = ctx.measureText(s);
          ctx.fillStyle = "#000";
          ctx.fillRect(x - m.width / 2, y - 6, m.width, 12);
          ctx.fillStyle = "#fff";
          ctx.fillText(s, x, y + 6);
        }
      ctx.textAlign = "left";
    } else
      this.fit(
        ctx,
        data?.contest?.logo || "/assets/img/icpc-logo.png",
        w * 0.1,
        h * 0.1,
        w * 0.8,
        h * 0.8,
      );
    if (cacheable) {
      this.cache ||= document.createElement("canvas");
      this.cache.width = w;
      this.cache.height = h;
      this.cache.getContext("2d").drawImage(ctx.canvas, 0, 0);
      this.cacheKey = cacheKey;
      this.cacheData = data;
      this.cacheCanvas = ctx.canvas;
    }
    this.finishFrame(ctx, item.type, L, phase, repeat);
    this.wasFading = fading;
    ctx.restore();
    return true;
  }
  dispose() {
    this.images.clear();
  }
}
