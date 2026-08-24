import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  HelpCircle,
  ExternalLink,
  Monitor,
  Smartphone,
} from "lucide-react";
import { Button } from "@/design-system";

import desktopImg from "@/assets/discord-username-desktop.jpg";
import mobileImg from "@/assets/discord-username-mobile.jpg";
import settingsImg from "@/assets/discord-username-settings.jpg";

/**
 * Collapsible tutorial explaining how to find your Discord username.
 * Designed for the Connect Discord page to help users who don't know their username.
 *
 * Source: https://support.discord.com/hc/en-us/articles/12620128861463
 */
export default function DiscordUsernameTutorial() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"desktop" | "mobile">("desktop");

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        aria-expanded={open}
        aria-controls="discord-username-tutorial"
      >
        <HelpCircle className="h-5 w-5 text-primary flex-shrink-0" />
        <span className="flex-1 text-sm font-medium text-foreground">
          Not sure what your Discord username is?
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {open && (
        <div id="discord-username-tutorial" className="border-t px-4 pb-5 pt-4 space-y-5">
          {/* Intro */}
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Discord has two identity fields: <strong className="text-foreground">Username</strong>{" "}
              (your unique handle, e.g.{" "}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">johndoe</code>) and{" "}
              <strong className="text-foreground">Display Name</strong> (what others see in chat,
              e.g. "John Doe"). You can search with either one here.
            </p>
          </div>

          {/* Tab switcher */}
          <div
            className="flex gap-1 rounded-lg bg-muted p-1"
            role="tablist"
            aria-label="Platform instructions"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "desktop"}
              onClick={() => setActiveTab("desktop")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "desktop"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              Desktop / Web
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "mobile"}
              onClick={() => setActiveTab("mobile")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "mobile"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" />
              Mobile
            </button>
          </div>

          {/* Desktop instructions */}
          {activeTab === "desktop" && (
            <div className="space-y-4">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Option 1: Quick Look — Bottom Left Corner
                </h3>
                <p className="text-sm text-muted-foreground">
                  Your username appears at the{" "}
                  <strong className="text-foreground">bottom-left</strong> of the Discord window,
                  right next to your avatar.
                </p>
                <div className="rounded-lg border overflow-hidden bg-muted/30">
                  <img
                    src={desktopImg}
                    alt="Discord desktop app showing username 'johndoe' highlighted at the bottom-left corner next to the user avatar and settings gear icon"
                    className="w-full max-w-md mx-auto"
                    loading="lazy"
                    width={800}
                    height={512}
                  />
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Option 2: Settings → My Account
                </h3>
                <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
                  <li>
                    Click the <strong className="text-foreground">gear icon ⚙️</strong> at the
                    bottom-left (next to your username).
                  </li>
                  <li>
                    Select <strong className="text-foreground">"My Account"</strong> from the left
                    sidebar.
                  </li>
                  <li>
                    Your <strong className="text-foreground">username</strong> is shown under your
                    profile card — it's the one <em>without</em> spaces or special characters.
                  </li>
                </ol>
                <div className="rounded-lg border overflow-hidden bg-muted/30">
                  <img
                    src={settingsImg}
                    alt="Discord Settings page showing the 'My Account' section with username 'johndoe' highlighted under the profile card, alongside the display name 'John Doe'"
                    className="w-full max-w-md mx-auto"
                    loading="lazy"
                    width={800}
                    height={512}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Mobile instructions */}
          {activeTab === "mobile" && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">On the Discord Mobile App</h3>
              <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
                <li>
                  Tap your <strong className="text-foreground">avatar</strong> or the{" "}
                  <strong className="text-foreground">profile icon</strong> at the bottom-right of
                  the screen.
                </li>
                <li>
                  Tap the <strong className="text-foreground">gear icon ⚙️</strong> to open
                  Settings.
                </li>
                <li>
                  Go to <strong className="text-foreground">"My Account"</strong>.
                </li>
                <li>
                  Your <strong className="text-foreground">username</strong> is listed right under
                  your profile picture.
                </li>
              </ol>
              <div className="rounded-lg border overflow-hidden bg-muted/30 max-w-xs mx-auto">
                <img
                  src={mobileImg}
                  alt="Discord mobile app My Account settings screen showing username 'johndoe' highlighted under the profile picture"
                  className="w-full"
                  loading="lazy"
                  width={512}
                  height={800}
                />
              </div>
            </div>
          )}

          {/* Key difference callout */}
          <div className="rounded-md bg-primary/5 border border-primary/20 p-3 space-y-1.5">
            <p className="text-xs font-semibold text-foreground">
              💡 Username vs Display Name — What's the Difference?
            </p>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>
                <strong className="text-foreground">Username</strong> — Your unique identifier
                (lowercase, no spaces). Example:{" "}
                <code className="bg-muted px-1 py-0.5 rounded">johndoe</code>
              </li>
              <li>
                <strong className="text-foreground">Display Name</strong> — What others see in chat
                (can have spaces &amp; capitals). Example: "John Doe"
              </li>
              <li>
                <strong className="text-foreground">Server Nickname</strong> — A custom name set for
                a specific server.
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              You can search with <strong className="text-foreground">any of these</strong> and
              we'll find you. If there's no exact match, we'll show you similar members to choose
              from.
            </p>
          </div>

          {/* Link to Discord docs */}
          <div className="pt-1">
            <a
              href="https://support.discord.com/hc/en-us/articles/12620128861463"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Learn more about Discord usernames &amp; display names
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
