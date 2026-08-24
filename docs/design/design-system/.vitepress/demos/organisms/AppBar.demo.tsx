import { AppBar, Toolbar, IconButton, Button } from "@/design-system";
import MenuIcon from "@mui/icons-material/Menu";

export default function AppBarDemo() {
  return (
    <AppBar position="static" style={{ borderRadius: 8, width: "100%" }}>
      <Toolbar>
        <IconButton edge="start" aria-label="menu" style={{ marginRight: 8 }}>
          <MenuIcon />
        </IconButton>
        <span style={{ flexGrow: 1, fontWeight: 700 }}>Tech Fleet</span>
        <Button variant="ghost">Sign in</Button>
      </Toolbar>
    </AppBar>
  );
}
