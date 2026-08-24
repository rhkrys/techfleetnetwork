import { useState } from "react";
import { Button } from "@/design-system";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

interface Props {
  applicationId: string;
  disabled?: boolean;
  size?: "sm" | "default";
}

export function AgreementResendButton({ applicationId, disabled, size = "sm" }: Props) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke("send-community-agreement-trigger", {
        body: { application_id: applicationId },
      });
      if (error) throw error;
      toast.success("Agreement request resent.", {
        description: "We notified the contributor in app and by email (if opted in).",
      });
    } catch (e: any) {
      toast.error("Couldn't resend the request.", {
        description: e?.message ?? "Try again shortly.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      size={size}
      variant="outline"
      onClick={handleClick}
      disabled={disabled || loading}
      className="gap-1.5"
      aria-label="Resend community agreement request"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Send className="h-3.5 w-3.5" />
      )}
      Resend
    </Button>
  );
}
