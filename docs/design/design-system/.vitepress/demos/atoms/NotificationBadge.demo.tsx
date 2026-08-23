import { NotificationBadge } from "@/design-system";
import Mail from "@mui/icons-material/Mail";
import Notifications from "@mui/icons-material/Notifications";

export default function NotificationBadgeDemo() {
  return (
    <div style={{ display: "flex", gap: 28 }}>
      <NotificationBadge badgeContent={4} color="primary">
        <Mail />
      </NotificationBadge>
      <NotificationBadge badgeContent={99} color="error">
        <Notifications />
      </NotificationBadge>
      <NotificationBadge variant="dot" color="success">
        <Mail />
      </NotificationBadge>
    </div>
  );
}
