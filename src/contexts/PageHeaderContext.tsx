import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderData {
  breadcrumbs?: BreadcrumbItem[];
  title?: string;
  description?: string;
  badge?: ReactNode;
}

interface PageHeaderContextValue {
  header: PageHeaderData | null;
  setHeader: (data: PageHeaderData | null) => void;
}

// Pin context to globalThis so HMR re-imports of this module reuse the SAME
// context instance — same defense as AuthContext to prevent provider/consumer
// mismatch if Vite HMR ever produces two module instances.
const GLOBAL_KEY = "__tfn_page_header_context__";
type GlobalWithCtx = typeof globalThis & {
  [GLOBAL_KEY]?: React.Context<PageHeaderContextValue>;
};
const g = globalThis as GlobalWithCtx;

const defaultValue: PageHeaderContextValue = {
  header: null,
  setHeader: () => {},
};

const existing = g[GLOBAL_KEY];
const fresh = existing ?? createContext<PageHeaderContextValue>(defaultValue);

// Dev-time duplicate-context detector: throws loudly if a different
// createContext instance ever tries to claim the same global slot.
if (import.meta.env?.DEV && existing && existing !== fresh) {
  throw new Error(
    "[PageHeaderContext] Duplicate context instance detected on globalThis. " +
      "This usually means HMR loaded two copies of PageHeaderContext.tsx. " +
      "Check for non-canonical import paths (must be @/contexts/PageHeaderContext)."
  );
}

const PageHeaderContext = fresh;
g[GLOBAL_KEY] = PageHeaderContext;

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeaderState] = useState<PageHeaderData | null>(null);
  const setHeader = useCallback((data: PageHeaderData | null) => setHeaderState(data), []);

  const Canonical = (globalThis as GlobalWithCtx)[GLOBAL_KEY] ?? PageHeaderContext;
  return (
    <Canonical.Provider value={{ header, setHeader }}>
      {children}
    </Canonical.Provider>
  );
}

export function usePageHeader() {
  const canonical = (globalThis as GlobalWithCtx)[GLOBAL_KEY] ?? PageHeaderContext;
  return useContext(canonical);
}

// Force a full reload on HMR updates to this module so we never end up with
// two divergent context instances coexisting in memory.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    try { window.dispatchEvent(new Event("lovable:pre-hmr-reload")); } catch { /* noop */ }
    queueMicrotask(() => window.location.reload());
  });
}
