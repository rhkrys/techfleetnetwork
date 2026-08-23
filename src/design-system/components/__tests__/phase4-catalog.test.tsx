import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
  DesignSystemProvider,
  // atoms
  Button,
  Avatar,
  Checkbox,
  Chip,
  Fab,
  IconButton,
  ButtonGroup,
  Rating,
  Link,
  Paper,
  Box,
  CircularProgress,
  Radio,
  NotificationBadge,
  AvatarGroup,
  InputAdornment,
  SvgIcon,
  // molecules
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuList,
  MenuItem,
  Stepper,
  Step,
  StepLabel,
  MobileStepper,
  BottomNavigation,
  BottomNavigationAction,
  ImageList,
  ImageListItem,
  FormControl,
  FormLabel,
  FormGroup,
  FormControlLabel,
  FormHelperText,
  SnackbarContent,
  TextField,
  NativeSelect,
  // organisms
  AppBar,
  Toolbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Backdrop,
  // primitives
  Modal,
  Popper,
  Portal,
  ClickAwayListener,
  NoSsr,
  SwipeableDrawer,
  Fade,
  Grow,
  Slide,
  Zoom,
  Collapse,
  TextareaAutosize,
  // hooks
  useMediaQuery,
} from "@/design-system";

function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

describe("MUI catalog completion — inline components render + theme", () => {
  it("renders atoms, list, stepper, nav, table and form primitives", () => {
    renderDS(
      <div>
        <Chip label="Tag" />
        <Fab aria-label="add">+</Fab>
        <IconButton aria-label="settings">i</IconButton>
        <ButtonGroup>
          <Button>A</Button>
          <Button>B</Button>
        </ButtonGroup>
        <Rating value={3} readOnly />
        <Link href="#link">A link</Link>
        <Paper>Paper surface</Paper>
        <Box>Box content</Box>
        <CircularProgress aria-label="loading" />
        <Radio checked readOnly />
        <NotificationBadge badgeContent={4}>
          <span>bell</span>
        </NotificationBadge>
        <AvatarGroup>
          <Avatar>AB</Avatar>
          <Avatar>CD</Avatar>
        </AvatarGroup>
        <InputAdornment position="start">$</InputAdornment>
        <SvgIcon>
          <path d="M0 0h24v24H0z" />
        </SvgIcon>
        <List>
          <ListItem>
            <ListItemButton>
              <ListItemIcon>•</ListItemIcon>
              <ListItemText primary="List row" />
            </ListItemButton>
          </ListItem>
        </List>
        <MenuList>
          <MenuItem>Menu row</MenuItem>
        </MenuList>
        <Stepper activeStep={0}>
          <Step>
            <StepLabel>Step one</StepLabel>
          </Step>
          <Step>
            <StepLabel>Step two</StepLabel>
          </Step>
        </Stepper>
        <MobileStepper
          steps={3}
          activeStep={0}
          position="static"
          backButton={<Button>Back</Button>}
          nextButton={<Button>Next</Button>}
        />
        <BottomNavigation showLabels>
          <BottomNavigationAction label="Home" />
        </BottomNavigation>
        <ImageList>
          <ImageListItem>
            <img alt="swatch" src="data:," />
          </ImageListItem>
        </ImageList>
        <FormControl>
          <FormLabel>Choices</FormLabel>
          <FormGroup>
            <FormControlLabel control={<Checkbox />} label="Option" />
          </FormGroup>
          <FormHelperText>Helper</FormHelperText>
        </FormControl>
        <SnackbarContent message="Snack message" />
        <TextField label="Field name" />
        <NativeSelect defaultValue="a" inputProps={{ "aria-label": "native" }}>
          <option value="a">A</option>
        </NativeSelect>
        <AppBar position="static">
          <Toolbar>Toolbar row</Toolbar>
        </AppBar>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Head cell</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>Body cell</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
        <TextareaAutosize aria-label="notes" />
      </div>
    );

    // Spot-check representative nodes across the atomic layers.
    expect(screen.getByText("Tag")).toBeInTheDocument();
    expect(screen.getByText("List row")).toBeInTheDocument();
    expect(screen.getByText("Menu row")).toBeInTheDocument();
    expect(screen.getByText("Step one")).toBeInTheDocument();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Head cell")).toBeInTheDocument();
    expect(screen.getByText("Snack message")).toBeInTheDocument();
  });
});

describe("MUI catalog completion — overlays & primitives mount", () => {
  it("mounts portal/transition/backdrop primitives without throwing", () => {
    expect(() =>
      renderDS(
        <div>
          <Backdrop open>backdrop</Backdrop>
          <Modal open>
            <div>modal body</div>
          </Modal>
          <Popper open anchorEl={document.body}>
            <div>popper body</div>
          </Popper>
          <Portal>
            <div>portal body</div>
          </Portal>
          <ClickAwayListener onClickAway={() => {}}>
            <div>clickaway child</div>
          </ClickAwayListener>
          <NoSsr>
            <div>nossr child</div>
          </NoSsr>
          <SwipeableDrawer open onOpen={() => {}} onClose={() => {}}>
            <div>drawer body</div>
          </SwipeableDrawer>
          <Fade in>
            <div>fade</div>
          </Fade>
          <Grow in>
            <div>grow</div>
          </Grow>
          <Slide in direction="up">
            <div>slide</div>
          </Slide>
          <Zoom in>
            <div>zoom</div>
          </Zoom>
          <Collapse in>
            <div>collapse</div>
          </Collapse>
        </div>
      )
    ).not.toThrow();

    // Portalled content lands in document.body and is queryable.
    expect(screen.getByText("modal body")).toBeInTheDocument();
    expect(screen.getByText("portal body")).toBeInTheDocument();
  });
});

describe("MUI catalog completion — useMediaQuery hook", () => {
  it("returns a boolean and renders", () => {
    function Probe() {
      const matches = useMediaQuery("(min-width: 1px)");
      return <span>mq:{String(matches)}</span>;
    }
    renderDS(<Probe />);
    expect(screen.getByText(/^mq:(true|false)$/)).toBeInTheDocument();
  });
});
