import { lazy, Suspense } from "react";
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/design-system";

// Wave 1 UX-W1-016: each tab body lazy-loaded behind a Suspense skeleton so
// tab switches paint a fallback within 16ms and code splits cleanly.
const QuestOverview = lazy(() =>
  import("@/components/quest/QuestOverview").then((m) => ({ default: m.QuestOverview }))
);
const MyProjectsTab = lazy(() =>
  import("@/components/MyProjectsTab").then((m) => ({ default: m.MyProjectsTab }))
);
const MyRegisteredClassesTab = lazy(() =>
  import("@/components/MyRegisteredClassesTab").then((m) => ({ default: m.MyRegisteredClassesTab }))
);
const ClassCertificationsTab = lazy(() =>
  import("@/components/ClassCertificationsTab").then((m) => ({ default: m.ClassCertificationsTab }))
);
const ProjectCertificationsTab = lazy(() =>
  import("@/components/ProjectCertificationsTab").then((m) => ({
    default: m.ProjectCertificationsTab,
  }))
);

function TabFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export default function MyJourneyPage() {
  return (
    <div className="container-app py-8 sm:py-12">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">My Journey</h1>
        <p className="text-muted-foreground mt-1">
          Track your progress and milestones across the Tech Fleet platform.
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Quests</TabsTrigger>
          <TabsTrigger value="my-projects">My Projects</TabsTrigger>
          <TabsTrigger value="my-classes">My Classes</TabsTrigger>
          <TabsTrigger value="certifications">Class Certifications</TabsTrigger>
          <TabsTrigger value="project-certifications">Project Certifications</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Suspense fallback={<TabFallback />}>
            <QuestOverview />
          </Suspense>
        </TabsContent>
        <TabsContent value="my-projects">
          <Suspense fallback={<TabFallback />}>
            <MyProjectsTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="my-classes">
          <Suspense fallback={<TabFallback />}>
            <MyRegisteredClassesTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="certifications">
          <Suspense fallback={<TabFallback />}>
            <ClassCertificationsTab />
          </Suspense>
        </TabsContent>
        <TabsContent value="project-certifications">
          <Suspense fallback={<TabFallback />}>
            <ProjectCertificationsTab />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
