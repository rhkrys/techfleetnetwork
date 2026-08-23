import { useState } from "react";
import { BottomNavigation, BottomNavigationAction, Paper } from "@/design-system";
import Home from "@mui/icons-material/Home";
import Search from "@mui/icons-material/Search";
import Person from "@mui/icons-material/Person";

export default function BottomNavigationDemo() {
  const [value, setValue] = useState(0);
  return (
    <Paper style={{ width: 360 }} elevation={2}>
      <BottomNavigation showLabels value={value} onChange={(_, v) => setValue(v)}>
        <BottomNavigationAction label="Home" icon={<Home />} />
        <BottomNavigationAction label="Search" icon={<Search />} />
        <BottomNavigationAction label="Profile" icon={<Person />} />
      </BottomNavigation>
    </Paper>
  );
}
