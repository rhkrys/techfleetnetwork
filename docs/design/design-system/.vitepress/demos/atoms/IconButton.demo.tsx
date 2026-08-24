import { IconButton } from "@/design-system";
import Favorite from "@mui/icons-material/Favorite";
import Delete from "@mui/icons-material/Delete";
import Share from "@mui/icons-material/Share";

export default function IconButtonDemo() {
  return (
    <>
      <IconButton color="primary" aria-label="like">
        <Favorite />
      </IconButton>
      <IconButton color="error" aria-label="delete">
        <Delete />
      </IconButton>
      <IconButton aria-label="share">
        <Share />
      </IconButton>
      <IconButton disabled aria-label="disabled">
        <Favorite />
      </IconButton>
    </>
  );
}
