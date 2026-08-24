/**
 * ResponsiveTabs (molecule). Replaces src/components/ui/responsive-tabs.tsx.
 * The DS `Tabs` are already responsive — MUI Tabs render `variant="scrollable"`
 * with `allowScrollButtonsMobile`, so they reflow/scroll on narrow screens
 * instead of overflowing. ResponsiveTabs is the same compound API.
 * See docs/design/design-system/components/molecules/Tabs.md
 */
export {
  Tabs as ResponsiveTabs,
  TabsList as ResponsiveTabsList,
  TabsTrigger as ResponsiveTabsTrigger,
  TabsContent as ResponsiveTabsContent,
} from "./Tabs";
