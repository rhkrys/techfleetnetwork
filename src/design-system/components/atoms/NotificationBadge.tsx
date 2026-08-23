/**
 * NotificationBadge (atom) — the small count/dot overlay anchored to a child
 * (e.g. an unread count on a bell icon). This is MUI's `Badge` component.
 *
 * NAMING: the TFDS `Badge` atom is the shadcn-style inline pill/label. MUI's
 * overlay Badge is a DIFFERENT component, exported here as `NotificationBadge`
 * to avoid the collision while keeping full MUI Core parity.
 * See docs/design/design-system/components/atoms/NotificationBadge.md
 */
export { default as NotificationBadge } from "@mui/material/Badge";
export type { BadgeProps as NotificationBadgeProps } from "@mui/material/Badge";
