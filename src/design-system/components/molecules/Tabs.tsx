/**
 * Tabs (molecule). Replaces src/components/ui/tabs.tsx.
 *
 * Keeps the shadcn compound API (Tabs/TabsList/TabsTrigger/TabsContent driven by
 * `value`/`onValueChange`) so migration is mechanical, backed by MUI Tabs/Tab —
 * which bring APG keyboard support (arrow keys, Home/End) and a11y for free.
 * See docs/design/design-system/components/molecules/Tabs.md
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import MuiTabs from "@mui/material/Tabs";
import MuiTab, { type TabProps } from "@mui/material/Tab";

interface TabsCtx {
  value: string;
  setValue: (v: string) => void;
}
const Ctx = createContext<TabsCtx | null>(null);
const useTabs = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("Tabs.* must be used within <Tabs>");
  return c;
};

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}

export function Tabs({ value: controlled, defaultValue = "", onValueChange, children }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const value = controlled ?? internal;
  const setValue = (v: string) => {
    if (controlled == null) setInternal(v);
    onValueChange?.(v);
  };
  return <Ctx.Provider value={{ value, setValue }}>{children}</Ctx.Provider>;
}

export function TabsList({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) {
  const { value, setValue } = useTabs();
  return (
    <MuiTabs
      value={value}
      onChange={(_e, v) => setValue(v as string)}
      variant="scrollable"
      allowScrollButtonsMobile
      {...rest}
    >
      {children}
    </MuiTabs>
  );
}

// MUI Tabs injects `selected`/`onChange`/etc. into its children; forward them.
// (MUI TabProps types `children` as `null`, so omit it and take the label node.)
export function TabsTrigger({
  children,
  ...rest
}: { children: ReactNode } & Omit<TabProps, "label" | "children">) {
  return <MuiTab label={children} {...rest} />;
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  const ctx = useTabs();
  if (ctx.value !== value) return null;
  return <div role="tabpanel">{children}</div>;
}
