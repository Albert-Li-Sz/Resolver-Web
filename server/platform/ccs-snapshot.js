import { openFeed } from "./feed.js";
import { inputError, LIMITS } from "../lib/limits.js";

async function readResource(source, resource, signal, progress) {
  const base = new URL(
    `contests/${encodeURIComponent(source.contestId)}/`,
    source.url.replace(/\/?$/, "/"),
  );
  const url = resource
    ? new URL(resource, base)
    : new URL(base.href.replace(/\/$/, ""));
  const stream = await openFeed(
    { ...source, mode: "feed", url: url.href },
    { signal },
  );
  let text = "",
    size = 0;
  try {
    for await (const chunk of stream) {
      size += Buffer.byteLength(chunk);
      if (size > LIMITS.feedBytes)
        throw inputError("CCS 数据超过容量限制", 413);
      progress(Buffer.byteLength(chunk));
      text += chunk;
    }
    return JSON.parse(text);
  } finally {
    stream.destroy();
  }
}

// Before thawing, a valid event feed may stay open indefinitely. Finite REST
// resources let the resolver capture the full private result without thawing.
export async function ccsSnapshot(
  source,
  { signal, progress = () => {}, read = readResource } = {},
) {
  const types = [
    "",
    "state",
    "teams",
    "organizations",
    "problems",
    "judgement-types",
    "submissions",
    "judgements",
    "awards",
    "groups",
  ];
  const optional = new Set(["organizations", "groups", "awards"]);
  const values = await Promise.allSettled(
    types.map(async (type) => {
      try {
        return await read(source, type, signal, progress);
      } catch (e) {
        if (optional.has(type) && /HTTP (404|403)/.test(e.message)) return [];
        throw e;
      }
    }),
  );
  const data = {};
  for (let i = 0; i < types.length; i++) {
    const result = values[i];
    if (result.status === "rejected") throw result.reason;
    data[types[i]] = result.value;
    if (!["", "state"].includes(types[i]) && !Array.isArray(result.value))
      throw inputError(`CCS ${types[i]} 响应格式无效`, 502);
  }
  if (!data.state?.ended)
    throw inputError("比赛尚未结束，请在赛后获取滚榜文件");
  // Verify the volatile collections a second time rather than mixing two
  // judgement generations during a rejudge or a late submission.
  const [submissions, judgements, state] = await Promise.all(
    ["submissions", "judgements", "state"].map((type) =>
      read(source, type, signal, progress),
    ),
  );
  const ordered = (value) =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, ordered(value[key])]),
          )
        : value;
  const canonical = (rows) =>
    JSON.stringify(
      ordered(
        [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id))),
      ),
    );
  if (
    !Array.isArray(submissions) ||
    !Array.isArray(judgements) ||
    !state?.ended ||
    canonical(submissions) !== canonical(data.submissions) ||
    canonical(judgements) !== canonical(data.judgements)
  )
    throw inputError("CCS 判题结果仍在变化，请等待判题完成后重试", 409);
  data.state = state;
  const events = [];
  for (const type of types) {
    const rows = ["", "state"].includes(type) ? [data[type]] : data[type];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw inputError("CCS 数据格式无效", 502);
      events.push({
        type: type || "contests",
        id: row.id || (type === "state" ? "state" : source.contestId),
        data: row,
      });
    }
  }
  return events;
}
