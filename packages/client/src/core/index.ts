export { SatMouseConnection, parseSatMouseUri, buildSatMouseUri } from "./connection.js";
export { fetchThingDescription, resolveEndpoints } from "./discovery.js";
export { decodeBinaryFrame, decodeWsBinaryFrame, decodeButtonStream } from "./decode.js";
export { launchSatMouse, negotiateViaSatMouse, parseNegotiateCallback } from "./launch.js";
export { TypedEmitter } from "./emitter.js";
export type { LaunchOptions, NegotiateResult } from "./launch.js";
export type {
  SpatialData,
  ButtonEvent,
  DeviceInfo,
  Vec3,
  ConnectionState,
  TransportProtocol,
  ConnectOptions,
  SatMouseEvents,
  ThingDescription,
} from "./types.js";
