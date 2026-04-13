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
 *
 * Signaling modes:
 * - fetch POST to /rtc/offer (works from HTTP pages or same-origin)
 * - popup window to /rtc/connect (works from HTTPS pages where fetch is blocked)
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

  constructor(signalingUrl: string) {
    this.signalingUrl = signalingUrl;
  }

  async connect(): Promise<void> {
    if (typeof globalThis.RTCPeerConnection === "undefined") {
      throw new Error("RTCPeerConnection not available");
    }

    this.pc = new RTCPeerConnection({ iceServers: [] });

    this.pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === "spatial") {
        channel.binaryType = "arraybuffer";
        channel.onmessage = (e) => {
          if (e.data instanceof ArrayBuffer && e.data.byteLength >= 20) {
            this.onSpatialData?.(decodeBinaryFrame(e.data));
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

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await this.waitForICE();

    // Try fetch first, fall back to popup signaling
    const answerSdp = await this.exchangeSDP(this.pc.localDescription!.sdp);
    await this.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebRTC connection timeout")), 10000);
      const check = () => {
        const state = this.pc?.connectionState;
        if (state === "connected") { clearTimeout(timeout); resolve(); }
        else if (state === "failed") { clearTimeout(timeout); reject(new Error("WebRTC connection failed")); }
      };
      this.pc!.onconnectionstatechange = () => {
        check();
        const state = this.pc?.connectionState;
        if (state === "disconnected" || state === "failed" || state === "closed") this.onClose?.();
      };
      check();
    });
  }

  close(): void {
    try { this.pc?.close(); } catch {}
    this.pc = null;
  }

  /** Exchange SDP: try fetch POST, fall back to popup window */
  private async exchangeSDP(offerSdp: string): Promise<string> {
    // Try direct fetch first
    try {
      const res = await fetch(this.signalingUrl, {
        method: "POST",
        body: offerSdp,
        headers: { "Content-Type": "application/sdp" },
      });
      if (res.ok) return await res.text();
    } catch {
      // Fetch blocked (mixed content) — fall through to popup
    }

    // Popup signaling: open a small window to the bridge's /rtc/connect endpoint
    // The bridge processes the offer and posts the answer back via window.opener.postMessage
    return this.exchangeSDPViaPopup(offerSdp);
  }

  private exchangeSDPViaPopup(offerSdp: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const offerB64 = btoa(offerSdp);
      // Build URL — use /rtc/connect which returns HTML that postMessages the answer back
      const baseUrl = this.signalingUrl.replace("/rtc/offer", "/rtc/connect-popup");
      const url = `${baseUrl}?offer=${encodeURIComponent(offerB64)}`;

      const popup = globalThis.open(url, "satmouse-rtc", "width=1,height=1,left=-100,top=-100");
      if (!popup) {
        reject(new Error("Popup blocked — user interaction required"));
        return;
      }

      const timeout = setTimeout(() => {
        popup.close();
        reject(new Error("WebRTC signaling timeout"));
      }, 10000);

      const onMessage = (event: MessageEvent) => {
        if (event.data?.type === "satmouse-rtc-answer") {
          clearTimeout(timeout);
          globalThis.removeEventListener("message", onMessage);
          popup.close();
          resolve(event.data.answer);
        }
      };
      globalThis.addEventListener("message", onMessage);
    });
  }

  private waitForICE(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.pc) return resolve();
      if (this.pc.iceGatheringState === "complete") return resolve();
      const timeout = setTimeout(resolve, 2000);
      this.pc.onicegatheringstatechange = () => {
        if (this.pc?.iceGatheringState === "complete") {
          clearTimeout(timeout);
          resolve();
        }
      };
    });
  }
}
