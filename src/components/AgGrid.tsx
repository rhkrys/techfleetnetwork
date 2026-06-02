/**
 * Lazy-loaded AG Grid wrapper.
 *
 * AG Grid (community + react bindings + alpine CSS themes) is ~400KB gzipped.
 * Most users land on `/` or `/dashboard` and never open a grid, so we keep it
 * out of the initial bundle and load it on first mount of any table.
 *
 * The public API of `ThemedAgGrid` is unchanged — callers continue to import
 * from `@/components/AgGrid`. The real implementation lives in
 * `./AgGridImpl.tsx` and is fetched on demand.
 */
import { Suspense, type ComponentType } from "react";
import type { AgGridReactProps } from "ag-grid-react";
import type { GridApi } from "ag-grid-community";
import { lazyWithRetry } from "@/lib/lazy-with-retry";
import { ScopedErrorBoundary } from "@/components/ScopedErrorBoundary";

interface ThemedAgGridProps<T> extends AgGridReactProps<T> {
  height?: string;
  gridId?: string;
  hideResetButton?: boolean;
  toolbarLeft?: React.ReactNode;
  showExportCsv?: boolean;
  hideExportCsv?: boolean;
  hideColumnsPicker?: boolean;
  exportFileName?: string;
  onApiReady?: (api: GridApi<T>) => void;
  disableCellCopy?: boolean;
}

const LazyThemedAgGrid = lazyWithRetry(() =>
  import("./AgGridImpl").then((m) => ({
    default: m.ThemedAgGrid as unknown as ComponentType<ThemedAgGridProps<unknown>>,
  })),
);

function GridFallback({ height = "400px" }: { height?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading table"
      className="rounded-lg border border-border/40 bg-card animate-pulse"
      style={{ height, width: "100%" }}
    />
  );
}

export function ThemedAgGrid<T = unknown>(props: ThemedAgGridProps<T>) {
  const Component = LazyThemedAgGrid as unknown as ComponentType<ThemedAgGridProps<T>>;
  return (
    <ScopedErrorBoundary label="Data grid">
      <Suspense fallback={<GridFallback height={props.height} />}>
        <Component {...props} />
      </Suspense>
    </ScopedErrorBoundary>
  );
}
