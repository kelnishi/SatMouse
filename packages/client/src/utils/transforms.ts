import type { SpatialData, Vec3 } from "../core/types.js";

export interface FlipConfig {
  tx: boolean;
  ty: boolean;
  tz: boolean;
  rx: boolean;
  ry: boolean;
  rz: boolean;
}

export interface SensitivityConfig {
  translation: number;
  rotation: number;
}

/** Maps each input axis to an output axis. E.g., { tx: "tz", tz: "tx" } swaps X and Z translation. */
export type AxisMap = {
  tx: keyof Vec3;
  ty: keyof Vec3;
  tz: keyof Vec3;
  rx: keyof Vec3;
  ry: keyof Vec3;
  rz: keyof Vec3;
};

export const DEFAULT_AXIS_MAP: AxisMap = {
  tx: "x", ty: "y", tz: "z",
  rx: "x", ry: "y", rz: "z",
};

export function applyFlip(data: SpatialData, flip: FlipConfig): SpatialData {
  return {
    ...data,
    translation: {
      x: flip.tx ? -data.translation.x : data.translation.x,
      y: flip.ty ? -data.translation.y : data.translation.y,
      z: flip.tz ? -data.translation.z : data.translation.z,
    },
    rotation: {
      x: flip.rx ? -data.rotation.x : data.rotation.x,
      y: flip.ry ? -data.rotation.y : data.rotation.y,
      z: flip.rz ? -data.rotation.z : data.rotation.z,
    },
  };
}

export function applySensitivity(data: SpatialData, sens: SensitivityConfig): SpatialData {
  return {
    ...data,
    translation: {
      x: data.translation.x * sens.translation,
      y: data.translation.y * sens.translation,
      z: data.translation.z * sens.translation,
    },
    rotation: {
      x: data.rotation.x * sens.rotation,
      y: data.rotation.y * sens.rotation,
      z: data.rotation.z * sens.rotation,
    },
  };
}

export function applyDominant(data: SpatialData): SpatialData {
  const axes = [
    { group: "t" as const, key: "x" as const, v: Math.abs(data.translation.x) },
    { group: "t" as const, key: "y" as const, v: Math.abs(data.translation.y) },
    { group: "t" as const, key: "z" as const, v: Math.abs(data.translation.z) },
    { group: "r" as const, key: "x" as const, v: Math.abs(data.rotation.x) },
    { group: "r" as const, key: "y" as const, v: Math.abs(data.rotation.y) },
    { group: "r" as const, key: "z" as const, v: Math.abs(data.rotation.z) },
  ];
  const max = axes.reduce((a, b) => (b.v > a.v ? b : a));

  const t: Vec3 = { x: 0, y: 0, z: 0 };
  const r: Vec3 = { x: 0, y: 0, z: 0 };

  if (max.group === "t") t[max.key] = data.translation[max.key];
  else r[max.key] = data.rotation[max.key];

  return { ...data, translation: t, rotation: r };
}

export function applyDeadZone(data: SpatialData, threshold: number): SpatialData {
  const dz = (v: number) => (Math.abs(v) < threshold ? 0 : v);
  return {
    ...data,
    translation: { x: dz(data.translation.x), y: dz(data.translation.y), z: dz(data.translation.z) },
    rotation: { x: dz(data.rotation.x), y: dz(data.rotation.y), z: dz(data.rotation.z) },
  };
}

export function applyAxisRemap(data: SpatialData, map: AxisMap): SpatialData {
  return {
    ...data,
    translation: {
      x: 0, y: 0, z: 0,
      [map.tx]: data.translation.x,
      [map.ty]: data.translation.y,
      [map.tz]: data.translation.z,
    } as Vec3,
    rotation: {
      x: 0, y: 0, z: 0,
      [map.rx]: data.rotation.x,
      [map.ry]: data.rotation.y,
      [map.rz]: data.rotation.z,
    } as Vec3,
  };
}
