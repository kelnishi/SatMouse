import type { ThingDescription } from "./types.js";

export interface ResolvedEndpoints {
  webtransport?: { url: string; certHash?: string };
  websocket?: { url: string };
  deviceInfoUrl?: string;
}

/** Fetch the WoT Thing Description from the bridge */
export async function fetchThingDescription(tdUrl: string): Promise<ThingDescription> {
  const res = await globalThis.fetch(tdUrl);
  if (!res.ok) throw new Error(`Failed to fetch TD: HTTP ${res.status}`);
  return res.json() as Promise<ThingDescription>;
}

/** Extract WebTransport, WebSocket, and device info endpoints from a Thing Description */
export function resolveEndpoints(td: ThingDescription): ResolvedEndpoints {
  const result: ResolvedEndpoints = {};

  const spatialForms = td.events?.spatialData?.forms ?? [];

  const wtForm = spatialForms.find((f) => f.subprotocol === "webtransport");
  if (wtForm) {
    result.webtransport = {
      url: wtForm.href,
      certHash: td["satmouse:certHash"],
    };
  }

  const wsForm = spatialForms.find((f) => f.subprotocol === "websocket");
  if (wsForm) {
    result.websocket = { url: wsForm.href };
  }

  const deviceForm = td.properties?.deviceInfo?.forms?.[0];
  if (deviceForm) {
    result.deviceInfoUrl = deviceForm.href;
  }

  return result;
}
