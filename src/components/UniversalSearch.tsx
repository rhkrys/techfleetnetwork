import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, GraduationCap, ClipboardList, Handshake, Megaphone,
  Building2, FolderKanban, Users,
} from "lucide-react";
import fleetyIcon from "@/assets/fleety-icon.png";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { supabase } from "@/integrations/supabase/client";
import { PROJECT_TYPES, PROJECT_PHASES } from "@/data/project-constants";

/* ── Searchable item types ────────────────────────────────── */

type SearchGroup =
  | "Courses"
  | "Classes"
  | "Applications"
  | "Project Training"
  | "Community Updates"
  | "Clients"
  | "Projects"
  | "Members";

interface SearchItem {
  id: string;
  label: string;
  description: string;
  href: string;
  group: SearchGroup;
}

/* ── Static catalogue ─────────────────────────────────────── */

const SEARCH_ITEMS: SearchItem[] = [
  // ── Courses ────────────────────────────────────────────────
  {
    id: "course-onboarding",
    label: "Onboarding Steps",
    description:
      "Set up your profile, complete onboarding class, sign up for service leadership, and review the user guide.",
    href: "/courses/onboarding",
    group: "Courses",
  },
  {
    id: "course-agile",
    label: "Build an Agile Mindset",
    description:
      "Lessons covering agile philosophies, teamwork, and scrum methods.",
    href: "/courses/agile-mindset",
    group: "Courses",
  },
  {
    id: "course-teamwork",
    label: "Agile Cross-Functional Team Dynamics",
    description:
      "Lessons from the Teammate Handbook covering team expectations, cross-functional work, and leadership.",
    href: "/courses/agile-teamwork",
    group: "Courses",
  },
  {
    id: "course-project-training",
    label: "Join Project Training Teams",
    description:
      "Lessons on how apprenticeship training works, working with nonprofit clients, and building case studies.",
    href: "/courses/project-training",
    group: "Courses",
  },
  {
    id: "course-volunteer",
    label: "Join Volunteer Teams",
    description:
      "Lessons on volunteering at Tech Fleet, team dynamics, and finding your volunteer role.",
    href: "/courses/volunteer-teams",
    group: "Courses",
  },

  // ── Applications ───────────────────────────────────────────
  {
    id: "app-general",
    label: "General Application",
    description:
      "Submit your general application to join Tech Fleet and become a member.",
    href: "/applications",
    group: "Applications",
  },
  {
    id: "app-project",
    label: "Project Applications",
    description:
      "Apply for available project training teams and apprenticeship cohorts.",
    href: "/applications",
    group: "Applications",
  },
  {
    id: "app-volunteer",
    label: "Volunteer Applications",
    description:
      "Apply to join volunteer teams and contribute to Tech Fleet operations.",
    href: "/applications",
    group: "Applications",
  },

  // ── Project Training ───────────────────────────────────────
  {
    id: "pt-landing",
    label: "Project Training Overview",
    description:
      "Hands-on training through real nonprofit projects and apprenticeship teams.",
    href: "/project-training",
    group: "Project Training",
  },

  // ── Updates ────────────────────────────────────────────────
  {
    id: "updates",
    label: "Updates & Announcements",
    description:
      "View the latest announcements and updates from the Tech Fleet team.",
    href: "/updates",
    group: "Community Updates",
  },
];

/* ── Helpers ──────────────────────────────────────────────── */

const GROUP_ICONS: Record<SearchGroup, React.ElementType> = {
  Courses: GraduationCap,
  Classes: GraduationCap,
  Applications: ClipboardList,
  "Project Training": Handshake,
  "Community Updates": Megaphone,
  Clients: Building2,
  Projects: FolderKanban,
  Members: Users,
};

/**
 * Case-insensitive partial / wildcard match.
 * Supports `*` as a wildcard character.
 */
function matchesQuery(text: string, query: string): boolean {
  if (!query) return true;
  const escaped = query
    .toLowerCase()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  try {
    return new RegExp(escaped).test(text.toLowerCase());
  } catch {
    return text.toLowerCase().includes(query.toLowerCase());
  }
}

const typeLabel = (v: string) => PROJECT_TYPES.find((t) => t.value === v)?.label ?? v;
const phaseLabel = (v: string) => PROJECT_PHASES.find((p) => p.value === v)?.label ?? v;

/* ── Component ────────────────────────────────────────────── */

export function UniversalSearch() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const { user } = useAuth();
  const { isAdmin } = useAdmin();

  /* ── Dynamic results from DB ──────────────────────────── */
  const [dynamicItems, setDynamicItems] = useState<SearchItem[]>([]);
  const [searching, setSearching] = useState(false);

  // Keyboard shortcut: Ctrl/Cmd + K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDynamicItems([]);
    }
  }, [open]);

  // Debounced DB search
  useEffect(() => {
    if (!open || !user) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setDynamicItems([]);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const items: SearchItem[] = [];
        const searchPattern = `%${trimmed}%`;

        // Search clients (all authenticated users can see active clients)
        const { data: clients } = await supabase
          .from("clients")
          .select("id, name, mission, status")
          .ilike("name", searchPattern)
          .limit(5);

        if (!controller.signal.aborted && clients) {
          for (const c of clients) {
            items.push({
              id: `client-${c.id}`,
              label: c.name,
              description: c.mission || `Client · ${c.status}`,
              href: isAdmin ? "/admin/clients" : "/project-openings",
              group: "Clients",
            });
          }
        }

        // Search published classes (RLS allows public)
        const { data: classRows } = await supabase
          .from("classes")
          .select("id, slug, title, summary, track, status")
          .eq("status", "published")
          .or(`title.ilike.${searchPattern},summary.ilike.${searchPattern}`)
          .limit(8);

        if (!controller.signal.aborted && classRows) {
          for (const c of classRows) {
            items.push({
              id: `class-${c.id}`,
              label: c.title,
              description: c.summary || (c.track === "advanced_training" ? "Advanced Training" : "Basic Training"),
              href: `/classes/${c.slug}`,
              group: "Classes",
            });
          }
        }

        // Search projects (RLS will handle visibility)
        const { data: projects } = await supabase
          .from("projects")
          .select("id, project_type, phase, project_status, client_id")
          .limit(10);

        if (!controller.signal.aborted && projects) {
          // Need client names for project labels
          const clientIds = [...new Set(projects.map((p) => p.client_id))];
          const { data: projClients } = clientIds.length > 0
            ? await supabase.from("clients").select("id, name").in("id", clientIds)
            : { data: [] };

          const clientNameMap = new Map((projClients ?? []).map((c) => [c.id, c.name]));

          for (const p of projects) {
            const clientName = clientNameMap.get(p.client_id) ?? "Client";
            const label = `${clientName} — ${typeLabel(p.project_type)}`;
            const desc = `${phaseLabel(p.phase)} · ${p.project_status.replace(/_/g, " ")}`;

            if (matchesQuery(label, trimmed) || matchesQuery(desc, trimmed) || matchesQuery(clientName, trimmed)) {
              items.push({
                id: `project-${p.id}`,
                label,
                description: desc,
                href: p.project_status === "apply_now"
                  ? `/project-openings/${p.id}`
                  : isAdmin ? `/admin/clients/projects/${p.id}/edit` : "/project-openings",
                group: "Projects",
              });
            }
          }
        }

        // Search members (admin-only via RLS)
        if (isAdmin) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("user_id, display_name, first_name, last_name, email, country")
            .or(`display_name.ilike.${searchPattern},first_name.ilike.${searchPattern},last_name.ilike.${searchPattern},email.ilike.${searchPattern}`)
            .limit(8);

          if (!controller.signal.aborted && profiles) {
            for (const p of profiles) {
              const name = p.display_name
                || [p.first_name, p.last_name].filter(Boolean).join(" ")
                || p.email
                || "Unknown";
              items.push({
                id: `member-${p.user_id}`,
                label: name,
                description: [p.email, p.country].filter(Boolean).join(" · ") || "Member",
                href: "/admin/users",
                group: "Members",
              });
            }
          }
        }

        if (!controller.signal.aborted) {
          setDynamicItems(items);
        }
      } catch {
        // silently ignore search errors
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [query, open, user, isAdmin]);

  /* ── Filter static items ──────────────────────────────── */
  const filteredStatic = useMemo(() => {
    if (!query.trim()) return SEARCH_ITEMS;
    return SEARCH_ITEMS.filter(
      (item) =>
        matchesQuery(item.label, query) ||
        matchesQuery(item.description, query) ||
        matchesQuery(item.group, query)
    );
  }, [query]);

  /* ── Merge static + dynamic ───────────────────────────── */
  const allItems = useMemo(() => [...filteredStatic, ...dynamicItems], [filteredStatic, dynamicItems]);

  const grouped = useMemo(() => {
    const groups: Record<string, SearchItem[]> = {};
    for (const item of allItems) {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    }
    return groups;
  }, [allItems]);

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      navigate(href);
    },
    [navigate]
  );

  return (
    <>
      <Button
        variant="outline"
        size={isMobile ? "icon" : "default"}
        className={
          isMobile
            ? "h-9 w-9"
            : "relative h-9 w-full max-w-[300px] justify-start gap-2 text-sm text-muted-foreground"
        }
        onClick={() => setOpen(true)}
        aria-label="Search courses, applications, clients, projects, and members"
      >
        <Search className="h-4 w-4 shrink-0" />
        {!isMobile && (
          <>
            <span className="hidden sm:inline-flex text-[1rem]">Search…</span>
            <kbd className="pointer-events-none absolute right-[0.4rem] top-[0.4rem] hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
              <span className="text-xs">⌘</span>K
            </kbd>
          </>
        )}
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search courses, clients, projects, members…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {searching ? "Searching…" : "No results found."}
          </CommandEmpty>
          {/* Ask Fleety option — always visible */}
          <CommandGroup heading="Fleety">
            <CommandItem
              value={`Ask Fleety ${query}`}
              onSelect={() => {
                setOpen(false);
                setQuery("");
                const q = query.trim();
                // Wave 3 W3-EVENT-008: CustomEvent dispatch instead of window global.
                if (q) {
                  window.dispatchEvent(new CustomEvent("fleety:open", { detail: { query: q } }));
                } else {
                  navigate("/resources?tab=guidance");
                }
              }}

              className="flex items-start gap-3 py-2.5"
            >
              <img
                src={fleetyIcon}
                alt=""
                className="h-5 w-5 mt-0.5 shrink-0 rounded-full"
                width={20}
                height={20}
                aria-hidden="true"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">
                  Ask Fleety the Helper Bot
                </span>
                <span className="text-xs text-muted-foreground line-clamp-1">
                  {query.trim()
                    ? `Ask Fleety: "${query.trim()}"`
                    : "Get guidance from Fleety, your Tech Fleet AI assistant"}
                </span>
              </div>
            </CommandItem>
          </CommandGroup>

          {Object.entries(grouped).map(([group, items]) => {
            const Icon = GROUP_ICONS[group as SearchGroup] ?? Search;
            return (
              <CommandGroup key={group} heading={group}>
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.description}`}
                    onSelect={() => handleSelect(item.href)}
                    className="flex items-start gap-3 py-2.5"
                  >
                    <Icon
                      className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-foreground">
                        {item.label}
                      </span>
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {item.description}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
      </CommandDialog>
    </>
  );
}
