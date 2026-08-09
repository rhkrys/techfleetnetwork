import { appQueryClient, QueryClientProvider, PersistQueryClientProvider } from "@/lib/react-query";
import { getQueryPersister, shouldPersistQuery, PERSISTER_BUSTER } from "@/lib/query/persister";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { TeacherRoute } from "@/components/TeacherRoute";
import { IdleTimeoutGuard } from "@/components/IdleTimeoutGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ScopedErrorBoundary } from "@/components/ScopedErrorBoundary";
import { AuthRedirectHandler } from "@/components/AuthRedirectHandler";
import { ProgressCacheIdentityGuard } from "@/components/ProgressCacheIdentityGuard";
import { RouteTitle } from "@/components/RouteTitle";
import { IdleMount } from "@/components/IdleMount";
import { Suspense } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry";
import { consumeQueryCacheResetPending } from "@/lib/app-cache-reset";
import { installSessionActivityTracker } from "@/lib/session-activity";

// Non-critical side-effect mounts — deferred to idle so they don't compete
// with LCP/FCP on cold load. Lazy-imported so their JS isn't in the entry chunk.
const OfflineBanner = lazy(() =>
  import("@/components/OfflineBanner").then((m) => ({ default: m.OfflineBanner }))
);
const SelfHealingRunner = lazy(() =>
  import("@/components/SelfHealingRunner").then((m) => ({ default: m.SelfHealingRunner }))
);
const AnalyticsTracker = lazy(() =>
  import("@/components/AnalyticsTracker").then((m) => ({ default: m.AnalyticsTracker }))
);
const RouteChangeReloader = lazy(() =>
  import("@/components/RouteChangeReloader").then((m) => ({ default: m.RouteChangeReloader }))
);

// Source-of-truth tracker for "user did something recently". Drives the
// session-idle policy in AuthService.getSession so that active users — even
// ones quietly reading or watching a video — are never auto-signed-out.
// Idempotent; safe under React StrictMode. Deferred to idle so it never blocks
// first paint on slow devices (the tracker itself is cheap but adds listeners).
if (typeof window !== "undefined") {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (typeof ric === "function") ric(() => installSessionActivityTracker());
  else window.setTimeout(() => installSessionActivityTracker(), 0);
} else {
  installSessionActivityTracker();
}

// Eagerly loaded routes (critical path — keep small to minimize initial JS on slow networks)
// AUTH REBUILD Ship 2 (2026-06-11): /login is now owned by SignInScreen,
// which is presentation-only over `useSignInEngine`. The legacy LoginPage
// stays on disk until Ship 5 deletion + soak.
import SignInScreen from "@/features/auth/ui/SignInScreen";
import NotFound from "./pages/NotFound";

// Lazily loaded — Index/Register only needed on their own routes
const Index = lazy(() => import("./pages/Index"));
// AUTH REBUILD Ship 4 (2026-06-11): /register now owned by RegisterScreen
// over useRegisterEngine. Legacy RegisterPage stays on disk until Ship 5.
const RegisterPage = lazy(() => import("@/features/auth/ui/RegisterScreen"));
const GetHelpPage = lazy(() => import("./pages/community/GetHelpPage"));

// Heavy non-critical widgets — defer until after first paint to free up the
// initial JS budget on slow networks.
const PWAInstallPrompt = lazy(() =>
  import("./components/PWAInstallPrompt").then((m) => ({ default: m.PWAInstallPrompt }))
);

// Lazily loaded routes (reduce initial JS bundle)
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
// AUTH REBUILD Ship 3 (2026-06-11): /forgot-password now owned by ForgotPasswordScreen
// over useForgotPasswordEngine. Legacy ForgotPasswordPage stays on disk until Ship 5.
const ForgotPasswordPage = lazy(() => import("@/features/auth/ui/ForgotPasswordScreen"));
// AUTH REBUILD Ship 3 (2026-06-11): /reset-password now owned by ResetPasswordScreen
// over useResetPasswordEngine. Pure mechanical extraction; recovery-session
// invariant + prefetch gate + CLEAN HANDOFF preserved byte-for-byte. Legacy
// ResetPasswordPage stays on disk until Ship 5.
const ResetPasswordPage = lazy(() => import("@/features/auth/ui/ResetPasswordScreen"));
const ConfirmRecoveryLinkPage = lazy(() => import("./pages/ConfirmRecoveryLinkPage"));
const ProfileSetupPage = lazy(() => import("./pages/ProfileSetupPage"));
const WelcomeWizard = lazy(() => import("./pages/WelcomeWizard"));
const FirstStepsPage = lazy(() => import("./pages/FirstStepsPage"));
const SecondStepsPage = lazy(() => import("./pages/SecondStepsPage"));
const ThirdStepsPage = lazy(() => import("./pages/ThirdStepsPage"));
const ProjectTrainingPage = lazy(() => import("./pages/ProjectTrainingPage"));
const VolunteerTeamsPage = lazy(() => import("./pages/VolunteerTeamsPage"));
const DiscordCoursePage = lazy(() => import("./pages/DiscordCoursePage"));
const TrainingPage = lazy(() => import("./pages/TrainingPage"));
const ResourcesPage = lazy(() => import("./pages/ResourcesPage"));

const ChatPage = lazy(() => import("./pages/ChatPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));
const AdminIngestPage = lazy(() => import("./pages/AdminIngestPage"));
const AdminPoliciesPage = lazy(() => import("./pages/admin/AdminPoliciesPage"));
const ApplicationsPage = lazy(() => import("./pages/ApplicationsPage"));
const GeneralApplicationPage = lazy(() => import("./pages/GeneralApplicationPage"));
const MyProjectApplicationsPage = lazy(() => import("./pages/MyProjectApplicationsPage"));
const ProjectApplicationStatusPage = lazy(() => import("./pages/ProjectApplicationStatusPage"));
const ProjectOpeningsPage = lazy(() => import("./pages/ProjectOpeningsPage"));
const UserAdminPage = lazy(() => import("./pages/UserAdminPage"));
const ConfirmAdminPage = lazy(() => import("./pages/ConfirmAdminPage"));
const ActivityLogPage = lazy(() => import("./pages/ActivityLogPage"));
const ApplicationSubmissionDetailPage = lazy(
  () => import("./pages/ApplicationSubmissionDetailPage")
);
const UpdatesPage = lazy(() => import("./pages/UpdatesPage"));
const ClientsPage = lazy(() => import("./pages/ClientsPage"));
const ProjectFormPage = lazy(() => import("./pages/ProjectFormPage"));
const ProjectApplicationPage = lazy(() => import("./pages/ProjectApplicationPage"));
const ProjectOpeningDetailPage = lazy(() => import("./pages/ProjectOpeningDetailPage"));
const EditProfilePage = lazy(() => import("./pages/EditProfilePage"));
const NotificationSettingsPage = lazy(() => import("./pages/NotificationSettingsPage"));
const ProjectAnalysisDetailPage = lazy(() => import("./pages/ProjectAnalysisDetailPage"));
const FeedbackPage = lazy(() => import("./pages/FeedbackPage"));
const AccessibilityPage = lazy(() => import("./pages/AccessibilityPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const CookiesPage = lazy(() => import("./pages/CookiesPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const TermsOfUsePage = lazy(() => import("./pages/TermsOfUsePage"));
const CodeOfConductPage = lazy(() => import("./pages/CodeOfConductPage"));
const DsarSubmitPage = lazy(() => import("./pages/DsarSubmitPage"));
const AdminRosterPage = lazy(() => import("./pages/AdminRosterPage"));
const BannerManagementPage = lazy(() => import("./pages/BannerManagementPage"));
const RosterProjectDetailPage = lazy(() => import("./pages/RosterProjectDetailPage"));
const RosterApplicantDetailPage = lazy(() => import("./pages/RosterApplicantDetailPage"));
const MyJourneyPage = lazy(() => import("./pages/MyJourneyPage"));
const QuestDetailPage = lazy(() => import("./pages/QuestDetailPage"));
const ObserverCoursePage = lazy(() => import("./pages/ObserverCoursePage"));
const ConnectDiscordPage = lazy(() => import("./pages/ConnectDiscordPage"));
const UnsubscribePage = lazy(() => import("./pages/UnsubscribePage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const AccessDeniedPage = lazy(() => import("./pages/AccessDeniedPage"));
const SystemHealthPage = lazy(() => import("./pages/SystemHealthPage"));
const AdminEmailDeliverabilityTestPage = lazy(
  () => import("./pages/AdminEmailDeliverabilityTestPage")
);
const BrandTokensPage = lazy(() => import("./pages/BrandTokensPage"));
const MyClassesPage = lazy(() => import("./pages/MyClassesPage"));
const ClassFormPage = lazy(() => import("./pages/ClassFormPage"));
const ClassDetailPage = lazy(() => import("./pages/ClassDetailPage"));
const CohortFormPage = lazy(() => import("./pages/CohortFormPage"));
const AdminClassesPage = lazy(() => import("./pages/AdminClassesPage"));
const ConfirmTeacherPage = lazy(() => import("./pages/ConfirmTeacherPage"));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

if (consumeQueryCacheResetPending()) appQueryClient.clear();

const queryPersister = getQueryPersister();

function QueryRoot({ children }: { children: React.ReactNode }) {
  if (!queryPersister) {
    return <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>;
  }
  return (
    <PersistQueryClientProvider
      client={appQueryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: 24 * 60 * 60 * 1000, // 24h on-disk retention
        buster: PERSISTER_BUSTER,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}

const App = () => (
  <QueryRoot>
    <ThemeProvider defaultTheme="dark">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <ErrorBoundary>
              {/* AuthRedirectHandler stays eager — it gates routing decisions and
                  must run on first paint. The rest are non-critical and deferred. */}
              <AuthRedirectHandler />
              <ProgressCacheIdentityGuard />
              <RouteTitle />
              <IdleMount>
                <Suspense fallback={null}>
                  <RouteChangeReloader />
                  <AnalyticsTracker />
                </Suspense>
              </IdleMount>
              <AppLayout>
                <IdleTimeoutGuard />
                <IdleMount>
                  <Suspense fallback={null}>
                    <SelfHealingRunner />
                    <PWAInstallPrompt />
                    <OfflineBanner />
                  </Suspense>
                </IdleMount>
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/" element={<Index />} />
                    <Route path="/login" element={<SignInScreen />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                    <Route path="/reset-password" element={<ResetPasswordPage />} />
                    <Route path="/reset-password/confirm" element={<ConfirmRecoveryLinkPage />} />
                    {/* AUTH-ARCH-CUTOVER-002: legacy reset links generated before
                        2026-06-11 pointed at /reset-password/<anything>. Any
                        unrecognized sub-path forwards to the live ResetPasswordScreen
                        with the original query/hash preserved so the token still
                        verifies instead of 404'ing. */}
                    <Route path="/reset-password/*" element={<ResetPasswordPage />} />
                    <Route
                      path="/dashboard"
                      element={
                        <ProtectedRoute>
                          <DashboardPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/profile-setup"
                      element={
                        <ProtectedRoute>
                          <ProfileSetupPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/welcome"
                      element={
                        <ProtectedRoute>
                          <WelcomeWizard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/my-journey"
                      element={
                        <ProtectedRoute>
                          <MyJourneyPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/my-journey/quest/:pathId"
                      element={
                        <ProtectedRoute>
                          <QuestDetailPage />
                        </ProtectedRoute>
                      }
                    />

                    <Route
                      path="/courses"
                      element={
                        <ProtectedRoute>
                          <TrainingPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/curriculum"
                      element={
                        <ProtectedRoute>
                          <TrainingPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/courses/connect-discord"
                      element={
                        <ProtectedRoute>
                          <ConnectDiscordPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/courses/onboarding"
                      element={
                        <ProtectedRoute>
                          <FirstStepsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/courses/agile-mindset"
                      element={
                        <ProtectedRoute>
                          <SecondStepsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/courses/discord-learning"
                      element={
                        <ProtectedRoute>
                          <DiscordCoursePage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/courses/agile-teamwork"
                      element={
                        <ProtectedRoute>
                          <ThirdStepsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/courses/project-training"
                      element={
                        <ProtectedRoute>
                          <ProjectTrainingPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/courses/volunteer-teams"
                      element={
                        <ProtectedRoute>
                          <VolunteerTeamsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/courses/observer"
                      element={
                        <ProtectedRoute>
                          <ObserverCoursePage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/events"
                      element={
                        <ProtectedRoute>
                          <EventsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/resources"
                      element={
                        <ProtectedRoute>
                          <ResourcesPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/community/get-help"
                      element={
                        <ProtectedRoute>
                          <ScopedErrorBoundary label="Get Help">
                            <GetHelpPage />
                          </ScopedErrorBoundary>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/chat"
                      element={
                        <ProtectedRoute>
                          <ChatPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/applications"
                      element={
                        <ProtectedRoute>
                          <ApplicationsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/applications/general"
                      element={
                        <ProtectedRoute>
                          <GeneralApplicationPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/applications/projects"
                      element={
                        <ProtectedRoute>
                          <MyProjectApplicationsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/applications/projects/:applicationId/status"
                      element={
                        <ProtectedRoute>
                          <ProjectApplicationStatusPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/project-openings"
                      element={
                        <ProtectedRoute>
                          <ProjectOpeningsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/project-openings/:projectId"
                      element={<ProjectOpeningDetailPage />}
                    />
                    <Route
                      path="/project-openings/:projectId/apply"
                      element={
                        <ProtectedRoute>
                          <ProjectApplicationPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/admin/ingest"
                      element={
                        <AdminRoute>
                          <AdminIngestPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/policies"
                      element={
                        <AdminRoute>
                          <AdminPoliciesPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/users"
                      element={
                        <AdminRoute>
                          <UserAdminPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/activity-log"
                      element={
                        <AdminRoute>
                          <ActivityLogPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/applications/analysis/:projectId"
                      element={
                        <AdminRoute>
                          <ProjectAnalysisDetailPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/applications/:applicationId"
                      element={
                        <AdminRoute>
                          <ApplicationSubmissionDetailPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/clients"
                      element={
                        <AdminRoute>
                          <ClientsPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/clients/projects/new"
                      element={
                        <AdminRoute>
                          <ProjectFormPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/clients/projects/:id/edit"
                      element={
                        <AdminRoute>
                          <ProjectFormPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/updates"
                      element={
                        <ProtectedRoute>
                          <UpdatesPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/profile/edit"
                      element={
                        <ProtectedRoute>
                          <EditProfilePage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/feedback"
                      element={
                        <ProtectedRoute>
                          <FeedbackPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/settings/notifications"
                      element={
                        <ProtectedRoute>
                          <NotificationSettingsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="/accessibility" element={<AccessibilityPage />} />
                    <Route path="/privacy" element={<PrivacyPage />} />
                    <Route path="/cookies" element={<CookiesPage />} />
                    <Route path="/terms" element={<TermsPage />} />
                    <Route path="/terms-of-use" element={<TermsOfUsePage />} />
                    <Route path="/code-of-conduct" element={<CodeOfConductPage />} />
                    <Route path="/privacy/dsar" element={<DsarSubmitPage />} />
                    <Route
                      path="/admin/feedback"
                      element={
                        <AdminRoute>
                          <FeedbackPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/roster"
                      element={
                        <AdminRoute>
                          <AdminRosterPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/banners"
                      element={
                        <AdminRoute>
                          <BannerManagementPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/system-health"
                      element={
                        <AdminRoute>
                          <SystemHealthPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/email-deliverability-test"
                      element={
                        <AdminRoute>
                          <AdminEmailDeliverabilityTestPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/brand-tokens"
                      element={
                        <AdminRoute>
                          <BrandTokensPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/roster/project/:projectId"
                      element={
                        <AdminRoute>
                          <RosterProjectDetailPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/admin/roster/project/:projectId/applicant/:applicationId"
                      element={
                        <AdminRoute>
                          <RosterApplicantDetailPage />
                        </AdminRoute>
                      }
                    />
                    <Route path="/confirm-admin" element={<ConfirmAdminPage />} />
                    <Route path="/confirm-teacher" element={<ConfirmTeacherPage />} />
                    <Route
                      path="/teach/classes"
                      element={
                        <TeacherRoute>
                          <MyClassesPage />
                        </TeacherRoute>
                      }
                    />
                    <Route
                      path="/teach/classes/new"
                      element={
                        <TeacherRoute>
                          <ClassFormPage />
                        </TeacherRoute>
                      }
                    />
                    <Route
                      path="/teach/classes/:id"
                      element={
                        <TeacherRoute>
                          <ClassDetailPage />
                        </TeacherRoute>
                      }
                    />
                    <Route
                      path="/teach/classes/:id/edit"
                      element={
                        <TeacherRoute>
                          <ClassFormPage />
                        </TeacherRoute>
                      }
                    />
                    <Route
                      path="/teach/classes/:id/cohorts/new"
                      element={
                        <TeacherRoute>
                          <CohortFormPage />
                        </TeacherRoute>
                      }
                    />
                    <Route
                      path="/teach/classes/:id/cohorts/:cohortId/edit"
                      element={
                        <TeacherRoute>
                          <CohortFormPage />
                        </TeacherRoute>
                      }
                    />
                    <Route
                      path="/admin/classes"
                      element={
                        <AdminRoute>
                          <AdminClassesPage />
                        </AdminRoute>
                      }
                    />
                    <Route
                      path="/profile/notifications"
                      element={
                        <ProtectedRoute>
                          <NotificationsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="/unsubscribe" element={<UnsubscribePage />} />
                    <Route
                      path="/access-denied"
                      element={
                        <ProtectedRoute>
                          <AccessDeniedPage />
                        </ProtectedRoute>
                      }
                    />
                    {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </AppLayout>
            </ErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryRoot>
);

export default App;
