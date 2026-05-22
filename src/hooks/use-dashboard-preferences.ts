import { useQuery, useMutation, useQueryClient } from "@/lib/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type DashboardWidgetId =
  | "core_courses"
  | "world_map"
  | "network_activity"
  | "latest_updates"
  | "my_project_apps"
  | "badges"
  | "system_health";

export const ALL_WIDGETS: { id: DashboardWidgetId; label: string; adminOnly?: boolean }[] = [
  { id: "core_courses", label: "Core Courses" },
  { id: "world_map", label: "Tech Fleet Network Map" },
  { id: "network_activity", label: "Tech Fleet Network Activity" },
  { id: "latest_updates", label: "Community Updates" },
  { id: "my_project_apps", label: "My Project Applications" },
  { id: "badges", label: "Beginner Badges Earned" },
  { id: "system_health", label: "System Health", adminOnly: true },
];

/** Default order for all widget IDs */
const DEFAULT_ORDER: DashboardWidgetId[] = ALL_WIDGETS.map((w) => w.id);

/** Default visible widgets for brand-new users */
const DEFAULT_VISIBLE: DashboardWidgetId[] = ALL_WIDGETS.map((w) => w.id);

const VALID_WIDGET_IDS = new Set<DashboardWidgetId>(DEFAULT_ORDER);

const extractWidgetList = (value: unknown): DashboardWidgetId[] | null => {
  let rawValues: unknown[] | null = null;

  if (Array.isArray(value)) {
    rawValues = value;
  } else if (value && typeof value === "object") {
    const indexedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => /^\d+$/.test(key))
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    rawValues = indexedEntries.length > 0 ? indexedEntries.map(([, item]) => item) : null;
  }

  if (!rawValues) return null;

  return rawValues.filter(
    (item): item is DashboardWidgetId =>
      typeof item === "string" && VALID_WIDGET_IDS.has(item as DashboardWidgetId),
  );
};

interface Prefs {
  visibleWidgets: DashboardWidgetId[];
  widgetOrder: DashboardWidgetId[];
  isNew: boolean;
}

export function useDashboardPreferences() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queryKey = ["dashboard-preferences", user?.id];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<Prefs> => {
      const { data: row } = await supabase
        .from("dashboard_preferences")
        .select("visible_widgets, widget_order")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (!row) return { visibleWidgets: DEFAULT_VISIBLE, widgetOrder: DEFAULT_ORDER, isNew: true };

      const visible = extractWidgetList(row.visible_widgets) ?? DEFAULT_VISIBLE;
      const storedOrder = extractWidgetList(row.widget_order);
      let order = storedOrder ? Array.from(new Set(storedOrder)) : DEFAULT_ORDER;

      const missing = DEFAULT_ORDER.filter((id) => !order.includes(id));
      if (missing.length > 0) order = [...order, ...missing];

      return {
        visibleWidgets: Array.from(new Set(visible)).filter((id) => order.includes(id)),
        widgetOrder: order,
        isNew: false,
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async (prefs: { visibleWidgets: DashboardWidgetId[]; widgetOrder: DashboardWidgetId[] }) => {
      const { error } = await supabase
        .from("dashboard_preferences")
        .upsert(
          [{
            user_id: user!.id,
            visible_widgets: prefs.visibleWidgets as unknown as import("@/integrations/supabase/types").Json,
            widget_order: prefs.widgetOrder as unknown as import("@/integrations/supabase/types").Json,
          }],
          { onConflict: "user_id" },
        );
      if (error) throw error;
    },
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData(queryKey);
      qc.setQueryData(queryKey, { ...prefs, isNew: false });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  // Self-healing: always coerce to arrays regardless of what cache/DB returns
  const visibleWidgets: DashboardWidgetId[] = (() => {
    const raw = data?.visibleWidgets;
    if (Array.isArray(raw)) return extractWidgetList(raw) ?? DEFAULT_VISIBLE;
    return extractWidgetList(raw) ?? DEFAULT_VISIBLE;
  })();
  const widgetOrder: DashboardWidgetId[] = (() => {
    const raw = data?.widgetOrder;
    const extracted = Array.isArray(raw) ? extractWidgetList(raw) : extractWidgetList(raw);
    return Array.from(new Set([...(extracted ?? []), ...DEFAULT_ORDER]));
  })();
  const isNewUser = data?.isNew ?? true;

  const persist = (visible: DashboardWidgetId[], order: DashboardWidgetId[]) => {
    const normalizedVisible = extractWidgetList(visible) ?? DEFAULT_VISIBLE;
    const normalizedOrder = Array.from(
      new Set([...(extractWidgetList(order) ?? []), ...DEFAULT_ORDER]),
    ) as DashboardWidgetId[];

    mutation.mutate({ visibleWidgets: normalizedVisible, widgetOrder: normalizedOrder });
  };

  const isVisible = (id: DashboardWidgetId) => visibleWidgets.includes(id);

  const setWidgets = (widgets: DashboardWidgetId[]) => persist(widgets, widgetOrder);

  const toggleWidget = (id: DashboardWidgetId) => {
    const next = isVisible(id)
      ? visibleWidgets.filter((w) => w !== id)
      : [...visibleWidgets, id];
    persist(next, widgetOrder);
  };

  const reorderWidgets = (order: DashboardWidgetId[]) => persist(visibleWidgets, order);

  return { visibleWidgets, widgetOrder, isVisible, setWidgets, toggleWidget, reorderWidgets, isNewUser, isLoading };
}
