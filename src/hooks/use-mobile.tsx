import * as React from "react";

/**
 * Layout-chrome breakpoint.
 *
 * `useIsMobile` returns `true` for anything narrower than 1024px so that
 * tablets (iPad portrait 810/820/834, Android tablets, small laptops in
 * split-screen) get the same off-canvas Sheet navigation that phones use,
 * instead of being squeezed by the 256px persistent sidebar.
 *
 * 1024 = Tailwind `lg:` breakpoint, the same threshold the sidebar now uses
 * to switch from Sheet to persistent rail.
 */
const MOBILE_BREAKPOINT = 1024;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * Three-tier breakpoint hook for components that need to distinguish tablet
 * from phone. Use sparingly — prefer Tailwind responsive classes.
 */
export type Breakpoint = "mobile" | "tablet" | "desktop";

const TABLET_MIN = 768;
const DESKTOP_MIN = 1024;

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = React.useState<Breakpoint>(() => {
    if (typeof window === "undefined") return "desktop";
    const w = window.innerWidth;
    if (w < TABLET_MIN) return "mobile";
    if (w < DESKTOP_MIN) return "tablet";
    return "desktop";
  });

  React.useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setBp(w < TABLET_MIN ? "mobile" : w < DESKTOP_MIN ? "tablet" : "desktop");
    };
    window.addEventListener("resize", onResize, { passive: true });
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return bp;
}
