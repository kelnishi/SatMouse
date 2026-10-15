import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { EventEmitter } from "node:events";

/**
 * How Rotatrix input reaches SatMouse pages, sent to Rotatrix as a tag
 * (satmouse.activation.<mode>) that the SatMouse Rotatrix profile keys on
 * (docs/rotatrix/satmouse-profile.yaml):
 * - hold:   the ball is a mouse until the modifier key or button 4 is held
 * - always: the ball streams 3D input whenever a SatMouse page has focus;
 *           the modifier key or button 4 returns it to a mouse
 */
export type OpenAxisActivation = "hold" | "always";
export const OPENAXIS_ACTIVATIONS: readonly OpenAxisActivation[] = ["hold", "always"];

export interface Settings {
  openaxisActivation: OpenAxisActivation;
}

const DEFAULTS: Settings = { openaxisActivation: "hold" };

interface SettingsStoreEvents {
  change: [settings: Settings];
}

/** User settings changed from the status window, persisted as JSON */
export class SettingsStore extends EventEmitter<SettingsStoreEvents> {
  private current: Settings;

  constructor(private readonly path: string) {
    super();
    this.current = { ...DEFAULTS, ...this.load() };
  }

  get(): Settings {
    return { ...this.current };
  }

  update(patch: Partial<Settings>): Settings {
    this.current = { ...this.current, ...patch };
    this.save();
    this.emit("change", this.get());
    return this.get();
  }

  private load(): Partial<Settings> {
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf-8"));
      const loaded: Partial<Settings> = {};
      if (OPENAXIS_ACTIVATIONS.includes(raw?.openaxisActivation)) {
        loaded.openaxisActivation = raw.openaxisActivation;
      }
      return loaded;
    } catch {
      return {};
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.current, null, 2) + "\n");
      renameSync(tmp, this.path);
    } catch (err) {
      console.error(`[Settings] Failed to save ${this.path}:`, err);
    }
  }
}
