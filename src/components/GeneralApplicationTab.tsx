import { useState } from "react";
import { Loader2, ArrowLeft, ArrowRight, Save, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlowMobileNav } from "@/components/FlowMobileNav";
import { StepProgressBar } from "@/components/StepProgressBar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useGeneralApplication } from "@/hooks/use-general-application";
import {
  SECTION_TITLES,
  TOTAL_SECTIONS,
  getFieldErrors,
  getSectionHasInput,
} from "@/lib/validators/general-application";
import {
  SectionBasicInfo,
  SectionProfile,
  SectionEngagement,
  SectionAgile,
  SectionLeadership,
  SectionReview,
} from "@/components/general-application";
import { AutosaveStatus } from "@/components/ui/AutosaveStatus";


export function GeneralApplicationTab() {
  const { user } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const {
    loading,
    activeApp,
    form,
    section,
    saving,
    errors,
    sectionsTouched,
    showCelebration,
    isCompleted,
    formContainerRef,
    autosave,
    setSection,
    setErrors,
    setShowCelebration,
    updateField,
    handleSave,
    handleNext,
    handleBack,
    canSubmit,
    navigate,
  } = useGeneralApplication();


  const handleDeleteApplication = async () => {
    if (!user || !activeApp?.id) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("general_applications")
        .delete()
        .eq("id", activeApp.id)
        .eq("user_id", user.id);
      if (error) throw error;
      toast.success("Application deleted", {
        description: "Your general application has been permanently removed.",
        position: "top-center",
      });
      navigate("/applications");
    } catch (err: unknown) {
      toast.error("We couldn't delete that application. Please try again.", {
        description: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative">
      <FlowMobileNav backTo="/applications" backLabel="Back to Applications" title="General Application" />
      {/* ── Sticky Progress Bar ────────────────────────────── */}
      <div className="sticky top-[65px] z-20 border-b bg-background px-4 sm:px-6 py-3 md:top-0">
        <div className="max-w-4xl w-full mx-auto">
        <StepProgressBar
          steps={SECTION_TITLES.map((label, i) => {
            const s = i + 1;
            const fieldErrors = getFieldErrors(form, s);
            const isComplete = Object.keys(fieldErrors).length === 0;
            const hasAnyInput = getSectionHasInput(form, s);
            return {
              label,
              hasError: sectionsTouched.has(s) && !isComplete,
              status: isComplete && hasAnyInput ? "completed" as const : hasAnyInput ? "started" as const : "not_started" as const,
            };
          })}
          currentStep={section}
          onStepClick={(s) => { setErrors({}); setSection(s); }}
        />
        </div>
      </div>

      {/* ── Content ─────────────────────────────── */}
      <div ref={formContainerRef}>
        <div className="max-w-4xl w-full mx-auto px-4 sm:px-6 py-6">
          <div className="card-elevated p-6 space-y-6">
            {/* Error summary banner */}
            {Object.keys(errors).length > 0 && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 flex gap-3" role="alert" aria-live="assertive">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-destructive">
                    Please fix {Object.keys(errors).length} {Object.keys(errors).length === 1 ? "error" : "errors"} to continue
                  </p>
                  <ul className="text-sm text-destructive/90 list-disc list-inside space-y-0.5">
                    {Object.values(errors).map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {section === TOTAL_SECTIONS
                  ? "Review Your Application"
                  : `Section ${section}: ${SECTION_TITLES[section - 1]}`}
              </h2>
              {section === 2 && (
                <p className="text-sm text-muted-foreground mt-1">
                  Here are some questions that are stored in your profile. Feel free to update them while you're filling out the general application.
                </p>
              )}
              {section === TOTAL_SECTIONS && (
                <p className="text-sm text-muted-foreground mt-1">
                  Review all your answers below. Click Edit on any section to make changes before submitting.
                </p>
              )}
            </div>

            {section === 1 && <SectionBasicInfo form={form} errors={errors} updateField={updateField} />}
            {section === 2 && <SectionProfile form={form} errors={errors} updateField={updateField} />}
            {section === 3 && <SectionEngagement form={form} errors={errors} updateField={updateField} />}
            {section === 4 && <SectionAgile form={form} errors={errors} updateField={updateField} />}
            {section === 5 && <SectionLeadership form={form} errors={errors} updateField={updateField} />}
            {section === TOTAL_SECTIONS && (
              <SectionReview
                form={form}
                onEditSection={(s) => { setErrors({}); setSection(s); }}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Sticky Footer CTAs ─────────────────────────────── */}
      <div className="sticky bottom-0 z-20 border-t bg-background px-4 sm:px-6 py-3">
        <div className="max-w-4xl w-full mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2 items-center">
            {section > 1 && (
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Previous
              </Button>
            )}

            {/* Delete button — only shown for submitted applications */}
            {activeApp && activeApp.status === "submitted" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10" disabled={deleting}>
                    <Trash2 className="h-4 w-4" />
                    {deleting ? "Deleting…" : "Delete"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete general application?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove your general application and all of your responses. 
                      This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteApplication}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete application
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <AutosaveStatus
              status={autosave.status}
              lastSavedAt={autosave.lastSavedAt}
              onRetry={autosave.retry}
            />
            <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
              {saving ? "Saving…" : isCompleted ? "Save Changes" : "Save Draft"}
            </Button>

            {section < TOTAL_SECTIONS ? (
              <Button onClick={handleNext} disabled={saving}>
                Next <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={() => handleSave(true)} disabled={saving || !canSubmit()}>
                {saving ? "Submitting…" : isCompleted ? "Update Application" : "Submit Application"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 🎉 Celebration dialog on first completion */}
      <Dialog open={showCelebration} onOpenChange={setShowCelebration}>
        <DialogContent className="sm:max-w-md text-center">
          <DialogHeader className="items-center">
            <div className="text-5xl mb-2">🎉</div>
            <DialogTitle className="text-xl">
              General Application Submitted!
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-2">
              Congratulations! Your general application has been submitted successfully.
              You can update it anytime from the Applications page.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => { setShowCelebration(false); navigate("/applications"); }}>
              Back to Applications
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
