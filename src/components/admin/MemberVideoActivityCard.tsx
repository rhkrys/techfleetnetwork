import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/design-system";

interface Row {
  id: string;
  created_at: string;
  event: string;
  lesson_id: string;
  lesson_title: string | null;
  youtube_id: string;
  position_seconds: number | null;
  course_slug: string | null;
}

const tone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  opened: "outline",
  play: "default",
  pause: "secondary",
  ended: "default",
  seek: "secondary",
  closed: "outline",
};

function fmtPos(s: number | null) {
  if (s == null || !Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function MemberVideoActivityCard({
  userId,
  limit = 25,
}: {
  userId: string;
  limit?: number;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("lesson_video_events")
        .select(
          "id,created_at,event,lesson_id,lesson_title,youtube_id,position_seconds,course_slug"
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (cancelled) return;
      if (error) setError(error.message);
      else setRows(data as Row[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, limit]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent video activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-sm text-destructive">Couldn't load activity: {error}</p>}
        {!error && rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!error && rows && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No course videos opened yet.</p>
        )}
        {rows && rows.length > 0 && (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.lesson_title ?? r.lesson_id}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()} · {fmtPos(r.position_seconds)}
                  </p>
                </div>
                <Badge variant={tone[r.event] ?? "outline"} className="shrink-0">
                  {r.event}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default MemberVideoActivityCard;
