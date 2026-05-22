/**
 * Shared email-domain helpers for edge functions.
 *
 * Strategy (per LCL-FIX-001/002):
 *   1. Hard allowlist — major mailbox providers always pass without DNS.
 *   2. 24h in-memory positive cache — DNS hits are rare.
 *   3. Cloudflare DoH lookup with a 2s AbortController timeout per record.
 *   4. On error / timeout → FAIL OPEN. DNS is defense-in-depth, not the
 *      primary auth gate. A DoH hiccup must never lock real users out.
 */
import { z } from "npm:zod@4.3.6";

export const EMAIL_DOMAIN_ALLOWLIST: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "aol.com",
  "techfleet.org",
  "techfleet.network",
]);

const DOMAIN_RE =
  /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const DnsAnswerSchema = z.object({
  Answer: z.array(z.unknown()).optional(),
  Status: z.number().optional(),
}).passthrough();

const POSITIVE_TTL_MS = 24 * 60 * 60_000;
const positiveCache = new Map<string, number>(); // domain -> expiresAt

export function emailDomain(email: string): string {
  return (email ?? "").toLowerCase().split("@").pop()?.replace(/\.+$/, "") ?? "";
}

export function isAllowlistedDomain(domain: string): boolean {
  return EMAIL_DOMAIN_ALLOWLIST.has(domain.toLowerCase());
}

async function hasDnsRecord(
  domain: string,
  type: "MX" | "A" | "AAAA",
  timeoutMs: number,
): Promise<boolean | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`,
      { headers: { accept: "application/dns-json" }, signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const parsed = DnsAnswerSchema.safeParse(await res.json());
    if (!parsed.success) return null;
    return parsed.data.Status === 0 &&
      Array.isArray(parsed.data.Answer) && parsed.data.Answer.length > 0;
  } catch {
    return null; // timeout / network error → unknown
  } finally {
    clearTimeout(t);
  }
}

export interface DomainCheckResult {
  valid: boolean;
  branch: "allowlist" | "cache" | "dns_ok" | "dns_reject" | "dns_fail_open" | "bad_format";
}

/**
 * Returns true if the domain looks usable. Fails open on DNS errors.
 */
export async function checkEmailDomain(
  rawDomain: string,
  opts: { timeoutMs?: number } = {},
): Promise<DomainCheckResult> {
  const domain = (rawDomain ?? "").toLowerCase().trim();
  if (!DOMAIN_RE.test(domain)) return { valid: false, branch: "bad_format" };

  if (isAllowlistedDomain(domain)) return { valid: true, branch: "allowlist" };

  const cached = positiveCache.get(domain);
  if (cached && cached > Date.now()) return { valid: true, branch: "cache" };
  if (cached) positiveCache.delete(domain);

  const timeoutMs = opts.timeoutMs ?? 2_000;
  const checks = await Promise.all([
    hasDnsRecord(domain, "MX", timeoutMs),
    hasDnsRecord(domain, "A", timeoutMs),
    hasDnsRecord(domain, "AAAA", timeoutMs),
  ]);

  const anyOk = checks.some((r) => r === true);
  if (anyOk) {
    positiveCache.set(domain, Date.now() + POSITIVE_TTL_MS);
    return { valid: true, branch: "dns_ok" };
  }

  const anyDefinitiveNo = checks.every((r) => r === false);
  if (anyDefinitiveNo) return { valid: false, branch: "dns_reject" };

  // At least one lookup was inconclusive (timeout / network error) and none
  // returned a positive answer. FAIL OPEN per LCL-FIX-001 — DoH outages must
  // not lock real users out.
  console.warn(`[email-domain] DNS inconclusive for "${domain}" — failing open`);
  return { valid: true, branch: "dns_fail_open" };
}

/** Test-only hook. */
export const __emailDomainTestHooks = {
  positiveCache,
};
