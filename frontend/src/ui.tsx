import React, { useId, useEffect, useRef, useState } from "react";
import { api } from "./api";
export function feedStatus(workspace: any, feed: any, active = true) {
  if (!workspace) return "尚未选择赛事";
  if (!active) return "非当前赛事";
  if (!workspace.source)
    return workspace.contest?.teams?.length ? "文件数据" : "未配置数据源";
  if (workspace.source.enabled === false) return "连接已停止";
  return (
    (
      {
        connected: "实时数据已连接",
        connecting: "正在连接",
        reconnecting: "正在重连",
        error: "连接异常，正在重连",
        stopped: "未连接",
      } as Record<string, string>
    )[feed?.state] || "未连接"
  );
}
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
        (["input", "select", "textarea"].includes(String(child.type)) ||
          child.type === SearchSelect)
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
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="row spread">
        <h2 id={id}>{title}</h2>
        <button className="secondary" onClick={close} aria-label="关闭对话框">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function SearchSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder = "搜索",
  disabled = false,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const filtered = options.filter((o) =>
    `${o.label} ${o.value}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };
  return (
    <div
      className="search-select"
      ref={root}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <input
        id={id}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && filtered[active] ? `${listId}-${active}` : undefined
        }
        disabled={disabled}
        placeholder={placeholder}
        value={
          open ? query : options.find((o) => o.value === value)?.label || ""
        }
        onFocus={() => {
          setQuery("");
          setActive(0);
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActive((n) =>
              Math.max(
                0,
                Math.min(
                  filtered.length - 1,
                  n + (e.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if (e.key === "Enter" && open && filtered[active]) {
            e.preventDefault();
            choose(filtered[active].value);
          }
        }}
      />
      {open ? (
        <div
          className="search-options"
          id={listId}
          role="listbox"
          aria-label={label}
        >
          {filtered.length ? (
            filtered.map((o, i) => (
              <button
                type="button"
                id={`${listId}-${i}`}
                key={o.value}
                role="option"
                aria-selected={value === o.value}
                className={i === active ? "focused" : ""}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(o.value)}
              >
                {o.label}
              </button>
            ))
          ) : (
            <span>没有匹配项</span>
          )}
        </div>
      ) : null}
    </div>
  );
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
            }, "图片已上传");
        }}
      />
    </Field>
  );
}
