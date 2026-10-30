export function subscribeEvents(
  path: string,
  headers: Record<string, string>,
  receive: (value: any, type: string) => void,
  status?: (online: boolean) => void,
  unauthorized?: () => void,
): () => void;
export function sharedEventSource(
  path: string,
  headers?: Record<string, string>,
): EventSource;
