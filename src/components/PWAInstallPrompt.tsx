import { useState, useEffect, useCallback } from "react";
import { X, Download, Share } from "lucide-react";
import { Button } from "@/design-system";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "pwa-install-dismissed";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !("standalone" in navigator);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone)
  );
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // Don't show if already installed
    if (isStandalone()) return;

    // Don't show if recently dismissed
    const dismissedAt = localStorage.getItem(DISMISSED_KEY);
    if (dismissedAt && Date.now() - Number(dismissedAt) < DISMISS_DURATION_MS) return;

    // iOS doesn't fire beforeinstallprompt — show manual guide
    if (isIos()) {
      const timer = setTimeout(() => setShowIosGuide(true), 3000);
      return () => clearTimeout(timer);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setShowBanner(false);
    setShowIosGuide(false);
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  }, []);

  if (!showBanner && !showIosGuide) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Tech Fleet Network"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-4 duration-300"
    >
      <div className="rounded-xl border border-border bg-card p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 rounded-lg bg-primary/10 p-2">
            <img src="/tech-fleet-logo.svg" alt="" className="h-8 w-8" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Install Tech Fleet Network</h3>
              <button
                onClick={handleDismiss}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                aria-label="Dismiss install prompt"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {showIosGuide
                ? "Add this app to your Home Screen for the best experience."
                : "Get quick access, offline support, and a native app experience."}
            </p>

            <div className="mt-3">
              {showIosGuide ? (
                <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  <Share className="h-4 w-4 flex-shrink-0 text-primary" />
                  <span>
                    Tap <strong className="text-foreground">Share</strong> then{" "}
                    <strong className="text-foreground">Add to Home Screen</strong>
                  </span>
                </div>
              ) : (
                <Button size="sm" onClick={handleInstall} className="gap-1.5 text-xs">
                  <Download className="h-3.5 w-3.5" />
                  Install App
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
