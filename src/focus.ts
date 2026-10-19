import { EventEmitter } from "node:events";

interface FocusTrackerEvents {
  change: [focused: boolean];
}

/**
 * Aggregates the input focus reported by connected web clients.
 *
 * Device servers such as OpenAxis route input only to a focused recipient.
 * The bridge is never focused itself, so it relays its clients' focus: it is
 * focused while any local client reports that its page has focus. Each
 * session's vote is dropped when it disconnects.
 */
export class FocusTracker extends EventEmitter<FocusTrackerEvents> {
  private sessions = new Map<object, boolean>();
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  /** Record a session's focus state. `session` is any per-connection object. */
  set(session: object, focused: boolean): void {
    this.sessions.set(session, focused);
    this.update();
  }

  /** Forget a session (call on disconnect) */
  remove(session: object): void {
    if (this.sessions.delete(session)) this.update();
  }

  private update(): void {
    let focused = false;
    for (const value of this.sessions.values()) {
      if (value) { focused = true; break; }
    }
    if (focused === this._focused) return;
    this._focused = focused;
    this.emit("change", focused);
  }
}

/**
 * Whether a peer address is on this machine. Accepts bare addresses
 * ("127.0.0.1", "::1", "::ffff:127.0.0.1") and host:port forms
 * ("127.0.0.1:5000", "[::1]:5000").
 *
 * Focus is only meaningful from local clients: a page on another machine
 * having focus says nothing about this machine's foreground application.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  let host = address.trim();
  const bracketed = host.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) {
    host = bracketed[1];
  } else if (/^[\d.]+:\d+$/.test(host)) {
    host = host.slice(0, host.lastIndexOf(":"));
  }
  host = host.toLowerCase();
  if (host.startsWith("::ffff:")) host = host.slice(7);
  return host === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}
