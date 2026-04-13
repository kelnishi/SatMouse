import type { Transport } from "./transport.js";
import type { SpatialData, ButtonEvent, DeviceInfo } from "../types.js";
import { decodeBinaryFrame } from "../decode.js";

/**
 * WebRTC data channel transport adapter.
 *
 * Connects to the bridge via SDP offer/answer exchange. Receives spatial
 * data on an unreliable "spatial" channel and button/status events on
 * a reliable "reliable" channel.
 *
 * No trusted certs needed — WebRTC uses DTLS with self-signed certs.
 */
export class WebRTCAdapter implements Transport {
  readonly protocol = "webrtc" as const;

  onSpatialData: ((data: SpatialData) => void) | null = null;
  onButtonEvent: ((data: ButtonEvent) => void) | null = null;
  onDeviceStatus: ((event: "connected" | "disconnected", device: DeviceInfo) => void) | null = null;
  onClose: (() => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  private pc: RTCPeerConnection | null = null;
  private signalingUrl: string;

  /**
   * @param signalingUrl — HTTP endpoint for SDP exchange (e.g., "http://127.0.0.1:18945/rtc/offer")
   */
  constructor(signalingUrl: string) {
    this.signalingUrl = signalingUrl;
  }

  async connect(): Promise<void> {
    if (typeof globalThis.RTCPeerConnection === "undefined") {
      throw new Error("RTCPeerConnection not available");
    }

    this.pc = new RTCPeerConnection({
      iceServers: [], // Local network, no STUN/TURN
    });

    // Listen for data channels created by the bridge
    this.pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === "spatial") {
        channel.binaryType = "arraybuffer";
        channel.onmessage = (e) => {
          if (e.data instanceof ArrayBuffer && e.data.byteLength >= 20) {
            const decoded = decodeBinaryFrame(e.data);
            this.onSpatialData?.(decoded);
          }
        };
      } else if (channel.label === "reliable") {
        channel.onmessage = (e) => {
          try {
            const text = typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data);
            const msg = JSON.parse(text);
            if (msg.type === "buttonEvent") this.onButtonEvent?.(msg.data);
            else if (msg.type === "deviceStatus") this.onDeviceStatus?.(msg.data.event, msg.data.device);
          } catch {}
        };
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
      if (state === "disconnected" || state === "failed" || state === "closed") {
        this.onClose?.();
      }
    };

    // Create offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Wait for ICE gathering to complete (or timeout)
    await this.waitForICE();

    // Send offer to bridge, get answer
    const response = await fetch(this.signalingUrl, {
      method: "POST",
      body: this.pc.localDescription!.sdp,
      headers: { "Content-Type": "application/sdp" },
    });

    if (!response.ok) {
      throw new Error(`Signaling failed: ${response.status}`);
    }

    const answerSdp = await response.text();
    await this.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    // Wait for connection to establish
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebRTC connection timeout")), 10000);
      const check = () => {
        if (this.pc?.connectionState === "connected") {
          clearTimeout(timeout);
          resolve();
        } else if (this.pc?.connectionState === "failed") {
          clearTimeout(timeout);
          reject(new Error("WebRTC connection failed"));
        }
      };
      this.pc!.onconnectionstatechange = () => {
        check();
        // Re-attach close handler
        const state = this.pc?.connectionState;
        if (state === "disconnected" || state === "failed" || state === "closed") {
          this.onClose?.();
        }
      };
      check(); // May already be connected
    });
  }

  close(): void {
    try { this.pc?.close(); } catch {}
    this.pc = null;
  }

  private waitForICE(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.pc) return resolve();
      if (this.pc.iceGatheringState === "complete") return resolve();
      const timeout = setTimeout(resolve, 2000); // Don't wait too long for local ICE
      this.pc.onicegatheringstatechange = () => {
        if (this.pc?.iceGatheringState === "complete") {
          clearTimeout(timeout);
          resolve();
        }
      };
    });
  }
}
