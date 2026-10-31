import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { currentItem } from "./Stage";
import { labels, type AnyRecord, type Item } from "./types";
import {
  Field,
  Button,
  Modal,
  SearchSelect,
  UploadImage,
  type Run,
} from "./ui";
import { ProfileFields, outputProfile } from "./OutputProfile";
import { TemplateThumbnail } from "./TemplateThumbnail";
import { useProtectedAction } from "./Confirm";
import { HealthSummary, MediaHealth } from "./Health";
export default function Admin({ state, run }: { state: AnyRecord; run: Run }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [group, setGroup] = useState("");
  const [pairing, setPairing] = useState(false);
  const [code, setCode] = useState("");
  const [pairName, setPairName] = useState("");
  const [details, setDetails] = useState(false);
  const [name, setName] = useState("");
  const [screenGroup, setScreenGroup] = useState("");
  const [profile, setProfile] = useState(outputProfile());
  const [item, setItem] = useState<Item>({ type: "logo", duration: 15 });
  const [items, setItems] = useState<Item[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [loop, setLoop] = useState(true);
  const [transition, setTransition] = useState("fade");
  const [planName, setPlanName] = useState("");
  const [plan, setPlan] = useState<AnyRecord | null>(null);
  const [pending, setPending] = useState(false);
  const commandBusy = useRef(false);
  const protection = useProtectedAction(run);
  const [savingPlan, setSavingPlan] = useState(false);
  const [, tick] = useState(0);
  const receivedClock = useRef({ server: state.serverTime, local: Date.now() });
  if (receivedClock.current.server !== state.serverTime)
    receivedClock.current = { server: state.serverTime, local: Date.now() };
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const serverNow =
    receivedClock.current.server + Date.now() - receivedClock.current.local;
  const plans = state.plans.filter(
    (p: any) => !p.workspaceId || p.workspaceId === state.activeWorkspaceId,
  );
  useEffect(() => {
    setItems((v) => v.map((row) => ({ ...row, teamId: "" })));
    setItem((v) => ({ ...v, teamId: "" }));
    setPlan(null);
    setPlanName("");
  }, [state.activeWorkspaceId, state.activeWorkspace?.sourceGeneration]);
  const acknowledged = useRef(new Map<string, number>());
  const displays = state.displays.map((d: any) => {
    const online = serverNow - (d.seenAt || 0) < 15000;
    return {
      ...d,
      online,
      health: {
        ...d.health,
        renderer: online ? d.health?.renderer || "unknown" : "offline",
      },
    };
  });
  const ids = displays.map((d: any) => d.id).join(",");
  useEffect(
    () =>
      setSelected((v) =>
        v.filter((id) => displays.some((d: any) => d.id === id)),
      ),
    [ids],
  );
  for (const d of displays)
    acknowledged.current.set(
      d.id,
      Math.max(d.revision, acknowledged.current.get(d.id) || 0),
    );
  const command = async (action: string, other = {}) => {
    if (commandBusy.current) throw Error("屏幕操作正在处理中");
    commandBusy.current = true;
    setPending(true);
    try {
      const result = await api("/displays/command", {
        ids: selected,
        revisions: Object.fromEntries(
          selected.map((id) => [id, acknowledged.current.get(id)]),
        ),
        action,
        ...other,
      });
      for (const d of result)
        acknowledged.current.set(
          d.id,
          Math.max(d.revision, acknowledged.current.get(d.id) || 0),
        );
      return result;
    } finally {
      commandBusy.current = false;
      setPending(false);
    }
  };
  const updateItem = (patch: Partial<Item>) => {
    const next = { ...item, ...patch };
    setItem(next);
    if (editingIndex !== null)
      setItems((rows) => rows.map((v, i) => (i === editingIndex ? next : v)));
  };
  const chooseTemplate = (type: string) => {
    setItem({
      type,
      duration: 15,
      text: "",
      targetTime: type === "countdown" ? Date.now() + 3600000 : undefined,
    });
    setEditingIndex(null);
  };
  const loadProgram = (p: any) => {
    setItems(p.items);
    setLoop(p.loop);
    setTransition(p.transition);
    setEditingIndex(null);
    setPlan(null);
    setPlanName("");
  };
  const savePlan = (copy = false) => {
    setSavingPlan(true);
    void run(
      async () => {
        try {
          const result = await api(
            plan && !copy
              ? `/presentations/plans/${plan.id}`
              : "/presentations/plans",
            {
              name: planName,
              workspaceId: state.activeWorkspaceId,
              items,
              loop,
              transition,
              revision: plan?.revision || 0,
            },
            plan && !copy ? "PUT" : "POST",
          );
          setPlan(result);
        } finally {
          setSavingPlan(false);
        }
      },
      copy ? "已另存节目单" : "节目单已保存",
    );
  };
  const groups = [
    ...new Set<string>(displays.map((d: any) => d.group).filter(Boolean)),
  ];
  const visible = displays.filter((d: any) => !group || d.group === group);
  const single =
    selected.length === 1
      ? displays.find((d: any) => d.id === selected[0])
      : null;
  return (
    <>
      <div className="admin-toolbar row spread">
        <div className="row">
          <h2>屏幕与节目</h2>
          <span className="muted">
            {displays.filter((d: any) => d.online).length} / {displays.length}{" "}
            在线
          </span>
        </div>
        <Button onClick={() => setPairing(true)}>连接展示屏</Button>
      </div>
      <div className="presentation-console">
        <section className="screen-rail">
          <div className="row spread">
            <h3>展示屏</h3>
            <Button
              className="secondary"
              onClick={() =>
                setSelected(
                  selected.length === visible.length
                    ? []
                    : visible.map((d: any) => d.id),
                )
              }
            >
              {selected.length === visible.length && visible.length
                ? "取消全选"
                : "全选"}
            </Button>
          </div>
          <Field label="屏幕分组">
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">全部屏幕</option>
              {groups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </Field>
          <div className="screens-list">
            {visible.map((d: any) => (
              <article
                className={
                  "screen-tile " + (selected.includes(d.id) ? "chosen" : "")
                }
                key={d.id}
              >
                <label className="screen-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(d.id)}
                    aria-label={`选择 ${d.name}`}
                    onChange={(e) =>
                      setSelected((v) =>
                        e.target.checked
                          ? [...v, d.id]
                          : v.filter((id) => id !== d.id),
                      )
                    }
                  />
                  <strong>{d.name}</strong>
                  <span className={d.online ? "online" : ""}>
                    {d.online ? "在线" : "离线"}
                  </span>
                </label>
                {d.thumbnail ? (
                  <img
                    className="screen-image"
                    src={d.thumbnail}
                    alt={`${d.name} 实际画面`}
                  />
                ) : (
                  <div className="screen-placeholder">等待画面回传</div>
                )}
                <div className="screen-status">
                  <span>
                    {d.hidden
                      ? "黑屏"
                      : d.mode === "standby"
                        ? "待机画面"
                        : d.paused
                          ? "暂停"
                          : labels[
                              currentItem(
                                d.program,
                                d.startedAt,
                                d.paused,
                                d.offset,
                                serverNow,
                              ).type
                            ]}
                  </span>
                  <span>
                    {d.appliedRevision === d.revision
                      ? "已执行"
                      : d.online
                        ? "等待执行"
                        : "待重连"}
                  </span>
                </div>
                <HealthSummary health={d.health} />
                <MediaHealth health={d.health} state={state} />
                <Button
                  className="text-button"
                  onClick={() => loadProgram(d.program)}
                >
                  载入当前节目单
                </Button>
              </article>
            ))}
          </div>
          {!displays.length ? (
            <p className="empty">
              在展示电脑打开 Presentations，再输入链接码。
            </p>
          ) : null}
        </section>
        <section className="template-library">
          <h3>展示模板</h3>
          <div className="template-grid">
            {Object.entries(labels)
              .filter(([type]) => type !== "standby")
              .map(([type, label]) => (
                <button
                  className={
                    "template-card " + (item.type === type ? "chosen" : "")
                  }
                  aria-pressed={item.type === type}
                  key={type}
                  onClick={() => chooseTemplate(type)}
                >
                  <TemplateThumbnail type={type} state={state.publicState} />
                  <span>{label}</span>
                </button>
              ))}
          </div>
        </section>
        <section className="program-inspector">
          <h3>
            {editingIndex === null
              ? "模板属性"
              : `编辑节目 ${editingIndex + 1}`}
          </h3>
          <strong>{labels[item.type]}</strong>
          <Field label="时长（秒）">
            <input
              type="number"
              min="2"
              max="3600"
              value={item.duration}
              onChange={(e) => updateItem({ duration: Number(e.target.value) })}
            />
          </Field>
          {item.type === "message" ? (
            <Field label="公告内容">
              <textarea
                value={item.text || ""}
                onChange={(e) => updateItem({ text: e.target.value })}
              />
            </Field>
          ) : null}
          {item.type === "countdown" ? (
            <Field label="目标时间">
              <input
                type="datetime-local"
                value={
                  item.targetTime
                    ? new Date(
                        item.targetTime -
                          new Date(item.targetTime).getTimezoneOffset() * 60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
                onChange={(e) =>
                  updateItem({
                    targetTime: e.target.value
                      ? new Date(e.target.value).getTime()
                      : 0,
                  })
                }
              />
            </Field>
          ) : null}
          {item.type === "team" ? (
            <Field label="队伍">
              <SearchSelect
                label="队伍"
                value={item.teamId || ""}
                options={[
                  { value: "", label: "自动选择第一支队伍" },
                  ...(state.activeWorkspace?.contest.teams || []).map(
                    (t: any) => ({
                      value: t.id,
                      label: `${t.label || t.id} · ${t.displayName || t.name}`,
                    }),
                  ),
                ]}
                onChange={(teamId) => updateItem({ teamId })}
              />
            </Field>
          ) : null}
          {item.type === "photos" ? (
            <>
              <Field label="图片链接，每行一个">
                <textarea
                  value={item.images?.join("\n") || ""}
                  onChange={(e) =>
                    updateItem({
                      images: e.target.value.split("\n").filter(Boolean),
                    })
                  }
                />
              </Field>
              <UploadImage
                run={run}
                onUpload={(url) =>
                  updateItem({ images: [...(item.images || []), url] })
                }
              />
            </>
          ) : null}
          <div className="row">
            <Button
              disabled={!selected.length || pending}
              onClick={() =>
                void run(
                  () =>
                    command("apply", {
                      program: { items: [item], loop: true, transition },
                    }),
                  "模板已预约上屏",
                )
              }
            >
              立即上屏
            </Button>
            <Button
              className="secondary"
              disabled={items.length >= 100}
              onClick={() => {
                setItems((v) => [...v, { ...item }]);
                setEditingIndex(null);
              }}
            >
              加入节目单
            </Button>
          </div>
          <hr />
          <div className="row spread">
            <h3>节目单</h3>
            <span className="muted">{items.length} 项</span>
          </div>
          <ol className="playlist-list">
            {items.map((v, i) => (
              <li className={editingIndex === i ? "chosen" : ""} key={i}>
                <button
                  className="playlist-label"
                  onClick={() => {
                    setItem({ ...v });
                    setEditingIndex(i);
                  }}
                >
                  {i + 1}. {labels[v.type]}
                  <small>{v.duration} 秒</small>
                </button>
                <div className="row">
                  <Button
                    className="secondary"
                    aria-label={`上移节目 ${i + 1}`}
                    disabled={!i}
                    onClick={() => {
                      setItems((x) => {
                        const a = [...x];
                        [a[i - 1], a[i]] = [a[i], a[i - 1]];
                        return a;
                      });
                      setEditingIndex(null);
                    }}
                  >
                    ↑
                  </Button>
                  <Button
                    className="secondary"
                    aria-label={`下移节目 ${i + 1}`}
                    disabled={i === items.length - 1}
                    onClick={() => {
                      setItems((x) => {
                        const a = [...x];
                        [a[i], a[i + 1]] = [a[i + 1], a[i]];
                        return a;
                      });
                      setEditingIndex(null);
                    }}
                  >
                    ↓
                  </Button>
                  <Button
                    className="secondary"
                    aria-label={`移除节目 ${i + 1}`}
                    onClick={() => {
                      setItems((x) => x.filter((_, n) => n !== i));
                      setEditingIndex(null);
                    }}
                  >
                    ×
                  </Button>
                </div>
              </li>
            ))}
          </ol>
          {!items.length ? (
            <p className="muted">选择模板并加入节目单。</p>
          ) : null}
          <label className="check">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />
            循环播放
          </label>
          <Field label="转场">
            <select
              value={transition}
              onChange={(e) => setTransition(e.target.value)}
            >
              <option value="fade">淡入淡出</option>
              <option value="cut">直接切换</option>
            </select>
          </Field>
          <Field label="已保存的节目单">
            <select
              value={plan?.id || ""}
              onChange={(e) => {
                const p = plans.find((p: any) => p.id === e.target.value);
                if (p) {
                  loadProgram(p);
                  setPlan(p);
                  setPlanName(p.name);
                } else {
                  setPlan(null);
                  setPlanName("");
                }
              }}
            >
              <option value="">新节目单</option>
              {plans.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="节目单名称">
            <input
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
            />
          </Field>
          <div className="row">
            <Button
              className="secondary"
              disabled={savingPlan || !items.length || !planName.trim()}
              onClick={() => savePlan()}
            >
              {plan ? "更新节目单" : "保存节目单"}
            </Button>
            {plan ? (
              <Button
                className="secondary"
                disabled={savingPlan || !items.length || !planName.trim()}
                onClick={() => savePlan(true)}
              >
                另存为
              </Button>
            ) : null}
          </div>
        </section>
      </div>
      <div className="screen-command-bar">
        <strong>已选 {selected.length} 个屏幕</strong>
        <Button
          disabled={!selected.length || !items.length || pending}
          onClick={() =>
            void run(
              () => command("apply", { program: { items, loop, transition } }),
              "节目单已预约同步切换",
            )
          }
        >
          下发节目单
        </Button>
        <div className="row">
          {[
            ["hide", "黑屏"],
            ["show", "恢复画面"],
            ["pause", "暂停"],
            ["resume", "继续"],
            ["previous", "上一项"],
            ["next", "下一项"],
            ["standby", "进入待机"],
            ["restore", "恢复节目"],
            ["rollback", "回切上一节目"],
          ].map(([action, label]) => (
            <Button
              key={action}
              className="secondary"
              disabled={
                !selected.length ||
                pending ||
                (action === "rollback" &&
                  selected.some(
                    (id) =>
                      !displays.find((d: any) => d.id === id)
                        ?.previousAvailable,
                  ))
              }
              onClick={() => void run(() => command(action), "屏幕操作已下发")}
            >
              {label}
            </Button>
          ))}
        </div>
        <Button
          className="secondary"
          disabled={!selected.length}
          onClick={() => {
            setName(single?.name || "");
            setScreenGroup(single?.group || "");
            setProfile(outputProfile(single?.outputProfile));
            setDetails(true);
          }}
        >
          屏幕设置
        </Button>
      </div>
      {pairing ? (
        <Modal title="连接展示屏" close={() => setPairing(false)}>
          <Field label="8 位链接码">
            <input
              inputMode="numeric"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="屏幕名称">
            <input
              value={pairName}
              onChange={(e) => setPairName(e.target.value)}
              placeholder="主舞台"
            />
          </Field>
          <Button
            disabled={code.length !== 8 || !pairName.trim() || pending}
            onClick={() =>
              void run(async () => {
                setPending(true);
                try {
                  const d = await api("/displays/pair", {
                    code,
                    name: pairName,
                  });
                  setSelected([d.id]);
                  setCode("");
                  setPairName("");
                  setPairing(false);
                } finally {
                  setPending(false);
                }
              }, "展示屏已连接")
            }
          >
            连接并命名
          </Button>
        </Modal>
      ) : null}
      {details ? (
        <Modal
          title={`屏幕设置 · ${selected.length} 个屏幕`}
          close={() => setDetails(false)}
        >
          {single ? (
            <Field label="屏幕名称">
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          ) : null}
          <Field label="分组">
            <input
              value={screenGroup}
              onChange={(e) => setScreenGroup(e.target.value)}
            />
          </Field>
          <Button
            className="secondary"
            disabled={pending}
            onClick={() =>
              void run(
                () =>
                  command("rename", {
                    name: single ? name : undefined,
                    group: screenGroup,
                  }),
                "名称与分组已保存",
              )
            }
          >
            保存名称与分组
          </Button>
          <hr />
          <h3>输出规格</h3>
          <ProfileFields value={profile} change={setProfile} />
          <Button
            disabled={pending}
            onClick={() =>
              void run(
                () => command("configure", { outputProfile: profile }),
                "输出规格已保存",
              )
            }
          >
            应用输出规格
          </Button>
          <hr />
          <Button
            className="secondary"
            disabled={pending || protection.pending}
            onClick={() => {
              const ids = [...selected],
                revisions = Object.fromEntries(
                  ids.map((id) => [id, acknowledged.current.get(id)]),
                );
              void protection.execute(
                {
                  title: "解除屏幕绑定",
                  details: [
                    `将解除 ${ids.length} 个屏幕：${displays
                      .filter((d: any) => ids.includes(d.id))
                      .map((d: any) => d.name)
                      .join("、")}`,
                    "这些屏幕将停止显示当前节目，需要重新配对。",
                  ],
                  confirm: "确认解除绑定",
                },
                async () => {
                  await command("revoke", { ids, revisions });
                  setDetails(false);
                },
                "已解除绑定",
              );
            }}
          >
            解除绑定
          </Button>
        </Modal>
      ) : null}
    </>
  );
}
