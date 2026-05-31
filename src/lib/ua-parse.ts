/**
 * Lightweight UA parser for RUM browser breakdown.
 *
 * Prefers Client Hints (`navigator.userAgentData`) when available, falls back
 * to a hand-rolled UA-string regex pass. Hand-rolled because:
 *  - `ua-parser-js` adds ~30KB gzipped to the main bundle.
 *  - We only need browser name+major, OS name+major, device type.
 *
 * No network calls, no PII, no async work in the fallback path.
 */

export type DeviceType = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export interface UaSummary {
  browserName: string | null;
  browserMajor: number | null;
  osName: string | null;
  osMajor: number | null;
  deviceType: DeviceType;
}

const BOT_RE =
  /bot|crawler|spider|crawling|headlesschrome|preview|phantomjs|puppeteer/i;

function intOrNull(v: string | undefined | null): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function parseUaString(ua: string): UaSummary {
  if (BOT_RE.test(ua)) {
    return { browserName: "Bot", browserMajor: null, osName: null, osMajor: null, deviceType: "bot" };
  }

  // Device type
  let deviceType: DeviceType = "desktop";
  const isTablet = /\b(iPad|Tablet|PlayBook|Silk)\b/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const isMobile = !isTablet && /\b(Mobile|iPhone|iPod|Android|Windows Phone|Opera Mini|IEMobile)\b/i.test(ua);
  if (isTablet) deviceType = "tablet";
  else if (isMobile) deviceType = "mobile";

  // OS — order matters (iOS before Mac, Android before Linux)
  let osName: string | null = null;
  let osMajor: number | null = null;
  const iOS = /(?:iPhone OS|iPad; CPU OS|CPU iPhone OS|CPU OS) (\d+)[_.]/.exec(ua);
  const android = /Android (\d+)/.exec(ua);
  const mac = /Mac OS X (\d+)[_.]/.exec(ua);
  const win = /Windows NT (\d+)/.exec(ua);
  const linux = /\bLinux\b/.test(ua);
  if (iOS) { osName = "iOS"; osMajor = intOrNull(iOS[1]); }
  else if (android) { osName = "Android"; osMajor = intOrNull(android[1]); }
  else if (mac) { osName = "macOS"; osMajor = intOrNull(mac[1]); }
  else if (win) { osName = "Windows"; osMajor = intOrNull(win[1]); }
  else if (linux) { osName = "Linux"; }

  // Browser — order matters (Edge before Chrome before Safari)
  let browserName: string | null = null;
  let browserMajor: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /Edg(?:e|A|iOS)?\/(\d+)/.exec(ua))) { browserName = "Edge"; browserMajor = intOrNull(m[1]); }
  else if ((m = /OPR\/(\d+)/.exec(ua)) || (m = /Opera\/(\d+)/.exec(ua))) { browserName = "Opera"; browserMajor = intOrNull(m[1]); }
  else if ((m = /Firefox\/(\d+)/.exec(ua)) || (m = /FxiOS\/(\d+)/.exec(ua))) { browserName = "Firefox"; browserMajor = intOrNull(m[1]); }
  else if ((m = /SamsungBrowser\/(\d+)/.exec(ua))) { browserName = "Samsung Internet"; browserMajor = intOrNull(m[1]); }
  else if ((m = /CriOS\/(\d+)/.exec(ua)) || (m = /Chrome\/(\d+)/.exec(ua))) { browserName = "Chrome"; browserMajor = intOrNull(m[1]); }
  else if ((m = /Version\/(\d+).*Safari/.exec(ua))) { browserName = "Safari"; browserMajor = intOrNull(m[1]); }
  else if (/Safari/.test(ua)) { browserName = "Safari"; }

  return { browserName, browserMajor, osName, osMajor, deviceType };
}

interface UAData {
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (
    hints: string[],
  ) => Promise<{ platform?: string; platformVersion?: string; model?: string }>;
}

/**
 * Resolve a UaSummary using Client Hints first, UA-string fallback otherwise.
 * Never throws; always returns a UaSummary.
 */
export async function detectUserAgent(uaString?: string): Promise<UaSummary> {
  const ua = uaString ?? (typeof navigator !== "undefined" ? navigator.userAgent ?? "" : "");
  const summary = parseUaString(ua);

  try {
    const uaData = (typeof navigator !== "undefined"
      ? (navigator as Navigator & { userAgentData?: UAData }).userAgentData
      : undefined);
    if (uaData?.getHighEntropyValues) {
      const hi = await uaData.getHighEntropyValues(["platform", "platformVersion", "model"]);
      if (hi.platform) {
        summary.osName = hi.platform;
        summary.osMajor = intOrNull(hi.platformVersion?.split(".")[0]);
      }
      if (Array.isArray(uaData.brands)) {
        // Pick the most specific brand (not "Not.A/Brand", "Chromium").
        const preferred = uaData.brands.find(
          (b) => !/Not.?A.?Brand|Chromium/i.test(b.brand),
        ) ?? uaData.brands[0];
        if (preferred) {
          summary.browserName = preferred.brand;
          summary.browserMajor = intOrNull(preferred.version);
        }
      }
      if (typeof uaData.mobile === "boolean" && uaData.mobile && summary.deviceType === "desktop") {
        summary.deviceType = "mobile";
      }
    }
  } catch {
    // Ignore — UA-string fallback already populated summary.
  }

  return summary;
}

// Exposed for unit tests.
export const __test_parseUaString = parseUaString;
