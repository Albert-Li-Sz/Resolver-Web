import React, { useState, useEffect, useRef } from "react";
import { api, subscribe, safeRead, safeWrite } from "./api";
import { currentItem } from "./Stage";
import {
  labels,
  widgetLabels,
  type AnyRecord,
  type Scene,
  type Item,
  type Program,
} from "./types";
import { Field, Button, UploadImage, type Run } from "./ui";
export default function Admin({ state, run }: { state: AnyRecord; run: Run }) {
  const [code, setCode] = useState("");
  const [pairName, setPairName] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [group, setGroup] = useState("");
  const activeIds = state.displays.map((d: any) => d.id).join(",");
  useEffect(
    () =>
      setSelected((ids) =>
        ids.filter((id) => state.displays.some((d: any) => d.id === id)),
      ),
    [activeIds],
  );
  useEffect(() => {
    if (selected.length !== 1) return;
    const d = state.displays.find((d: any) => d.id === selected[0]);
    if (d) {
      setName(d.name);
      setGroup(d.group);
    }
  }, [selected.join(",")]);
  const [items, setItems] = useState<Item[]>([
    { type: "logo", duration: 15, text: "" },
  ]);
  const [loop, setLoop] = useState(true);
  const [transition, setTransition] = useState("fade");
  const [planName, setPlanName] = useState("");
  const command = (action: string, other = {}) =>
    api("/displays/command", {
      ids: selected,
      revisions: Object.fromEntries(
        state.displays.map((d: any) => [d.id, d.revision]),
      ),
      action,
      ...other,
    });
  const groups = [
    ...new Set<string>(state.displays.map((d: any) => d.group).filter(Boolean)),
  ];
  return (
    <>
      <section className="panel pairing">
        <h2>连接展示屏</h2>
        <div className="row">
          <Field label="8 位链接码">
            <input
              inputMode="numeric"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="00000000"
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
            disabled={code.length !== 8 || !pairName.trim()}
            onClick={() =>
              void run(async () => {
                await api("/displays/pair", { code, name: pairName });
                setCode("");
                setPairName("");
              }, "展示屏已连接")
            }
          >
            连接并命名
          </Button>
        </div>
      </section>
      <div className="admin-grid">
        <section className="panel">
          <div className="row spread">
            <h2>展示屏</h2>
            <Button
              className="secondary"
              onClick={() => setSelected(state.displays.map((d: any) => d.id))}
            >
              全选
            </Button>
          </div>
          <div className="row">
            {groups.map((g) => (
              <Button
                className="secondary"
                key={g}
                onClick={() =>
                  setSelected(
                    state.displays
                      .filter((d: any) => d.group === g)
                      .map((d: any) => d.id),
                  )
                }
              >
                {g}
              </Button>
            ))}
          </div>
          {state.displays.length ? (
            state.displays.map((d: any) => (
              <label
                className={
                  "screen-card " + (selected.includes(d.id) ? "chosen" : "")
                }
                key={d.id}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(d.id)}
                  onChange={(e) =>
                    setSelected((x) =>
                      e.target.checked
                        ? [...x, d.id]
                        : x.filter((id) => id !== d.id),
                    )
                  }
                />
                <div>
                  {d.thumbnail ? (
                    <img src={d.thumbnail} alt={`${d.name} 实际画面`} />
                  ) : (
                    <div className="screen-placeholder">等待画面回传</div>
                  )}
                  <strong>{d.name}</strong>
                  <Button
                    className="secondary"
                    onClick={() => {
                      setSelected([d.id]);
                      setItems(structuredClone(d.program.items));
                      setLoop(d.program.loop);
                      setTransition(d.program.transition);
                    }}
                  >
                    编辑节目单
                  </Button>
                  <p>
                    {d.online ? "● 在线" : "○ 离线"} ·{" "}
                    {d.hidden ? "黑屏" : d.paused ? "已暂停" : "播放中"} ·{" "}
                    {d.group || "未分组"}
                  </p>
                  <small>
                    {labels[
                      currentItem(
                        d.program,
                        d.startedAt,
                        d.paused,
                        d.offset,
                        state.serverTime,
                      ).type
                    ] || "等待节目"}
                  </small>
                  <small>
                    状态版本 {d.appliedRevision ?? "待回执"} / {d.revision}
                  </small>
                </div>
              </label>
            ))
          ) : (
            <p className="empty">
              在展示电脑打开 Presentations，输入其链接码。
            </p>
          )}
          <div className="control-grid">
            {[
              ["hide", "黑屏"],
              ["show", "恢复画面"],
              ["pause", "暂停"],
              ["resume", "继续"],
              ["previous", "上一项"],
              ["next", "下一项"],
            ].map(([action, label]) => (
              <Button
                className="secondary"
                disabled={!selected.length}
                key={action}
                onClick={() => void run(() => command(action))}
              >
                {label}
              </Button>
            ))}
          </div>
          <Field label="名称（单屏）">
            <input
              disabled={selected.length !== 1}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="分组">
            <input value={group} onChange={(e) => setGroup(e.target.value)} />
          </Field>
          <div className="row">
            <Button
              className="secondary"
              disabled={!selected.length}
              onClick={() =>
                void run(() =>
                  command("rename", {
                    name: selected.length === 1 ? name : undefined,
                    group,
                  }),
                )
              }
            >
              更新名称与分组
            </Button>
            <Button
              className="secondary"
              disabled={!selected.length}
              onClick={() =>
                void run(
                  () => command("revoke"),
                  "已解除绑定，展示屏将显示新链接码",
                )
              }
            >
              解除绑定
            </Button>
          </div>
        </section>
        <section className="panel">
          <h2>节目单</h2>
          {items.map((item, index) => (
            <div className="playlist-item" key={index}>
              <div className="row">
                <Field label={`节目 ${index + 1}`}>
                  <select
                    value={item.type}
                    onChange={(e) =>
                      setItems((x) =>
                        x.map((v, i) =>
                          i === index ? { ...v, type: e.target.value } : v,
                        ),
                      )
                    }
                  >
                    {Object.entries(labels).map(([id, name]) => (
                      <option value={id} key={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="时长（秒）">
                  <input
                    type="number"
                    min="2"
                    max="3600"
                    value={item.duration}
                    onChange={(e) =>
                      setItems((x) =>
                        x.map((v, i) =>
                          i === index
                            ? { ...v, duration: Number(e.target.value) }
                            : v,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
              {item.type === "message" ? (
                <Field label="公告内容">
                  <textarea
                    value={item.text || ""}
                    onChange={(e) =>
                      setItems((x) =>
                        x.map((v, i) =>
                          i === index ? { ...v, text: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </Field>
              ) : null}
              {item.type === "photos" ? (
                <>
                  <Field label="图片链接，每行一个">
                    <textarea
                      value={item.images?.join("\n") || ""}
                      onChange={(e) =>
                        setItems((x) =>
                          x.map((v, i) =>
                            i === index
                              ? {
                                  ...v,
                                  images: e.target.value
                                    .split("\n")
                                    .filter(Boolean),
                                }
                              : v,
                          ),
                        )
                      }
                    />
                  </Field>
                  <UploadImage
                    run={run}
                    onUpload={(url) =>
                      setItems((x) =>
                        x.map((v, i) =>
                          i === index
                            ? { ...v, images: [...(v.images || []), url] }
                            : v,
                        ),
                      )
                    }
                  />
                </>
              ) : null}
              {item.type === "countdown" ? (
                <Field label="目标时间">
                  <input
                    type="datetime-local"
                    onChange={(e) =>
                      setItems((x) =>
                        x.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                targetTime: new Date(e.target.value).getTime(),
                              }
                            : v,
                        ),
                      )
                    }
                  />
                </Field>
              ) : null}
              {item.type === "team" ? (
                <Field label="队伍">
                  <select
                    value={item.teamId || ""}
                    onChange={(e) =>
                      setItems((x) =>
                        x.map((v, i) =>
                          i === index ? { ...v, teamId: e.target.value } : v,
                        ),
                      )
                    }
                  >
                    <option value="">第一支队伍</option>
                    {state.activeWorkspace?.contest?.teams.map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.displayName || t.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <div className="row">
                <Button
                  className="secondary"
                  disabled={index === 0}
                  onClick={() =>
                    setItems((x) => {
                      const r = [...x];
                      [r[index - 1], r[index]] = [r[index], r[index - 1]];
                      return r;
                    })
                  }
                >
                  上移
                </Button>
                <Button
                  className="secondary"
                  disabled={index === items.length - 1}
                  onClick={() =>
                    setItems((x) => {
                      const r = [...x];
                      [r[index], r[index + 1]] = [r[index + 1], r[index]];
                      return r;
                    })
                  }
                >
                  下移
                </Button>
                <Button
                  className="secondary"
                  disabled={items.length === 1}
                  onClick={() =>
                    setItems((x) => x.filter((_, i) => i !== index))
                  }
                >
                  移除
                </Button>
              </div>
            </div>
          ))}
          <Button
            className="secondary"
            onClick={() =>
              setItems((x) => [
                ...x,
                { type: "message", duration: 15, text: "" },
              ])
            }
          >
            添加节目
          </Button>
          <div className="row">
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
          </div>
          <div className="row">
            <input
              aria-label="节目单名称"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="节目单名称"
            />
            <Button
              className="secondary"
              disabled={!planName.trim()}
              onClick={() =>
                void run(() =>
                  api("/presentations/plans", {
                    name: planName,
                    items,
                    loop,
                    transition,
                  }),
                )
              }
            >
              保存节目单
            </Button>
          </div>
          <div className="row">
            {state.plans.map((p: any) => (
              <Button
                className="secondary"
                key={p.id}
                onClick={() => {
                  setItems(p.items);
                  setLoop(p.loop);
                  setTransition(p.transition);
                  setPlanName(p.name);
                }}
              >
                {p.name}
              </Button>
            ))}
          </div>
          <Button
            disabled={!selected.length}
            onClick={() =>
              void run(
                () =>
                  command("apply", { program: { items, loop, transition } }),
                "节目单已预约同步切换",
              )
            }
          >
            下发到 {selected.length} 个展示屏
          </Button>
        </section>
      </div>
    </>
  );
}
