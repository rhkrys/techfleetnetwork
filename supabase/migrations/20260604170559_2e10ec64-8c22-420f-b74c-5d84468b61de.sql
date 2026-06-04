CREATE OR REPLACE FUNCTION public.get_refactor_kpis(p_days INT DEFAULT 30)
RETURNS TABLE (
  metric_key TEXT, label TEXT, description TEXT, category TEXT, unit TEXT,
  baseline_value NUMERIC, target_value NUMERIC, direction TEXT,
  related_section TEXT, sort_order INT,
  current_value NUMERIC, previous_value NUMERIC,
  trend NUMERIC[], status TEXT, last_snapshot TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admins only';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (d.metric_key)
      d.metric_key, d.metric_value AS current_value, d.computed_at AS last_snapshot
    FROM public.refactor_kpi_daily d
    WHERE d.snapshot_date >= CURRENT_DATE - p_days
    ORDER BY d.metric_key, d.snapshot_date DESC, d.computed_at DESC
  ),
  prev AS (
    SELECT DISTINCT ON (d.metric_key) d.metric_key, d.metric_value AS previous_value
    FROM public.refactor_kpi_daily d
    JOIN latest l ON l.metric_key = d.metric_key
    WHERE d.snapshot_date < CURRENT_DATE
    ORDER BY d.metric_key, d.snapshot_date DESC, d.computed_at DESC
  ),
  trnd AS (
    SELECT d.metric_key, array_agg(d.metric_value ORDER BY d.snapshot_date) AS trend
    FROM public.refactor_kpi_daily d
    WHERE d.snapshot_date >= CURRENT_DATE - p_days
    GROUP BY d.metric_key
  )
  SELECT
    c.metric_key, c.label, c.description, c.category, c.unit,
    c.baseline_value, c.target_value, c.direction, c.related_section, c.sort_order,
    COALESCE(l.current_value, c.baseline_value),
    p.previous_value,
    COALESCE(t.trend, ARRAY[]::NUMERIC[]),
    CASE
      WHEN l.current_value IS NULL THEN 'no_data'
      WHEN c.direction = 'lower_is_better' THEN
        CASE
          WHEN l.current_value <= c.target_value THEN 'met'
          WHEN l.current_value > c.baseline_value THEN 'off_track'
          WHEN (c.baseline_value - l.current_value) >= (c.baseline_value - c.target_value) * 0.5 THEN 'on_track'
          ELSE 'at_risk'
        END
      ELSE
        CASE
          WHEN l.current_value >= c.target_value THEN 'met'
          WHEN l.current_value < c.baseline_value THEN 'off_track'
          WHEN (l.current_value - c.baseline_value) >= (c.target_value - c.baseline_value) * 0.5 THEN 'on_track'
          ELSE 'at_risk'
        END
    END,
    l.last_snapshot
  FROM public.refactor_kpi_catalog c
  LEFT JOIN latest l ON l.metric_key = c.metric_key
  LEFT JOIN prev   p ON p.metric_key = c.metric_key
  LEFT JOIN trnd   t ON t.metric_key = c.metric_key
  ORDER BY c.category, c.sort_order;
END;
$$;