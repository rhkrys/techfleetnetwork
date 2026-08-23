import {
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
} from "@/design-system";
import Inbox from "@mui/icons-material/Inbox";
import Drafts from "@mui/icons-material/Drafts";
import Send from "@mui/icons-material/Send";

export default function ListDemo() {
  return (
    <List
      sx={{ width: "100%", maxWidth: 320, bgcolor: "background.paper" }}
      subheader={<ListSubheader>Mailbox</ListSubheader>}
    >
      <ListItem disablePadding>
        <ListItemButton>
          <ListItemIcon>
            <Inbox />
          </ListItemIcon>
          <ListItemText primary="Inbox" secondary="24 new" />
        </ListItemButton>
      </ListItem>
      <ListItem disablePadding>
        <ListItemButton selected>
          <ListItemIcon>
            <Drafts />
          </ListItemIcon>
          <ListItemText primary="Drafts" />
        </ListItemButton>
      </ListItem>
      <ListItem disablePadding>
        <ListItemButton>
          <ListItemIcon>
            <Send />
          </ListItemIcon>
          <ListItemText primary="Sent" />
        </ListItemButton>
      </ListItem>
    </List>
  );
}
