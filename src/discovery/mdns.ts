import { Bonjour } from "bonjour-service";
import type { SatMouseConfig } from "../config.js";

/**
 * Advertises SatMouse as a _wot._tcp mDNS service on the local network.
 *
 * TXT records tell clients where to find the Thing Description and
 * which ports to use for each transport protocol.
 */
export class MDNSAdvertiser {
  private bonjour: Bonjour | null = null;
  private config: SatMouseConfig;

  constructor(config: SatMouseConfig) {
    this.config = config;
  }

  start(): void {
    this.bonjour = new Bonjour();

    this.bonjour.publish({
      name: this.config.serviceName,
      type: "wot",
      port: this.config.wsPort,
      txt: {
        td: "/td.json",
        wt: String(this.config.wtPort),
        ws: String(this.config.wsPort),
        type: "SpatialInput",
      },
    });

    console.log(`[mDNS] Advertising _wot._tcp "${this.config.serviceName}" on port ${this.config.wsPort}`);
  }

  stop(): void {
    this.bonjour?.unpublishAll();
    this.bonjour?.destroy();
    this.bonjour = null;
    console.log("[mDNS] Stopped");
  }
}
