import React from "react";
import { api } from "./api";
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
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
