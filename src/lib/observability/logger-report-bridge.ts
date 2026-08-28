/**
 * Bridges error-level logs into the error reporter (ADR-0021, Phase 0b).
 *
 * A LEAF module wired only from main.tsx. It imports the logger seam, the report
 * facade, and the feature-flag check — so `logger.service` itself takes on no new
 * dependency and no import cycle is possible.
 *
 * Forwarding is gated by the `logger_error_reporting` flag, which ships OFF, so
 * installing this is a runtime no-op until an admin ramps the flag. That is the
 * mechanism that finally routes the hundreds of `log.error(...)` service catches
 * into `audit_log` — safely, behind a dial and a kill-switch.
 */
import { setLoggerErrorForwarder, type ForwardedLogError } from "@/services/logger.service";
import { report } from "@/lib/observability/report";
import { isFeatureEnabled, refreshFeatureFlags } from "@/services/feature-flags.service";

const FLAG = "logger_error_reporting";

function forward(e: ForwardedLogError): void {
  if (!isFeatureEnabled(FLAG)) return; // safe default OFF until ramped

  // Hand the ORIGINAL throwable to report() so its structural classifier still
  // works — transient PG codes (PGRST002, deadlocks…), TypeError/network, and
  // AbortError all depend on the real error's code/message/type. Reconstructing
  // from the human log line would drop those and misclassify infra blips as
  // actionable bugs (flooding agent_fix_queue). If the caller logged only a
  // message (no error), synthesize one from the already-redacted message. The
  // reporter redacts the persisted message again, idempotently.
  const error = e.error ?? new Error(e.message);

  // NOTE (pre-ramp, ADR-0021): a catch that calls BOTH log.error(err) AND
  // report()/reportError(err) will produce two audit rows once this is ramped
  // (different source/message → they don't dedupe). The bridge is intended for
  // log-only catches; the both-path sites must be reconciled before ramping the
  // flag past 0%. Tracked as a ramp prerequisite.
  report(error, {
    source: `${e.service}:${e.action}`,
    eventType: "client_error",
    severity: "error",
  });
}

/** Wire error-level logs to the reporter and warm the flag snapshot. */
export function installLoggerReporting(): void {
  setLoggerErrorForwarder(forward);
  // Load the flag once so the sync isFeatureEnabled() has a snapshot; if the
  // fetch fails the snapshot stays empty and forwarding stays OFF (safe).
  void refreshFeatureFlags();
}
