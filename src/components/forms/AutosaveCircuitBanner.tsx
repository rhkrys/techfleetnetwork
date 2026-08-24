import { AlertTriangle, RotateCcw, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button } from "@/design-system";

import type { AutosaveCircuitReason } from "@/hooks/use-autosave";

interface Props {
  open: boolean;
  reason: AutosaveCircuitReason | null;
  onRetry: () => void;
  onReload?: () => void;
}

/**
 * Inline banner shown when use-autosave opens its circuit. Renders nothing
 * when the circuit is closed so consumers can mount it unconditionally
 * inside form layouts.
 *
 * Copy follows the brand voice rules (verb+object CTAs, sentence case,
 * empathy + plain reason + recovery action) — see mem://style/editorial-rules.
 */
export function AutosaveCircuitBanner({ open, reason, onRetry, onReload }: Props) {
  if (!open) return null;

  const copy = (() => {
    switch (reason) {
      case "auth_lost":
        return {
          title: "Your session expired",
          body: "Sign in again to keep saving your draft. Your unsaved changes are kept locally for now.",
          retryLabel: "Try saving now",
          showReload: true,
        };
      case "schema_drift":
        return {
          title: "This form is out of date",
          body: "We rolled out an update. Reload the page so your draft can save against the new form.",
          retryLabel: "Try saving now",
          showReload: true,
        };
      case "permission":
        return {
          title: "We can't save this draft",
          body: "Your account doesn't have permission to edit this form. Refresh, or contact support if this looks wrong.",
          retryLabel: "Try saving now",
          showReload: true,
        };
      case "rate_limited":
        return {
          title: "Too many saves in a row",
          body: "We paused autosave for a moment. Try saving when you're ready — we'll pick back up.",
          retryLabel: "Try saving now",
          showReload: false,
        };
      case "transient":
      case "unknown":
      default:
        return {
          title: "We couldn't save your draft",
          body: "Something on our side is acting up. Your typing is safe — try saving now, or reload if it keeps failing.",
          retryLabel: "Try saving now",
          showReload: true,
        };
    }
  })();

  return (
    <Alert variant="destructive" role="alert" aria-live="polite" className="mb-4">
      <AlertTriangle className="h-4 w-4" aria-hidden />
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{copy.body}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" aria-hidden /> {copy.retryLabel}
          </Button>
          {copy.showReload && (
            <Button
              size="sm"
              variant="outline"
              onClick={onReload ?? (() => window.location.reload())}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Reload form
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
