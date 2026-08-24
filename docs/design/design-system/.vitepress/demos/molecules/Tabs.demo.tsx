import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/design-system";

export default function TabsDemo() {
  return (
    <div style={{ width: "100%", maxWidth: 420 }}>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">The overview panel.</TabsContent>
        <TabsContent value="activity">Recent activity shows here.</TabsContent>
        <TabsContent value="settings">Settings for this project.</TabsContent>
      </Tabs>
    </div>
  );
}
