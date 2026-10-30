import http from "node:http";
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { timingSafeEqual } from "node:crypto";
const key = process.env.MEDIA_INTERNAL_KEY;
if (!key) throw Error("MEDIA_INTERNAL_KEY is required");
const host = process.env.MEDIA_MTX_HOST || "mediamtx";
const jobs = new Map();
const equal = (a, b) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function input(source) {
  if (!/^[a-f0-9]{32}$/.test(source.id)) throw Error("Invalid source");
  if (source.kind === "publish")
    return `rtsp://worker:${encodeURIComponent(key)}@${host}:8554/source-${source.id}`;
  const u = new URL(source.url);
  if (
    !["rtsp:", "rtmp:", "srt:", "http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password
  )
    throw Error("Invalid protocol");
  const name = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(name, { all: true });
  if (
    !addresses.length ||
    addresses.some(
      (a) =>
        a.address === "::1" ||
        a.address.startsWith("127.") ||
        a.address.startsWith("169.254.") ||
        a.address.startsWith("fe80:") ||
        a.address === "0.0.0.0" ||
        a.address === "::",
    )
  )
    throw Error("Forbidden source");
  const a = addresses[0].address;
  const privateAddress =
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|f[cd])/i.test(a);
  if (privateAddress && !source.allowPrivate)
    throw Error("Private source not allowed");
  // Preserve TLS hostname for HTTPS. The application validates sources before issuing this internal request.
  if (u.protocol !== "https:") u.hostname = a.includes(":") ? `[${a}]` : a;
  if (source.username) u.username = source.username;
  if (source.password) u.password = source.password;
  return u.href;
}
async function probe(source) {
  const url = await input(source);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        ...(url.startsWith("rtsp:")
          ? ["-rtsp_transport", "tcp", "-timeout", "7000000"]
          : ["-rw_timeout", "7000000"]),
        "-show_entries",
        "stream=codec_type,codec_name,width,height,has_b_frames",
        "-of",
        "json",
        url,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
    child.stdout.on("data", (data) => {
      output += data;
      if (output.length > 65536) child.kill();
    });
    child.on("error", () => {
      clearTimeout(timeout);
      reject(Error("Probe unavailable"));
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(Error("Source unavailable"));
      try {
        resolve(JSON.parse(output));
      } catch {
        reject(Error("Invalid media"));
      }
    });
  });
}
async function start(job) {
  if (job.closed) return;
  try {
    const url = await input(job.source);
    let force = job.source.transcode;
    try {
      const info = await probe(job.source);
      job.info = info;
      force =
        force ||
        info.streams?.some(
          (s) =>
            s.codec_type === "video" &&
            (s.codec_name !== "h264" || s.has_b_frames > 0),
        );
    } catch {
      /* A live publisher may appear after the job starts. */
    }
    if (job.closed) return;
    const args = [
      "-nostdin",
      "-protocol_whitelist",
      "http,https,tcp,tls,udp,rtp,rtsp,rtmp,srt,crypto,data",
      "-hide_banner",
      "-loglevel",
      "error",
      ...(url.startsWith("http") && /\.mp4(?:\?|$)/i.test(url)
        ? ["-re", "-stream_loop", "-1"]
        : []),
      ...(url.startsWith("rtsp:")
        ? ["-rtsp_transport", "tcp", "-timeout", "10000000"]
        : ["-rw_timeout", "10000000"]),
      "-i",
      url,
      "-map",
      "0:v:0?",
      "-map",
      "0:a:0?",
      ...(force
        ? [
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-tune",
            "zerolatency",
            "-pix_fmt",
            "yuv420p",
            "-profile:v",
            "baseline",
            "-vf",
            "scale=w=min(1920\\,iw):h=-2",
            "-r",
            "30",
          ]
        : ["-c:v", "copy"]),
      "-c:a",
      "libopus",
      "-b:a",
      "96k",
      "-f",
      "rtsp",
      "-rtsp_transport",
      "tcp",
      `rtsp://worker:${encodeURIComponent(key)}@${host}:8554/play-${job.source.id}`,
    ];
    const child = spawn("ffmpeg", args, { stdio: "ignore" });
    job.child = child;
    job.status = "running";
    let finished = false;
    const retry = () => {
      if (finished) return;
      finished = true;
      job.status = "reconnecting";
      if (!job.closed) {
        job.retry = setTimeout(() => void start(job), 3000);
        job.retry.unref();
      }
    };
    child.once("error", retry);
    child.once("exit", retry);
  } catch {
    job.status = "error";
    if (!job.closed) {
      job.retry = setTimeout(() => void start(job), 5000);
      job.retry.unref();
    }
  }
}
function stop(job) {
  job.closed = true;
  clearTimeout(job.retry);
  job.child?.kill("SIGTERM");
  setTimeout(() => job.child?.kill("SIGKILL"), 2000).unref();
}
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (!equal(req.headers["x-media-key"], key)) {
    res.writeHead(403).end("{}");
    return;
  }
  try {
    if (req.url === "/health") {
      res.end(
        JSON.stringify({
          ok: true,
          jobs: [...jobs.values()].map((j) => ({
            id: j.source.id,
            status: j.status,
          })),
        }),
      );
      return;
    }
    if (
      req.method !== "POST" ||
      !["/probe", "/ensure", "/release"].includes(req.url)
    ) {
      res.writeHead(404).end("{}");
      return;
    }
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 20000) throw Error("Too large");
    }
    const { source, consumer = "legacy" } = JSON.parse(body);
    if (
      !/^[a-f0-9]{32}$/.test(source?.id) ||
      !/^(legacy|[a-f0-9]{64})$/.test(consumer)
    )
      throw Error("Invalid lease");
    if (req.url === "/release") {
      const existing = jobs.get(source.id);
      existing?.consumers.delete(consumer);
      if (existing && !existing.consumers.size) {
        stop(existing);
        jobs.delete(source.id);
      }
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === "/probe") {
      const result = await probe(source);
      res.end(JSON.stringify({ ok: true, streams: result.streams }));
      return;
    }
    let job = jobs.get(source.id);
    if (job && JSON.stringify(job.source) !== JSON.stringify(source)) {
      stop(job);
      jobs.delete(source.id);
      job = null;
    }
    if (!job) {
      if (jobs.size >= 8) {
        res
          .writeHead(429)
          .end(JSON.stringify({ error: "Active media limit reached" }));
        return;
      }
      job = {
        source,
        status: "starting",
        seenAt: Date.now(),
        closed: false,
        consumers: new Map(),
      };
      jobs.set(source.id, job);
      void start(job);
    }
    job.seenAt = Date.now();
    job.consumers.set(consumer, Date.now());
    res.end(JSON.stringify({ ok: true, status: job.status }));
  } catch {
    res
      .writeHead(502)
      .end(JSON.stringify({ error: "Media source unavailable" }));
  }
});
setInterval(() => {
  for (const [id, job] of jobs) {
    for (const [consumer, time] of job.consumers)
      if (Date.now() - time > 75000) job.consumers.delete(consumer);
    if (!job.consumers.size) {
      stop(job);
      jobs.delete(id);
    }
  }
}, 15000).unref();
server.listen(8091, "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const job of jobs.values()) stop(job);
    server.close(() => process.exit());
    setTimeout(() => process.exit(), 3000).unref();
  });
