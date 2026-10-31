import { useState } from "react";
import { api, copyText } from "./api";
import { Field, Button, type Run } from "./ui";
import { ProfileFields, outputProfile } from "./OutputProfile";
import type { AnyRecord } from "./types";
import { useProtectedAction } from "./Confirm";
export function BroadcastOutputs({
  state,
  run,
}: {
  state: AnyRecord;
  run: Run;
}) {
  const [type, setType] = useState("program");
  const protection = useProtectedAction(run);
  const [profile, setProfile] = useState(() =>
    outputProfile(state.broadcast.outputProfiles?.program),
  );
  const [revision, setRevision] = useState(state.broadcast.outputRevision || 0);
  const url = `${location.origin}/live/${type}/?clean=1#${state.broadcast.token}`;
  return (
    <section className="panel">
      <h2>OBS 输出</h2>
      <Field label="输出类型">
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setProfile(
              outputProfile(state.broadcast.outputProfiles?.[e.target.value]),
            );
            setRevision(state.broadcast.outputRevision || 0);
          }}
        >
          <option value="program">正式画面</option>
          <option value="overlay">透明叠加</option>
        </select>
      </Field>
      <ProfileFields
        value={profile}
        change={(value) => {
          setProfile(value);
        }}
      />
      <div className="row" style={{ margin: "18px 0" }}>
        <Button
          onClick={() =>
            void run(async () => {
              const result = await api(
                "/broadcast/output-settings",
                { type, outputProfile: profile, revision },
                "PUT",
              );
              setRevision(result.revision);
            }, "输出规格已保存")
          }
        >
          保存输出规格
        </Button>
      </div>
      <Field label={type === "program" ? "正式画面链接" : "透明叠加链接"}>
        <div className="row">
          <input readOnly value={url} />
          <Button onClick={() => void run(() => copyText(url), "链接已复制")}>
            复制链接
          </Button>
        </div>
      </Field>
      <Button
        className="secondary"
        disabled={protection.pending}
        onClick={() =>
          void protection.execute(
            {
              title: "重新生成输出链接",
              details: [
                `${(state.outputs || []).filter((o: any) => o.online).length} 个已知独立输出浏览器在线。`,
                "所有旧正式画面和透明叠加链接将失效，OBS 浏览器源需要更新链接。",
                "通过展示屏身份播放的 Live 适配器不受换链影响。",
              ],
              confirm: "确认更换输出链接",
            },
            () =>
              api("/broadcast/rotate-token", {
                tokenRevision: state.broadcast.tokenRevision || 0,
              }),
            "输出链接已更新，请更新 OBS 浏览器源",
          )
        }
      >
        重新生成输出链接
      </Button>
    </section>
  );
}
