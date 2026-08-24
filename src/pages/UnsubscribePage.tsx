import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/design-system";

import { Loader2, CheckCircle2, AlertCircle, MailX } from "lucide-react";

type State = "loading" | "valid" | "already_unsubscribed" | "invalid" | "success" | "error";

export default function UnsubscribePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<State>("loading");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }

    const validate = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const response = await fetch(
          `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: supabaseKey } }
        );
        const data = await response.json();

        if (data.valid === false && data.reason === "already_unsubscribed") {
          setState("already_unsubscribed");
        } else if (data.valid) {
          setState("valid");
        } else {
          setState("invalid");
        }
      } catch {
        setState("invalid");
      }
    };

    validate();
  }, [token]);

  const handleUnsubscribe = async () => {
    if (!token) return;
    setProcessing(true);
    try {
      const { error } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (error) throw error;
      setState("success");
    } catch {
      setState("error");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Email Preferences</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {state === "loading" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Validating your request…</p>
            </div>
          )}

          {state === "valid" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <MailX className="h-10 w-10 text-muted-foreground" />
              <p className="text-foreground">
                Would you like to unsubscribe from Tech Fleet Network emails?
              </p>
              <Button onClick={handleUnsubscribe} disabled={processing} className="gap-2">
                {processing && <Loader2 className="h-4 w-4 animate-spin" />}
                Confirm Unsubscribe
              </Button>
            </div>
          )}

          {state === "success" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-10 w-10 text-success" />
              <p className="text-foreground font-medium">You've been unsubscribed</p>
              <p className="text-sm text-muted-foreground">
                You will no longer receive transactional emails from Tech Fleet Network.
              </p>
            </div>
          )}

          {state === "already_unsubscribed" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-10 w-10 text-muted-foreground" />
              <p className="text-foreground font-medium">Already unsubscribed</p>
              <p className="text-sm text-muted-foreground">
                You have already been unsubscribed from these emails.
              </p>
            </div>
          )}

          {(state === "invalid" || state === "error") && (
            <div className="flex flex-col items-center gap-3 py-4">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-foreground font-medium">
                {state === "invalid" ? "Invalid or expired link" : "Something went wrong"}
              </p>
              <p className="text-sm text-muted-foreground">
                {state === "invalid"
                  ? "This unsubscribe link is no longer valid."
                  : "Please try again later or contact support."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
