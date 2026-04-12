const SCHEME_URL = "satmouse://launch";
const PROJECT_URL = "https://github.com/kelnishi/SatMouse/releases/latest";

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
