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
  const controller = new AbortController();
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  async function connect() {
    try {
      const r = await fetch(`/api${path}`, {
        headers,
        signal: controller.signal,
      });
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) {
          unauthorized?.();
          status?.(false);
          return;
        }
        throw Error();
      }
      status?.(true);
      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = event.split("\n").find((x) => x.startsWith("data: "));
            if (data) receive(JSON.parse(data.slice(6)));
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch {
      /* Reconnect uses an authoritative snapshot. */
    }
    if (!controller.signal.aborted) {
      status?.(false);
      reconnect = setTimeout(connect, 1500);
    }
  }
  void connect();
  return () => {
    controller.abort();
    clearTimeout(reconnect);
  };
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
