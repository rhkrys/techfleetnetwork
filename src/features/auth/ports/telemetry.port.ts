/**
 * AUTH-ENGINE — telemetry port.
 *
 * Single seam between engine code and ops_events. Engines import from this
 * port; the audit-telemetry adapter is the only module that knows about the
 * `record-auth-event` edge function shape.
 *
 * Fire-and-forget. Never throws, never blocks the calling state transition.
 */
import {
  recordAuthEngineEvent,
  type AuthEngineKind,
} from "@/features/auth/adapters/audit-telemetry.adapter";

export type { AuthEngineKind };

export const telemetryPort = {
  record: recordAuthEngineEvent,
};
