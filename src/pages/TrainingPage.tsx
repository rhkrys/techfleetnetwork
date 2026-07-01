import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Check,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  Users,
  Lock,
  Briefcase,
  Heart,
  Lightbulb,
  Rocket,
  Eye,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveTabs,
  ResponsiveTabsList,
  ResponsiveTabsContent,
  type TabItem,
} from "@/components/ui/responsive-tabs";
import { useAuth } from "@/contexts/AuthContext";
import { TOTAL_AGILE_LESSONS } from "@/data/agile-course";
import { TOTAL_DISCORD_LESSONS } from "@/data/discord-course";
import { TOTAL_TEAMWORK_LESSONS } from "@/data/teamwork-course";
import { TOTAL_PROJECT_TRAINING_LESSONS } from "@/data/project-training-course";
import { TOTAL_VOLUNTEER_LESSONS } from "@/data/volunteer-teams-course";
import { TOTAL_OBSERVER_LESSONS } from "@/data/observer-course";
import { useCompletedCount } from "@/hooks/use-journey-progress";
import {
  useCourseCompletionCounts,
  type CourseCompletionSpec,
} from "@/hooks/use-course-completion-counts";
import { TOTAL_FIRST_STEPS, FIRST_STEPS_TASK_IDS } from "@/pages/FirstStepsPage";
import { TOTAL_CONNECT_DISCORD, CONNECT_DISCORD_TASK_IDS } from "@/pages/ConnectDiscordPage";
import { ALL_AGILE_LESSON_IDS } from "@/data/agile-course";
import { ALL_DISCORD_LESSON_IDS } from "@/data/discord-course";
import { ALL_TEAMWORK_LESSON_IDS } from "@/data/teamwork-course";
import { ALL_PROJECT_TRAINING_LESSON_IDS } from "@/data/project-training-course";
import { ALL_VOLUNTEER_LESSON_IDS } from "@/data/volunteer-teams-course";
import { ALL_OBSERVER_LESSON_IDS } from "@/data/observer-course";
import { usePublishedClassesByTrack } from "@/hooks/use-classes";
import { stripHtml as stripHtmlToText } from "@/lib/strip-html";

interface CourseCard {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  totalTasks: number;
  completedTasks: number;
  locked: boolean;
  prerequisiteLabel?: string;
  /** Number of *other* members who have completed this course */
  otherCompleters?: number;
}

function formatCompleters(n: number, _viewerCompleted: boolean): string {
  // v4: count is total (includes viewer) per course_completion_stats.
  if (n <= 0) return "No one has completed this yet";
  if (n === 1) return "1 member completed this course";
  return `${n.toLocaleString()} members completed this course`;
}

function CourseGrid({ courses }: { courses: CourseCard[] }) {
  if (courses.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <GraduationCap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No courses in this category yet. Check back soon!</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
      {courses.map((course) => {
        const progress =
          course.totalTasks > 0 ? Math.round((course.completedTasks / course.totalTasks) * 100) : 0;
        const isComplete = course.totalTasks > 0 && course.completedTasks >= course.totalTasks;
        const isStarted = course.completedTasks > 0;
        const Icon = course.icon;

        if (course.locked) {
          return (
            <Link
              key={course.id}
              to={course.href}
              className="card-elevated p-5 relative overflow-hidden hover:border-primary/40 transition-all group"
              aria-label={`${course.title}. Recommended after ${course.prerequisiteLabel}, but available now.`}
            >
              <div className="absolute inset-x-0 top-0 bg-warning/10 text-warning text-xs font-semibold py-2 text-center pointer-events-none">
                Recommended after {course.prerequisiteLabel}
              </div>
              <div className="flex items-start justify-between mb-3">
                <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center">
                  <Lock className="h-5 w-5 text-muted-foreground" />
                </div>
                <Badge
                  variant="outline"
                  className="bg-muted text-muted-foreground border-muted-foreground/20 text-xs gap-1"
                >
                  <Lock className="h-3 w-3" />
                  Guided
                </Badge>
              </div>
              <h3 className="font-semibold text-muted-foreground mb-1">{course.title}</h3>
              <p className="text-sm text-muted-foreground/70 mb-3">{course.description}</p>
              <div className="flex items-center gap-1.5 text-xs text-warning bg-warning/10 rounded-md px-2.5 py-1.5 mt-2">
                <Lock className="h-3 w-3 flex-shrink-0" />
                <span>
                  Suggested first:{" "}
                  <strong className="text-warning">{course.prerequisiteLabel}</strong>
                </span>
              </div>
            </Link>
          );
        }

        return (
          <Link
            key={course.id}
            to={course.href}
            className="card-elevated p-5 hover:border-primary/40 transition-all group"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              {isComplete ? (
                <Badge
                  variant="outline"
                  className="bg-success/10 text-success border-success/20 text-xs"
                >
                  Complete
                </Badge>
              ) : isStarted ? (
                <Badge
                  variant="outline"
                  className="bg-warning/10 text-warning border-warning/20 text-xs"
                >
                  In Progress
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  Not Started
                </Badge>
              )}
            </div>
            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors mb-1">
              {course.title}
            </h3>
            <p className="text-sm text-muted-foreground mb-3">{course.description}</p>
            {course.totalTasks > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {course.completedTasks}/{course.totalTasks} tasks
                  </span>
                  <span>{progress}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
            {typeof course.otherCompleters === "number" && (
              <p
                className="flex items-center gap-1.5 text-xs text-muted-foreground mt-3"
                aria-label={`${course.otherCompleters} members have completed this course`}
              >
                <Users className="h-3 w-3" aria-hidden="true" />
                <span>{formatCompleters(course.otherCompleters, isComplete)}</span>
              </p>
            )}
            <div className="flex items-center gap-1 text-xs text-primary mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
              {isComplete ? "Review" : isStarted ? "Continue" : "Start"}
              <ChevronRight className="h-3 w-3" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

const COURSE_COMPLETION_SPECS: CourseCompletionSpec[] = [
  { key: "connect-discord", phase: "first_steps", task_ids: CONNECT_DISCORD_TASK_IDS },
  { key: "onboarding", phase: "first_steps", task_ids: FIRST_STEPS_TASK_IDS },
  { key: "agile-mindset", phase: "second_steps", task_ids: ALL_AGILE_LESSON_IDS },
  { key: "project-training", phase: "project_training", task_ids: ALL_PROJECT_TRAINING_LESSON_IDS },
  { key: "volunteer-teams", phase: "volunteer", task_ids: ALL_VOLUNTEER_LESSON_IDS },
  { key: "discord-learning", phase: "discord_learning", task_ids: ALL_DISCORD_LESSON_IDS },
  { key: "observer-course", phase: "observer", task_ids: ALL_OBSERVER_LESSON_IDS },
  { key: "agile-teamwork", phase: "third_steps", task_ids: ALL_TEAMWORK_LESSON_IDS },
];

export default function TrainingPage() {
  const { user } = useAuth();
  const userId = user?.id;

  const totalFirstSteps = TOTAL_FIRST_STEPS;

  const { data: connectDiscordCompleted = 0 } = useCompletedCount(
    userId,
    "first_steps",
    CONNECT_DISCORD_TASK_IDS
  );
  const { data: firstCompleted = 0 } = useCompletedCount(
    userId,
    "first_steps",
    FIRST_STEPS_TASK_IDS
  );
  const { data: agileCompleted = 0 } = useCompletedCount(userId, "second_steps");
  const { data: discordCompleted = 0 } = useCompletedCount(userId, "discord_learning");
  const { data: teamworkCompleted = 0 } = useCompletedCount(userId, "third_steps");
  const { data: projectTrainingCompleted = 0 } = useCompletedCount(userId, "project_training");
  const { data: volunteerCompleted = 0 } = useCompletedCount(userId, "volunteer");
  const { data: observerCompleted = 0 } = useCompletedCount(userId, "observer");

  const allConnectDiscordDone = connectDiscordCompleted >= TOTAL_CONNECT_DISCORD;
  const allFirstStepsDone = firstCompleted >= TOTAL_FIRST_STEPS;
  const allAgileDone = agileCompleted >= TOTAL_AGILE_LESSONS;

  const { data: completers = {} } = useCourseCompletionCounts(COURSE_COMPLETION_SPECS);

  const gettingStartedCourses: CourseCard[] = [
    {
      id: "connect-discord",
      title: "Connect to Discord",
      description: "Link your Discord account to the Tech Fleet Network platform.",
      icon: Users,
      href: "/courses/connect-discord",
      totalTasks: TOTAL_CONNECT_DISCORD,
      completedTasks: connectDiscordCompleted,
      locked: false,
      otherCompleters: completers["connect-discord"] ?? 0,
    },
    {
      id: "onboarding",
      title: "Onboarding Steps",
      description:
        "Set up your profile, complete onboarding class, sign up for service leadership, and review the user guide.",
      icon: ClipboardCheck,
      href: "/courses/onboarding",
      totalTasks: totalFirstSteps,
      completedTasks: firstCompleted,
      locked: !allConnectDiscordDone,
      prerequisiteLabel: "Connect to Discord",
      otherCompleters: completers["onboarding"] ?? 0,
    },
  ];

  const coreCourses: CourseCard[] = [
    {
      id: "agile-mindset",
      title: "Build an Agile Mindset",
      description: `${TOTAL_AGILE_LESSONS} lessons covering agile philosophies, teamwork, and scrum methods.`,
      icon: BookOpen,
      href: "/courses/agile-mindset",
      totalTasks: TOTAL_AGILE_LESSONS,
      completedTasks: agileCompleted,
      locked: !allFirstStepsDone,
      prerequisiteLabel: "Onboarding Steps",
      otherCompleters: completers["agile-mindset"] ?? 0,
    },
    {
      id: "project-training",
      title: "Join Project Training Teams",
      description: `${TOTAL_PROJECT_TRAINING_LESSONS} lessons on how apprenticeship training works, working with nonprofit clients, and building case studies.`,
      icon: Briefcase,
      href: "/courses/project-training",
      totalTasks: TOTAL_PROJECT_TRAINING_LESSONS,
      completedTasks: projectTrainingCompleted,
      locked: !allAgileDone,
      prerequisiteLabel: "Build an Agile Mindset",
      otherCompleters: completers["project-training"] ?? 0,
    },
    {
      id: "volunteer-teams",
      title: "Join Volunteer Teams",
      description: `${TOTAL_VOLUNTEER_LESSONS} lessons on volunteering at Tech Fleet, team dynamics, and finding your volunteer role.`,
      icon: Heart,
      href: "/courses/volunteer-teams",
      totalTasks: TOTAL_VOLUNTEER_LESSONS,
      completedTasks: volunteerCompleted,
      locked: !allAgileDone,
      prerequisiteLabel: "Build an Agile Mindset",
      otherCompleters: completers["volunteer-teams"] ?? 0,
    },
    {
      id: "discord-learning",
      title: "Discord Learning Series",
      description: `${TOTAL_DISCORD_LESSONS} lessons on getting started, security, and interacting in Tech Fleet Discord.`,
      icon: Users,
      href: "/courses/discord-learning",
      totalTasks: TOTAL_DISCORD_LESSONS,
      completedTasks: discordCompleted,
      locked: false,
      otherCompleters: completers["discord-learning"] ?? 0,
    },
    {
      id: "observer-course",
      title: "Observer Course",
      description: `${TOTAL_OBSERVER_LESSONS} lessons from the Observer Handbook on how to observe Tech Fleet project teams and prepare for apprenticeship.`,
      icon: Eye,
      href: "/courses/observer",
      totalTasks: TOTAL_OBSERVER_LESSONS,
      completedTasks: observerCompleted,
      locked: false,
      otherCompleters: completers["observer-course"] ?? 0,
    },
    {
      id: "agile-teamwork",
      title: "Agile Cross-Functional Team Dynamics",
      description: `${TOTAL_TEAMWORK_LESSONS} lessons from the Teammate Handbook covering team expectations, cross-functional work, and leadership.`,
      icon: Users,
      href: "/courses/agile-teamwork",
      totalTasks: TOTAL_TEAMWORK_LESSONS,
      completedTasks: teamworkCompleted,
      locked: false,
      otherCompleters: completers["agile-teamwork"] ?? 0,
    },
  ];

  const { data: basicClasses = [] } = usePublishedClassesByTrack("basic_training");
  const { data: advancedClasses = [] } = usePublishedClassesByTrack("advanced_training");

  // Plain-text preview for course cards. Tag stripping is delegated to the
  // shared DOM-parser helper (robust against the regex bypasses CodeQL flagged);
  // this only adds the 180-char truncation.
  const stripHtml = (html: string | null | undefined): string => {
    const text = stripHtmlToText(html);
    return text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text;
  };

  const mapClassToCard = (c: (typeof basicClasses)[number]): CourseCard => ({
    id: `class-${c.id}`,
    title: c.title,
    description: stripHtml(c.summary),
    icon: GraduationCap,
    href: `/classes/${c.slug}`,
    totalTasks: 0,
    completedTasks: 0,
    locked: false,
  });

  const beginnerCourses: CourseCard[] = basicClasses.map(mapClassToCard);
  const advancedCourses: CourseCard[] = advancedClasses.map(mapClassToCard);

  const isTabComplete = (courses: CourseCard[]) =>
    courses.length > 0 &&
    courses.every((c) => c.totalTasks > 0 && c.completedTasks >= c.totalTasks);

  const gettingStartedComplete = isTabComplete(gettingStartedCourses);
  const coreComplete = isTabComplete(coreCourses);
  const beginnerComplete = isTabComplete(beginnerCourses);
  const advancedComplete = isTabComplete(advancedCourses);

  const TabBadge = ({ complete, count }: { complete: boolean; count: number }) =>
    complete ? (
      <span
        className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-success"
        aria-label="All courses completed"
      >
        <Check className="h-3 w-3 text-success-foreground" strokeWidth={3} />
      </span>
    ) : (
      <span
        className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-bold text-primary-foreground ${count > 0 ? "bg-primary" : "bg-muted-foreground"}`}
      >
        {count}
      </span>
    );

  return (
    <div className="container-app py-8 sm:py-12">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Courses</h1>
        <p className="text-muted-foreground mt-1">
          Courses and learning paths to grow your skills and mindset.
        </p>
      </div>

      <TrainingTabs
        gettingStartedCourses={gettingStartedCourses}
        coreCourses={coreCourses}
        beginnerCourses={beginnerCourses}
        advancedCourses={advancedCourses}
        gettingStartedComplete={gettingStartedComplete}
        coreComplete={coreComplete}
        beginnerComplete={beginnerComplete}
        advancedComplete={advancedComplete}
        TabBadge={TabBadge}
      />
    </div>
  );
}

function TrainingTabs({
  gettingStartedCourses,
  coreCourses,
  beginnerCourses,
  advancedCourses,
  gettingStartedComplete,
  coreComplete,
  beginnerComplete,
  advancedComplete,
  TabBadge,
}: {
  gettingStartedCourses: CourseCard[];
  coreCourses: CourseCard[];
  beginnerCourses: CourseCard[];
  advancedCourses: CourseCard[];
  gettingStartedComplete: boolean;
  coreComplete: boolean;
  beginnerComplete: boolean;
  advancedComplete: boolean;
  TabBadge: React.FC<{ complete: boolean; count: number }>;
}) {
  const [tab, setTab] = useState("getting-started");

  const tabs: TabItem[] = [
    {
      value: "getting-started",
      icon: <ClipboardCheck className="h-4 w-4" />,
      label: (
        <span className="flex items-center gap-1.5">
          Onboard to Tech Fleet{" "}
          <TabBadge complete={gettingStartedComplete} count={gettingStartedCourses.length} />
        </span>
      ),
    },
    {
      value: "core",
      icon: <GraduationCap className="h-4 w-4" />,
      label: (
        <span className="flex items-center gap-1.5">
          Core Courses <TabBadge complete={coreComplete} count={coreCourses.length} />
        </span>
      ),
    },
    {
      value: "beginner",
      icon: <Lightbulb className="h-4 w-4" />,
      label: (
        <span className="flex items-center gap-1.5">
          Basic Training <TabBadge complete={beginnerComplete} count={beginnerCourses.length} />
        </span>
      ),
    },
    {
      value: "advanced",
      icon: <Rocket className="h-4 w-4" />,
      label: (
        <span className="flex items-center gap-1.5">
          Advanced Training <TabBadge complete={advancedComplete} count={advancedCourses.length} />
        </span>
      ),
    },
  ];

  return (
    <ResponsiveTabs value={tab} onValueChange={setTab} className="w-full">
      <ResponsiveTabsList tabs={tabs} value={tab} onValueChange={setTab} className="mb-6" />
      <ResponsiveTabsContent value="getting-started">
        <CourseGrid courses={gettingStartedCourses} />
      </ResponsiveTabsContent>
      <ResponsiveTabsContent value="core">
        <CourseGrid courses={coreCourses} />
      </ResponsiveTabsContent>
      <ResponsiveTabsContent value="beginner">
        <CourseGrid courses={beginnerCourses} />
      </ResponsiveTabsContent>
      <ResponsiveTabsContent value="advanced">
        <CourseGrid courses={advancedCourses} />
      </ResponsiveTabsContent>
    </ResponsiveTabs>
  );
}
