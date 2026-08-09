import { useState } from "react";
import { useSearchParams, Link, useLocation } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { invokeEdge } from "@/lib/edge/invokeEdge";
import { EdgeInvokeError } from "@/lib/errors/AppError";
import { useAuth } from "@/contexts/AuthContext";

// Audit T-G: the role grant is NEVER performed on page load. The invited user
// must be signed in as themselves and explicitly click Confirm, which POSTs to
// the edge function with their bearer JWT. An email prefetch carries no session.
type Status =
  "ready" | "submitting" | "success" | "already" | "expired" | "not_owner" | "invalid" | "error";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">{children}</CardContent>
      </Card>
    </div>
  );
}

export default function ConfirmTeacherPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const token = params.get("token");
  const { user, loading } = useAuth();
  const [status, setStatus] = useState<Status>("ready");
  const [message, setMessage] = useState("");

  if (!token) {
    return (
      <Shell>
        <XCircle className="h-10 w-10 text-destructive mx-auto" />
        <h2 className="text-xl font-bold text-foreground">Invalid confirmation link</h2>
        <p className="text-muted-foreground text-sm">
          This link is missing its confirmation token.
        </p>
        <Button variant="outline" asChild>
          <Link to="/dashboard">Go to Dashboard</Link>
        </Button>
      </Shell>
    );
  }

  if (loading) {
    return (
      <Shell>
        <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
        <p className="text-muted-foreground">Loading…</p>
      </Shell>
    );
  }

  if (!user) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return (
      <Shell>
        <ShieldCheck className="h-10 w-10 text-primary mx-auto" />
        <h2 className="text-xl font-bold text-foreground">Sign in to confirm</h2>
        <p className="text-muted-foreground text-sm">
          For your security, confirm your teacher role while signed in to the account it was issued
          to.
        </p>
        <Button asChild>
          <Link to={`/login?redirect=${redirect}`}>Sign in to continue</Link>
        </Button>
      </Shell>
    );
  }

  const onConfirm = async () => {
    setStatus("submitting");
    try {
      const data = await invokeEdge<{ success?: boolean; already_confirmed?: boolean }>(
        "confirm-teacher-role",
        { body: { token }, silentReport: true }
      );
      setStatus(data?.already_confirmed ? "already" : "success");
    } catch (err) {
      const status = err instanceof EdgeInvokeError ? err.status : undefined;
      if (status === 410) setStatus("expired");
      else if (status === 403) setStatus("not_owner");
      else if (status === 401) {
        setStatus("error");
        setMessage("Your session expired. Please sign in again.");
      } else {
        setStatus("error");
        setMessage("We couldn't confirm your role.");
      }
    }
  };

  if (status === "success" || status === "already") {
    return (
      <Shell>
        <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
        <h2 className="text-xl font-bold text-foreground">
          {status === "already"
            ? "Your teacher role was already confirmed"
            : "Your teacher role is active"}
        </h2>
        <p className="text-muted-foreground text-sm">
          You can now create and publish classes in Tech Fleet Network.
        </p>
        <Button asChild>
          <Link to="/teach/classes">Go to My Classes</Link>
        </Button>
      </Shell>
    );
  }

  if (status === "expired" || status === "not_owner" || status === "error") {
    const heading =
      status === "expired"
        ? "This confirmation link has expired"
        : status === "not_owner"
          ? "This invitation is for a different account"
          : "We couldn't confirm your role";
    const body =
      status === "expired"
        ? "Ask an administrator to send a fresh teacher invitation."
        : status === "not_owner"
          ? "Sign in as the account the invitation was sent to, then open the link again."
          : message;
    return (
      <Shell>
        <XCircle className="h-10 w-10 text-destructive mx-auto" />
        <h2 className="text-xl font-bold text-foreground">{heading}</h2>
        <p className="text-muted-foreground text-sm">{body}</p>
        <Button variant="outline" asChild>
          <Link to="/dashboard">Go to Dashboard</Link>
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <ShieldCheck className="h-10 w-10 text-primary mx-auto" />
      <h2 className="text-xl font-bold text-foreground">Confirm your teacher role</h2>
      <p className="text-muted-foreground text-sm">
        You're signed in as <span className="font-medium text-foreground">{user.email}</span>. Click
        below to activate your teacher privileges in the Tech Fleet Network.
      </p>
      <Button className="w-full" onClick={onConfirm} disabled={status === "submitting"}>
        {status === "submitting" ? "Confirming…" : "Confirm teacher role"}
      </Button>
    </Shell>
  );
}
