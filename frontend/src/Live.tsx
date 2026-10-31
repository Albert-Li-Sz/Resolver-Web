import { BroadcastOutputs } from "./BroadcastOutputs";
import { useState, useEffect, useRef } from "react";
import { api } from "./api";
import { Stage, type StageHandle } from "./Stage";
import { widgetLabels, type AnyRecord, type Scene } from "./types";
import { Field, Button, UploadImage, SearchSelect, type Run } from "./ui";
import liveConfig from "../vendor/icpc-live/config";
import { sceneMediaSlots } from "../../public/js/broadcast-media.js";
import { useProtectedAction } from "./Confirm";
import { LiveHealth } from "./Health";
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
  const controlRevision = useRef(state.broadcast.revision);
  controlRevision.current = Math.max(controlRevision.current, state.broadcast.revision);
  const handle = useRef<StageHandle | null>(null);
  const action = useProtectedAction(run);
  useEffect(() => {
    if (!dirty) setDraft(state.broadcast.preview);
  }, [state.broadcast.revision, dirty]);
  useEffect(() => {
    setDraft(state.broadcast.preview);
    setDirty(false);
    draftRevision.current = state.broadcast.revision;
    controlRevision.current = state.broadcast.revision;
  }, [state.activeWorkspaceId, state.activeWorkspace?.sourceGeneration]);
  const change = (patch: Partial<Scene>) => {
    if (!dirty) draftRevision.current = state.broadcast.revision;
    setDraft((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const save = () =>
    api(
      "/broadcast/preview",
      {
        revision: dirty ? draftRevision.current : controlRevision.current,
        scene: draft,
      },
      "PUT",
    );
  const mediaHeaders = { "X-Output-Token": state.broadcast.token };
  const emergency = (name: string, enabled?: boolean) =>
    void action.execute(
      null,
      async () => {
        const result = await api(`/broadcast/${name}`, {
          revision: controlRevision.current,
          ...(enabled === undefined ? {} : { enabled }),
        });
        controlRevision.current = result.revision;
        if (dirty) draftRevision.current = result.revision;
      },
      name === "rollback"
        ? "已回切上一正式节目"
        : enabled
          ? "正式输出已进入待机"
          : "正式节目已恢复",
    );
  const media = state.media.filter(
    (m: any) => !m.workspaceId || m.workspaceId === state.activeWorkspaceId,
  );
  const backups = sceneMediaSlots(draft, media, state.activeWorkspaceId).map(
    (slot) =>
      media.find(
        (m: any) =>
          m.id ===
          media.find((primary: any) => primary.id === slot.primary)?.fallbackId,
      ),
  );
  const audioBackup = media.find(
    (m: any) =>
      m.id ===
      media.find((primary: any) => primary.id === draft.audioMediaId)
        ?.fallbackId,
  );
  return (
    <>
      <div className="tabs">
        {[
          ["director", "导播控制"],
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
      {tab === "output" ? (
        <BroadcastOutputs state={state} run={run} />
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
                outputMode="program"
              />
            </section>
            <section className="monitor">
              <div className="monitor-label">
                <h2>正式画面</h2>
                <span className="live-dot">
                  {state.broadcast.mode === "standby" ? "● 待机" : "● LIVE"}
                </span>
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
              disabled={!dirty || action.pending}
              onClick={() =>
                void action.execute(null, async () => {
                  const saved = await save(); controlRevision.current = saved.revision;
                  setDirty(false);
                })
              }
            >
              保存预览
            </Button>
            <Button
              disabled={action.pending}
              onClick={() =>
                void action.execute(
                  null,
                  async () => {
                    let revision = controlRevision.current;
                    if (dirty) {
                      const result = await save();
                      revision = result.revision;
                      setDirty(false);
                    }
                    const taken = await api("/broadcast/take", { revision }); controlRevision.current = taken.revision;
                  },
                  "正式画面已切换",
                )
              }
            >
              切换到正式画面 →
            </Button>
            <Button
              className="secondary"
              disabled={action.pending || state.broadcast.mode === "standby"}
              onClick={() => emergency("standby", true)}
            >
              进入待机
            </Button>
            <Button
              className="secondary"
              disabled={action.pending || state.broadcast.mode !== "standby"}
              onClick={() => emergency("standby", false)}
            >
              恢复正式节目
            </Button>
            <Button
              className="secondary"
              disabled={action.pending || !state.broadcast.previousProgram}
              onClick={() => emergency("rollback")}
            >
              回切上一正式节目
            </Button>
          </div>
          <LiveHealth state={state} />
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
                      <SearchSelect
                        label={`队伍 ${i + 1}`}
                        value={draft.teamIds[i] || ""}
                        options={(
                          state.activeWorkspace?.contest?.teams || []
                        ).map((t: any) => ({
                          value: t.id,
                          label: `${t.label || t.id} · ${t.displayName || t.name}`,
                        }))}
                        placeholder="搜索队伍或学校"
                        onChange={(value) => {
                          const ids = [...draft.teamIds];
                          ids[i] = value;
                          const mediaIds = [...draft.mediaIds];
                          mediaIds[i] = "";
                          change({ teamIds: ids, mediaIds });
                        }}
                      />
                    </Field>
                    <Field label={`视频来源 ${i + 1}`}>
                      <SearchSelect
                        label={`视频来源 ${i + 1}`}
                        value={draft.mediaIds[i] || ""}
                        onChange={(value) => {
                          const ids = [...draft.mediaIds];
                          ids[i] = value;
                          change({ mediaIds: ids });
                        }}
                        options={[
                          { value: "", label: "使用队伍摄像头" },
                          ...media
                            .filter((m: any) => m.role !== "audio")
                            .map((m: any) => ({
                              value: m.id,
                              label: `${m.name} · ${m.role === "desktop" ? "桌面" : "摄像头"}`,
                            })),
                        ]}
                      />
                    </Field>
                    {backups[i] ? (
                      <Button
                        className="secondary"
                        onClick={() => {
                          const ids = [...draft.mediaIds];
                          ids[i] = backups[i].id;
                          change({ mediaIds: ids });
                        }}
                      >
                        预览备用源：{backups[i].name}
                      </Button>
                    ) : null}
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
                <SearchSelect
                  label="独立音频来源"
                  value={draft.audioMediaId || ""}
                  onChange={(audioMediaId) => change({ audioMediaId })}
                  options={[
                    { value: "", label: "使用当前视频音频" },
                    ...media.map((m: any) => ({ value: m.id, label: m.name })),
                  ]}
                />
              </Field>
              {audioBackup ? (
                <Button
                  className="secondary"
                  onClick={() => change({ audioMediaId: audioBackup.id })}
                >
                  预览备用音频：{audioBackup.name}
                </Button>
              ) : null}
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
                      <details>
                        <summary>位置</summary>
                        <div className="row">
                          <Field label="横向 %">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={
                                draft.positions[key]?.x ??
                                defaultPosition(key).x
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
                                draft.positions[key]?.y ??
                                defaultPosition(key).y
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
                      </details>
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
  const [editing, setEditing] = useState<AnyRecord | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setEditing(null);
    setName("");
  }, [state.activeWorkspaceId, state.activeWorkspace?.sourceGeneration]);
  const savePreset = (copy = false) => {
    setSaving(true);
    void run(
      async () => {
        try {
          const result = await api(
            editing && !copy
              ? `/broadcast/presets/${editing.id}`
              : "/broadcast/presets",
            {
              name,
              scene: draft,
              workspaceId: state.activeWorkspaceId,
              revision: editing?.revision || 0,
            },
            editing && !copy ? "PUT" : "POST",
          );
          setEditing(result);
        } finally {
          setSaving(false);
        }
      },
      copy ? "已另存预设" : "预设已保存",
    );
  };
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
          disabled={saving || !name.trim()}
          onClick={() => savePreset()}
        >
          {editing ? "更新预设" : "保存预设"}
        </Button>
      </div>
      {editing ? (
        <Button
          className="secondary"
          disabled={saving || !name.trim()}
          onClick={() => savePreset(true)}
        >
          另存为
        </Button>
      ) : null}
      <div className="row">
        {state.broadcast.presets
          ?.filter(
            (p: any) =>
              !p.workspaceId || p.workspaceId === state.activeWorkspaceId,
          )
          .map((p: any) => (
            <Button
              className="secondary"
              key={p.id}
              onClick={() => {
                change(p.scene);
                setName(p.name);
                setEditing(p);
              }}
            >
              {p.name}
            </Button>
          ))}
      </div>
    </>
  );
}
