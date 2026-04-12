import type { InputManager } from "../utils/input-manager.js";

/**
 * Global registry for SatMouse Web Components.
 *
 * Usage:
 *   import { registerSatMouse } from "@kelnishi/satmouse-client/elements";
 *   registerSatMouse(manager);
 *   // All <satmouse-*> elements auto-connect to this manager
 */

let globalManager: InputManager | null = null;
const listeners = new Set<(m: InputManager) => void>();

export function registerSatMouse(manager: InputManager): void {
  globalManager = manager;
  for (const fn of listeners) fn(manager);
  listeners.clear();
}

export function getManager(): InputManager | null {
  return globalManager;
}

export function onManagerReady(fn: (m: InputManager) => void): void {
  if (globalManager) fn(globalManager);
  else listeners.add(fn);
}
