import { RTCPeerConnection, RTCSessionDescription } from "werift";
import type { SpatialData, ButtonEvent, DeviceInfo } from "../devices/types.js";

const MAX_PEERS = 16;
const MAX_SDP_SIZE = 16384; // 16KB

/** Clamp to int16, reject NaN/Infinity */
function clampInt16(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-32768, Math.min(32767, Math.round(v)));
}

interface PeerSession {
  pc: RTCPeerConnection;
  spatial: any;
  reliable: any;
}

export class WebRTCServer {
  private sessions = new Set<PeerSession>();

  /**
   * Process an SDP offer and return an SDP answer.
   * Validates offer before processing.
   */
  async handleOffer(offerSdp: string): Promise<string> {
    // Validate offer
    if (!offerSdp || typeof offerSdp !== "string") {
      throw new Error("Invalid SDP offer: not a string");
    }
    if (offerSdp.length > MAX_SDP_SIZE) {
      throw new Error(`SDP offer too large: ${offerSdp.length} > ${MAX_SDP_SIZE}`);
    }
    if (!offerSdp.startsWith("v=0")) {
      throw new Error("Invalid SDP offer: must start with v=0");
    }

    // Connection limit
    if (this.sessions.size >= MAX_PEERS) {
      throw new Error(`Maximum peer connections reached (${MAX_PEERS})`);
    }

    const pc = new RTCPeerConnection({ iceServers: [] });
    const session: PeerSession = { pc, spatial: null, reliable: null };

    const spatialChannel = pc.createDataChannel("spatial", {
      ordered: false,
      maxRetransmits: 0,
    });
    session.spatial = spatialChannel;

    const reliableChannel = pc.createDataChannel("reliable", {
      ordered: true,
    });
    session.reliable = reliableChannel;

    pc.connectionStateChange.subscribe(() => {
      const state = pc.connectionState;
      if (state === "disconnected" || state === "failed" || state === "closed") {
        this.sessions.delete(session);
        console.log(`[WebRTC] Peer disconnected (${this.sessions.size} remaining)`);
      }
    });

    await pc.setRemoteDescription(new RTCSessionDescription(offerSdp, "offer"));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.sessions.add(session);
    console.log(`[WebRTC] Peer connected (${this.sessions.size} total)`);

    return pc.localDescription?.sdp ?? "";
  }

  broadcastSpatialData(data: SpatialData): void {
    if (this.sessions.size === 0) return;

    const buf = Buffer.allocUnsafe(24);
    buf.writeDoubleLE(Number.isFinite(data.timestamp) ? data.timestamp : 0, 0);
    buf.writeInt16LE(clampInt16(data.translation.x), 8);
    buf.writeInt16LE(clampInt16(data.translation.y), 10);
    buf.writeInt16LE(clampInt16(data.translation.z), 12);
    buf.writeInt16LE(clampInt16(data.rotation.x), 14);
    buf.writeInt16LE(clampInt16(data.rotation.y), 16);
    buf.writeInt16LE(clampInt16(data.rotation.z), 18);
    buf.writeUInt32LE(0, 20);

    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    for (const session of this.sessions) {
      try {
        if (session.spatial?.readyState === "open") {
          session.spatial.send(bytes);
        }
      } catch {}
    }
  }

  broadcastButtonEvent(data: ButtonEvent): void {
    if (this.sessions.size === 0) return;
    // Validate button index
    if (!Number.isInteger(data.button) || data.button < 0 || data.button > 31) return;
    const json = JSON.stringify({ type: "buttonEvent", data });
    const bytes = new TextEncoder().encode(json);

    for (const session of this.sessions) {
      try {
        if (session.reliable?.readyState === "open") {
          session.reliable.send(bytes);
        }
      } catch {}
    }
  }

  broadcastDeviceStatus(event: "connected" | "disconnected", device: DeviceInfo): void {
    if (this.sessions.size === 0) return;
    const json = JSON.stringify({ type: "deviceStatus", data: { event, device } });
    const bytes = new TextEncoder().encode(json);

    for (const session of this.sessions) {
      try {
        if (session.reliable?.readyState === "open") {
          session.reliable.send(bytes);
        }
      } catch {}
    }
  }

  stop(): void {
    for (const session of this.sessions) {
      try { session.pc.close(); } catch {}
    }
    this.sessions.clear();
  }
}
