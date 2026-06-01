import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export default function ConfirmAdminPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "already" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("No confirmation token provided.");
      return;
    }

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const url = `https://${projectId}.supabase.co/functions/v1/confirm-admin-role?token=${encodeURIComponent(token)}`;

    fetch(url)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          if (data.already_confirmed) {
            setStatus("already");
            setMessage("Your admin role was already confirmed.");
          } else {
            setStatus("success");
            setMessage("Your admin role has been activated!");
          }
        } else {
          setStatus("error");
          setMessage(data.error || "Confirmation failed.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("An unexpected error occurred.");
      });
  }, [token]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">
          {status === "loading" && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
              <p className="text-muted-foreground">Confirming your admin role…</p>
            </>
          )}
          {(status === "success" || status === "already") && (
            <>
              <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
              <h2 className="text-xl font-bold text-foreground">{message}</h2>
              <p className="text-muted-foreground text-sm">
                You now have admin privileges in the Tech Fleet Network.
              </p>
              <Button asChild>
                <Link to="/dashboard">Go to Dashboard</Link>
              </Button>
            </>
          )}
          {status === "error" && (
            <>
              <XCircle className="h-10 w-10 text-destructive mx-auto" />
              <h2 className="text-xl font-bold text-foreground">We couldn't confirm your role</h2>
              <p className="text-muted-foreground text-sm">{message}</p>
              <Button variant="outline" asChild>
                <Link to="/dashboard">Go to Dashboard</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
