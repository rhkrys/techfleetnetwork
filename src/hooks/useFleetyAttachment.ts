// React state wrapper around the Fleety upload client (2.2-F). Shared by all three chat
// surfaces so upload/extract behavior stays identical everywhere (the "change all three
// surfaces together" rule). Holds the current attachment + status; the surface renders the
// paperclip button and chip from these.
import { useCallback, useState } from "react";
import { extractFile, type FleetyAttachment } from "@/lib/fleety/attachment";

export type AttachStatus = "idle" | "extracting" | "ready" | "error";

export function useFleetyAttachment() {
  const [attachment, setAttachment] = useState<FleetyAttachment | null>(null);
  const [status, setStatus] = useState<AttachStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const attach = useCallback(async (file: File): Promise<FleetyAttachment | null> => {
    setStatus("extracting");
    setError(null);
    setAttachment(null);
    try {
      const a = await extractFile(file);
      setAttachment(a);
      setStatus("ready");
      return a;
    } catch (e) {
      setError(e instanceof Error ? e.message : "I couldn't read that file.");
      setStatus("error");
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    setAttachment(null);
    setStatus("idle");
    setError(null);
  }, []);

  return { attachment, status, error, attach, clear };
}
