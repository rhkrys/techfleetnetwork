import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@/lib/react-query";
import { ThemeProvider } from "@/components/ThemeProvider";
import { HelmetProvider } from "react-helmet-async";

// Minimal wrapper for components that need Router + React Query context.
// ThemeProvider is included because production always mounts one at the app
// root (App.tsx); components that reach useTheme() — LandingPage, the Sonner
// toaster, ThemeToggle in shared layout — otherwise throw "useTheme must be
// used within ThemeProvider". A nested ThemeProvider (some tests add their own)
// is harmless: useTheme resolves the nearest one.
function RouterWrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <HelmetProvider>
        <ThemeProvider defaultTheme="dark">
          <MemoryRouter>{children}</MemoryRouter>
        </ThemeProvider>
      </HelmetProvider>
    </QueryClientProvider>
  );
}

export function renderWithRouter(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: RouterWrapper, ...options });
}

// Mock AuthContext values
export const mockAuthLoggedOut = {
  user: null,
  session: null,
  profile: null,
  loading: false,
  profileLoaded: true,
  signOut: vi.fn(),
  signOutAllDevices: vi.fn(),
  refreshProfile: vi.fn(),
};

export const mockAuthLoggedIn = {
  user: {
    id: "test-user-id",
    email: "test@example.com",
    user_metadata: { full_name: "Test User" },
  } as any,
  session: {} as any,
  profile: {
    id: "profile-id",
    user_id: "test-user-id",
    first_name: "Test",
    last_name: "User",
    display_name: "Test User",
    email: "test@example.com",
    country: "United States",
    discord_username: "testuser",
    discord_user_id: "",
    bio: "",
    professional_background: "",
    interests: [],
    profile_completed: true,
    avatar_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  loading: false,
  profileLoaded: true,
  signOut: vi.fn(),
  signOutAllDevices: vi.fn(),
  refreshProfile: vi.fn(),
};
