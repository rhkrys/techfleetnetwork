import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/services/error-reporter.service";
import { isChunkLoadMessage } from "@/lib/lazy-with-retry";
import { AlertCircle } from "lucide-react";
import { Button } from "@/design-system";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

/**
 * React Error Boundary that catches render-time errors,
 * reports them to the audit_log for admin visibility, and
 * shows a recovery UI.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Stale-deployment chunk-load errors: silently hard-reload once instead of
    // showing the error UI. Guarded by sessionStorage to avoid reload loops.
    const msg = error.message || "";
    const isChunkError = isChunkLoadMessage(msg) || /ChunkLoadError/i.test(error.name);

    if (isChunkError && typeof window !== "undefined") {
      const FLAG = "__lovable_chunk_reload__";
      if (!window.sessionStorage.getItem(FLAG)) {
        window.sessionStorage.setItem(FLAG, "1");
        window.location.reload();
        return;
      }
    }

    const stack = `${error.name}: ${error.message}\n${error.stack ?? ""}\n\nComponent stack:${info.componentStack ?? ""}`;
    const route = typeof window !== "undefined" ? window.location.pathname : "unknown";
    // Stale-chunk errors that fall through here (already reloaded once this
    // session) are infrastructure noise, not actionable bugs. Report them
    // under the existing chunk-load event_type at warn severity so they
    // don't enter the Triage queue (which only ingests severity=error).
    reportError(stack, `ErrorBoundary:${route}`, {
      eventType: isChunkError ? "ui_chunk_load_failed" : "ui_render_error",
      severity: isChunkError ? "warn" : "error",
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center min-h-[40vh] gap-4 p-8"
          role="alert"
        >
          <AlertCircle className="h-12 w-12 text-destructive" aria-hidden />
          <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            An unexpected error occurred. The error has been logged for the admin team to
            investigate.
          </p>
          <Button variant="outline" onClick={this.handleRetry}>
            Try Again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
