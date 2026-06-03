import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact, type AgGridReactProps } from "ag-grid-react";
import type {
  ColDef, GridReadyEvent, ColumnResizedEvent, SortChangedEvent,
  FilterChangedEvent, ColumnMovedEvent, ColumnVisibleEvent, GridApi,
  CellClickedEvent,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import { useTheme } from "@/components/ThemeProvider";
import { useGridState, type GridState } from "@/hooks/use-grid-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RotateCcw, Download, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Props<T> extends AgGridReactProps<T> {
  height?: string;
  /** Unique id used to persist grid state per user. If omitted, state is not persisted. */
  gridId?: string;
  /** Hide the reset view button even when gridId is set */
  hideResetButton?: boolean;
  /** Extra buttons/controls rendered in the toolbar row alongside Reset View */
  toolbarLeft?: React.ReactNode;
  /** Show CSV export button. Defaults to true when `gridId` is provided. */
  showExportCsv?: boolean;
  /** Hide CSV export even when gridId is provided */
  hideExportCsv?: boolean;
  /** Hide the built-in Columns picker even when gridId is provided */
  hideColumnsPicker?: boolean;
  /** Custom CSV filename prefix (default: gridId or "export") */
  exportFileName?: string;
  /** Callback to receive the grid API reference */
  onApiReady?: (api: GridApi<T>) => void;
  /** Disable copy-on-click for cells (enabled by default) */
  disableCellCopy?: boolean;
}

interface PickerCol {
  colId: string;
  label: string;
  visible: boolean;
  lockVisible: boolean;
}

export function ThemedAgGrid<T = unknown>({
  height = "400px",
  gridId,
  hideResetButton,
  toolbarLeft,
  showExportCsv,
  hideExportCsv,
  hideColumnsPicker,
  exportFileName,
  onApiReady,
  disableCellCopy,
  defaultColDef,
  onGridReady: externalOnGridReady,
  onSortChanged: externalOnSortChanged,
  onFilterChanged: externalOnFilterChanged,
  onColumnResized: externalOnColumnResized,
  onColumnMoved: externalOnColumnMoved,
  onColumnVisible: externalOnColumnVisible,
  columnDefs,
  ...rest
}: Props<T>) {
  const { resolvedTheme } = useTheme();
  const themeClass = resolvedTheme === "dark" ? "ag-theme-alpine-dark" : "ag-theme-alpine";
  const apiRef = useRef<GridApi<T> | null>(null);
  const [pickerCols, setPickerCols] = useState<PickerCol[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { savedState, loaded, persistState, clearState } = useGridState(gridId ?? "");

  // Default behavior: export CSV and columns picker on whenever gridId is set.
  const csvEnabled = (showExportCsv ?? !!gridId) && !hideExportCsv;
  const columnsPickerEnabled = !!gridId && !hideColumnsPicker;

  const mergedColDef = useMemo<ColDef<T>>(
    () => ({
      sortable: true,
      resizable: true,
      filter: true,
      floatingFilter: true,
      flex: 1,
      minWidth: 80,
      wrapText: true,
      autoHeight: true,
      ...defaultColDef,
    }),
    [defaultColDef]
  );

  const saveCurrentState = useCallback(() => {
    if (!gridId || !apiRef.current) return;
    const api = apiRef.current;
    const state: GridState = {
      columnState: api.getColumnState(),
      filterModel: api.getFilterModel(),
    };
    persistState(state);
  }, [gridId, persistState]);

  const refreshPickerCols = useCallback(() => {
    if (!apiRef.current) return;
    const api = apiRef.current;
    const state = api.getColumnState();
    const next: PickerCol[] = state
      .map((s) => {
        const col = api.getColumn(s.colId);
        const def = col?.getColDef();
        const headerName = def?.headerName ?? def?.field ?? s.colId;
        // Skip unlabeled action columns (e.g. "" headerName + no field) from the picker
        const hasLabel = !!(def?.headerName && String(def.headerName).trim() !== "");
        const hasField = !!def?.field;
        if (!hasLabel && !hasField) return null;
        return {
          colId: s.colId,
          label: String(headerName || s.colId),
          visible: !s.hide,
          lockVisible: !!def?.lockVisible,
        };
      })
      .filter((c): c is PickerCol => c !== null);
    setPickerCols(next);
  }, []);

  const resetView = useCallback(async () => {
    await clearState();
    if (apiRef.current) {
      apiRef.current.resetColumnState();
      apiRef.current.setFilterModel(null);
      refreshPickerCols();
    }
    toast.success("Table view reset to default");
  }, [clearState, refreshPickerCols]);

  const handleExportCsv = useCallback(() => {
    if (!apiRef.current) return;
    const prefix = exportFileName ?? gridId ?? "export";
    apiRef.current.exportDataAsCsv({
      fileName: `${prefix}-${format(new Date(), "yyyy-MM-dd")}`,
    });
  }, [exportFileName, gridId]);

  const toggleColumn = useCallback((colId: string, visible: boolean) => {
    apiRef.current?.setColumnsVisible([colId], visible);
  }, []);

  const showAllColumns = useCallback(() => {
    if (!apiRef.current) return;
    const ids = pickerCols.map((c) => c.colId);
    apiRef.current.setColumnsVisible(ids, true);
  }, [pickerCols]);

  const handleGridReady = useCallback(
    (e: GridReadyEvent<T>) => {
      apiRef.current = e.api;
      onApiReady?.(e.api as unknown as GridApi<T>);
      if (gridId && savedState) {
        if (savedState.columnState) {
          e.api.applyColumnState({ state: savedState.columnState, applyOrder: true });
        }
        if (savedState.filterModel) {
          setTimeout(() => e.api.setFilterModel(savedState.filterModel!), 0);
        }
      }
      // NOTE: do NOT call sizeColumnsToFit() here. Forcing fit shrinks
      // explicit-width columns (e.g. Actions) below their content size and
      // suppresses AG Grid's native horizontal scrollbar. Let declared
      // widths + flex render naturally; horizontal scroll appears when
      // total column width exceeds the viewport.
      refreshPickerCols();
      externalOnGridReady?.(e);
    },
    [gridId, savedState, externalOnGridReady, onApiReady, refreshPickerCols]
  );

  const handleSortChanged = useCallback(
    (e: SortChangedEvent<T>) => { saveCurrentState(); externalOnSortChanged?.(e); },
    [saveCurrentState, externalOnSortChanged]
  );

  const handleFilterChanged = useCallback(
    (e: FilterChangedEvent<T>) => { saveCurrentState(); externalOnFilterChanged?.(e); },
    [saveCurrentState, externalOnFilterChanged]
  );

  const handleColumnResized = useCallback(
    (e: ColumnResizedEvent<T>) => { if (e.finished) saveCurrentState(); externalOnColumnResized?.(e); },
    [saveCurrentState, externalOnColumnResized]
  );

  const handleColumnMoved = useCallback(
    (e: ColumnMovedEvent<T>) => { if (e.finished) saveCurrentState(); externalOnColumnMoved?.(e); },
    [saveCurrentState, externalOnColumnMoved]
  );

  const handleColumnVisible = useCallback(
    (e: ColumnVisibleEvent<T>) => {
      saveCurrentState();
      refreshPickerCols();
      externalOnColumnVisible?.(e);
    },
    [saveCurrentState, refreshPickerCols, externalOnColumnVisible]
  );

  const handleCellClicked = useCallback(
    (event: CellClickedEvent<T>) => {
      if (disableCellCopy) return;
      const value = event.value;
      if (value == null || value === "") return;
      const text = Array.isArray(value) ? value.join(", ") : String(value);
      navigator.clipboard.writeText(text).then(
        () => toast.success("Copied to clipboard", { description: text.length > 80 ? text.slice(0, 80) + "…" : text, duration: 1500 }),
        () => {}
      );
    },
    [disableCellCopy]
  );

  // Refresh picker when columnDefs change (e.g. dynamic column sets)
  useEffect(() => {
    if (apiRef.current) refreshPickerCols();
  }, [columnDefs, refreshPickerCols]);

  const visibleColCount = pickerCols.filter((c) => c.visible).length;

  const showToolbar =
    toolbarLeft || (gridId && !hideResetButton) || csvEnabled || columnsPickerEnabled;

  if (gridId && !loaded) {
    return (
      <div className={themeClass} style={{ height, width: "100%" }} role="status" aria-label="Loading grid">
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {gridId && !hideResetButton && (
            <Button
              variant="outline"
              size="sm"
              onClick={resetView}
              className="gap-1.5 text-xs h-8 rounded-md border-border/50 hover:bg-accent/60"
              aria-label="Reset table view to default"
            >
              <RotateCcw className="h-3 w-3" />
              Reset View
            </Button>
          )}
          {csvEnabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="gap-1.5 text-xs h-8 rounded-md border-border/50 hover:bg-accent/60"
              aria-label="Export table to CSV"
            >
              <Download className="h-3 w-3" />
              Export CSV
            </Button>
          )}
          {columnsPickerEnabled && pickerCols.length > 0 && (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-8 rounded-md border-border/50 hover:bg-accent/60"
                  aria-label="Choose visible columns"
                >
                  <Settings2 className="h-3 w-3" />
                  Columns ({visibleColCount})
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="end">
                <div className="p-3 border-b flex items-center justify-between">
                  <p className="text-sm font-medium">Visible Columns</p>
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={showAllColumns}>
                    Show all
                  </Button>
                </div>
                <ScrollArea className="max-h-80 p-3">
                  <div className="space-y-1.5">
                    {pickerCols.map((col) => (
                      <div key={col.colId} className="flex items-center gap-2">
                        <Checkbox
                          id={`agcol-${gridId}-${col.colId}`}
                          checked={col.visible}
                          disabled={col.lockVisible}
                          onCheckedChange={(checked) => toggleColumn(col.colId, !!checked)}
                        />
                        <Label
                          htmlFor={`agcol-${gridId}-${col.colId}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {col.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          )}
          {toolbarLeft}
        </div>
      )}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 rounded-lg border border-border/40" role="region" aria-label="Scrollable data table" tabIndex={0}>
        <div key={themeClass} className={themeClass} style={{ height, width: "100%", minWidth: "min(600px, 100%)" }}>
          <AgGridReact<T>
            defaultColDef={mergedColDef}
            columnDefs={columnDefs}
            animateRows
            onGridReady={handleGridReady}
            onSortChanged={handleSortChanged}
            onFilterChanged={handleFilterChanged}
            onColumnResized={handleColumnResized}
            onColumnMoved={handleColumnMoved}
            onColumnVisible={handleColumnVisible}
            onCellClicked={handleCellClicked}
            tooltipShowDelay={300}
            {...rest}
          />
        </div>
      </div>
    </div>
  );
}
