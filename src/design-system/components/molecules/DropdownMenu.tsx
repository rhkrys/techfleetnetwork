/**
 * DropdownMenu (molecule). Replaces src/components/ui/dropdown-menu.tsx.
 * Keeps the shadcn compound API (DropdownMenu/Trigger/Content/Item/Label/
 * Separator) via an anchor context, backed by MUI Menu (roving focus, arrow-key
 * navigation, Escape-to-close per the APG menu pattern).
 * See docs/design/design-system/components/molecules/DropdownMenu.md
 */
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import MuiMenu from "@mui/material/Menu";
import MuiMenuItem, { type MenuItemProps } from "@mui/material/MenuItem";
import ListSubheader from "@mui/material/ListSubheader";
import Divider from "@mui/material/Divider";

interface Ctx {
  anchorEl: HTMLElement | null;
  setAnchorEl: (el: HTMLElement | null) => void;
}
const MenuCtx = createContext<Ctx | null>(null);
const useMenu = () => {
  const c = useContext(MenuCtx);
  if (!c) throw new Error("DropdownMenu.* must be used within <DropdownMenu>");
  return c;
};

export function DropdownMenu({ children }: { children: ReactNode }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return <MenuCtx.Provider value={{ anchorEl, setAnchorEl }}>{children}</MenuCtx.Provider>;
}

export function DropdownMenuTrigger({ children }: { children: ReactNode }) {
  const { setAnchorEl } = useMenu();
  if (Children.count(children) === 1 && isValidElement(children)) {
    return cloneElement(
      children as React.ReactElement<{ onClick?: (e: MouseEvent<HTMLElement>) => void }>,
      {
        onClick: (e: MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget),
      }
    );
  }
  return <>{children}</>;
}

export function DropdownMenuContent({ children }: { children: ReactNode }) {
  const { anchorEl, setAnchorEl } = useMenu();
  return (
    <MuiMenu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
      {children}
    </MuiMenu>
  );
}

/** A menu action; closes the menu after its onClick. */
export function DropdownMenuItem({ onClick, ...props }: MenuItemProps) {
  const { setAnchorEl } = useMenu();
  return (
    <MuiMenuItem
      onClick={(e) => {
        onClick?.(e);
        setAnchorEl(null);
      }}
      {...props}
    />
  );
}

export const DropdownMenuLabel = ({ children }: { children: ReactNode }) => (
  <ListSubheader disableSticky>{children}</ListSubheader>
);
export const DropdownMenuSeparator = () => <Divider />;
