import { useState, Fragment, Suspense } from "react";
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Menu,
  X,
  BookOpen,
  GraduationCap,
  LayoutDashboard,
  LogIn,
  LogOut,
  UserPen,
  Bot,
  CalendarDays,
  Megaphone,
  ClipboardList,
  Handshake,
  Map,
  MessageSquarePlus,
  ShieldCheck,
  Activity,
  Building2,
  Users,
  Settings,
  KeyRound,
  Flag,
  Sparkles,
  HeartPulse,
  Bell,
} from "lucide-react";
import { Button } from "./ui/button";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";

import { ProfileSetupDialog } from "./ProfileSetupDialog";
import { MfaEnforcementGuard } from "./MfaEnforcementGuard";
import { LiveAnnouncer, useRouteAnnouncer } from "./LiveAnnouncer";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/hooks/use-admin";
import { PageHeaderProvider, usePageHeader } from "@/contexts/PageHeaderContext";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAnnouncementRealtime } from "@/hooks/use-announcement-realtime";
import { useNotificationRealtime } from "@/hooks/use-notifications";
import { useProjectApplicationsRealtime } from "@/hooks/use-project-applications-realtime";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";
import { UniversalSearch } from "./UniversalSearch";
import { NotificationBell } from "./NotificationBell";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { CookieConsentBanner } from "./CookieConsentBanner";
import { UpdateAvailableBanner } from "./UpdateAvailableBanner";
import { ShortcutCheatsheet } from "./ShortcutCheatsheet";
import { PrivacyFooterLinks } from "./PrivacyFooterLinks";
import { AppFooter } from "./AppFooter";
// Heavy chat widget — lazy-loaded and skipped on save-data / 2g connections
const FleetyChatWidget = lazy(() =>
  import("./FleetyChatWidget").then((m) => ({ default: m.FleetyChatWidget }))
);

import { useNetworkQuality } from "@/hooks/use-network-quality";
import { AdminTwoFactorGraceDialog } from "./AdminTwoFactorGraceDialog";
import type { Profile } from "@/services/profile.service";
import type { User } from "@supabase/supabase-js";

function ProfileDropdown({
  profile,
  user,
  onSignOut,
}: {
  profile: Profile | null;
  user: User | null;
  onSignOut: () => void;
}) {
  const navigate = useNavigate();
  const avatarInitials = profile
    ? `${(profile.first_name?.[0] || "").toUpperCase()}${(profile.last_name?.[0] || "").toUpperCase()}` ||
      "U"
    : (user?.user_metadata?.full_name?.[0] || "U").toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Account menu"
        >
          <Avatar className="h-8 w-8 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all">
            <AvatarImage src={profile?.avatar_url || undefined} alt="Profile" />
            <AvatarFallback className="text-xs">{avatarInitials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium truncate">
            {profile?.first_name || profile?.display_name || "Profile"}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {profile?.email || user?.email || ""}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/profile/edit?tab=basic-info")}>
          <UserPen className="h-4 w-4 mr-2" />
          Basic Info
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/profile/edit?tab=background")}>
          <GraduationCap className="h-4 w-4 mr-2" />
          Background
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/profile/edit?tab=preferences")}>
          <Settings className="h-4 w-4 mr-2" />
          Preferences
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/profile/edit?tab=account")}>
          <KeyRound className="h-4 w-4 mr-2" />
          Account
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/profile/edit?tab=membership")}>
          <Sparkles className="h-4 w-4 mr-2" />
          Membership
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/settings/notifications")}>
          <Bell className="h-4 w-4 mr-2" />
          Notification preferences
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSignOut}>
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Desktop header with optional page context ────────── */
function DesktopHeader({
  profile,
  user,
  onSignOut,
}: {
  profile: Profile | null;
  user: User | null;
  onSignOut: () => void;
}) {
  const { header } = usePageHeader();

  return (
    <header
      className="sticky top-0 z-40 flex items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 sm:px-6 lg:px-12 pt-safe pl-safe pr-safe"
      role="banner"
      style={{ minHeight: header ? undefined : "3rem" }}
    >
      {/* Left: page context */}
      {header ? (
        <div className="flex flex-col justify-center py-1.5 pl-2 lg:pl-9 min-w-0 mr-4">
          {header.breadcrumbs && header.breadcrumbs.length > 0 && (
            <Breadcrumb>
              <BreadcrumbList className="text-xs">
                {header.breadcrumbs.map((crumb, i) => (
                  <Fragment key={i}>
                    {i > 0 && <BreadcrumbSeparator />}
                    <BreadcrumbItem>
                      {crumb.href ? (
                        <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          )}
          <div className="flex items-center gap-2">
            {header.title && (
              <h1 className="text-sm font-semibold text-foreground truncate">{header.title}</h1>
            )}
            {header.description && (
              <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                — {header.description}
              </span>
            )}
            {header.badge && <div className="shrink-0">{header.badge}</div>}
          </div>
        </div>
      ) : (
        <div />
      )}

      {/* Right: controls */}
      <div className="flex items-center gap-2 lg:gap-3 shrink-0 px-2 lg:px-9 py-3" data-no-card>
        <UniversalSearch />
        <ThemeToggle />
        <LanguageSwitcher />
        <NotificationBell />
        <div className="ml-1">
          <ProfileDropdown profile={profile} user={user} onSignOut={onSignOut} />
        </div>
      </div>
    </header>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
}

const mobileNavLinks = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "Announcements", href: "/updates", icon: Megaphone },
  { label: "Applications", href: "/applications", icon: ClipboardList },
  { label: "Courses", href: "/courses", icon: GraduationCap },
  { label: "Events", href: "/events", icon: CalendarDays },
  { label: "Feedback", href: "/feedback", icon: MessageSquarePlus },
  { label: "TAL 9000", href: "/tal-9000", icon: Bot },
  { label: "My Journey", href: "/my-journey", icon: Map },
  { label: "Project Openings", href: "/project-openings", icon: Handshake },
  { label: "Resources", href: "/resources", icon: BookOpen },
];

const mobileAdminLinks = [
  { label: "Activity Log", href: "/admin/activity-log", icon: Activity },
  { label: "Banners", href: "/admin/banners", icon: Flag },
  { label: "Clients & Projects", href: "/admin/clients", icon: Building2 },
  { label: "Recruiting Center", href: "/admin/roster", icon: Users },
  { label: "System Health", href: "/admin/system-health", icon: HeartPulse },
  { label: "User Admin", href: "/admin/users", icon: ShieldCheck },
];

export function AppLayout({ children }: AppLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, loading, signOut } = useAuth();
  const { isAdmin } = useAdmin();
  const isMobile = useIsMobile();
  const { isSlow } = useNetworkQuality();
  const fleetyWidget = isSlow ? null : (
    <Suspense fallback={null}>
      <FleetyChatWidget />
    </Suspense>
  );
  useAnnouncementRealtime();
  useNotificationRealtime();
  useProjectApplicationsRealtime();
  useRouteAnnouncer();

  const isActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(href + "/");

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
    setMobileMenuOpen(false);
  };

  // TAL 9000 "Future Mode" — full-screen terminal takeover: no header, sidebar,
  // footer, or floating widget. Auth guards (MFA / profile / 2FA grace) are kept so
  // the takeover never weakens security. Classic mode (/tal-9000 with no ?mode=future)
  // keeps normal chrome and falls through to the authenticated layout below.
  const isTalFullscreen =
    !!user &&
    location.pathname === "/tal-9000" &&
    new URLSearchParams(location.search).get("mode") === "future";

  if (isTalFullscreen) {
    return (
      <PageHeaderProvider>
        <div className="min-h-dvh bg-background text-foreground">
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>
          <main id="main-content" role="main" tabIndex={-1}>
            {children}
          </main>
          <ProfileSetupDialog />
          <MfaEnforcementGuard />
          <AdminTwoFactorGraceDialog />
          <LiveAnnouncer />
        </div>
      </PageHeaderProvider>
    );
  }

  // Public pages (no sidebar)
  const isPublicPage =
    !user ||
    [
      "/",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/reset-password/confirm",
    ].includes(location.pathname);

  if (isPublicPage) {
    return (
      <div className="min-h-dvh flex flex-col bg-background text-foreground">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <header
          className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-safe pl-safe pr-safe"
          role="banner"
        >
          <nav
            className="container-app flex h-16 items-center justify-between"
            aria-label="Main navigation"
          >
            <a
              href="https://techfleet.org"
              className="flex items-center gap-2 font-bold text-lg"
              aria-label="Tech Fleet Home"
            >
              <img
                src={techFleetLogo}
                alt="Tech Fleet"
                className="h-8 w-8 dark:invert"
                width={32}
                height={32}
              />
            </a>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageSwitcher />
              {!loading && !user && (
                <Link to="/login">
                  <Button variant="outline" size="sm">
                    Connect
                  </Button>
                </Link>
              )}
            </div>
          </nav>
        </header>
        <main id="main-content" className="flex-1" role="main" tabIndex={-1}>
          {children}
        </main>
        <ProfileSetupDialog />
        <LiveAnnouncer />
        <CookieConsentBanner />
        <UpdateAvailableBanner />
        <ShortcutCheatsheet />
        <AppFooter />
      </div>
    );
  }

  // Authenticated: sidebar on desktop, hamburger on mobile
  const authenticatedLayout = isMobile ? (
    <div className="min-h-dvh flex flex-col bg-background text-foreground">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header
        className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 pt-safe pl-safe pr-safe"
        role="banner"
      >
        <nav
          className="container-app flex h-14 items-center justify-between"
          aria-label="Main navigation"
        >
          <Link
            to="/dashboard"
            className="flex min-w-0 items-center gap-2 font-bold text-base"
            aria-label="Tech Fleet Home"
          >
            <img
              src={techFleetLogo}
              alt="Tech Fleet"
              className="h-7 w-7 dark:invert"
              width={28}
              height={28}
            />
            <span className="truncate min-[360px]:inline hidden" data-no-translate>
              Tech Fleet
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <UniversalSearch />
            <ThemeToggle />
            <LanguageSwitcher />
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </nav>
        {mobileMenuOpen && (
          <div
            id="mobile-menu"
            className="border-t animate-fade-in max-h-[calc(100dvh-4rem)] overflow-y-auto"
            role="menu"
          >
            <div className="container-app py-4 space-y-1">
              {mobileNavLinks.map(({ label, href, icon: Icon }) => (
                <Link
                  key={href}
                  to={href}
                  className={`flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors ${
                    isActive(href)
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={isActive(href) ? "page" : undefined}
                  role="menuitem"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
              {isAdmin && (
                <>
                  <div className="pt-3 border-t">
                    <p className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Admin
                    </p>
                  </div>
                  {mobileAdminLinks.map(({ label, href, icon: Icon }) => (
                    <Link
                      key={href}
                      to={href}
                      className={`flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium transition-colors ${
                        isActive(href)
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      }`}
                      onClick={() => setMobileMenuOpen(false)}
                      aria-current={isActive(href) ? "page" : undefined}
                      role="menuitem"
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Link>
                  ))}
                </>
              )}
              <div className="pt-3 border-t space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    navigate("/profile/edit?tab=basic-info");
                    setMobileMenuOpen(false);
                  }}
                >
                  <UserPen className="h-4 w-4 mr-2" />
                  Basic Info
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    navigate("/profile/edit?tab=preferences");
                    setMobileMenuOpen(false);
                  }}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Preferences
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    navigate("/profile/edit?tab=account");
                    setMobileMenuOpen(false);
                  }}
                >
                  <KeyRound className="h-4 w-4 mr-2" />
                  Account
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={handleSignOut}>
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        )}
      </header>
      <AnnouncementBanner />
      <main id="main-content" className="flex-1" role="main" tabIndex={-1}>
        {children}
      </main>
      <AppFooter />
      <ProfileSetupDialog />
      <MfaEnforcementGuard />
      <LiveAnnouncer />
      <CookieConsentBanner />
      <UpdateAvailableBanner />
      <AdminTwoFactorGraceDialog />
      <ShortcutCheatsheet />
      <Suspense fallback={null}>
        <FleetyChatWidget />
      </Suspense>
    </div>
  ) : (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-dvh flex w-full bg-background text-foreground">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <DesktopHeader profile={profile} user={user} onSignOut={handleSignOut} />
          <AnnouncementBanner />
          <main id="main-content" className="flex-1" role="main" tabIndex={-1}>
            {children}
          </main>
          <AppFooter />
        </div>
      </div>
      <ProfileSetupDialog />
      <MfaEnforcementGuard />
      <LiveAnnouncer />
      <CookieConsentBanner />
      <UpdateAvailableBanner />
      <AdminTwoFactorGraceDialog />
      <Suspense fallback={null}>
        <FleetyChatWidget />
      </Suspense>
      <ShortcutCheatsheet />
    </SidebarProvider>
  );

  return <PageHeaderProvider>{authenticatedLayout}</PageHeaderProvider>;
}
