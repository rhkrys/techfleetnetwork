import { useState, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage, Button } from "@/design-system";

import { Camera, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AvatarCropperDialog } from "@/components/profile/AvatarCropperDialog";

// Pre-crop accept list (cropper re-encodes to JPEG and strips EXIF).
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB pre-crop; output is ~<200KB JPEG.

interface AvatarUploadProps {
  userId: string;
  currentUrl: string | null;
  initials: string;
  onUploaded: (url: string | null) => void;
  className?: string;
}

export function AvatarUpload({
  userId,
  currentUrl,
  initials,
  onUploaded,
  className,
}: AvatarUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Please upload a PNG, JPG, or WEBP image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error("Image must be under 5MB.");
      return;
    }

    const url = URL.createObjectURL(file);
    setCropSrc(url);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleCropConfirm = async (blob: Blob) => {
    setUploading(true);
    try {
      const path = `${userId}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl } as any)
        .eq("user_id", userId);

      setPreviewUrl(publicUrl);
      onUploaded(publicUrl);
      toast.success("Profile picture updated.");
      closeCropper();
    } catch (err: any) {
      toast.error(err.message || "Failed to upload image.");
    } finally {
      setUploading(false);
    }
  };

  const closeCropper = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleRemove = async () => {
    setUploading(true);
    try {
      // List and remove existing avatar files
      const { data: files } = await supabase.storage.from("avatars").list(userId);
      if (files?.length) {
        await supabase.storage.from("avatars").remove(files.map((f) => `${userId}/${f.name}`));
      }

      await supabase
        .from("profiles")
        .update({ avatar_url: null } as any)
        .eq("user_id", userId);

      setPreviewUrl(null);
      onUploaded(null);
      toast.success("Profile picture removed.");
    } catch (err: any) {
      toast.error(err.message || "Failed to remove image.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="relative group">
        <Avatar className="h-20 w-20 border-2 border-border">
          <AvatarImage src={previewUrl || undefined} alt="Profile picture" />
          <AvatarFallback className="text-lg font-medium">{initials}</AvatarFallback>
        </Avatar>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          aria-label="Change profile picture"
        >
          <Camera className="h-5 w-5 text-white" />
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        onChange={handleFileSelect}
        className="hidden"
        aria-label="Upload profile picture"
      />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : previewUrl ? "Change Photo" : "Upload Photo"}
        </Button>
        {previewUrl && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={uploading}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="h-4 w-4 mr-1" />
            Remove
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        PNG, JPG, or WEBP, max 5MB. Cropped to a 512×512 square.
      </p>

      <AvatarCropperDialog
        open={Boolean(cropSrc)}
        imageSrc={cropSrc}
        onCancel={closeCropper}
        onConfirm={handleCropConfirm}
      />
    </div>
  );
}
