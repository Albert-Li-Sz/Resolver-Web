import http from "node:http";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { mediaInput } from "./source.mjs";
const key = process.env.MEDIA_INTERNAL_KEY;
if (!key) throw Error("MEDIA_INTERNAL_KEY is required");
const host = process.env.MEDIA_MTX_HOST || "mediamtx";
const rtspPort = Number(process.env.MEDIA_MTX_RTSP_PORT || 20001);
const port = Number(process.env.MEDIA_WORKER_PORT || 20007);
if (![rtspPort, port].every(value => Number.isInteger(value) && value >= 1 && value <= 65535)) throw Error("Invalid media service port");
const networkPolicy = process.env.RESOLVER_NETWORK_POLICY || "open";
if (!["open", "restricted"].includes(networkPolicy)) throw Error("RESOLVER_NETWORK_POLICY must be open or restricted");
const jobs = new Map();
const equal = (a, b) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function input(source) {
  return mediaInput(source, { key, host, rtspPort, networkPolicy });
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
    job.transcoding = !!force;
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
      `rtsp://worker:${encodeURIComponent(key)}@${host}:${rtspPort}/play-${job.source.id}`,
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
            transcoding: j.transcoding === true,
            videoCodec: j.info?.streams?.find(s => s.codec_type === 'video')?.codec_name || null,
          })),
        }),
      );
      return;
    }
    if (
      req.method !== "POST" ||
      !["/probe", "/ensure", "/release", "/drop"].includes(req.url)
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
    if (req.url === "/drop") {
      const existing = jobs.get(source.id);
      if (existing) { stop(existing); jobs.delete(source.id); }
      res.end(JSON.stringify({ ok: true }));
      return;
    }
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
    if (job && ["id", "kind", "url", "username", "password", "allowPrivate", "transcode", "token"].some(field => job.source[field] !== source[field])) {
      stop(job);
      jobs.delete(source.id);
      job = null;
    }
    if (job) job.source = source;
    if (!job) {
      // Two four-video scenes plus their independent audio and handover leases.
      if (jobs.size >= 12) {
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
server.listen(port, "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const job of jobs.values()) stop(job);
    server.close(() => process.exit());
    setTimeout(() => process.exit(), 3000).unref();
  });
