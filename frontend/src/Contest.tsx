import { useEffect, useState } from "react";
import { api } from "./api";
import { Field, Button, Modal, SearchSelect, type Run, feedStatus } from "./ui";
import { Sources, ContestAssets } from "./ContestResources";
import type { AnyRecord } from "./types";
import { useProtectedAction, type Confirmation } from "./Confirm";
export default function Contest({
  state,
  run,
}: {
  state: AnyRecord;
  run: Run;
}) {
  const [selected, setSelected] = useState(state.activeWorkspaceId || "");
  const protection = useProtectedAction(run);
  const [loaded, setLoaded] = useState<AnyRecord | null>(null);
  const [tab, setTab] = useState(
    new URLSearchParams(location.search).get("tab") || "connection",
  );
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const refresh = async (key = selected) => {
    if (key) setLoaded(await api(`/workspaces/${key}`));
  };
  useEffect(() => {
    let active = true;
    setLoaded(null);
    setError("");
    if (selected)
      void api(`/workspaces/${selected}`)
        .then((w) => {
          if (active) setLoaded(w);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected]);
  const w =
    selected === state.activeWorkspaceId ? state.activeWorkspace : loaded;
  const localRun: Run = (fn, success) =>
    run(async () => {
      await fn();
      await refresh();
    }, success);
  const scoped = { ...state, activeWorkspace: w, activeWorkspaceId: w?.id };
  return (
    <>
      <section className="contest-toolbar">
        <Field label="查看赛事">
          <SearchSelect
            label="查看赛事"
            value={selected}
            onChange={setSelected}
            options={state.workspaces.map((x: any) => ({
              value: x.id,
              label: x.name,
            }))}
            placeholder="选择赛事"
          />
        </Field>
        <Button className="secondary" onClick={() => setCreating(true)}>
          新建 / 导入赛事
        </Button>
        <Button
          disabled={
            !w || w.id === state.activeWorkspaceId || protection.pending
          }
          onClick={() =>
            void protection.execute(
              {
                title: "切换当前赛事",
                details: [
                  `目标赛事：${w!.name}`,
                  `Live 和 ${state.displays.length} 个已绑定屏幕将使用目标赛事，旧队伍和媒体引用将清空。`,
                  "已载入的 Resolver 滚榜保持独立。",
                ],
                confirm: "确认切换赛事",
              },
              () =>
                api(`/workspaces/${w!.id}/activate`, {
                  currentWorkspaceId: state.activeWorkspaceId,
                  expectedContextRevision: state.contextRevision || 0,
                }),
              "当前赛事已切换，全端同步",
            )
          }
        >
          切换当前赛事
        </Button>
      </section>
      {error ? <p role="alert">{error}</p> : null}
      {w ? (
        <>
          <div className="contest-summary">
            <h2>{w.name}</h2>
            <span>
              {w.id === state.activeWorkspaceId ? "当前赛事" : "未上屏"}
            </span>
            <span>
              {w.contest.teams.length} 支队伍 · {w.contest.problems.length} 道题
            </span>
          </div>
          <div className="tabs">
            {[
              ["connection", "数据连接"],
              ["assets", "展示与素材"],
              ["media", "队伍媒体"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? "selected" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "media" ? (
            <Sources
              key={`${w.id}:${w.sourceGeneration || 0}`}
              state={scoped}
              run={localRun}
            />
          ) : tab === "assets" ? (
            <ContestAssets
              key={`${w.id}:${w.sourceGeneration || 0}`}
              state={scoped}
              run={localRun}
            />
          ) : (
            <Connection key={w.id} workspace={w} state={state} run={localRun} />
          )}
        </>
      ) : (
        <p className="empty">
          {selected
            ? "正在载入赛事…"
            : "新建赛事后配置一次连接，供导播和所有展示屏使用。"}
        </p>
      )}
      {creating ? (
        <Modal title="新建赛事" close={() => setCreating(false)}>
          <Field label="赛事名称">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button
            disabled={!name.trim()}
            onClick={() =>
              void run(async () => {
                const v = await api("/workspaces", { name });
                setSelected(v.id);
                setCreating(false);
                setName("");
              }, "赛事已创建，请配置并切换当前赛事")
            }
          >
            创建赛事
          </Button>
          <hr />
          <Field label="导入 NDJSON">
            <input
              type="file"
              accept=".ndjson,.json,.jsonl"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void run(async () => {
                    if (f.size > 38 * 1024 * 1024)
                      throw Error("文件超过 38 MB");
                    const r = await fetch(
                      `/api/workspaces?name=${encodeURIComponent(name || f.name)}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/x-ndjson" },
                        body: await f.text(),
                      },
                    );
                    const v = await r.json();
                    if (!r.ok) throw Error(v.error);
                    setSelected(v.id);
                    setCreating(false);
                  }, "赛事已导入，尚未切换上屏");
              }}
            />
          </Field>
        </Modal>
      ) : null}
    </>
  );
}
function Connection({
  workspace: w,
  state,
  run,
}: {
  workspace: AnyRecord;
  state: AnyRecord;
  run: Run;
}) {
  const [source, setSource] = useState<AnyRecord>(() => ({
    mode: "api",
    url: "",
    contestId: "",
    auth: "none",
    ...w.source,
  }));
  const [base, setBase] = useState(w.configRevision || 0);
  const [dirty, setDirty] = useState(false);
  const protection = useProtectedAction(run);
  const pending = protection.pending;
  const change = (patch: AnyRecord) => {
    if (!dirty) setBase(w.configRevision || 0);
    setDirty(true);
    setSource((s) => ({ ...s, ...patch }));
  };
  useEffect(() => {
    if (!dirty) {
      setSource({
        mode: "api",
        url: "",
        contestId: "",
        auth: "none",
        ...w.source,
      });
      setBase(w.configRevision || 0);
    }
  }, [w.configRevision, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const before = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  const action = (
    fn: () => Promise<unknown>,
    message: string,
    prompt: Confirmation | null = null,
  ) => void protection.execute(prompt, fn, message);
  const sourceChanged =
    (!!w.source || !!w.contest?.teams?.length || !!w.contest?.submissions?.length) &&
    JSON.stringify([source.url, source.mode, source.contestId]) !==
      JSON.stringify([w.source?.url, w.source?.mode, w.source?.contestId]);
  return (
    <div className="two-columns">
      <section className="panel">
        <h2>CCS 数据连接</h2>
        <Field label="来源类型">
          <select
            value={source.mode}
            onChange={(e) => change({ mode: e.target.value })}
          >
            <option value="api">Contest API</option>
            <option value="feed">持续 NDJSON 事件流</option>
          </select>
        </Field>
        <Field label={source.mode === "api" ? "API 根地址" : "事件流地址"}>
          <input
            type="url"
            value={source.url || ""}
            placeholder="https://ccs.example/api/"
            onChange={(e) => change({ url: e.target.value })}
          />
        </Field>
        {source.mode === "api" ? (
          <Field label="比赛 ID">
            <input
              value={source.contestId || ""}
              onChange={(e) => change({ contestId: e.target.value })}
            />
          </Field>
        ) : null}
        <Field label="认证方式">
          <select
            value={
              source.auth ||
              (source.hasBearer ? "bearer" : source.username ? "basic" : "none")
            }
            onChange={(e) => change({ auth: e.target.value })}
          >
            <option value="none">无认证</option>
            <option value="basic">Basic</option>
            <option value="bearer">Bearer</option>
          </select>
        </Field>
        {source.auth === "basic" ? (
          <>
            <Field label="用户名">
              <input
                autoComplete="off"
                value={source.username || ""}
                onChange={(e) => change({ username: e.target.value })}
              />
            </Field>
            <Field label="密码">
              <input
                type="password"
                autoComplete="new-password"
                value={source.password || ""}
                placeholder={source.hasPassword ? "已保存；留空保留" : ""}
                onChange={(e) =>
                  change({ password: e.target.value || undefined })
                }
              />
            </Field>
          </>
        ) : null}
        {source.auth === "bearer" ? (
          <Field label="Bearer Token">
            <input
              type="password"
              autoComplete="new-password"
              value={source.bearer || ""}
              placeholder={source.hasBearer ? "已保存；留空保留" : ""}
              onChange={(e) => change({ bearer: e.target.value || undefined })}
            />
          </Field>
        ) : null}
        <label className="check">
          <input
            type="checkbox"
            checked={!!source.allowPrivate}
            onChange={(e) => change({ allowPrivate: e.target.checked })}
          />
          允许场馆内网地址
        </label>
        {dirty ? <p className="muted">有未保存的修改</p> : null}
        <div className="row">
          <Button
            disabled={
              pending ||
              !source.url ||
              (source.mode === "api" && !source.contestId)
            }
            onClick={() =>
              action(
                async () => {
                  const saved = await api(
                    `/workspaces/${w.id}`,
                    {
                      configRevision: base,
                      source: { ...source, enabled: true },
                      expectedContextRevision:
                        w.id === state.activeWorkspaceId
                          ? state.contextRevision || 0
                          : undefined,
                    },
                    "PUT",
                  );
                  setSource(saved.source);
                  setDirty(false);
                },
                w.id === state.activeWorkspaceId
                  ? "连接已保存并启用"
                  : "连接已保存，切换当前赛事后启用",
                sourceChanged && w.id === state.activeWorkspaceId
                  ? {
                      title: "替换当前赛事数据源",
                      details: [
                        `当前赛事：${w.name}`,
                        "实时数据和队伍、媒体引用将重新载入，公开榜单重新执行封榜规则，旧回切记录将清除。",
                        "Resolver 已载入的滚榜不受影响。",
                      ],
                      confirm: "确认替换数据源",
                    }
                  : null,
              )
            }
          >
            保存连接
          </Button>
          <Button
            className="secondary"
            disabled={pending || !source.url}
            onClick={() =>
              action(
                () => api(`/workspaces/${w.id}/test`, { source }),
                "当前填写的连接可用",
              )
            }
          >
            测试填写内容
          </Button>
          {w.source ? (
            <Button
              className="secondary"
              disabled={pending}
              onClick={() =>
                action(
                  () =>
                    api(
                      `/workspaces/${w.id}`,
                      {
                        configRevision: w.configRevision || 0,
                        source: {
                          ...w.source,
                          enabled: w.source.enabled === false,
                        },
                      },
                      "PUT",
                    ),
                  w.source.enabled === false
                    ? "连接已恢复"
                    : "连接已停止，配置已保留",
                )
              }
            >
              {w.source.enabled === false ? "重新连接" : "停止连接"}
            </Button>
          ) : null}
        </div>
      </section>
      <section className="panel">
        <h2>赛事状态</h2>
        <dl className="status-list">
          <dt>实时连接</dt>
          <dd>{feedStatus(w, state.feed, w.id === state.activeWorkspaceId)}</dd>
          <dt>已接收提交</dt>
          <dd>{w.contest.submissions.length}</dd>
          <dt>公开榜单</dt>
          <dd>{w.unlocked ? "已解榜" : "遵守封榜规则"}</dd>
        </dl>
        {w.id === state.activeWorkspaceId && state.feed?.message ? (
          <p role="status">{state.feed.message}</p>
        ) : null}
        <Button
          className="secondary"
          disabled={pending}
          onClick={() =>
            action(
              () =>
                api(
                  `/workspaces/${w.id}`,
                  {
                    configRevision: w.configRevision || 0,
                    unlocked: !w.unlocked,
                    expectedContextRevision: state.contextRevision || 0,
                  },
                  "PUT",
                ),
              w.unlocked ? "已恢复封榜规则" : "公开画面已解榜",
              {
                title: w.unlocked ? "恢复封榜规则" : "公开解榜",
                details: [
                  `赛事：${w.name}`,
                  w.id === state.activeWorkspaceId
                    ? `影响 Live 输出及 ${state.displays.length} 个已绑定屏幕的公开数据；不会推进 Resolver 滚榜。`
                    : "当前未启用此赛事；设置将在切换到此赛事后用于公开画面。",
                  w.unlocked
                    ? "恢复封榜不能收回观众已经看到的判题结果。"
                    : "封榜内完整判题将对观众公开。",
                ],
                checkbox: w.unlocked ? undefined : "确认公开封榜判题",
                confirm: w.unlocked ? "确认恢复封榜" : "确认公开解榜",
              },
            )
          }
        >
          {w.unlocked ? "恢复封榜规则" : "公开解榜"}
        </Button>
        <hr />
        <h3>赛后滚榜</h3>
        <p>从 CCS 获取完整 NDJSON，或上传赛后文件。</p>
        <a className="button" href="/resolver/">
          进入 Resolver →
        </a>
      </section>
    </div>
  );
}
