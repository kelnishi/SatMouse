import type { InputConfig } from "./config.js";

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "satmouse:settings";

function getStorage(storage?: StorageAdapter): StorageAdapter | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function saveSettings(config: InputConfig, storage?: StorageAdapter): void {
  const s = getStorage(storage);
  if (!s) return;
  s.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearSettings(storage?: StorageAdapter): void {
  const s = getStorage(storage);
  if (!s) return;
  s.setItem(STORAGE_KEY, "{}");
}

export function loadSettings(storage?: StorageAdapter): Partial<InputConfig> | null {
  const s = getStorage(storage);
  if (!s) return null;
  const raw = s.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<InputConfig>;
  } catch {
    return null;
  }
}
