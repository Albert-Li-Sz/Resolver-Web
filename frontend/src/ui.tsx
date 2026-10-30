import React, { useId } from "react";
import { api } from "./api";
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = useId();
  let linked = false;
  const linkControl = (nodes: React.ReactNode): React.ReactNode =>
    React.Children.map(nodes, (child) => {
      if (!React.isValidElement<Record<string, any>>(child)) return child;
      if (
        !linked &&
        ["input", "select", "textarea"].includes(String(child.type))
      ) {
        linked = true;
        return React.cloneElement(child, { id });
      }
      return child.props.children
        ? React.cloneElement(child, {
            children: linkControl(child.props.children),
          })
        : child;
    });
  const controls = linkControl(children);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {controls}
    </div>
  );
}
export function Button({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props}>{children}</button>;
}

export type Run = (
  fn: () => Promise<unknown>,
  success?: string,
) => Promise<void>;
export function UploadImage({
  onUpload,
  run,
}: {
  onUpload: (url: string) => void;
  run: Run;
}) {
  return (
    <Field label="上传图片">
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            void run(async () => {
              const r = await fetch("/api/assets", {
                method: "POST",
                headers: { "Content-Type": f.type },
                body: f,
              });
              const v = await r.json();
              if (!r.ok) throw Error(v.error);
              onUpload(v.url);
            });
        }}
      />
    </Field>
  );
}
