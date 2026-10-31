import React, { useState, useEffect } from "react";
import { api, copyText } from "./api";
import { Field, Button, UploadImage, SearchSelect, type Run } from "./ui";
import type { AnyRecord } from "./types";
import { useProtectedAction } from "./Confirm";
import { sceneMediaIds } from "../../public/js/broadcast-media.js";
function sourceReferenced(state: AnyRecord, id: string) {
  return [state.broadcast.program, state.broadcast.previousProgram?.scene]
    .filter(Boolean)
    .some((scene) =>
      sceneMediaIds(scene, state.media, state.publicState?.workspaceId || state.activeWorkspaceId).includes(id),
    );
}
function sourceImpact(state: AnyRecord, id: string) {
  const workspaceId = state.publicState?.workspaceId || state.activeWorkspaceId;
  const references = [
    [state.broadcast.program, state.broadcast.mode === "standby" ? "待机恢复节目" : "当前正式节目"],
    [state.broadcast.previousProgram?.scene, "上一正式节目回切记录"],
  ].filter(([scene]) => scene && sceneMediaIds(scene, state.media, workspaceId).includes(id)).map(([, label]) => label);
  const screens = state.displays.filter((d: AnyRecord) => d.program.items.some((item: AnyRecord) => item.type === "live"));
  return [
    `引用：${references.join("、")}`,
    `影响独立 Live 输出${screens.length ? `及 Live 适配屏：${screens.map((d: AnyRecord) => d.name).join("、")}` : "；当前没有 Live 适配屏"}。`,
  ];
}
export function Sources({ state, run }: { state: AnyRecord; run: Run }) {
  const protection = useProtectedAction(run);
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
              <SearchSelect
                label="绑定队伍"
                value={form.teamId}
                onChange={(teamId) => setForm({ ...form, teamId })}
                options={[
                  { value: "", label: "通用来源" },
                  ...(state.activeWorkspace?.contest?.teams || []).map(
                    (t: any) => ({
                      value: t.id,
                      label: `${t.label || t.id} · ${t.displayName || t.name}`,
                    }),
                  ),
                ]}
              />
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
          <details className="source-advanced">
            <summary>高级设置</summary>
            {form.kind === "pull" ? (
              <div className="row">
                {[
                  ["username", "用户名"],
                  ["password", "密码"],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      type={key === "password" ? "password" : "text"}
                      value={form[key] || ""}
                      placeholder={
                        key === "password" && form.hasPassword
                          ? "已保存；留空保留"
                          : ""
                      }
                      onChange={(e) =>
                        setForm({ ...form, [key]: e.target.value || undefined })
                      }
                    />
                  </Field>
                ))}
              </div>
            ) : null}
            <Field label="备用来源">
              <SearchSelect
                label="备用来源"
                value={form.fallbackId || ""}
                onChange={(fallbackId) => setForm({ ...form, fallbackId })}
                options={[
                  { value: "", label: "无备用来源" },
                  ...sources
                    .filter(
                      (m: any) =>
                        m.id !== form.id &&
                        (form.role === "audio"
                          ? m.role === "audio"
                          : m.role !== "audio"),
                    )
                    .map((m: any) => ({ value: m.id, label: m.name })),
                ]}
              />
            </Field>
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
              兼容转码
            </label>
          </details>
          <Button
            disabled={
              protection.pending ||
              !form.name.trim() ||
              (form.kind === "pull" && !form.url.trim())
            }
            onClick={() => {
              const old = sources.find((m: any) => m.id === form.id);
              const changed =
                old &&
                [
                  "url",
                  "kind",
                  "username",
                  "password",
                  "transcode",
                  "teamId",
                  "role",
                  "allowPrivate",
                ].some(
                  (key) => form[key] !== undefined && form[key] !== old[key],
                );
              void protection.execute(
                changed && sourceReferenced(state, form.id)
                  ? {
                      title: "替换正式节目媒体来源",
                      details: [
                        `媒体来源：${old.name}`,
                        ...sourceImpact(state, form.id),
                        "修改连接参数可能中断视频与声音。",
                      ],
                      confirm: "确认替换媒体来源",
                    }
                  : null,
                async () => {
                  await api(
                    form.id ? `/media/sources/${form.id}` : "/media/sources",
                    {
                      ...form,
                      workspaceId: form.teamId ? state.activeWorkspaceId : "",
                      sourceRevision: form.revision || 0,
                      expectedBroadcastRevision: changed ? state.broadcast.revision : undefined,
                    },
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
                },
              );
            }}
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
                    await api("/media/sources", {
                      ...r,
                      workspaceId: r.teamId ? state.activeWorkspaceId : "",
                    });
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
                          disabled={protection.pending}
                          onClick={() =>
                            void protection.execute(
                              sourceReferenced(state, m.id)
                                ? {
                                    title: "移除正式节目媒体来源",
                                    details: [
                                      `媒体来源：${m.name}`,
                                      ...sourceImpact(state, m.id),
                                      "此来源将停止播放；固定引用显示占位，相关回切记录不可用。",
                                    ],
                                    confirm: "确认移除来源",
                                  }
                                : null,
                              () =>
                                api(
                                  `/media/sources/${m.id}`,
                                  { sourceRevision: m.revision || 0, expectedBroadcastRevision: state.broadcast.revision },
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

export function ContestAssets({ state, run }: { state: AnyRecord; run: Run }) {
  const w = state.activeWorkspace;
  if (!w) return <p>请先选择赛事。</p>;
  return (
    <>
      <PresentationLanguage workspace={w} run={run} />
      <div className="two-columns">
        {(["contest", "organization", "team"] as const).map((kind) => (
          <AssetEditor key={kind} kind={kind} workspace={w} run={run} />
        ))}
      </div>
    </>
  );
}
function PresentationLanguage({
  workspace: w,
  run,
}: {
  workspace: AnyRecord;
  run: Run;
}) {
  const [locale, setLocale] = useState(w.presentationLocale || "en");
  const protection = useProtectedAction(run);
  useEffect(
    () => setLocale(w.presentationLocale || "en"),
    [w.presentationLocale],
  );
  return (
    <section className="panel language-panel">
      <h2>大屏语言</h2>
      <Field label="大屏模板语言">
        <select
          value={locale}
          disabled={protection.pending}
          onChange={(e) => {
            const value = e.target.value;
            setLocale(value);
            void protection.execute(
              null,
              async () => {
                try {
                  await api(
                    `/workspaces/${w.id}`,
                    {
                      configRevision: w.configRevision || 0,
                      presentationLocale: value,
                    },
                    "PUT",
                  );
                } catch (error) {
                  setLocale(w.presentationLocale || "en");
                  throw error;
                }
              },
              "大屏语言已保存",
            );
          }}
        >
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
      </Field>
      <p className="muted">此赛事的大屏原生模板统一使用所选语言。</p>
    </section>
  );
}
function AssetEditor({
  kind,
  workspace: w,
  run,
}: {
  kind: "contest" | "organization" | "team";
  workspace: AnyRecord;
  run: Run;
}) {
  const [selected, setSelected] = useState("");
  const [logo, setLogo] = useState(
    kind === "contest" ? w.assets?.logo || "" : "",
  );
  const [photo, setPhoto] = useState("");
  const [base, setBase] = useState(w.configRevision || 0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (dirty) return;
    setBase(w.configRevision || 0);
    setLogo(
      kind === "contest"
        ? w.assets?.logo || ""
        : kind === "organization"
          ? w.assets?.organizations?.[selected] || ""
          : w.assets?.teams?.[selected]?.logo || "",
    );
    setPhoto(w.assets?.teams?.[selected]?.photo || "");
  }, [w.configRevision, selected]);
  const change = (setter: (v: string) => void, value: string) => {
    if (!dirty) setBase(w.configRevision || 0);
    setDirty(true);
    setter(value);
  };
  const titles = {
    contest: "赛事 Logo",
    organization: "学校校徽",
    team: "队伍素材",
  };
  const rows =
    kind === "organization" ? w.contest.organizations : w.contest.teams;
  return (
    <section className="panel">
      <h2>{titles[kind]}</h2>
      {kind !== "contest" ? (
        <Field label={kind === "team" ? "选择队伍" : "学校"}>
          <SearchSelect
            label={kind === "team" ? "选择队伍" : "学校"}
            value={selected}
            onChange={(id) => {
              if (id !== selected) {
                setDirty(false);
                setSelected(id);
              }
            }}
            options={rows.map((r: any) => ({
              value: r.id,
              label: r.displayName || r.name,
            }))}
          />
        </Field>
      ) : null}
      {kind === "contest" || selected ? (
        <>
          <Field
            label={
              kind === "team"
                ? "队伍标识地址（留空使用学校校徽）"
                : kind === "organization"
                  ? "校徽地址"
                  : "赛事 Logo 地址"
            }
          >
            <input
              value={logo}
              placeholder={kind === "organization" ? "留空使用自动适配" : ""}
              onChange={(e) => change(setLogo, e.target.value)}
            />
          </Field>
          <UploadImage run={run} onUpload={(url) => change(setLogo, url)} />
          {kind === "team" ? (
            <>
              <Field label="队伍照片地址">
                <input
                  value={photo}
                  onChange={(e) => change(setPhoto, e.target.value)}
                />
              </Field>
              <UploadImage
                run={run}
                onUpload={(url) => change(setPhoto, url)}
              />
            </>
          ) : null}
          {dirty ? <p className="muted">有未保存的修改</p> : null}
          <Button
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void run(async () => {
                try {
                  const assets =
                    kind === "contest"
                      ? { logo }
                      : kind === "organization"
                        ? { organizationId: selected, organizationLogo: logo }
                        : { teamId: selected, logo, photo };
                  const saved = await api(
                    `/workspaces/${w.id}`,
                    { configRevision: base, assets },
                    "PUT",
                  );
                  setBase(saved.configRevision);
                  setDirty(false);
                } finally {
                  setSaving(false);
                }
              }, "素材已保存");
            }}
          >
            保存{titles[kind]}
          </Button>
        </>
      ) : null}
    </section>
  );
}
