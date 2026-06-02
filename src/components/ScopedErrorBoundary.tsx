import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/services/error-reporter.service";
import { isChunkLoadMessage } from "@/lib/lazy-with-retry";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  label: string;
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

/**
 * Scoped error boundary — catches render errors inside a single feature
 * surface (e.g. Get Help route, AG Grid) so a crash there cannot take
 * down the whole route. Real error is always logged to console first, then
 * forwarded to the audit log with a `boundary:<label>` source tag.
 *
 * Composes the same chunk-load self-heal logic as the root ErrorBoundary,
 * so stale-deploy chunk failures inside a scoped surface still trigger a
 * single soft reload rather than a permanent fallback.
 */
export class ScopedErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const { label } = this.props;

    // Always surface the real error in the console — satisfies the
    // "log the real error" contract regardless of opaque-error filtering
    // happening downstream in the reporter.
    // eslint-disable-next-line no-console
    console.error(`[boundary:${label}]`, error, info);

    const msg = error.message || "";
    const isChunkError = isChunkLoadMessage(msg) || /ChunkLoadError/i.test(error.name);

    if (isChunkError && typeof window !== "undefined") {
      const FLAG = `__lovable_chunk_reload__:${label}`;
      if (!window.sessionStorage.getItem(FLAG)) {
        window.sessionStorage.setItem(FLAG, "1");
        window.location.reload();
        return;
      }
    }

    const stack = `${error.name}: ${error.message}\n${error.stack ?? ""}\n\nComponent stack:${info.componentStack ?? ""}`;
    const route = typeof window !== "undefined" ? window.location.pathname : "unknown";
    reportError(stack, `boundary.${label}:${route}`, {
      eventType: isChunkError ? "ui_chunk_load_failed" : "ui_render_error",
      severity: isChunkError ? "warn" : "error",
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: "" });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border/40 bg-card p-8 text-center"
      >
        <AlertCircle className="h-10 w-10 text-destructive" aria-hidden />
        <h2 className="text-lg font-semibold text-foreground">
          {this.props.label} hit a snag
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          We saved the details for the team. The rest of the page is still
          working — try again or move on for now.
        </p>
        <Button variant="outline" onClick={this.handleRetry}>
          Try again
        </Button>
      </div>
    );
  }
}
