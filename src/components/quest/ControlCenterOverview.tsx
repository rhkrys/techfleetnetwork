import { useMemo, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  useQuestPaths,
  useAllQuestSteps,
  useUserQuestSelections,
  useSelfReportProgress,
  useAllJourneyProgress,
  useQuestSteps,
  useAddQuestPath,
  useSystemVerificationData,
} from "@/hooks/use-quest";
import { isStepCompleted } from "./QuestRoadmap";
import { DosTypewriter } from "./DosTypewriter";
import { toast } from "sonner";
import type { QuestPath, QuestPathStep } from "@/services/quest.service";

const QUEST_BUTTONS = [
  { slug: "plan-journey", label: "PLAN JOURNEY" },
  { slug: "explore-possibilities", label: "EXPLORE POSSIBILITIES" },
  { slug: "observe-teams", label: "OBSERVE TEAMS" },
  { slug: "client-projects", label: "GET TEAM EXPERIENCE" },
  { slug: "learn-skills", label: "DEVELOP SKILLS" },
] as const;

const STEP_TYPE_LABELS: Record<string, string> = {
  course: "COURSE",
  self_report: "SELF-REPORT",
  system_verified: "VERIFIED",
  application: "APPLICATION",
};

type ScreenView = "home" | "quest-detail";

export function ControlCenterOverview() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { data: paths, isLoading: pathsLoading } = useQuestPaths();
  const { data: allSteps } = useAllQuestSteps();
  const { data: selections, isLoading: selectionsLoading } = useUserQuestSelections();
  const { data: selfReportProgress } = useSelfReportProgress();
  const { data: allJourneyMap } = useAllJourneyProgress();
  const { data: sysVerification } = useSystemVerificationData();

  const [screenView, setScreenView] = useState<ScreenView>("home");
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(null);

  const allProgress = useMemo(() => {
    const map = new Map<string, { completed: number; total: number }>();
    if (!allJourneyMap) return map;
    for (const [phase, tasks] of allJourneyMap.entries()) {
      const completed = tasks.filter((t) => t.completed).length;
      map.set(phase, { completed, total: tasks.length });
    }
    return map;
  }, [allJourneyMap]);

  const pathProgress = useMemo(() => {
    const result = new Map<string, { completed: number; total: number; nextStep?: QuestPathStep }>();
    if (!paths || !allSteps) return result;
    for (const path of paths) {
      const steps = allSteps.filter((s) => s.path_id === path.id);
      let completed = 0;
      let nextStep: QuestPathStep | undefined;
      for (const step of steps) {
        if (isStepCompleted(step, allProgress, selfReportProgress, profile, sysVerification)) {
          completed++;
        } else if (!nextStep) {
          nextStep = step;
        }
      }
      result.set(path.id, { completed, total: steps.length, nextStep });
    }
    return result;
  }, [paths, allSteps, allProgress, selfReportProgress, profile, sysVerification]);

  const subscribedIds = useMemo(() => {
    if (!selections) return new Set<string>();
    return new Set(selections.map((s) => s.path_id));
  }, [selections]);

  const pathBySlug = useMemo(() => {
    const map = new Map<string, QuestPath>();
    if (!paths) return map;
    for (const p of paths) map.set(p.slug, p);
    return map;
  }, [paths]);

  const handleQuestClick = useCallback(
    (slug: string) => {
      const path = pathBySlug.get(slug);
      if (!path) return;
      if (subscribedIds.has(path.id)) {
        navigate(`/my-journey/quest/${path.id}`);
      } else {
        setSelectedQuestId(path.id);
        setScreenView("quest-detail");
      }
    },
    [pathBySlug, subscribedIds, navigate]
  );

  const handleReturnHome = useCallback(() => {
    setScreenView("home");
    setSelectedQuestId(null);
  }, []);

  if (pathsLoading || selectionsLoading) {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-label="Loading control center">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full" role="region" aria-label="Quest Control Center" style={{ background: "#C9BCBC" }}>
      {/* ── Top screws row ── */}
      <ScrewRow />

      {/* ── CONTROL CENTER title ── */}
      <h2
        className="text-center font-bold tracking-[0.25em] uppercase select-none py-4"
        style={{ color: "#100D26", fontSize: "clamp(1rem, 2.5vw, 1.8rem)" }}
      >
        CONTROL CENTER
      </h2>

      {/* ── Main body: TV + Controls side by side ── */}
      <div className="flex gap-4 px-4 pb-4" style={{ minHeight: 0 }}>
        {/* ── TV Section ── */}
        <div className="flex-1 min-w-0 relative">
          <div className="relative w-full" style={{ aspectRatio: "2046 / 1663" }}>
            {/* TV frame SVG */}
            <img
              src="/images/quest-tv.svg"
              alt=""
              className="absolute inset-0 w-full h-full pointer-events-none select-none"
              aria-hidden="true"
              draggable={false}
            />

            {/* CRT scanline overlay — covers the green glass */}
            <div
              className="absolute pointer-events-none z-30"
              aria-hidden="true"
              style={{
                top: "15%",
                left: "13%",
                width: "74%",
                height: "70%",
                borderRadius: "6% / 8%",
                backgroundImage:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)",
              }}
            />

            {/* Screen content area — positioned over the green CRT region */}
            <div
              className="absolute overflow-hidden z-20"
              style={{
                top: "22%",
                left: "17%",
                width: "66%",
                height: "56%",
                borderRadius: "4% / 6%",
              }}
            >
              {screenView === "home" ? (
                <div className="w-full h-full relative" style={{ background: "#012a01" }}>
                  <img
                    src="/images/landscape.svg"
                    alt="Quest landscape"
                    className="w-full h-full object-contain"
                    draggable={false}
                  />
                </div>
              ) : selectedQuestId ? (
                <div
                  className="w-full h-full relative"
                  style={{
                    background: "radial-gradient(ellipse at center, #024a02 0%, #013201 50%, #001a00 100%)",
                  }}
                >
                  <div
                    className="absolute inset-0 pointer-events-none z-10"
                    aria-hidden="true"
                    style={{
                      background: "radial-gradient(ellipse at center, rgba(1,255,133,0.04) 0%, transparent 70%)",
                    }}
                  />
                  <div className="relative z-20 w-full h-full overflow-y-auto dos-scrollbar p-[6%]">
                    <QuestDetailScreen pathId={selectedQuestId} onReturn={handleReturnHome} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── Right Control Panel ── */}
        <div className="flex-shrink-0" style={{ width: "clamp(160px, 22%, 280px)" }}>
          <div className="relative w-full h-full" style={{ aspectRatio: "576 / 990" }}>
            {/* Panel background */}
            <img
              src="/images/controls-bg.svg"
              alt=""
              className="absolute inset-0 w-full h-full pointer-events-none select-none"
              aria-hidden="true"
              draggable={false}
            />

            {/* Top screws on panel */}
            <div
              className="absolute pointer-events-none select-none"
              aria-hidden="true"
              style={{ top: "2%", left: "4%", width: "92%", height: "7%" }}
            >
              <img src="/images/screws.svg" alt="" className="w-full h-full" draggable={false} />
            </div>

            {/* "QUESTS" title */}
            <div className="absolute w-full flex justify-center" style={{ top: "11%", left: 0, right: 0 }}>
              <span
                className="font-bold tracking-[0.25em] uppercase select-none"
                style={{ color: "#100D26", fontSize: "clamp(0.6rem, 1.4vw, 1.2rem)" }}
              >
                QUESTS
              </span>
            </div>

            {/* Quest buttons — evenly spaced in the panel */}
            {QUEST_BUTTONS.map((btn, i) => {
              const path = pathBySlug.get(btn.slug);
              const isOn = path ? subscribedIds.has(path.id) : false;
              const progress = path ? pathProgress.get(path.id) : undefined;
              const pct = progress ? Math.round((progress.completed / Math.max(progress.total, 1)) * 100) : 0;
              const isAvailable = !!path;

              // 5 buttons from 18% to 82%, each ~12% tall with ~1.5% gap
              const topPct = 18 + i * 13.5;

              return (
                <button
                  key={btn.slug}
                  onClick={() => handleQuestClick(btn.slug)}
                  disabled={!isAvailable}
                  className="absolute focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-transform active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{
                    left: "6%",
                    width: "88%",
                    top: `${topPct}%`,
                    height: "12%",
                  }}
                  aria-label={`${btn.label} — ${isOn ? `active, ${pct}% complete` : isAvailable ? "not started" : "coming soon"}`}
                >
                  <img
                    src={isOn ? "/images/on-button.svg" : "/images/off-button.svg"}
                    alt=""
                    className="absolute inset-0 w-full h-full pointer-events-none select-none"
                    aria-hidden="true"
                    draggable={false}
                  />
                  <span
                    className="relative z-10 font-bold tracking-[0.12em] select-none font-mono flex items-center justify-center w-full"
                    style={{
                      color: isOn ? "#013201" : "#100D26",
                      fontSize: "clamp(0.4rem, 1vw, 0.85rem)",
                      height: "100%",
                      marginTop: "-6%",
                    }}
                  >
                    {btn.label}
                    {isOn && progress ? ` — ${pct}%` : ""}
                  </span>
                </button>
              );
            })}

            {/* Bottom screws on panel */}
            <div
              className="absolute pointer-events-none select-none"
              aria-hidden="true"
              style={{ bottom: "2%", left: "4%", width: "92%", height: "7%" }}
            >
              <img src="/images/screws.svg" alt="" className="w-full h-full" draggable={false} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom screws row ── */}
      <ScrewRow />
    </div>
  );
}

/* ── Full-width screw row ── */
function ScrewRow() {
  return (
    <div className="flex justify-between px-3 py-2" aria-hidden="true">
      <Screw />
      <Screw />
    </div>
  );
}

/* ── Single screw inline SVG ── */
function Screw() {
  return (
    <svg width="40" height="40" viewBox="0 0 74 74" fill="none" className="flex-shrink-0">
      <circle cx="37" cy="37" r="30" fill="#A89E9E" />
      <circle cx="37" cy="37" r="25" fill="#100D26" />
      <path
        d="M43.2 60.9c4.8-1.3 9.1-3.9 12.3-7.7 3.3-3.7 5.4-8.3 6-13.2.6-4.9-.2-9.9-2.4-14.3-2.2-4.4-5.6-8.1-9.9-10.6-4.3-2.5-9.2-3.6-14.1-3.3-4.9.3-9.7 2.1-13.6 5.1-3.9 3-6.9 7.1-8.5 11.8-1.6 4.7-1.7 9.7-.4 14.5 1.7 6.4 5.9 11.9 11.6 15.2 5.7 3.3 12.6 4.2 19 2.5zm-20.8-24.5 9.3-2.5-2.5-9.3 7.8-2.1 2.5 9.3 9.3-2.5 2.1 7.8-9.3 2.5 2.5 9.3-7.8 2.1-2.5-9.3-9.3 2.5-2.1-7.8z"
        fill="#96AAB9"
      />
    </svg>
  );
}

/* ── Quest Detail Screen (inside the CRT) ── */

function QuestDetailScreen({
  pathId,
  onReturn,
}: {
  pathId: string;
  onReturn: () => void;
}) {
  const { data: paths } = useQuestPaths();
  const { data: steps, isLoading: stepsLoading } = useQuestSteps(pathId);
  const addPath = useAddQuestPath();

  const path = useMemo(() => paths?.find((p) => p.id === pathId), [paths, pathId]);

  const handleSubscribe = async () => {
    try {
      await addPath.mutateAsync(pathId);
      toast.success(`Quest "${path?.title}" activated!`);
      onReturn();
    } catch {
      // error handled by hook
    }
  };

  if (!path) return null;

  const lines = [
    `> LOADING QUEST: ${path.title.toUpperCase()}`,
    "",
    `DESCRIPTION:`,
    path.description,
    "",
    `LEVEL: ${(path.level || "beginner").toUpperCase()}`,
    `ESTIMATED DURATION: ${path.estimated_duration}`,
    "",
  ];

  const stepsText = steps
    ? steps.map(
        (step, i) =>
          `  ${String(i + 1).padStart(2, "0")}. [${STEP_TYPE_LABELS[step.step_type] ?? "STEP"}] ${step.title}`
      )
    : [];

  const fullText = [...lines, "STEPS:", ...stepsText, "", "> READY TO BEGIN? [Y/N]"].join("\n");

  return (
    <div className="space-y-[3%]" style={{ fontFamily: "'White Rabbit', monospace" }}>
      <button
        onClick={onReturn}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        style={{ color: "#01FF85" }}
      >
        <span className="text-[clamp(0.35rem,0.9vw,0.7rem)] tracking-wider hover:underline">
          {"< RETURN HOME"}
        </span>
      </button>

      <pre
        className="whitespace-pre-wrap leading-relaxed"
        style={{ color: "#01FF85", fontSize: "clamp(0.3rem, 0.85vw, 0.7rem)" }}
      >
        {stepsLoading ? (
          <DosTypewriter text="> LOADING QUEST DATA..." speed={40} />
        ) : (
          <DosTypewriter text={fullText} speed={8} />
        )}
      </pre>

      {!stepsLoading && (
        <div className="flex gap-[3%] pt-[2%]">
          <button
            onClick={handleSubscribe}
            disabled={addPath.isPending}
            className="px-[4%] py-[2%] rounded border font-bold tracking-wider transition-all hover:shadow-[0_0_12px_rgba(1,255,133,0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            style={{
              color: "#013201",
              background: "#01FF85",
              borderColor: "#01FF85",
              fontSize: "clamp(0.3rem, 0.8vw, 0.65rem)",
            }}
          >
            {addPath.isPending ? "ACTIVATING..." : "Y - START QUEST"}
          </button>
          <button
            onClick={onReturn}
            className="px-[4%] py-[2%] rounded border font-bold tracking-wider transition-all hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              color: "#01FF85",
              background: "transparent",
              borderColor: "#01FF85",
              fontSize: "clamp(0.3rem, 0.8vw, 0.65rem)",
            }}
          >
            N - GO BACK
          </button>
        </div>
      )}
    </div>
  );
}
