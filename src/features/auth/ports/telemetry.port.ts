/**
 * AUTH-ENGINE — telemetry port.
 *
 * Single seam between engine code and ops_events. Engines import from this
 * port; adapters know about edge-fn shapes and legacy telemetry helpers.
 * Fire-and-forget. Never throws, never blocks the calling state transition.
 */
import {
  recordAuthEngineEvent,
  type AuthEngineKind,
} from "@/features/auth/adapters/audit-telemetry.adapter";
import { logCaptchaTelemetry } from "@/lib/auth-captcha-telemetry";

export type { AuthEngineKind };

export const telemetryPort = {
  record: recordAuthEngineEvent,
  captcha: logCaptchaTelemetry,
};
