import { Icon } from "@/design-system";
import Favorite from "@mui/icons-material/Favorite";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Settings from "@mui/icons-material/Settings";

export default function IconDemo() {
  return (
    <>
      <Icon icon={Favorite} label="Favorite" />
      <Icon icon={CheckCircle} label="Done" color="success" />
      <Icon icon={Settings} label="Settings" fontSize="large" />
    </>
  );
}
