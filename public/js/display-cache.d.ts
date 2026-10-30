export function readDisplayCache(
  id: string,
): Promise<Record<string, any> | null>;
export function writeDisplayCache(id: string, value: unknown): Promise<boolean>;
