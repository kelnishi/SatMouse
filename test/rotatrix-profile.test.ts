import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RotatrixProfileProbe,
  SATMOUSE_PROFILE_BUNDLE,
  profileImportUrl,
  profileStateOf,
} from "../src/devices/plugins/openaxis/rotatrix-profile.ts";

// What Rotatrix 1.6.0b3 wrote to its user config after importing the bundle
const IMPORTED = `saved_by_version: "1.6.0b3"
profile_order:
  - satmouse
  - openaxis_demos
  - nav_default
axis_maps:
  satmouse_rotate:
    axis_dominance: satmouse_off
    wx: { output: rx, osd: obj rx }
profiles:
  satmouse:
    triggers: [ tag:app.satmouse ]
    ball_mode: mouse
    binding_selection: first_active
    bindings:
      - name: SatMouse 3D
        triggers:
          - tag:satmouse.activation.always
        ball_mode: rotatrix
        axis_map: satmouse_rotate
        label: { text: Rotate, mode: replace }
profile_enabled: { satmouse: true }
`;

test("a profile triggering on tag:app.satmouse counts as installed", () => {
  assert.equal(profileStateOf(IMPORTED), "installed");
  // Under any name: an update imported as "satmouse (2)" still counts
  assert.equal(profileStateOf(IMPORTED.replace("  satmouse:\n", "  satmouse (2):\n")), "installed");
});

test("a switched-off profile is disabled, not missing", () => {
  assert.equal(profileStateOf(IMPORTED.replace("{ satmouse: true }", "{ satmouse: false }")), "disabled");
});

test("config without the profile, or that names the tag only as a negation or prefix, is missing", () => {
  assert.equal(profileStateOf(""), "missing");
  assert.equal(profileStateOf('saved_by_version: "1.6.0b3"\nprofile_order: [ default ]\n'), "missing");
  assert.equal(profileStateOf(IMPORTED.replace("[ tag:app.satmouse ]", "[ -tag:app.satmouse ]")), "missing");
  assert.equal(profileStateOf(IMPORTED.replace("[ tag:app.satmouse ]", "[ tag:app.satmouse2 ]")), "missing");
  // A trigger group still counts
  assert.equal(profileStateOf(IMPORTED.replace("[ tag:app.satmouse ]", '[ "{tag:app.satmouse tag:app.kelcite}" ]')), "installed");
});

test("unparseable config is unknown", () => {
  assert.equal(profileStateOf("profiles: [unclosed"), "unknown");
});

test("the probe reports a missing file as missing and follows edits", () => {
  const path = join(mkdtempSync(join(tmpdir(), "satmouse-rotatrix-")), "config.yaml");
  const probe = new RotatrixProfileProbe(path);
  assert.equal(probe.state(), "missing");
  writeFileSync(path, 'saved_by_version: "1.6.0b3"\n');
  assert.equal(probe.state(), "missing");
  writeFileSync(path, IMPORTED);
  const later = new Date(Date.now() + 5000);
  utimesSync(path, later, later);
  assert.equal(probe.state(), "installed");
});

test("the import link carries the bundle as gzipped base64url JSON", () => {
  const url = new URL(profileImportUrl());
  assert.equal(url.protocol, "rotatrix:");
  assert.equal(url.host, "import");
  assert.equal(url.searchParams.get("v"), "1");
  const decoded = JSON.parse(gunzipSync(Buffer.from(url.searchParams.get("data")!, "base64url")).toString());
  assert.deepEqual(decoded, SATMOUSE_PROFILE_BUNDLE);
});

test("the bundle includes every axis map and preset it uses, under names Rotatrix doesn't bundle", () => {
  const deps = new Map(SATMOUSE_PROFILE_BUNDLE.dependencies.map((d) => [`${d.kind}/${d.name}`, d.definition as any]));
  const used: string[] = [];
  const walk = (b: any) => {
    if (b.axis_map) used.push(`axis_maps/${b.axis_map}`);
    (b.bindings ?? []).forEach(walk);
  };
  walk(SATMOUSE_PROFILE_BUNDLE.root.definition);
  assert.ok(used.length > 0);
  for (const key of used) {
    // Rotatrix refuses the import with "Package is missing axis map"
    assert.ok(deps.has(key), `missing ${key}`);
    const preset = deps.get(key).axis_dominance;
    if (preset) assert.ok(deps.has(`axis_dominance_presets/${preset}`), `missing preset ${preset}`);
  }
  // A name Rotatrix already has is imported as a "(2)" copy
  for (const d of SATMOUSE_PROFILE_BUNDLE.dependencies) {
    assert.match(d.name, /^satmouse_/);
  }
});
