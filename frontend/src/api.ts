import { subscribeEvents } from "../../public/js/event-channel.js";
export async function api(
  path: string,
  body?: unknown,
  method?: string,
  headers: Record<string, string> = {},
) {
  const r = await fetch(`/api${path}`, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || `HTTP ${r.status}`);
  return result;
}
export function subscribe(
  path: string,
  headers: Record<string, string>,
  receive: (value: any) => void,
  status?: (online: boolean) => void,
  unauthorized?: () => void,
) {
  return subscribeEvents(
    `/api${path}`,
    headers,
    (value, type) => {
      if (type === "state") receive(value);
    },
    status,
    unauthorized,
  );
}

export function safeRead(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
export function safeWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Runtime state remains usable without storage. */
  }
}

export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* HTTP venue addresses may need the selection-based clipboard API. */
  }
  const focused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand("copy"))
      throw Error("复制失败，请选择链接后手动复制");
  } finally {
    field.remove();
    focused?.focus();
  }
}
