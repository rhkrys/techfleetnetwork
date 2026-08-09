// Shared helpers for compliance edge functions.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Audit T-C: hardened IP resolution (prefer cf-connecting-ip; XFF is spoofable).
// Re-exported from the shared helper so every compliance consumer is fixed at once.
export { clientIp } from "./client-ip.ts";

// Country-level export-control / sanctions deny list (US OFAC + EU + UK overlap).
// Keep conservative; per-name SDN screening is a future workstream.
export const SANCTIONS_LIST_VERSION = "2026-05-08";
export const EMBARGOED_COUNTRIES = new Set([
  "CU", // Cuba
  "IR", // Iran
  "KP", // North Korea
  "SY", // Syria
  "RU", // Russia (export-control)
  "BY", // Belarus
  "MM", // Myanmar (Burma)
  // Disputed regions screened by region code where available
  "UA-43", // Crimea
  "UA-14", // Donetsk
  "UA-09", // Luhansk
]);

export function isEmbargoed(countryCode: string): boolean {
  return EMBARGOED_COUNTRIES.has(countryCode.toUpperCase());
}
