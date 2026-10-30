import React, { useState, useEffect, useRef } from "react";
import { api, subscribe, safeRead, safeWrite, copyText } from "./api";
import { Stage, type StageHandle } from "./Stage";
import {
  labels,
  widgetLabels,
  type AnyRecord,
  type Scene,
  type Item,
  type Program,
} from "./types";
import { Field, Button, UploadImage, type Run } from "./ui";
import liveConfig from "../vendor/icpc-live/config";
const widgetLocation: Record<string, string> = {
  scoreboard: "scoreboard",
  queue: "queue",
  firstSolves: "queue",
  team: "teamViewSingle",
  clock: "ticker",
  ticker: "ticker",
  title: "advertisement",
  image: "picture",
};
function defaultPosition(key: string) {
  const box = (liveConfig.WIDGET_POSITIONS as AnyRecord)[widgetLocation[key]];
  return {
    x: Number((box.positionX / 19.2).toFixed(2)),
    y: Number((box.positionY / 10.8).toFixed(2)),
  };
}
export default function Live({ state, run }: { state: AnyRecord; run: Run }) {
  const [tab, setTab] = useState("director");
  const [draft, setDraft] = useState<Scene>(state.broadcast.preview);
  const [dirty, setDirty] = useState(false);
  const draftRevision = useRef(state.broadcast.revision);
  const handle = useRef<StageHandle | null>(null);
  useEffect(() => {
    if (!dirty) setDraft(state.broadcast.preview);
  }, [state.broadcast.revision, dirty]);
  const change = (patch: Partial<Scene>) => {
    if (!dirty) draftRevision.current = state.broadcast.revision;
    setDraft((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const save = () =>
    api(
      "/broadcast/preview",
      {
        revision: dirty ? draftRevision.current : state.broadcast.revision,
        scene: draft,
      },
      "PUT",
    );
  const mediaHeaders = { "X-Output-Token": state.broadcast.token };
  return (
    <>
      <div className="tabs">
        {[
          ["director", "导播控制"],
          ["contest", "赛事接入"],
          ["media", "媒体来源"],
          ["assets", "赛事素材"],
          ["output", "输出设置"],
        ].map(([id, name]) => (
          <button
            className={tab === id ? "selected" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "contest" ? (
        <Contests state={state} run={run} />
      ) : tab === "assets" ? (
        <ContestAssets state={state} run={run} />
      ) : tab === "media" ? (
        <Sources state={state} run={run} />
      ) : tab === "output" ? (
        <section className="panel">
          <h2>OBS 输出</h2>
          <p>添加浏览器源，尺寸选择 1920×1080、2560×1440 或 3840×2160。</p>
          {["program", "overlay"].map((type) => (
            <Field
              label={type === "program" ? "正式画面链接" : "透明叠加链接"}
              key={type}
            >
              <div className="row">
                <input
                  readOnly
                  value={`${location.origin}/live/${type}/?clean=1#${state.broadcast.token}`}
                />
                <Button
                  onClick={() =>
                    void run(
                      () =>
                        copyText(
                          `${location.origin}/live/${type}/?clean=1#${state.broadcast.token}`,
                        ),
                      "链接已复制",
                    )
                  }
                >
                  复制链接
                </Button>
              </div>
            </Field>
          ))}
          <Button
            className="secondary"
            onClick={() =>
              void run(
                () => api("/broadcast/rotate-token", {}),
                "旧输出链接已失效，请更新 OBS",
              )
            }
          >
            重新生成输出链接
          </Button>
        </section>
      ) : (
        <>
          <div className="monitor-grid">
            <section className="monitor">
              <div className="monitor-label">
                <h2>预览画面</h2>
                <span>静音</span>
              </div>
              <Stage
                state={{ ...state.publicState, media: state.media }}
                scene={draft}
                headers={{ ...mediaHeaders, "X-Media-Preview": "1" }}
                handle={handle}
              />
            </section>
            <section className="monitor">
              <div className="monitor-label">
                <h2>正式画面</h2>
                <span className="live-dot">● LIVE</span>
              </div>
              <Stage
                state={state.publicState}
                scene={state.broadcast.program}
                headers={mediaHeaders}
              />
            </section>
          </div>
          <div className="row actions">
            <Button
              className="secondary"
              disabled={!dirty}
              onClick={() =>
                void run(async () => {
                  await save();
                  setDirty(false);
                })
              }
            >
              保存预览
            </Button>
            <Button
              onClick={() =>
                void run(async () => {
                  let revision = state.broadcast.revision;
                  if (dirty) {
                    const result = await save();
                    revision = result.revision;
                    setDirty(false);
                  }
                  await api("/broadcast/take", { revision });
                }, "正式画面已切换")
              }
            >
              切换到正式画面 →
            </Button>
          </div>
          <div className="two-columns">
            <section className="panel">
              <h2>画面布局</h2>
              <Field label="布局">
                <select
                  value={draft.layout}
                  onChange={(e) => change({ layout: e.target.value })}
                >
                  <option value="single">单队伍</option>
                  <option value="dual">双队伍对比</option>
                  <option value="quad">四分屏</option>
                </select>
              </Field>
              {Array.from(
                {
                  length:
                    draft.layout === "quad"
                      ? 4
                      : draft.layout === "dual"
                        ? 2
                        : 1,
                },
                (_, i) => (
                  <div className="slot" key={i}>
                    <Field label={`队伍 ${i + 1}`}>
                      <select
                        value={draft.teamIds[i] || ""}
                        onChange={(e) => {
                          const ids = [...draft.teamIds];
                          ids[i] = e.target.value;
                          change({ teamIds: ids });
                        }}
                      >
                        <option value="">选择队伍</option>
                        {state.activeWorkspace?.contest?.teams.map((t: any) => (
                          <option value={t.id} key={t.id}>
                            {t.displayName || t.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={`视频来源 ${i + 1}`}>
                      <select
                        value={draft.mediaIds[i] || ""}
                        onChange={(e) => {
                          const ids = [...draft.mediaIds];
                          ids[i] = e.target.value;
                          change({ mediaIds: ids });
                        }}
                      >
                        <option value="">使用队伍摄像头</option>
                        {state.media.map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ·{" "}
                            {m.role === "desktop"
                              ? "桌面"
                              : m.role === "audio"
                                ? "音频"
                                : "摄像头"}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                ),
              )}
              <Field label="正式输出音量">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={draft.volume}
                  onChange={(e) => change({ volume: Number(e.target.value) })}
                />
              </Field>
              <Field label="独立音频来源">
                <select
                  value={draft.audioMediaId || ""}
                  onChange={(e) => change({ audioMediaId: e.target.value })}
                >
                  <option value="">使用当前视频音频</option>
                  {state.media.map((m: any) => (
                    <option value={m.id} key={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <PresetControls
                draft={draft}
                change={change}
                state={state}
                run={run}
              />
            </section>
            <section className="panel">
              <h2>叠加组件</h2>
              <Button
                className="secondary"
                disabled={!Object.keys(draft.positions).length}
                onClick={() => change({ positions: {} })}
              >
                还原原版位置
              </Button>
              <div className="widget-grid">
                {Object.entries(widgetLabels).map(([key, label]) => (
                  <div className="widget" key={key}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={draft.widgets[key]}
                        onChange={(e) =>
                          change({
                            widgets: {
                              ...draft.widgets,
                              [key]: e.target.checked,
                            },
                          })
                        }
                      />
                      {label}
                    </label>
                    {draft.widgets[key] ? (
                      <div className="row">
                        <Field label="横向 %">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={
                              draft.positions[key]?.x ?? defaultPosition(key).x
                            }
                            onChange={(e) =>
                              change({
                                positions: {
                                  ...draft.positions,
                                  [key]: {
                                    x: Number(e.target.value),
                                    y:
                                      draft.positions[key]?.y ??
                                      defaultPosition(key).y,
                                  },
                                },
                              })
                            }
                          />
                        </Field>
                        <Field label="纵向 %">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={
                              draft.positions[key]?.y ?? defaultPosition(key).y
                            }
                            onChange={(e) =>
                              change({
                                positions: {
                                  ...draft.positions,
                                  [key]: {
                                    x:
                                      draft.positions[key]?.x ??
                                      defaultPosition(key).x,
                                    y: Number(e.target.value),
                                  },
                                },
                              })
                            }
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              <Field label="字幕">
                <input
                  value={draft.title}
                  onChange={(e) => change({ title: e.target.value })}
                />
              </Field>
              <Field label="滚动消息">
                <input
                  value={draft.ticker}
                  onChange={(e) => change({ ticker: e.target.value })}
                />
              </Field>
              <Field label="图片链接">
                <input
                  value={draft.image}
                  onChange={(e) => change({ image: e.target.value })}
                />
              </Field>
              <UploadImage
                onUpload={(url) => change({ image: url })}
                run={run}
              />
            </section>
          </div>
        </>
      )}
    </>
  );
}
function PresetControls({
  draft,
  change,
  state,
  run,
}: {
  draft: Scene;
  change: (p: Partial<Scene>) => void;
  state: AnyRecord;
  run: Run;
}) {
  const [name, setName] = useState("");
  return (
    <>
      <h3>布局预设</h3>
      <div className="row">
        <input
          aria-label="预设名称"
          placeholder="预设名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          className="secondary"
          disabled={!name.trim()}
          onClick={() =>
            void run(() => api("/broadcast/presets", { name, scene: draft }))
          }
        >
          保存预设
        </Button>
      </div>
      <div className="row">
        {state.broadcast.presets?.map((p: any) => (
          <Button
            className="secondary"
            key={p.id}
            onClick={() => change(p.scene)}
          >
            {p.name}
          </Button>
        ))}
      </div>
    </>
  );
}
function Contests({ state, run }: { state: AnyRecord; run: Run }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<AnyRecord>({
    url: "",
    mode: "api",
    contestId: "",
    username: "",
    password: "",
    bearer: "",
    allowPrivate: false,
  });
  const w = state.activeWorkspace;
  useEffect(
    () =>
      setSource(
        w?.source
          ? { ...w.source, password: undefined, bearer: undefined }
          : {
              url: "",
              mode: "api",
              contestId: "",
              username: "",
              password: "",
              bearer: "",
              allowPrivate: false,
            },
      ),
    [w?.id],
  );
  return (
    <div className="two-columns">
      <section className="panel">
        <h2>赛事工作区</h2>
        <Field label="当前工作区">
          <select
            value={state.activeWorkspaceId || ""}
            onChange={(e) =>
              void run(() => api(`/workspaces/${e.target.value}/activate`, {}))
            }
          >
            <option value="">选择赛事</option>
            {state.workspaces.map((x: any) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="新赛事名称">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button
          disabled={!name.trim()}
          onClick={() => void run(() => api("/workspaces", { name }))}
        >
          创建工作区
        </Button>
        <Field label="导入 NDJSON 事件流">
          <input
            type="file"
            accept=".json,.ndjson,.jsonl"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                void run(async () => {
                  if (f.size > 38 * 1024 * 1024) throw Error("文件超过 38 MB");
                  const response = await fetch(
                    `/api/workspaces?name=${encodeURIComponent(name || f.name)}`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/x-ndjson" },
                      body: await f.text(),
                      signal: AbortSignal.timeout(60000),
                    },
                  );
                  const result = await response.json();
                  if (!response.ok) throw Error(result.error || "导入失败");
                  return result;
                }, "赛事已导入");
            }}
          />
        </Field>
        {w ? (
          <>
            <p>
              {w.contest.teams.length} 支队伍 · {w.contest.problems.length} 道题
            </p>
            <p>
              数据源：
              {state.feed?.state === "connected"
                ? "已连接"
                : state.feed?.state === "error"
                  ? state.feed.message
                  : state.feed?.state === "stopped"
                    ? "未连接"
                    : "正在连接"}
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={w.unlocked}
                onChange={(e) =>
                  void run(
                    () =>
                      api(
                        `/workspaces/${w.id}`,
                        { revision: w.revision, unlocked: e.target.checked },
                        "PUT",
                      ),
                    e.target.checked
                      ? "公开画面已解榜"
                      : "公开画面已恢复封榜规则",
                  )
                }
              />
              公开解榜
            </label>
            <a className="button secondary" href="/resolver/">
              创建 Resolver 滚榜快照 ↗
            </a>
          </>
        ) : null}
      </section>
      <section className="panel">
        <h2>实时数据连接</h2>
        <Field label="来源类型">
          <select
            value={source.mode}
            onChange={(e) => setSource({ ...source, mode: e.target.value })}
          >
            <option value="api">Contest API 根地址</option>
            <option value="feed">持续事件流地址</option>
          </select>
        </Field>
        <Field label="来源地址">
          <input
            type="url"
            value={source.url || ""}
            onChange={(e) => setSource({ ...source, url: e.target.value })}
            placeholder="http://cds:8080/api/"
          />
        </Field>
        {source.mode === "api" ? (
          <Field label="比赛 ID">
            <input
              value={source.contestId || ""}
              onChange={(e) =>
                setSource({ ...source, contestId: e.target.value })
              }
            />
          </Field>
        ) : null}
        {[
          ["username", "用户名"],
          ["password", "密码"],
          ["bearer", "Bearer Token"],
        ].map(([key, label]) => (
          <Field label={label} key={key}>
            <input
              type={key === "username" ? "text" : "password"}
              value={source[key] || ""}
              placeholder={
                source[`has${key === "password" ? "Password" : "Bearer"}`]
                  ? "已保存；留空保留"
                  : ""
              }
              onChange={(e) =>
                setSource({ ...source, [key]: e.target.value || undefined })
              }
            />
          </Field>
        ))}
        <label className="check">
          <input
            type="checkbox"
            checked={!!source.allowPrivate}
            onChange={(e) =>
              setSource({ ...source, allowPrivate: e.target.checked })
            }
          />
          允许连接场馆内网地址
        </label>
        <div className="row">
          <Button
            disabled={!w || !source.url}
            onClick={() =>
              void run(
                () =>
                  api(
                    `/workspaces/${w.id}`,
                    { revision: w.revision, source },
                    "PUT",
                  ),
                "数据连接已保存",
              )
            }
          >
            保存并连接
          </Button>
          <Button
            className="secondary"
            disabled={!w?.source}
            onClick={() =>
              void run(
                () => api(`/workspaces/${w.id}/test`, {}),
                "来源连接正常",
              )
            }
          >
            测试连接
          </Button>
          <Button
            className="secondary"
            disabled={!w?.source}
            onClick={() =>
              void run(
                () =>
                  api(
                    `/workspaces/${w.id}`,
                    { revision: w.revision, source: null },
                    "PUT",
                  ),
                "数据连接已停止",
              )
            }
          >
            停止连接
          </Button>
        </div>
      </section>
    </div>
  );
}
function Sources({ state, run }: { state: AnyRecord; run: Run }) {
  const sources = state.media.filter(
    (m: any) =>
      !m.teamId || !m.workspaceId || m.workspaceId === state.activeWorkspaceId,
  );
  const [form, setForm] = useState<AnyRecord>({
    name: "",
    url: "",
    teamId: "",
    role: "camera",
    kind: "pull",
    allowPrivate: true,
    transcode: false,
  });
  const [bulk, setBulk] = useState("");
  return (
    <>
      <div className="two-columns">
        <section className="panel">
          <h2>添加媒体来源</h2>
          <Field label="来源名称">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="接入方式">
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              <option value="pull">拉取已有链接</option>
              <option value="publish">生成推送地址</option>
            </select>
          </Field>
          {form.kind === "pull" ? (
            <Field label="RTSP / RTMP / SRT / HLS / MP4 链接">
              <input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </Field>
          ) : null}
          <div className="row">
            <Field label="绑定队伍">
              <select
                value={form.teamId}
                onChange={(e) => setForm({ ...form, teamId: e.target.value })}
              >
                <option value="">通用来源</option>
                {state.activeWorkspace?.contest?.teams?.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName || t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="用途">
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="camera">摄像头</option>
                <option value="desktop">桌面</option>
                <option value="audio">音频</option>
              </select>
            </Field>
          </div>
          <div className="row">
            {[
              ["username", "用户名"],
              ["password", "密码"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type={key === "password" ? "password" : "text"}
                  value={form[key] || ""}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={form.allowPrivate}
              onChange={(e) =>
                setForm({ ...form, allowPrivate: e.target.checked })
              }
            />
            允许场馆内网来源
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.transcode}
              onChange={(e) =>
                setForm({ ...form, transcode: e.target.checked })
              }
            />
            兼容转码（浏览器无法播放原编码时启用）
          </label>
          <Button
            disabled={!form.name || (form.kind === "pull" && !form.url)}
            onClick={() =>
              void run(async () => {
                await api(
                  form.id ? `/media/sources/${form.id}` : "/media/sources",
                  { ...form, revision: state.revision },
                  form.id ? "PUT" : "POST",
                );
                setForm({
                  name: "",
                  url: "",
                  teamId: "",
                  role: "camera",
                  kind: "pull",
                  allowPrivate: true,
                  transcode: false,
                });
              })
            }
          >
            {form.id ? "保存来源" : "添加来源"}
          </Button>
        </section>
        <section className="panel">
          <h2>批量导入链接</h2>
          <Field label="JSON 数组，字段：name、url、teamId、role">
            <textarea
              rows={10}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={
                '[{"name":"1队摄像头","url":"rtsp://192.168.1.20/live","teamId":"1","role":"camera","allowPrivate":true}]'
              }
            />
          </Field>
          <Button
            disabled={!bulk.trim()}
            onClick={() =>
              void run(async () => {
                const rows = JSON.parse(bulk);
                if (!Array.isArray(rows) || rows.length > 100)
                  throw Error("请提供最多 100 项的 JSON 数组");
                let done = 0;
                try {
                  for (const r of rows) {
                    await api("/media/sources", r);
                    done++;
                  }
                } catch (e) {
                  throw Error(`已导入 ${done} 项；${(e as Error).message}`);
                }
                setBulk("");
              }, "批量导入完成")
            }
          >
            导入来源
          </Button>
        </section>
      </div>
      <section className="panel">
        <h2>来源列表</h2>
        {sources.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>队伍 / 用途</th>
                  <th>接入</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((m: any) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>
                      {state.activeWorkspace?.contest?.teams?.find(
                        (t: any) => t.id === m.teamId,
                      )?.displayName ||
                        m.teamId ||
                        "通用"}{" "}
                      ·{" "}
                      {
                        { camera: "摄像头", desktop: "桌面", audio: "音频" }[
                          m.role as "camera" | "desktop" | "audio"
                        ]
                      }
                    </td>
                    <td>
                      {m.kind === "publish" ? "推送" : "拉取"}
                      {m.transcode ? " · 转码" : ""}
                    </td>
                    <td>
                      <div className="row">
                        <Button
                          className="secondary"
                          onClick={() => setForm({ ...m, password: undefined })}
                        >
                          编辑
                        </Button>
                        <Button
                          className="secondary"
                          onClick={() =>
                            void run(async () => {
                              const v = await api(
                                `/media/sources/${m.id}/test`,
                                {},
                              );
                              if (!v.ok) throw Error(v.message || "来源不可用");
                            }, "媒体来源正常")
                          }
                        >
                          检测
                        </Button>
                        {m.kind === "publish" ? (
                          <Button
                            className="secondary"
                            onClick={() =>
                              void run(async () => {
                                const links = await api(
                                  `/media/sources/${m.id}/publish`,
                                );
                                await copyText(
                                  Object.entries(links)
                                    .map(([k, v]) => `${k}: ${v}`)
                                    .join("\n"),
                                );
                              }, "发布地址已复制")
                            }
                          >
                            复制推送地址
                          </Button>
                        ) : null}
                        <Button
                          className="secondary"
                          onClick={() =>
                            void run(
                              () =>
                                api(
                                  `/media/sources/${m.id}`,
                                  undefined,
                                  "DELETE",
                                ),
                              "来源已移除",
                            )
                          }
                        >
                          移除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">尚未添加媒体来源</p>
        )}
      </section>
    </>
  );
}

function ContestAssets({ state, run }: { state: AnyRecord; run: Run }) {
  const w = state.activeWorkspace;
  const [teamId, setTeamId] = useState("");
  const [logo, setLogo] = useState("");
  const [photo, setPhoto] = useState("");
  const [contestLogo, setContestLogo] = useState("");
  useEffect(() => {
    const t = w?.contest.teams.find((t: any) => t.id === teamId);
    setLogo(w?.assets?.teams?.[teamId]?.logo || "");
    setPhoto(w?.assets?.teams?.[teamId]?.photo || "");
    setContestLogo(w?.assets?.logo || "");
  }, [w?.id, teamId]);
  if (!w) return <p>请先创建或选择赛事工作区。</p>;
  const save = (assets: AnyRecord) =>
    api(`/workspaces/${w.id}`, { revision: w.revision, assets }, "PUT");
  return (
    <div className="two-columns">
      <section className="panel">
        <h2>赛事 Logo</h2>
        <Field label="赛事 Logo 地址">
          <input
            value={contestLogo}
            onChange={(e) => setContestLogo(e.target.value)}
          />
        </Field>
        <UploadImage run={run} onUpload={setContestLogo} />
        <Button onClick={() => void run(() => save({ logo: contestLogo }))}>
          保存赛事 Logo
        </Button>
      </section>
      <section className="panel">
        <h2>队伍素材</h2>
        <Field label="选择队伍">
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">选择队伍</option>
            {w.contest.teams.map((t: any) => (
              <option key={t.id} value={t.id}>
                {t.displayName || t.name}
              </option>
            ))}
          </select>
        </Field>
        {teamId ? (
          <>
            <Field label="校徽地址（留空使用自动适配）">
              <input value={logo} onChange={(e) => setLogo(e.target.value)} />
            </Field>
            <UploadImage run={run} onUpload={setLogo} />
            <Field label="队伍照片地址">
              <input value={photo} onChange={(e) => setPhoto(e.target.value)} />
            </Field>
            <UploadImage run={run} onUpload={setPhoto} />
            <Button
              onClick={() => void run(() => save({ teamId, logo, photo }))}
            >
              保存队伍素材
            </Button>
          </>
        ) : null}
      </section>
    </div>
  );
}
