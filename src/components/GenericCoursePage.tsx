import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Play,
  BookOpen,
  Lock,
  AlertTriangle,
  Share2,
  Check,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { SafeExternalLink } from "@/components/security/SafeExternalLink";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { FlowMobileNav } from "@/components/FlowMobileNav";
import { StepProgressBar } from "@/components/StepProgressBar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@/lib/react-query";
import { DiscordNotifyService } from "@/services/discord-notify.service";
import type { CourseLesson, CourseSection } from "@/data/project-training-course";
import { CourseVideoEmbed, renderMarkdownLite } from "@/components/courses/CoursePlayer";


// CourseVideoEmbed extracted to src/components/courses/CoursePlayer/CourseVideoEmbed.tsx



interface GenericCoursePageProps {
  title: string;
  subtitle: string;
  backTo: string;
  backLabel: string;
  phase: string;
  sections: CourseSection[];
  allLessons: CourseLesson[];
  allLessonIds: string[];
  totalLessons: number;
  completionMessage: string;
  completionSubtext: string;
  prerequisite?: {
    met: boolean;
    loaded: boolean;
    courseName: string;
    courseHref: string;
  };
  nextCourse?: {
    title: string;
    href: string;
  };
  interactiveSlot?: (ctx: { lessonId: string; isCompleted: boolean; markComplete: () => void }) => React.ReactNode;
}

export default function GenericCoursePage({
  title,
  subtitle,
  backTo,
  backLabel,
  phase,
  sections,
  allLessons,
  allLessonIds,
  totalLessons,
  completionMessage,
  completionSubtext,
  prerequisite,
  nextCourse,
  interactiveSlot,
}: GenericCoursePageProps) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  // Treat tablets (≤1024px) as "fullscreen" too so the lesson viewer maximizes screen real estate
  const [isTabletOrSmaller, setIsTabletOrSmaller] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1024px)");
    const update = () => setIsTabletOrSmaller(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  const fullscreen = isMobile || isTabletOrSmaller;
  const [completedSet, setCompletedSet] = useState<Set<string>>(new Set());
  const [selectedLesson, setSelectedLesson] = useState<CourseLesson | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [toggling, setToggling] = useState(false);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const prevCompletedCountRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  // Load progress
  useEffect(() => {
    if (!user) return;
    supabase
      .from("journey_progress")
      .select("task_id, completed")
      .eq("user_id", user.id)
      .eq("phase", phase as any)
      .then(({ data }) => {
        if (data) {
          setCompletedSet(
            new Set(data.filter((r) => r.completed).map((r) => r.task_id))
          );
        }
        setProgressLoaded(true);
      });
  }, [user, phase]);

  // Auto-expand first incomplete section
  useEffect(() => {
    if (!progressLoaded) return;
    const currentSectionIdx = sections.findIndex((section) =>
      section.lessons.some((l) => !completedSet.has(l.id))
    );
    setExpandedSections(
      new Set(currentSectionIdx >= 0 ? [currentSectionIdx] : [])
    );
  }, [progressLoaded]);

  const completedCount = useMemo(
    () => allLessonIds.filter((id) => completedSet.has(id)).length,
    [completedSet, allLessonIds]
  );
  const progress = (completedCount / totalLessons) * 100;

  // Detect when course just became fully complete after a toggle
  useEffect(() => {
    if (prevCompletedCountRef.current !== null && prevCompletedCountRef.current < totalLessons && completedCount === totalLessons) {
      setShowCompletionDialog(true);
      const displayName = profile?.display_name || profile?.first_name || "A member";
      const discord = profile?.discord_username || undefined;
      const discordId = profile?.discord_user_id || undefined;
      DiscordNotifyService.phaseCompleted(displayName, phase, discord, discordId);
    }
    prevCompletedCountRef.current = completedCount;
  }, [completedCount, totalLessons, phase, profile]);

  const toggleLesson = async (lessonId: string) => {
    if (!user || toggling) return;
    setToggling(true);
    const newCompleted = !completedSet.has(lessonId);
    try {
      await supabase.from("journey_progress").upsert(
        {
          user_id: user.id,
          phase: phase as any,
          task_id: lessonId,
          completed: newCompleted,
          completed_at: newCompleted ? new Date().toISOString() : null,
        },
        { onConflict: "user_id,phase,task_id" }
      );
      setCompletedSet((prev) => {
        const next = new Set(prev);
        newCompleted ? next.add(lessonId) : next.delete(lessonId);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["journey-completed", user.id, phase] });
      queryClient.invalidateQueries({ queryKey: ["journey-progress", user.id, phase] });
    } finally {
      setToggling(false);
    }
  };

  const toggleSection = (idx: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const sectionProgress = (sectionIdx: number) => {
    const section = sections[sectionIdx];
    const done = section.lessons.filter((l) => completedSet.has(l.id)).length;
    return { done, total: section.lessons.length };
  };

  const renderContent = (content: string) => renderMarkdownLite(content);


  // Share button component
  const ShareButton = () => {
    const [copied, setCopied] = useState(false);
    const shareUrl = `${window.location.origin}${window.location.pathname}`;

    const handleShare = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        const input = document.createElement("input");
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };

    return (
      <Button
        variant="outline"
        size="sm"
        className="flex-shrink-0 gap-1.5"
        onClick={handleShare}
        aria-label="Copy share link"
      >
        {copied ? (
          <>
            <Check className="h-4 w-4 text-success" />
            <span className="text-xs">Copied!</span>
          </>
        ) : (
          <>
            <Share2 className="h-4 w-4" />
            <span className="text-xs">Share</span>
          </>
        )}
      </Button>
    );
  };

  // Build step progress bar data from sections
  const stepProgressData = useMemo(() => {
    return sections.map((section, idx) => {
      const { done, total } = sectionProgress(idx);
      const status: "not_started" | "started" | "completed" =
        done === total ? "completed" : done > 0 ? "started" : "not_started";
      return { label: section.title, status };
    });
  }, [sections, completedSet]);

  // Determine the current active section (first incomplete)
  const currentSectionStep = useMemo(() => {
    const idx = sections.findIndex((section) =>
      section.lessons.some((l) => !completedSet.has(l.id))
    );
    return idx >= 0 ? idx + 1 : sections.length;
  }, [sections, completedSet]);

  // Prerequisite gate
  if (prerequisite && prerequisite.loaded && !prerequisite.met) {
    return (
      <div className="container-app py-8 sm:py-12 max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Courses</h1>
          <Breadcrumb className="mt-2">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/courses">Courses</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <div className="flex flex-col items-center justify-center text-center py-16 px-4">
          <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mb-6">
            <Lock className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
            {title}
          </h1>
          <div className="card-elevated border-warning/30 bg-warning/5 p-6 max-w-md mx-auto">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
              <div className="text-left">
                <p className="font-semibold text-foreground text-sm mb-1">
                  Prerequisite Required
                </p>
                <p className="text-sm text-muted-foreground mb-3">
                  You must complete <strong className="text-foreground">{prerequisite.courseName}</strong> before you can access this course.
                </p>
                <Button
                  size="sm"
                  onClick={() => navigate(prerequisite.courseHref)}
                >
                  Go to {prerequisite.courseName}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <FlowMobileNav backTo={backTo} backLabel={backLabel} title={title} />
      <div className="container-app py-6 sm:py-12 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Courses</h1>
        <Breadcrumb className="mt-2">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/courses">Courses</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex items-start justify-between gap-4 mt-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-foreground">{title}</h2>
            <p className="text-muted-foreground mt-1">{subtitle}</p>
          </div>
          <ShareButton />
        </div>
      </div>

      {/* Step Progress Bar — same style as onboarding welcome */}
      <div className="mb-8">
        <div className="flex items-center justify-between text-sm mb-4">
          <span className="text-muted-foreground">
            {completedCount} of {totalLessons} lessons completed
          </span>
          <span className="font-medium text-foreground">{Math.round(progress)}%</span>
        </div>
        <StepProgressBar
          steps={stepProgressData}
          currentStep={currentSectionStep}
          getStepHref={(s) => `#course-section-${s}`}
          onStepClick={(s) => {
            const idx = s - 1;
            // Ensure section is OPEN (don't collapse on click).
            setExpandedSections((prev) => {
              if (prev.has(idx)) return prev;
              const next = new Set(prev);
              next.add(idx);
              return next;
            });
            // Scroll to the section, honoring prefers-reduced-motion.
            requestAnimationFrame(() => {
              const el = document.getElementById(`course-section-${s}`);
              if (!el) return;
              const reduce =
                typeof window !== "undefined" &&
                window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
              el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
            });
          }}
        />
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {sections.map((section, sIdx) => {
          const expanded = expandedSections.has(sIdx);
          const { done, total } = sectionProgress(sIdx);
          const sectionDone = done === total;

          return (
            <div key={sIdx} id={`course-section-${sIdx + 1}`} className="card-elevated overflow-hidden border border-white/50 scroll-mt-24">
              <button
                onClick={() => toggleSection(sIdx)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-accent/50 transition-colors"
              >
                {expanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <h2
                    className={`font-semibold text-sm ${
                      sectionDone ? "text-success" : "text-foreground"
                    }`}
                  >
                    {section.title}
                  </h2>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {done}/{total}
                </span>
              </button>

              {expanded && (
                <div className="border-t border-border">
                  {section.lessons.map((lesson) => {
                    const isDone = completedSet.has(lesson.id);
                    return (
                      <div
                        key={lesson.id}
                        className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 border-border/50 transition-colors ${
                          isDone ? "bg-success/5" : ""
                        }`}
                      >
                        <button
                          onClick={() => {
                            if (!isDone) {
                              setSelectedLesson(lesson);
                            } else {
                              toggleLesson(lesson.id);
                            }
                          }}
                          disabled={toggling}
                          className="flex-shrink-0"
                          aria-label={
                            isDone
                              ? `Mark "${lesson.title}" as incomplete`
                              : `Open "${lesson.title}"`
                          }
                        >
                          {isDone ? (
                            <CheckCircle2 className="h-5 w-5 text-success" />
                          ) : (
                            <Circle className="h-5 w-5 text-muted-foreground hover:text-primary transition-colors" />
                          )}
                        </button>

                        <span
                          className={`flex-1 text-sm cursor-pointer hover:text-primary transition-colors ${
                            isDone
                              ? "text-muted-foreground line-through"
                              : "text-foreground"
                          }`}
                          onClick={() => setSelectedLesson(lesson)}
                        >
                          {lesson.title}
                        </span>

                        <Button
                          variant={lesson.youtubeId ? "default" : "ghost"}
                          size="sm"
                          className={`flex-shrink-0 h-8 ${
                            lesson.youtubeId ? "px-3 gap-1.5" : "px-2"
                          }`}
                          onClick={() => setSelectedLesson(lesson)}
                        >
                          {lesson.youtubeId ? (
                            <>
                              <Play className="h-3.5 w-3.5" />
                              <span className="text-xs">Watch</span>
                            </>
                          ) : (
                            <>
                              <BookOpen className="h-3.5 w-3.5" />
                              <span className="text-xs">Read</span>
                            </>
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Completion banner */}
      {completedCount === totalLessons && (
        <div className="mt-8 card-elevated border-success/50 bg-success/5 p-6 text-center animate-fade-in">
          <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-3" />
          <h2 className="text-xl font-bold text-foreground mb-2">
            {completionMessage}
          </h2>
          <p className="text-muted-foreground">{completionSubtext}</p>
          {nextCourse && (
            <Button className="mt-4" onClick={() => navigate(nextCourse.href)}>
              Continue to {nextCourse.title}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      )}

      {/* Course completion popup */}
      <Dialog open={showCompletionDialog} onOpenChange={setShowCompletionDialog}>
        <DialogContent className="sm:max-w-md text-center">
          <DialogHeader className="items-center">
            <div className="text-5xl mb-2">🎉</div>
            <DialogTitle className="text-xl">
              {title} Complete!
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-2">
              You've completed all lessons in this course. Well done!
              {nextCourse
                ? " You're ready for the next course."
                : " " + completionSubtext}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            {nextCourse ? (
              <>
                <Button onClick={() => { setShowCompletionDialog(false); navigate(nextCourse.href); }}>
                  Continue to {nextCourse.title}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
                <Button variant="outline" onClick={() => setShowCompletionDialog(false)}>
                  Stay on This Course
                </Button>
              </>
            ) : (
              <Button onClick={() => setShowCompletionDialog(false)}>
                Close
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Lesson detail — full-screen on mobile, centered modal on desktop */}
      <Dialog
        open={!!selectedLesson}
        onOpenChange={(open) => !open && setSelectedLesson(null)}
      >
        <DialogContent
          className="w-screen h-[100dvh] max-w-none max-h-none min-h-0 overflow-hidden rounded-none border-0 p-0 gap-0 flex flex-col sm:rounded-none translate-x-0 translate-y-0 left-0 top-0 data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom"
          onTouchStart={(e) => {
            if (!fullscreen) return;
            const t = e.touches[0];
            touchStartXRef.current = t.clientX;
            touchStartYRef.current = t.clientY;
          }}
          onTouchEnd={(e) => {
            if (!fullscreen || touchStartXRef.current === null) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - touchStartXRef.current;
            const dy = t.clientY - (touchStartYRef.current ?? t.clientY);
            touchStartXRef.current = null;
            touchStartYRef.current = null;
            // horizontal swipe only — ignore vertical scrolls
            if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
            if (!selectedLesson) return;
            const idx = allLessons.findIndex((l) => l.id === selectedLesson.id);
            if (dx < 0 && idx < allLessons.length - 1) {
              setSelectedLesson(allLessons[idx + 1]);
            } else if (dx > 0 && idx > 0) {
              setSelectedLesson(allLessons[idx - 1]);
            }
          }}
        >
          <DialogHeader
            className={
              fullscreen
                ? "px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 border-b border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur sticky top-0 z-10 shrink-0 text-left space-y-1"
                : "px-6 pt-6 pb-4 border-b border-border shrink-0"
            }
          >
            {selectedLesson && (
              <p className="text-xs text-muted-foreground">
                Lesson{" "}
                {allLessons.findIndex((l) => l.id === selectedLesson.id) + 1}{" "}
                of {totalLessons}
              </p>
            )}
            <DialogTitle className={fullscreen ? "text-base leading-snug pr-8 text-left" : "text-base leading-snug pr-6"}>
              {selectedLesson?.title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Lesson details for {selectedLesson?.title}
            </DialogDescription>
          </DialogHeader>

          <div
            className={fullscreen ? "flex-1 min-h-0 overflow-y-auto overscroll-contain" : "flex-1 min-h-0 overflow-y-auto overscroll-contain px-6"}
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <div className="space-y-4 pb-4">
              {selectedLesson?.youtubeId && (
                <div className="space-y-2">
                  {/*
                    Cap the video so the entire 16:9 frame is visible without
                    scrolling. Width is limited by available viewport height
                    (minus header + footer + text-version chrome ~ 22rem) so
                    the video shrinks on short windows instead of overflowing.
                  */}
                  <div className="w-full bg-black flex justify-center">
                    <div
                      className="w-full"
                      style={{
                        maxWidth: "min(100%, calc((100dvh - 22rem) * 16 / 9))",
                      }}
                    >
                      <CourseVideoEmbed
                        youtubeId={selectedLesson.youtubeId}
                        title={selectedLesson.title}
                        lessonId={selectedLesson.id}
                      />
                    </div>
                  </div>
                  <SafeExternalLink
                    href={`https://www.youtube.com/watch?v=${selectedLesson.youtubeId}`}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-4"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Watch on YouTube
                  </SafeExternalLink>
                </div>
              )}

              <div className={fullscreen ? "px-4 space-y-4" : "space-y-4"}>
                {/* Text version */}
                {selectedLesson?.content && selectedLesson?.youtubeId ? (
                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="text-version" className="border rounded-lg">
                      <AccordionTrigger className="px-4 py-3 text-sm font-medium hover:no-underline">
                        Text Version
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <div className="space-y-3">
                          {renderContent(selectedLesson.content)}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ) : selectedLesson?.content ? (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Lesson Content
                    </p>
                    <div className="space-y-3">
                      {renderContent(selectedLesson.content)}
                    </div>
                  </div>
                ) : null}

                <div className="pt-2">
                  <SafeExternalLink
                    href={selectedLesson?.sourceUrl}
                  >
                    <Button variant="outline" size="sm">
                      Read on Guide
                    </Button>
                  </SafeExternalLink>
                </div>

                {selectedLesson && interactiveSlot ? (
                  <div className="pt-4">
                    {interactiveSlot({
                      lessonId: selectedLesson.id,
                      isCompleted: completedSet.has(selectedLesson.id),
                      markComplete: () => {
                        if (!completedSet.has(selectedLesson.id)) {
                          void toggleLesson(selectedLesson.id);
                        }
                      },
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {selectedLesson &&
            (() => {
              const currentIndex = allLessons.findIndex(
                (l) => l.id === selectedLesson.id
              );
              const prevLesson =
                currentIndex > 0 ? allLessons[currentIndex - 1] : null;
              const nextLesson =
                currentIndex < allLessons.length - 1
                  ? allLessons[currentIndex + 1]
                  : null;

              return (
                <div
                  className={
                    fullscreen
                      ? "px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] border-t border-border space-y-2 shrink-0 bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur"
                      : "px-6 py-4 border-t border-border space-y-3 shrink-0"
                  }
                >
                  <Button
                    className="w-full h-11"
                    variant={
                      completedSet.has(selectedLesson.id) ? "outline" : "default"
                    }
                    onClick={() => toggleLesson(selectedLesson.id)}
                    disabled={toggling}
                  >
                    {completedSet.has(selectedLesson.id) ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-1.5" />
                        Completed — Mark Incomplete
                      </>
                    ) : (
                      <>
                        <Circle className="h-4 w-4 mr-1.5" />
                        Mark as Complete
                      </>
                    )}
                  </Button>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 h-11"
                      disabled={!prevLesson}
                      onClick={() =>
                        prevLesson && setSelectedLesson(prevLesson)
                      }
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Back
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 h-11"
                      disabled={!nextLesson}
                      onClick={() =>
                        nextLesson && setSelectedLesson(nextLesson)
                      }
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
