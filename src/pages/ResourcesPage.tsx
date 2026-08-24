import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Wrench, Loader2, Sparkles, Puzzle } from "lucide-react";
import {
  ResponsiveTabs,
  ResponsiveTabsList,
  ResponsiveTabsContent,
  type TabItem,
} from "@/components/ui/responsive-tabs";
import ExploreTab from "@/components/resources/ExploreTab";
import ResourceCard from "@/components/resources/ResourceCard";
import ResourceDetailPanel from "@/components/resources/ResourceDetailPanel";
import SkillsPracticesTab from "@/components/resources/SkillsPracticesTab";
import { fetchHandbooks, handbookCategoryColors, type Handbook } from "@/data/handbooks";
import { fetchWorkshops, workshopCategoryColors, type Workshop } from "@/data/workshops";
import { toast } from "@/hooks/use-toast";

export default function ResourcesPage() {
  const [handbooks, setHandbooks] = useState<Handbook[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedHandbook, setSelectedHandbook] = useState<Handbook | null>(null);
  const [selectedWorkshop, setSelectedWorkshop] = useState<Workshop | null>(null);
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "explore";
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    async function load() {
      try {
        const [hb, ws] = await Promise.all([fetchHandbooks(), fetchWorkshops()]);
        setHandbooks(hb);
        setWorkshops(ws);
      } catch {
        toast({ title: "Failed to load resources", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="container-app py-8 sm:py-12 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const countBadge = (count: number) => (
    <span
      className={`ml-1.5 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold leading-none ${
        count > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
      }`}
    >
      {count}
    </span>
  );

  const resourceTabs: TabItem[] = [
    {
      value: "explore",
      icon: <Sparkles className="h-4 w-4" />,
      label: "Explore",
    },
    {
      value: "skills-practices",
      icon: <Puzzle className="h-4 w-4" />,
      label: "Skills & Practices",
    },
    {
      value: "handbooks",
      icon: <BookOpen className="h-4 w-4" />,
      label: <span className="flex items-center">Handbooks{countBadge(handbooks.length)}</span>,
    },
    {
      value: "workshops",
      icon: <Wrench className="h-4 w-4" />,
      label: (
        <span className="flex items-center">Workshop Templates{countBadge(workshops.length)}</span>
      ),
    },
  ];

  return (
    <div className="container-app py-8 sm:py-12">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Resources</h1>
        <p className="text-muted-foreground mt-1">
          Handbooks, workshop templates, and reference materials for your Tech Fleet journey.
        </p>
      </div>

      <ResponsiveTabs value={tab} onValueChange={setTab} className="space-y-6">
        <ResponsiveTabsList tabs={resourceTabs} value={tab} onValueChange={setTab} />

        <ResponsiveTabsContent value="explore">
          <ExploreTab />
        </ResponsiveTabsContent>

        <ResponsiveTabsContent value="skills-practices">
          <SkillsPracticesTab />
        </ResponsiveTabsContent>

        <ResponsiveTabsContent value="handbooks">
          {handbooks.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No handbooks available.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {handbooks.map((hb) => (
                <ResourceCard
                  key={hb.id}
                  name={hb.name}
                  category={hb.category}
                  categoryColorClass={handbookCategoryColors[hb.category] ?? ""}
                  description={hb.description}
                  onView={() => setSelectedHandbook(hb)}
                />
              ))}
            </div>
          )}
        </ResponsiveTabsContent>

        <ResponsiveTabsContent value="workshops">
          {workshops.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              No workshops available.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {workshops.map((ws) => (
                <ResourceCard
                  key={ws.id}
                  name={ws.name}
                  category={ws.category}
                  categoryColorClass={workshopCategoryColors[ws.category] ?? ""}
                  description={ws.description}
                  onView={() => setSelectedWorkshop(ws)}
                />
              ))}
            </div>
          )}
        </ResponsiveTabsContent>
      </ResponsiveTabs>

      <ResourceDetailPanel
        open={!!selectedHandbook}
        onOpenChange={(open) => !open && setSelectedHandbook(null)}
        title={selectedHandbook?.name ?? ""}
        category={selectedHandbook?.category ?? ""}
        categoryColorClass={handbookCategoryColors[selectedHandbook?.category ?? ""] ?? ""}
        externalLink={selectedHandbook?.link}
        externalLinkLabel="Read Handbook"
        fields={[
          { label: "Description", value: selectedHandbook?.description },
          { label: "Target Audience", value: selectedHandbook?.target_audience },
          { label: "Table of Contents", value: selectedHandbook?.contents },
        ]}
      />

      <ResourceDetailPanel
        open={!!selectedWorkshop}
        onOpenChange={(open) => !open && setSelectedWorkshop(null)}
        title={selectedWorkshop?.name ?? ""}
        category={selectedWorkshop?.category ?? ""}
        categoryColorClass={workshopCategoryColors[selectedWorkshop?.category ?? ""] ?? ""}
        externalLink={selectedWorkshop?.figma_link}
        externalLinkLabel="Open Figma Template"
        fields={[
          { label: "Description", value: selectedWorkshop?.description },
          { label: "Led By", value: selectedWorkshop?.led_by },
          { label: "Resulting Deliverables", value: selectedWorkshop?.deliverables },
          { label: "Accountable Function", value: selectedWorkshop?.accountable_function },
          { label: "Functions Involved", value: selectedWorkshop?.functions_involved },
          { label: "Stakeholders", value: selectedWorkshop?.stakeholders },
          { label: "Timing", value: selectedWorkshop?.timing },
          { label: "Milestones", value: selectedWorkshop?.milestones },
          { label: "Project Types", value: selectedWorkshop?.project_types },
          { label: "Skills Involved", value: selectedWorkshop?.skills },
          { label: "Company Types", value: selectedWorkshop?.company_types },
        ]}
      />
    </div>
  );
}
