/**
 * Install App Card
 *
 * Shown in Profile → Preferences to let users install the PWA
 * on their current device. Handles three states:
 * - Already installed (standalone mode)
 * - Android/desktop (beforeinstallprompt API)
 * - iOS (manual Add to Home Screen guide)
 */

import { useState, useEffect, useCallback } from "react";
import { Download, Share, Monitor, Smartphone, CheckCircle2 } from "lucide-react";
import { Button, Label } from "@/design-system";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !("standalone" in navigator);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone)
  );
}

function getDeviceLabel() {
  if (/iphone|ipad|ipod|android/i.test(navigator.userAgent)) return "device";
  return "computer";
}

export function InstallAppCard() {
  const [installed, setInstalled] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const ios = isIos();

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Detect install after prompt accepted
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const displayHandler = (e: MediaQueryListEvent) => {
      if (e.matches) setInstalled(true);
    };
    mediaQuery.addEventListener("change", displayHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      mediaQuery.removeEventListener("change", displayHandler);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setInstalled(true);
      }
      setDeferredPrompt(null);
    } finally {
      setInstalling(false);
    }
  }, [deferredPrompt]);

  const DeviceIcon = /iphone|ipad|ipod|android/i.test(navigator.userAgent) ? Smartphone : Monitor;

  // Already installed
  if (installed) {
    return (
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-4 w-4 mt-1 text-emerald-500" aria-hidden="true" />
        <div>
          <Label className="text-sm leading-relaxed">App installed</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tech Fleet Network is installed on this {getDeviceLabel()}. You're getting the best
            experience!
          </p>
        </div>
      </div>
    );
  }

  // iOS — manual guide
  if (ios) {
    return (
      <div className="flex items-start gap-3">
        <Smartphone className="h-4 w-4 mt-1 text-muted-foreground" aria-hidden="true" />
        <div className="flex-1">
          <Label className="text-sm leading-relaxed">Install as an app</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add Tech Fleet Network to your Home Screen for quick access, offline support, and a
            native app experience.
          </p>
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <Share className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
            <span>
              Tap the <strong className="text-foreground">Share</strong> button in Safari, then
              select <strong className="text-foreground">Add to Home Screen</strong>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Android / Desktop — install prompt available
  return (
    <div className="flex items-start gap-3">
      <DeviceIcon className="h-4 w-4 mt-1 text-muted-foreground" aria-hidden="true" />
      <div className="flex-1">
        <Label className="text-sm leading-relaxed">Install as an app</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Install Tech Fleet Network on your {getDeviceLabel()} for quick access, offline support,
          and a native app experience.
        </p>
        <Button
          variant="default"
          size="sm"
          className="mt-2"
          onClick={handleInstall}
          disabled={!deferredPrompt || installing}
          aria-label="Install Tech Fleet Network app"
        >
          {installing ? "Installing…" : deferredPrompt ? "Install App" : "Install via Browser Menu"}
        </Button>
        {!deferredPrompt && (
          <p className="text-xs text-muted-foreground mt-1.5">
            Use your browser's menu → <strong className="text-foreground">Install app</strong> or{" "}
            <strong className="text-foreground">Add to Home Screen</strong> to install.
          </p>
        )}
      </div>
    </div>
  );
}
