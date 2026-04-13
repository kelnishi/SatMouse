import { RTCPeerConnection, RTCSessionDescription } from "werift";
import type { SpatialData, ButtonEvent, DeviceInfo } from "../devices/types.js";

/**
 * WebRTC data channel transport server.
 *
 * Each client connects via SDP offer/answer exchange. The bridge creates
 * an RTCPeerConnection per client and sends spatial data + button events
 * over data channels.
 *
 * Signaling goes through HTTP POST (/rtc/offer) or navigate-redirect
 * (/rtc/connect) for browsers that can't POST to localhost.
 *
 * No trusted certs needed — WebRTC uses DTLS with self-signed certs
 * and the SDP exchange handles fingerprint verification.
 */

interface PeerSession {
  pc: RTCPeerConnection;
  spatial: any; // RTCDataChannel
  reliable: any; // RTCDataChannel for buttons/status
}

export class WebRTCServer {
  private sessions = new Set<PeerSession>();

  /**
   * Process an SDP offer from a client and return an SDP answer.
   * Called by the HTTP signaling endpoint.
   */
  async handleOffer(offerSdp: string): Promise<string> {
    const pc = new RTCPeerConnection({
      iceServers: [], // Local network, no STUN/TURN needed
    });

    const session: PeerSession = { pc, spatial: null, reliable: null };

    // Create data channels (server-initiated)
    const spatialChannel = pc.createDataChannel("spatial", {
      ordered: false,      // Unordered for lowest latency
      maxRetransmits: 0,   // Unreliable — latest value always wins
    });
    session.spatial = spatialChannel;

    const reliableChannel = pc.createDataChannel("reliable", {
      ordered: true,       // Ordered + reliable for buttons/status
    });
    session.reliable = reliableChannel;

    // Track session lifecycle
    pc.connectionStateChange.subscribe(() => {
      const state = pc.connectionState;
      if (state === "disconnected" || state === "failed" || state === "closed") {
        this.sessions.delete(session);
        console.log(`[WebRTC] Peer disconnected (${this.sessions.size} remaining)`);
      }
    });

    // Set remote offer and create answer
    await pc.setRemoteDescription(new RTCSessionDescription(offerSdp, "offer"));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.sessions.add(session);
    console.log(`[WebRTC] Peer connected (${this.sessions.size} total)`);

    return pc.localDescription?.sdp ?? "";
  }

  broadcastSpatialData(data: SpatialData): void {
    if (this.sessions.size === 0) return;

    // Encode as 24-byte binary (same format as WebTransport datagrams)
    const buf = Buffer.allocUnsafe(24);
    buf.writeDoubleLE(data.timestamp, 0);
    buf.writeInt16LE(Math.round(data.translation.x), 8);
    buf.writeInt16LE(Math.round(data.translation.y), 10);
    buf.writeInt16LE(Math.round(data.translation.z), 12);
    buf.writeInt16LE(Math.round(data.rotation.x), 14);
    buf.writeInt16LE(Math.round(data.rotation.y), 16);
    buf.writeInt16LE(Math.round(data.rotation.z), 18);
    buf.writeUInt32LE(0, 20);

    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    for (const session of this.sessions) {
      try {
        if (session.spatial?.readyState === "open") {
          session.spatial.send(bytes);
        }
      } catch {
        // Will be cleaned up on disconnect
      }
    }
  }

  broadcastButtonEvent(data: ButtonEvent): void {
    if (this.sessions.size === 0) return;
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
