import { useEffect, useRef, useState } from "react";
import {
  outputProfile,
  type OutputProfile,
} from "../../public/js/output-profile.js";
import { displayGeometry } from "../../public/js/display-preferences.js";
import { Field } from "./ui";
export { outputProfile };
export type { OutputProfile };
export async function captureOutput(frame: string) {
  const area = document.querySelector(".output-area")?.getBoundingClientRect();
  const region = document
    .querySelector(".output-region")
    ?.getBoundingClientRect();
  if (!area?.width || !area.height || !region) return frame;
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(Error("画面捕获失败"));
  });
  image.src = frame;
  await loaded;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = Math.max(1, Math.round((320 * area.height) / area.width));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const fit = Math.min(
    region.width / image.naturalWidth,
    region.height / image.naturalHeight,
  );
  const scale = canvas.width / area.width;
  const width = image.naturalWidth * fit,
    height = image.naturalHeight * fit;
  ctx.drawImage(
    image,
    (region.left - area.left + (region.width - width) / 2) * scale,
    (region.top - area.top + (region.height - height) / 2) * scale,
    width * scale,
    height * scale,
  );
  return new Promise<string>((resolve) =>
    canvas.toBlob(
      (blob) => {
        if (!blob) return resolve(frame);
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve(frame);
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      0.65,
    ),
  );
}
export function ProfileFields({
  value,
  change,
}: {
  value: OutputProfile;
  change: (p: OutputProfile) => void;
}) {
  const update = (p: Partial<OutputProfile>) =>
    change(outputProfile({ ...value, ...p }));
  return (
    <div className="profile-fields">
      <Field label="渲染分辨率">
        <select
          value={value.resolution}
          onChange={(e) => update({ resolution: e.target.value })}
        >
          <option value="1080p">1080p</option>
          <option value="1440p">2K</option>
          <option value="2160p">4K</option>
        </select>
      </Field>
      <Field label="画面比例">
        <select
          value={value.aspect}
          onChange={(e) => update({ aspect: e.target.value })}
        >
          {["16:9", "4:3", "1:1", "21:9", "32:9", "auto"].map((v) => (
            <option key={v} value={v}>
              {v === "auto" ? "适应输出区域" : v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="安全边距 %">
        <input
          type="number"
          min="0"
          max="15"
          step="0.5"
          value={value.margin}
          onChange={(e) => update({ margin: Number(e.target.value) })}
        />
      </Field>
      <Field label="输出区域">
        <select
          value={value.region}
          onChange={(e) => update({ region: e.target.value })}
        >
          {Object.entries({
            full: "全屏",
            top: "上半屏",
            bottom: "下半屏",
            left: "左半屏",
            right: "右半屏",
            tl: "左上",
            tr: "右上",
            bl: "左下",
            br: "右下",
            custom: "自定义",
          }).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {value.region === "custom"
        ? (
            [
              ["x", "左侧 %"],
              ["y", "顶部 %"],
              ["width", "宽度 %"],
              ["height", "高度 %"],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              <input
                type="number"
                min="0"
                max="100"
                value={value[k]}
                onChange={(e) => update({ [k]: Number(e.target.value) })}
              />
            </Field>
          ))
        : null}
    </div>
  );
}
export function OutputArea({
  profile,
  children,
}: {
  profile: OutputProfile;
  children: (resolution: number, ratio: number) => React.ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useEffect(() => {
    const observer = new ResizeObserver(([e]) =>
      setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    observer.observe(element.current!);
    return () => observer.disconnect();
  }, []);
  const box = displayGeometry(profile, size.width, size.height);
  return (
    <div className="output-area" ref={element}>
      <div
        className="output-region"
        style={{
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        }}
      >
        {children(
          Number(profile.resolution.replace("p", "")),
          box.logicalWidth / 1080,
        )}
      </div>
    </div>
  );
}
