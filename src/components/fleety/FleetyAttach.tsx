// Shared attach UI for Fleety (2.2-F): a paperclip button + a status chip, used identically by
// ChatPage, FleetyChatWidget, and GuidanceEmbed. Logic lives in useFleetyAttachment; this is
// only presentation so the three surfaces render the same control.
import { useRef } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCEPTED_FILE_TYPES, type FleetyAttachment } from "@/lib/fleety/attachment";
import type { AttachStatus } from "@/hooks/useFleetyAttachment";

export function FleetyAttachButton({
  onPick,
  disabled,
  busy,
}: {
  onPick: (file: File) => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          // reset so re-picking the SAME file still fires onChange
          e.currentTarget.value = "";
          if (f) onPick(f);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || busy}
        aria-label="Attach a file"
        title="Attach a file (PDF, image, or text) for Fleety to read"
        onClick={() => ref.current?.click()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
      </Button>
    </>
  );
}

export function FleetyAttachmentChip({
  attachment,
  status,
  error,
  onClear,
}: {
  attachment: FleetyAttachment | null;
  status: AttachStatus;
  error: string | null;
  onClear: () => void;
}) {
  if (status === "idle") return null;

  return (
    <div className="mb-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
      <div className="flex items-start gap-2">
        {status === "extracting" ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          {status === "extracting" && (
            <span className="text-muted-foreground">Reading your file…</span>
          )}
          {status === "error" && <span className="text-destructive">{error}</span>}
          {status === "ready" && attachment && (
            <>
              <span className="block truncate font-medium text-foreground">
                {attachment.filename}
              </span>
              {attachment.note ? (
                <span className="text-muted-foreground">{attachment.note}</span>
              ) : (
                <span className="text-muted-foreground">
                  Ready — I'll read this with your next message.
                </span>
              )}
            </>
          )}
        </div>
        {status !== "extracting" && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Remove attached file"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
