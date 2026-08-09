import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/services/logger.service";
import { discordBreaker } from "@/lib/circuit-breaker";

const log = createLogger("DiscordNotifyService");

export const DISCORD_MEMBER_NOT_VISIBLE_MESSAGE =
  "That Discord account is no longer visible in the Tech Fleet server. Please join the server, then search again.";

const parseFunctionPayload = (rawData: unknown) => {
  if (typeof rawData !== "string") return rawData as any;
  try {
    return JSON.parse(rawData);
  } catch {
    return rawData;
  }
};

const normalizeDiscordVerificationError = (message?: string | null) => {
  const text = message || "Discord verification failed. Please try again.";
  if (/no longer visible|not in the Tech Fleet server|not in server|non-member/i.test(text)) {
    return DISCORD_MEMBER_NOT_VISIBLE_MESSAGE;
  }
  return text;
};

const readFunctionErrorMessage = async (rawData: unknown, error: unknown) => {
  const data = parseFunctionPayload(rawData);
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.message === "string") return data.message;

  const context = (error as { context?: unknown } | null)?.context;
  if (context && typeof (context as Response).clone === "function") {
    const response = context as Response;
    try {
      const payload = await response.clone().json();
      if (typeof payload?.error === "string") return payload.error;
      if (typeof payload?.message === "string") return payload.message;
    } catch {
      try {
        const text = await response.clone().text();
        if (text) return text;
      } catch {
        // Fall through to generic error handling below.
      }
    }
  }

  return error instanceof Error ? error.message : null;
};

interface NotifyPayload {
  event:
    | "user_signed_up"
    | "profile_completed"
    | "task_completed"
    | "phase_completed"
    | "class_registered"
    | "application_submitted"
    | "project_applied"
    | "feedback_submitted"
    | "resource_explored"
    | "discord_verified";
  display_name?: string;
  discord_username?: string;
  discord_user_id?: string;
  task_name?: string;
  phase_name?: string;
  class_name?: string;
  country?: string;
  project_name?: string;
  application_type?: string;
  feedback_area?: string;
  search_query?: string;
}

/** Fire-and-forget Discord notification — never throws */
async function notify(payload: NotifyPayload) {
  try {
    log.info("notify", `Sending Discord notification: ${payload.event}`, {
      event: payload.event,
      displayName: payload.display_name,
      discordUsername: payload.discord_username,
    });

    const { data, error } = await discordBreaker.executeWithFallback(
      () => supabase.functions.invoke("discord-notify", { body: payload }),
      { data: { success: false, reason: "circuit_open" }, error: null }
    );

    if (error) {
      throw error;
    }

    if (data?.success === false) {
      log.warn(
        "notify",
        `Discord notification skipped for event "${payload.event}" — non-critical`,
        {
          event: payload.event,
          displayName: payload.display_name,
          reason: data?.reason,
          status: data?.status,
        }
      );
      return;
    }

    log.info("notify", `Discord notification sent successfully: ${payload.event}`, {
      event: payload.event,
    });
  } catch (err) {
    log.warn(
      "notify",
      `Failed to send Discord notification for event "${payload.event}" — non-critical, continuing`,
      {
        event: payload.event,
        displayName: payload.display_name,
      },
      err
    );
  }
}

const TASK_LABELS: Record<string, string> = {
  profile: "Set Up Profile",
  "onboarding-class": "Complete Onboarding Class",
  "service-leadership": "Sign Up for Service Leadership Class",

  "figma-account": "Register for Figma Educational Account",
  "community-agreement": "Agree to the Community Member Agreement",
  "privacy-policy": "Agree to the Privacy Policy",
  "terms-conditions": "Agree to the Terms & Conditions",
  "terms-of-use": "Agree to the Terms of Use",
  "cookie-policy": "Acknowledge the Cookie Policy",
};

const PHASE_LABELS: Record<string, string> = {
  first_steps: "Onboarding Steps",
  second_steps: "Build an Agile Mindset",
  third_steps: "Agile Cross-Functional Team Dynamics",
  observer: "Observe Project Teams",
  projects: "Apply for Projects",
};

export const DiscordNotifyService = {
  userSignedUp(displayName: string, discordUsername?: string, discordUserId?: string) {
    log.info("userSignedUp", `New user signed up: ${displayName}`, {
      displayName,
      discordUsername,
    });
    notify({
      event: "user_signed_up",
      display_name: displayName,
      discord_username: discordUsername,
      discord_user_id: discordUserId,
    });
  },

  profileCompleted(
    displayName: string,
    country?: string,
    discordUsername?: string,
    discordUserId?: string
  ) {
    log.info("profileCompleted", `Profile completed by ${displayName}`, {
      displayName,
      country,
      discordUsername,
    });
    notify({
      event: "profile_completed",
      display_name: displayName,
      country,
      discord_username: discordUsername,
      discord_user_id: discordUserId,
    });
  },

  taskCompleted(
    displayName: string,
    taskId: string,
    discordUsername?: string,
    discordUserId?: string
  ) {
    const taskName = TASK_LABELS[taskId] || taskId;
    log.info("taskCompleted", `Task "${taskName}" completed by ${displayName}`, {
      displayName,
      taskId,
      taskName,
      discordUsername,
    });
    notify({
      event: "task_completed",
      display_name: displayName,
      task_name: taskName,
      discord_username: discordUsername,
      discord_user_id: discordUserId,
    });
  },

  phaseCompleted(
    displayName: string,
    phase: string,
    discordUsername?: string,
    discordUserId?: string
  ) {
    const phaseName = PHASE_LABELS[phase] || phase;
    log.info("phaseCompleted", `Phase "${phaseName}" completed by ${displayName}`, {
      displayName,
      phase,
      phaseName,
      discordUsername,
    });
    notify({
      event: "phase_completed",
      display_name: displayName,
      phase_name: phaseName,
      discord_username: discordUsername,
      discord_user_id: discordUserId,
    });
  },

  classRegistered(
    displayName: string,
    className: string,
    discordUsername?: string,
    discordUserId?: string
  ) {
    log.info("classRegistered", `Class "${className}" registered by ${displayName}`, {
      displayName,
      className,
      discordUsername,
    });
    notify({
      event: "class_registered",
      display_name: displayName,
      class_name: className,
      discord_username: discordUsername,
      discord_user_id: discordUserId,
    });
  },

  applicationSubmitted(
    displayName: string,
    applicationType: string,
    discordUsername?: string,
    discordUserId?: string
  ) {
    log.info("applicationSubmitted", `${applicationType} application submitted by ${displayName}`, {
      displayName,
      applicationType,
      discordUsername,
    });
    notify({
      event: "application_submitted",
      display_name: displayName,
      application_type: applicationType,
      discord_username: discordUsername,
      discord_user_id: discordUserId,
    });
  },

  projectApplied(
    displayName: string,
    projectName: string,
    discordUsername?: string,
    discordUserId?: string
  ) {
    log.info(
      "projectApplied",
      `Project application submitted by ${displayName} for "${projectName}"`,
      { displayName, projectName, discordUsername }
    );
    notify({
      event: "project_applied",
      display_name: displayName,
      project_name: projectName,
      discord_username: discordUsername,
      discord_user_id: discordUserId,
    });
  },

  feedbackSubmitted(
    displayName: string,
    feedbackArea: string,
    discordUsername?: string,
    discordUserId?: string
  ) {
    log.info("feedbackSubmitted", `Feedback submitted by ${displayName} about "${feedbackArea}"`, {
      displayName,
      feedbackArea,
      discordUsername,
    });
    notify({
      event: "feedback_submitted",
      display_name: displayName,
      feedback_area: feedbackArea,
      discord_username: discordUsername,
      discord_user_id: discordUserId,
    });
  },

  resourceExplored(
    displayName: string,
    searchQuery: string,
    discordUsername?: string,
    discordUserId?: string
  ) {
    log.info("resourceExplored", `Resources explored by ${displayName}: "${searchQuery}"`, {
      displayName,
      searchQuery,
      discordUsername,
    });
    notify({
      event: "resource_explored",
      display_name: displayName,
      search_query: searchQuery,
      discord_username: discordUsername,
      discord_user_id: discordUserId,
    });
  },

  discordVerified(displayName: string, discordUsername: string, discordUserId: string) {
    log.info("discordVerified", `Discord verified by ${displayName}`, {
      displayName,
      discordUsername,
      discordUserId,
    });
    notify({
      event: "discord_verified",
      display_name: displayName,
      discord_username: discordUsername,
      discord_user_id: discordUserId,
    });
  },

  async resolveDiscordId(discordUsername: string): Promise<{
    discord_user_id: string | null;
    discord_username?: string | null;
    avatar_url?: string | null;
    candidates?: Array<{
      id: string;
      username: string;
      display_name?: string | null;
      global_name: string | null;
      nick: string | null;
      avatar: string | null;
    }>;
    message?: string;
  }> {
    return log.track(
      "resolveDiscordId",
      `Resolving Discord ID for "${discordUsername}"`,
      { discordUsername },
      async () => {
        try {
          // This is an account-linking verification path, not a non-critical Discord notification.
          // Do not route it through the shared Discord circuit breaker: notification outages can open
          // that browser-local breaker and make real members look like "not found" without contacting
          // the verification backend.
          const { data: rawData, error } = await supabase.functions.invoke("resolve-discord-id", {
            body: { discord_username: discordUsername },
          });

          // supabase.functions.invoke may return parsed JSON or a raw string
          const data = parseFunctionPayload(rawData);

          if (error) {
            const backendMessage = await readFunctionErrorMessage(rawData, error);
            log.warn(
              "resolveDiscordId",
              `Edge function error for "${discordUsername}": ${backendMessage || error.message}`,
              { discordUsername }
            );
            throw new Error(
              normalizeDiscordVerificationError(
                backendMessage ||
                  error.message ||
                  "Discord verification is temporarily unavailable. Please try again in a minute."
              )
            );
          }

          if (data?.error) {
            throw new Error(normalizeDiscordVerificationError(data.error));
          }

          const result = data?.discord_user_id || null;
          const candidates = Array.isArray(data?.candidates) ? data.candidates : undefined;

          if (result) {
            log.info("resolveDiscordId", `Resolved "${discordUsername}" to Discord ID ${result}`, {
              discordUsername,
              discordUserId: result,
            });
          } else {
            log.warn(
              "resolveDiscordId",
              `Could not resolve "${discordUsername}" — candidates: ${candidates?.length ?? 0}`,
              {
                discordUsername,
                candidateCount: candidates?.length ?? 0,
                rawDataType: typeof rawData,
              }
            );
          }
          return {
            discord_user_id: result,
            discord_username: data?.discord_username || null,
            avatar_url: data?.avatar_url || null,
            candidates,
            message: data?.message || undefined,
          };
        } catch (err) {
          log.warn(
            "resolveDiscordId",
            `Error resolving Discord ID for "${discordUsername}"`,
            { discordUsername },
            err
          );
          if (err instanceof Error) throw err;
          throw new Error(
            "Discord verification is temporarily unavailable. Please try again in a minute."
          );
        }
      }
    );
  },

  async confirmDiscordId(discordUserId: string): Promise<{
    discord_user_id: string;
    discord_username?: string | null;
    discord_display_name?: string | null;
    global_name?: string | null;
    nick?: string | null;
  } | null> {
    return log.track(
      "confirmDiscordId",
      `Confirming Discord ID ${discordUserId}`,
      { discordUserId },
      async () => {
        try {
          const { data: rawData, error } = await supabase.functions.invoke("resolve-discord-id", {
            body: { confirm_user_id: discordUserId },
          });
          const data = parseFunctionPayload(rawData);
          if (error) {
            const backendMessage = await readFunctionErrorMessage(rawData, error);
            throw new Error(normalizeDiscordVerificationError(backendMessage || error.message));
          }
          if (data?.error) {
            throw new Error(normalizeDiscordVerificationError(data.error));
          }
          return data?.discord_user_id
            ? {
                discord_user_id: data.discord_user_id,
                discord_username: data.discord_username || null,
                discord_display_name:
                  data.discord_display_name ||
                  data.nick ||
                  data.global_name ||
                  data.discord_username ||
                  null,
                global_name: data.global_name || null,
                nick: data.nick || null,
              }
            : null;
        } catch (err) {
          log.warn(
            "confirmDiscordId",
            `Error confirming Discord ID ${discordUserId}`,
            { discordUserId },
            err
          );
          if (err instanceof Error) throw err;
          throw new Error("Discord verification failed. Please try again.");
        }
      }
    );
  },

  /**
   * Begin the Discord ownership-proof OAuth flow (audit H11 follow-up). Returns
   * the Discord authorize URL the browser must be redirected to. `origin` is the
   * app origin (window.location.origin); the server validates it against an
   * allow-list and derives the fixed callback path.
   */
  async startDiscordOAuth(origin: string): Promise<string> {
    return log.track(
      "startDiscordOAuth",
      "Starting Discord OAuth link flow",
      { origin },
      async () => {
        const { data: rawData, error } = await supabase.functions.invoke("discord-oauth-start", {
          body: { origin },
        });
        const data = parseFunctionPayload(rawData);
        if (error) {
          const backendMessage = await readFunctionErrorMessage(rawData, error);
          throw new Error(normalizeDiscordVerificationError(backendMessage || error.message));
        }
        if (data?.error) throw new Error(normalizeDiscordVerificationError(data.error));
        if (typeof data?.url !== "string" || !data.url) {
          throw new Error("Could not start Discord linking. Please try again.");
        }
        return data.url;
      }
    );
  },

  /**
   * Complete the Discord OAuth flow: hand the code+state to the callback edge
   * function, which proves ownership via /users/@me and binds the account. This
   * is the ONLY client path that results in a Discord identity being written.
   */
  async completeDiscordOAuth(
    code: string,
    state: string
  ): Promise<{
    discord_user_id: string;
    discord_username: string;
    discord_display_name?: string | null;
    global_name?: string | null;
    nick?: string | null;
    avatar?: string | null;
  }> {
    return log.track("completeDiscordOAuth", "Completing Discord OAuth link flow", {}, async () => {
      const { data: rawData, error } = await supabase.functions.invoke("discord-oauth-callback", {
        body: { code, state },
      });
      const data = parseFunctionPayload(rawData);
      if (error) {
        const backendMessage = await readFunctionErrorMessage(rawData, error);
        throw new Error(normalizeDiscordVerificationError(backendMessage || error.message));
      }
      if (data?.error) throw new Error(normalizeDiscordVerificationError(data.error));
      if (!data?.discord_user_id || !data?.discord_username) {
        throw new Error("Discord verification failed. Please try linking again.");
      }
      return {
        discord_user_id: data.discord_user_id,
        discord_username: data.discord_username,
        discord_display_name: data.discord_display_name ?? null,
        global_name: data.global_name ?? null,
        nick: data.nick ?? null,
        avatar: data.avatar ?? null,
      };
    });
  },
};
