const SCHEME_URL = "satmouse://launch";
const PROJECT_URL = "https://github.com/kelnishi/SatMouse/releases/latest";

/** Result of a URI scheme negotiation */
export interface NegotiateResult {
  ip: string;
  wsPort: number;
  wtPort: number;
  httpsPort: number;
  certHash?: string;
  challenge?: string;
}

/**
 * Trigger the satmouse://negotiate URI scheme for discovery when direct
 * HTTP/HTTPS fetch is blocked (Safari LNA).
 *
 * The bridge intercepts the URI, then redirects back to your origin with
 * connection details as query parameters. Your app handles the callback
 * route and passes the result to SatMouseConnection.
 *
 * @param origin - Your app's origin (e.g., "https://kelcite.app")
 * @param callbackPath - Path the bridge redirects to (default: "/satmouse-handshake")
 * @param challenge - Optional challenge token for verification
 */
export function negotiateViaSatMouse(origin: string, callbackPath = "/satmouse-handshake", challenge?: string): void {
  const params = new URLSearchParams({ origin, callback: callbackPath });
  if (challenge) params.set("challenge", challenge);
  globalThis.location.href = `satmouse://negotiate?${params}`;
}

/**
 * Parse the negotiate callback URL parameters (called on your callback route).
 * Returns connection details or null if the params are missing.
 */
export function parseNegotiateCallback(searchParams: URLSearchParams): NegotiateResult | null {
  const ip = searchParams.get("ip");
  const wsPort = searchParams.get("wsPort");
  if (!ip || !wsPort) return null;
  return {
    ip,
    wsPort: parseInt(wsPort, 10),
    wtPort: parseInt(searchParams.get("wtPort") ?? "18946", 10),
    httpsPort: parseInt(searchParams.get("httpsPort") ?? "18947", 10),
    certHash: searchParams.get("certHash") ?? undefined,
    challenge: searchParams.get("challenge") ?? undefined,
  };
}

export interface LaunchOptions {
  /** URL scheme to open. Default: "satmouse://launch" */
  schemeUrl?: string;
  /** Fallback URL if the app is not installed. Default: GitHub releases page */
  fallbackUrl?: string;
  /** Timeout in ms before assuming the app is not installed. Default: 2500 */
  timeout?: number;
}

/**
 * Attempt to launch SatMouse via the `satmouse://` URL scheme.
 *
 * If the app is installed and registered, the OS opens it. If not,
 * navigates to the fallback URL (project releases page) after a timeout.
 *
 * Returns true if the scheme likely opened, false if it fell back.
 */
export function launchSatMouse(options?: LaunchOptions): Promise<boolean> {
  const schemeUrl = options?.schemeUrl ?? SCHEME_URL;
  const timeout = options?.timeout ?? 2500;

  // Validate fallback URL — only allow http/https to prevent javascript: or data: injection
  let fallbackUrl = PROJECT_URL;
  if (options?.fallbackUrl) {
    try {
      const parsed = new URL(options.fallbackUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        fallbackUrl = options.fallbackUrl;
      }
    } catch {}
  }

  return new Promise((resolve) => {
    // Track if we leave the page (scheme handler opened the app)
    let launched = false;

    const onBlur = () => {
      launched = true;
    };
    globalThis.addEventListener("blur", onBlur);

    // Use a hidden iframe to trigger the scheme without navigating away
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = schemeUrl;
    document.body.appendChild(iframe);

    setTimeout(() => {
      globalThis.removeEventListener("blur", onBlur);
      document.body.removeChild(iframe);

      if (launched || document.hidden) {
        resolve(true);
      } else {
        // App not installed — redirect to project page
        globalThis.location.href = fallbackUrl;
        resolve(false);
      }
    }, timeout);
  });
}
