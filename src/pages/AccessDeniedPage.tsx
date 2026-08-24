import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Home } from "lucide-react";
import { Button } from "@/design-system";

export default function AccessDeniedPage() {
  const location = useLocation();
  const reason = typeof location.state?.reason === "string" ? location.state.reason : null;
  const from =
    typeof location.state?.from?.pathname === "string" ? location.state.from.pathname : null;

  return (
    <main className="min-h-[70vh] px-4 py-10 sm:px-6 lg:px-8">
      <section className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
        </div>

        <p className="mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Access denied
        </p>
        <h1 className="text-3xl font-bold tracking-normal text-foreground sm:text-4xl">
          You don’t have permission to open this area
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          {reason ??
            "Your account was verified, but it does not have the required access for this page."}
        </p>

        {from && (
          <p
            className="mt-3 max-w-full break-words text-sm text-muted-foreground"
            aria-live="polite"
          >
            Requested page: <span className="font-medium text-foreground">{from}</span>
          </p>
        )}

        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button component={Link} to="/dashboard">
            <Home className="mr-2 h-4 w-4" aria-hidden="true" />
            Go to dashboard
          </Button>
          <Button component={Link} to="/feedback" variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
            Contact support
          </Button>
        </div>
      </section>
    </main>
  );
}
