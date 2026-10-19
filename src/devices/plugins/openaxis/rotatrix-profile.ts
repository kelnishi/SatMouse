import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { parse } from "yaml";

/**
 * The SatMouse profile for Rotatrix, as a `rotatrix-bundle` that Rotatrix
 * 1.6+ imports through a `rotatrix://import` link or a dropped `.rotatrix`
 * file.
 *
 * Rotatrix selects the profile while the bridge is the active OpenAxis client
 * (tag `app.satmouse`). The status window's activation toggle sets one of two
 * tags the bindings key on:
 *   satmouse.activation.hold    the ball is a mouse until the modifier (Ctrl
 *                               on macOS, Win on Windows, Super on Linux) or
 *                               button 4 is held
 *   satmouse.activation.always  the ball streams 3D input the whole time;
 *                               the modifier or button 4 returns it to a
 *                               mouse, so the user can click out of the page
 *                               without another pointing device
 *
 * The import refuses a bundle whose axis maps are not included, and adds a
 * "(2)" copy of any resource whose name is already taken, so the maps and
 * dominance presets carry SatMouse names instead of the built-in obj_rotate,
 * obj_translate, off and soft they copy.
 */
const MODIFIER = "{(os:windows key:tapthru:win) (os:mac key:ctrl) (os:linux key:tapthru:super) btn:4}";

export const PROFILE_NAME = "satmouse";
export const PROFILE_TAG = "app.satmouse";

export const SATMOUSE_PROFILE_BUNDLE = {
  format: "rotatrix-bundle",
  format_version: 1,
  root: {
    kind: "profiles",
    name: PROFILE_NAME,
    definition: {
      description: [
        "SatMouse: stream 3D input to the focused SatMouse web page.",
        "- Hold the modifier key (Ctrl on macOS, Win on Windows, Super on Linux) or button 4 for 3D rotate,",
        "  or set activation to Always in SatMouse's status window.",
        "- In Always, hold the modifier or button 4 to get the mouse back.",
        "- Add Shift or button 2 to translate.",
      ].join("\n"),
      triggers: [`tag:${PROFILE_TAG}`],
      ball_mode: "mouse",
      binding_selection: "first_active",
      bindings: [
        // First active wins: in Always, the modifier or button 4 takes the ball
        // back to a mouse before the 3D binding can match
        {
          name: "SatMouse Mouse",
          triggers: [`tag:satmouse.activation.always ${MODIFIER}`],
          ball_mode: "mouse",
          label: "Mouse",
        },
        {
          name: "SatMouse 3D",
          triggers: ["tag:satmouse.activation.always", `tag:satmouse.activation.hold ${MODIFIER}`],
          ball_mode: "rotatrix",
          axis_map: "satmouse_rotate",
          label: "Rotate",
          bindings: [
            { name: "SatMouse Translate", triggers: ["btn:2", "key:shift"], axis_map: "satmouse_translate", label: "Translate" },
          ],
        },
      ],
    },
  },
  dependencies: [
    {
      kind: "axis_maps",
      name: "satmouse_rotate",
      definition: {
        axis_dominance: "satmouse_off",
        wx: { output: "rx", osd: "obj rx" },
        wy: { output: "ry", osd: "obj ry" },
        wz: { output: "rz", osd: "obj rz" },
      },
    },
    {
      kind: "axis_maps",
      name: "satmouse_translate",
      definition: {
        axis_dominance: "satmouse_soft",
        wx: { output: "-ty", osd: "obj -ty" },
        wy: { output: "tx", osd: "obj tx" },
        wz: { output: "-tz", osd: "obj -tz" },
      },
    },
    { kind: "axis_dominance_presets", name: "satmouse_off", definition: { decouple_enabled: false } },
    {
      kind: "axis_dominance_presets",
      name: "satmouse_soft",
      definition: { decouple_enabled: true, decouple_soft: true, decouple_threshold: 2, decouple_soft_power: 2, decouple_smooth: true },
    },
  ],
} as const;

/** `rotatrix://import?v=1&data=<base64url(gzip(bundle JSON))>`, the link format
 *  Rotatrix's own example apps use */
export function profileImportUrl(bundle: object = SATMOUSE_PROFILE_BUNDLE): string {
  const data = gzipSync(JSON.stringify(bundle)).toString("base64url");
  return `rotatrix://import?v=1&data=${data}`;
}

/**
 * - `installed`: an enabled profile triggers on `tag:app.satmouse`
 * - `disabled`: one exists but is switched off; importing again would only
 *   add a "(2)" copy, so the user re-enables it in Rotatrix instead
 * - `missing`: no such profile, or no user config yet
 * - `unknown`: the config could not be read or parsed
 */
export type ProfileState = "installed" | "disabled" | "missing" | "unknown";

/** A trigger matches the tag as a positive term, not `-tag:` and not a longer tag */
const TAG_TERM = new RegExp(`(^|[\\s{(])tag:${PROFILE_TAG.replace(/\./g, "\\.")}(?=$|[\\s})])`);

export function profileStateOf(configText: string): ProfileState {
  let config: any;
  try {
    config = parse(configText);
  } catch {
    return "unknown";
  }
  if (config == null) return "missing";
  if (typeof config !== "object") return "unknown";
  const profiles = config.profiles && typeof config.profiles === "object" ? config.profiles : {};
  const enabled = config.profile_enabled && typeof config.profile_enabled === "object" ? config.profile_enabled : {};

  let disabled = false;
  for (const [name, profile] of Object.entries<any>(profiles)) {
    const triggers: unknown[] = Array.isArray(profile?.triggers) ? profile.triggers : [];
    if (!triggers.some((t) => typeof t === "string" && TAG_TERM.test(t))) continue;
    if (enabled[name] === false) disabled = true;
    else return "installed";
  }
  return disabled ? "disabled" : "missing";
}

/** Reads the Rotatrix user config, re-parsing only when its mtime changes */
export class RotatrixProfileProbe {
  private cachedMtime: number | null = null;
  private cachedState: ProfileState = "missing";

  constructor(private readonly configPath: string) {}

  state(): ProfileState {
    let mtime: number;
    try {
      mtime = statSync(this.configPath).mtimeMs;
    } catch (err: any) {
      this.cachedMtime = null;
      return err?.code === "ENOENT" ? "missing" : "unknown";
    }
    if (mtime !== this.cachedMtime) {
      try {
        this.cachedState = profileStateOf(readFileSync(this.configPath, "utf-8"));
      } catch {
        this.cachedState = "unknown";
      }
      this.cachedMtime = mtime;
    }
    return this.cachedState;
  }
}
