import { useRef, useState } from "react";
import { Button } from "@/design-system";

import { Camera, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ACCEPTED = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

interface Props {
  userId: string;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  className?: string;
  /** Optional class id to make file path stable per class. Falls back to a random suffix. */
  classId?: string;
}

/**
 * Hero image uploader for classes. Uploads to the public `class-hero-images`
 * bucket under the uploader's user id folder (RLS enforced).
 */
export function ClassImageUpload({ userId, value, onChange, className, classId }: Props) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error("Please upload a PNG, JPG, or WEBP image.");
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error("Image must be under 5MB.");
      return;
    }

    setUploading(true);
    try {
      const rawExt = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const ext = /^[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : "jpg";
      const stableId = classId ?? `new-${crypto.randomUUID()}`;
      const path = `${userId}/${stableId}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("class-hero-images")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from("class-hero-images").getPublicUrl(path);
      const url = `${data.publicUrl}?t=${Date.now()}`;
      onChange(url);
      toast.success("Hero image uploaded.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to upload image.";
      toast.error(msg);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = () => onChange(null);

  return (
    <div className={cn("space-y-2", className)}>
      {value ? (
        <div className="relative group rounded-md overflow-hidden border border-border">
          <img
            src={value}
            alt="Class hero preview"
            className="w-full max-h-56 object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              <Camera className="h-4 w-4 mr-1" /> Replace
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleRemove}
              disabled={uploading}
            >
              <X className="h-4 w-4 mr-1" /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="w-full flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/20 hover:bg-muted/40 transition-colors py-10 px-4 text-sm text-muted-foreground"
          aria-label="Upload hero image"
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <Camera className="h-5 w-5" />
              <span>Click to upload a hero image</span>
              <span className="text-xs">PNG, JPG, or WEBP — max 5MB</span>
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        onChange={handleSelect}
        className="hidden"
        aria-label="Hero image file input"
      />
    </div>
  );
}
