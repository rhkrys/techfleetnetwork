/**
 * Menu family (molecule) — the raw MUI Menu primitives (anchored popup + items).
 *
 * NOTE: for the common trigger→menu pattern prefer the `DropdownMenu` compound
 * component (handles anchor state for you). These raw exports exist for full MUI
 * parity and advanced cases (custom anchor logic, MenuList in a Popper, etc.).
 * See docs/design/design-system/components/molecules/Menu.md
 */
export { default as Menu } from "@mui/material/Menu";
export type { MenuProps } from "@mui/material/Menu";
export { default as MenuItem } from "@mui/material/MenuItem";
export type { MenuItemProps } from "@mui/material/MenuItem";
export { default as MenuList } from "@mui/material/MenuList";
export type { MenuListProps } from "@mui/material/MenuList";
