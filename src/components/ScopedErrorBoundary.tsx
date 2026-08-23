import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/services/error-reporter.service";
import { isChunkLoadMessage } from "@/lib/lazy-with-retry";
import { isDomExtensionMutationError } from "@/lib/observability/classify";
import { AlertCircle } from "lucide-react";
import { Button } from "@/design-system";

interface Props {
  label: string;
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
  /** Bumped on silent remount (DOM-mutation extension recovery). */
  resetKey: number;
}

/**
 * Scoped error boundary — catches render errors inside a single feature
 * surface so a crash there cannot take down the whole route. Real error is
 * always surfaced to console first, then forwarded to the audit log with a
 * `boundary:<label>` source tag.
 *
 * Three recovery paths:
 *  1. Chunk-load error → one-shot reload (handled here, same as root).
 *  2. DOM-mutation extension error (Google Translate / Transover et al.)
 *     → silent remount with a fresh `resetKey`. No user-visible fallback,
 *     no audit row — the underlying classifier drops it as not-our-bug.
 *  3. Any other render error → fallback UI + Try Again button + audit row.
 */
export class ScopedErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: "", resetKey: 0 };
  /** Cap silent remounts per surface so we don't infinite-loop. */
  private silentRetries = 0;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const { label } = this.props;

    // Always surface the real error in the console — satisfies the
    // "log the real error" contract regardless of downstream filtering.
    // eslint-disable-next-line no-console
    console.error(`[boundary:${label}]`, error, info);

    const msg = error.message || "";
    const isChunkError = isChunkLoadMessage(msg) || /ChunkLoadError/i.test(error.name);
    const isDomExt = isDomExtensionMutationError(error);

    if (isChunkError && typeof window !== "undefined") {
      const FLAG = `__lovable_chunk_reload__:${label}`;
      if (!window.sessionStorage.getItem(FLAG)) {
        window.sessionStorage.setItem(FLAG, "1");
        window.location.reload();
        return;
      }
    }

    if (isDomExt && this.silentRetries < 2) {
      this.silentRetries += 1;
      // Silent remount in a microtask so React can finish unwinding first.
      Promise.resolve().then(() => {
        this.setState((s) => ({ hasError: false, errorMessage: "", resetKey: s.resetKey + 1 }));
      });
      return;
    }

    const stack = `${error.name}: ${error.message}\n${error.stack ?? ""}\n\nComponent stack:${info.componentStack ?? ""}`;
    const route = typeof window !== "undefined" ? window.location.pathname : "unknown";
    reportError(stack, `boundary.${label}:${route}`, {
      eventType: isChunkError ? "ui_chunk_load_failed" : "ui_render_error",
      severity: isChunkError ? "warn" : "error",
    });
  }

  handleRetry = () => {
    this.setState((s) => ({ hasError: false, errorMessage: "", resetKey: s.resetKey + 1 }));
  };

  render() {
    if (!this.state.hasError) {
      // `key` forces full remount of children when we recover, dropping any
      // half-mounted subtree left behind by the extension's DOM edit.
      return (
        <div key={this.state.resetKey} style={{ display: "contents" }}>
          {this.props.children}
        </div>
      );
    }
    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border/40 bg-card p-8 text-center"
      >
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden />
        <h2 className="text-lg font-semibold text-foreground">{this.props.label} hit a snag</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          We saved the details for the team. The rest of the page is still working — try again or
          move on for now.
        </p>
        <Button variant="outline" onClick={this.handleRetry}>
          Try again
        </Button>
      </div>
    );
  }
}
