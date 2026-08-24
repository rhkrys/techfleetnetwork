import {
  ResponsiveTabs,
  ResponsiveTabsList,
  ResponsiveTabsTrigger,
  ResponsiveTabsContent,
} from "@/design-system";

export default function ResponsiveTabsDemo() {
  return (
    <div style={{ width: "100%", maxWidth: 360 }}>
      <ResponsiveTabs defaultValue="a">
        <ResponsiveTabsList>
          <ResponsiveTabsTrigger value="a">Summary</ResponsiveTabsTrigger>
          <ResponsiveTabsTrigger value="b">Milestones</ResponsiveTabsTrigger>
          <ResponsiveTabsTrigger value="c">Team</ResponsiveTabsTrigger>
          <ResponsiveTabsTrigger value="d">Files</ResponsiveTabsTrigger>
          <ResponsiveTabsTrigger value="e">Billing</ResponsiveTabsTrigger>
        </ResponsiveTabsList>
        <ResponsiveTabsContent value="a">
          On narrow screens the tab strip scrolls instead of overflowing.
        </ResponsiveTabsContent>
        <ResponsiveTabsContent value="b">Milestones panel.</ResponsiveTabsContent>
        <ResponsiveTabsContent value="c">Team panel.</ResponsiveTabsContent>
        <ResponsiveTabsContent value="d">Files panel.</ResponsiveTabsContent>
        <ResponsiveTabsContent value="e">Billing panel.</ResponsiveTabsContent>
      </ResponsiveTabs>
    </div>
  );
}
