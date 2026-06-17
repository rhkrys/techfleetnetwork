import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSessionSafe } from "@/lib/auth/session-port";
import { useEffect } from "react";

import type { CommunityEvent } from "@/components/events/CommunityEventCard";
import { addWeeks } from "@/lib/events/weekRange";

const FUNCTIONS_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/get-community-events`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

async function fetchRange(from: Date, to: Date): Promise<CommunityEvent[]> {
  const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  const session = await getSessionSafe();
  const token = session?.access_token ?? ANON_KEY;
  const res = await fetch(`${FUNCTIONS_URL}?${qs.toString()}`, {
    method: "GET",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`get-community-events ${res.status}`);
  const data = await res.json();
  return ((data as { events?: CommunityEvent[] })?.events ?? []) as CommunityEvent[];
}

export function useCommunityEventsWeek(weekStart: Date) {
  const qc = useQueryClient();
  const weekEnd = addWeeks(weekStart, 1);
  const key = ["community-events", "week", weekStart.toISOString()];

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchRange(weekStart, weekEnd),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Prefetch next week for snappy navigation.
  useEffect(() => {
    if (!query.data) return;
    const nextStart = addWeeks(weekStart, 1);
    const nextEnd = addWeeks(nextStart, 1);
    qc.prefetchQuery({
      queryKey: ["community-events", "week", nextStart.toISOString()],
      queryFn: () => fetchRange(nextStart, nextEnd),
      staleTime: 10 * 60 * 1000,
    });
  }, [query.data, weekStart, qc]);

  return query;
}
