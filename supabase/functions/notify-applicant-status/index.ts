// @edge-auth required
import { withAuditWrapper } from "../_shared/audit.ts";
/**
 * notify-applicant-status — Enterprise-grade Edge Function
 *
 * Atomically updates an applicant's status, creates an in-app notification,
 * writes an audit log entry, and optionally triggers a transactional email
 * (interview invite). When status is "active_participant", automatically assigns
 * the project's Discord role and logs the result to the activity log.
 *
 * Security: JWT verification + admin role check (SECURITY DEFINER has_role).
 * Payload: Zod-validated, size-limited (32 KiB), XSS-sanitized.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { queueTransactionalEmail } from "../_shared/transactional-email.ts";
import { discordFetch } from "../_shared/discord-fetch.ts";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MAX_PAYLOAD_BYTES = 32_768; // 32 KiB
const VALID_STATUSES = new Set([
  "pending_review",
  "invited_to_interview",
  "interview_scheduled",
  "not_selected",
  "active_participant",
  "left_the_project",
] as const);

type ApplicantStatus =
  | "pending_review"
  | "invited_to_interview"
  | "interview_scheduled"
  | "not_selected"
  | "active_participant"
  | "left_the_project";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
} as const;

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" } as const;

const INTERVIEW_GUIDE_URL =
  "https://guide.techfleet.org/team-portal/new-teammate-handbook/project-training-teams/applying-to-tech-fleet-project-training/interview-guide-for-tech-fleet-project-training/teammate-interview-guide-for-project-coordinators";

/* ------------------------------------------------------------------ */
/*  Notification content map                                           */
/* ------------------------------------------------------------------ */

interface NotificationContent {
  title: string;
  bodyFn: (ctx: {
    coordinatorName: string;
    schedulingUrl?: string;
    projectName?: string;
  }) => string;
  /** Plain-text body used for transactional email (HTML stripped). */
  emailMessageFn: (ctx: {
    coordinatorName: string;
    schedulingUrl?: string;
    projectName?: string;
  }) => string;
  /** Friendly status label shown in email subject + body. */
  statusLabel: string;
  type: string;
  linkUrl: string;
}

const APP_BASE_URL = "https://techfleet.network";

const NOTIFICATION_MAP: Record<ApplicantStatus, NotificationContent> = {
  pending_review: {
    title: "Application Status Updated",
    bodyFn: () => "<p>Your application status has been updated to Pending Review.</p>",
    emailMessageFn: () => "Your application is now back in pending review.",
    statusLabel: "Pending Review",
    type: "status_change",
    linkUrl: "/applications",
  },
  invited_to_interview: {
    title: "🎉 Interview Invitation",
    bodyFn: ({ coordinatorName, schedulingUrl }) => {
      const safeName = escapeHtml(coordinatorName || "a Tech Fleet Project Coordinator");
      let html = `<p>You have been invited to interview by <strong>${safeName}</strong>.</p>`;
      if (schedulingUrl) {
        const safeUrl = escapeHtml(schedulingUrl);
        html += `<p>Schedule your interview: <a href="${safeUrl}">${safeUrl}</a></p>`;
        html += `<p>Prepare with the <a href="${INTERVIEW_GUIDE_URL}">Interview Guide</a>.</p>`;
      }
      return html;
    },
    emailMessageFn: ({ coordinatorName }) =>
      `You have been invited to interview by ${coordinatorName || "a Tech Fleet Project Coordinator"}. Check your application for the scheduling link.`,
    statusLabel: "Invited to Interview",
    type: "interview_invite",
    linkUrl: "/applications",
  },
  interview_scheduled: {
    title: "📅 Interview Scheduled",
    bodyFn: () =>
      "<p>Your interview has been marked as scheduled. We look forward to meeting you!</p>",
    emailMessageFn: () =>
      "Your interview has been marked as scheduled. We look forward to meeting you!",
    statusLabel: "Interview Scheduled",
    type: "interview_scheduled",
    linkUrl: "/applications",
  },
  active_participant: {
    title: "🚀 You're now an Active Teammate!",
    bodyFn: () =>
      "<p>Congratulations! You have been selected to join a Tech Fleet project team. Welcome aboard!</p>",
    emailMessageFn: () =>
      "Congratulations! You have been selected to join a Tech Fleet project team. Welcome aboard!",
    statusLabel: "Active Participant",
    type: "active_participant",
    linkUrl: "/journey",
  },
  not_selected: {
    title: "Application Update",
    bodyFn: () =>
      "<p>Thank you for applying. Unfortunately, you were not selected for this project at this time. We encourage you to apply to future projects!</p>",
    emailMessageFn: () =>
      "Thank you for applying. Unfortunately, you were not selected for this project at this time. We encourage you to apply to future projects!",
    statusLabel: "Not Selected",
    type: "not_selected",
    linkUrl: "/applications",
  },
  left_the_project: {
    title: "Project Status Updated",
    bodyFn: () => "<p>Your project participation status has been updated.</p>",
    emailMessageFn: () => "Your project participation status has been updated.",
    statusLabel: "Left the Project",
    type: "left_project",
    linkUrl: "/applications",
  },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeString(val: unknown, maxLen = 512): string {
  if (typeof val !== "string") return "";
  return val.slice(0, maxLen).trim();
}

function isValidUuid(val: unknown): val is string {
  return typeof val === "string" && UUID_RE.test(val);
}

function isValidUrl(val: unknown): boolean {
  if (typeof val !== "string" || !val) return false;
  try {
    const url = new URL(val);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

interface ValidatedPayload {
  applicationId: string;
  applicantUserId: string;
  applicantEmail: string;
  applicantFirstName: string;
  newStatus: ApplicantStatus;
  coordinatorName: string;
  schedulingUrl: string | undefined;
  projectId: string;
}

function validatePayload(
  raw: unknown
): { ok: true; data: ValidatedPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid payload" };

  const obj = raw as Record<string, unknown>;

  const applicationId = obj.applicationId;
  const applicantUserId = obj.applicantUserId;
  const projectId = obj.projectId;
  const newStatus = obj.newStatus;

  if (!isValidUuid(applicationId)) return { ok: false, error: "Invalid applicationId" };
  if (!isValidUuid(applicantUserId)) return { ok: false, error: "Invalid applicantUserId" };
  if (!isValidUuid(projectId)) return { ok: false, error: "Invalid projectId" };
  if (typeof newStatus !== "string" || !VALID_STATUSES.has(newStatus as ApplicantStatus)) {
    return { ok: false, error: `Invalid status: ${sanitizeString(newStatus, 64)}` };
  }

  const schedulingUrl = obj.schedulingUrl ? sanitizeString(obj.schedulingUrl, 2048) : undefined;
  if (schedulingUrl && !isValidUrl(schedulingUrl)) {
    return { ok: false, error: "Invalid schedulingUrl" };
  }

  return {
    ok: true,
    data: {
      applicationId,
      applicantUserId,
      applicantEmail: sanitizeString(obj.applicantEmail, 320),
      applicantFirstName: sanitizeString(obj.applicantFirstName, 128),
      newStatus: newStatus as ApplicantStatus,
      coordinatorName: sanitizeString(obj.coordinatorName, 256),
      schedulingUrl,
      projectId,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Discord role assignment helper (with retry)                        */
/* ------------------------------------------------------------------ */

async function assignDiscordRole(
  discordUserId: string,
  roleId: string
): Promise<{ ok: boolean; error?: string }> {
  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  const guildId = Deno.env.get("DISCORD_GUILD_ID");

  if (!botToken || !guildId) {
    return { ok: false, error: "Discord bot not configured" };
  }

  try {
    const { response: res, retries } = await discordFetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
      {
        method: "PUT",
        headers: { Authorization: `Bot ${botToken}` },
      }
    );

    if (retries > 0) {
      console.info("Discord role assignment succeeded after retries", {
        retries,
        discordUserId,
        roleId,
      });
    }

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Discord role assignment failed", {
        status: res.status,
        error: errorText.substring(0, 500),
      });
      return { ok: false, error: `Discord API ${res.status}` };
    }

    await res.text(); // consume body
    return { ok: true };
  } catch (e) {
    console.error("Discord role assignment error after retries", e);
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

/* ------------------------------------------------------------------ */
/*  Project welcome post helper                                        */
/* ------------------------------------------------------------------ */

const WELCOME_CHANNEL_ID = "1506083368679379044";
const WELCOME_VIDEO_URL = "https://www.youtube.com/watch?v=ht35r4GSwoY";

async function postProjectWelcome(params: {
  discordUserId: string;
  discordRoleId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!botToken) return { ok: false, error: "Discord bot not configured" };

  const content =
    `<@${params.discordUserId}> welcome to the <@&${params.discordRoleId}>\n\n` +
    `Say hello to your teammates in the project channels!\n\n` +
    `We will start onboarding soon.\n\n` +
    `Please go to <id:browse> to set the project channels in your menu.\n\n` +
    `Watch this video on how to do this: ${WELCOME_VIDEO_URL}`;

  try {
    const { response: res } = await discordFetch(
      `https://discord.com/api/v10/channels/${WELCOME_CHANNEL_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          allowed_mentions: { parse: ["users", "roles"] },
        }),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Project welcome post failed", {
        status: res.status,
        error: errorText.substring(0, 500),
      });
      return { ok: false, error: `Discord API ${res.status}` };
    }
    await res.text();
    return { ok: true };
  } catch (e) {
    console.error("Project welcome post error after retries", e);
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                       */
/* ------------------------------------------------------------------ */

Deno.serve(
  withAuditWrapper("notify-applicant-status", async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    /* ---- Env ---- */
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return errorResponse("Server misconfiguration", 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    /* ---- Auth ---- */
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("Unauthorized", 401);
    }

    const token = authHeader.slice(7);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return errorResponse("Unauthorized", 401);
    }

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) {
      return errorResponse("Forbidden", 403);
    }

    /* ---- Payload size check ---- */
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
      return errorResponse("Payload too large", 413);
    }

    /* ---- Parse & validate ---- */
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse("Invalid JSON", 400);
    }

    const validation = validatePayload(rawBody);
    if (!validation.ok) {
      return errorResponse(validation.error, 400);
    }

    const {
      applicationId,
      applicantUserId,
      applicantEmail,
      applicantFirstName,
      newStatus,
      coordinatorName,
      schedulingUrl,
      projectId,
    } = validation.data;

    /* ---- 0. Defense-in-depth: block interview statuses on no-interview projects ---- */
    if (newStatus === "invited_to_interview" || newStatus === "interview_scheduled") {
      const { data: projectFlag } = await supabase
        .from("projects")
        .select("requires_interview")
        .eq("id", projectId)
        .maybeSingle();
      if (projectFlag && projectFlag.requires_interview === false) {
        return errorResponse("Interview statuses are disabled for this project", 400);
      }
    }

    /* ---- 1. Update status (critical — fail-fast) ---- */
    const { error: updateError } = await supabase
      .from("project_applications")
      .update({ applicant_status: newStatus })
      .eq("id", applicationId);

    if (updateError) {
      console.error("Status update failed", {
        applicationId,
        newStatus,
        error: updateError.message,
      });
      return errorResponse("Failed to update status", 500);
    }

    console.info("Status updated", { applicationId, newStatus });

    /* ---- 1b. Resolve project + applicant context (best-effort) ---- */
    let projectName = "";
    try {
      const { data: projectRow } = await supabase
        .from("projects")
        .select("friendly_name, client_id, clients:client_id ( name )")
        .eq("id", projectId)
        .maybeSingle();
      const clientsField = (projectRow as any)?.clients;
      const clientName =
        (clientsField && !Array.isArray(clientsField) ? clientsField.name : "") ||
        (Array.isArray(clientsField) ? clientsField[0]?.name : "") ||
        "";
      const friendly = (projectRow as any)?.friendly_name || "";
      projectName = [clientName, friendly].filter(Boolean).join(" — ");
    } catch (e) {
      console.warn("Project lookup failed (non-critical)", e);
    }

    // Look up applicant preferences + fallback contact info.
    let applicantWantsEmail = true;
    let resolvedFirstName = applicantFirstName;
    let resolvedEmail = applicantEmail;
    try {
      const { data: applicantProfile } = await supabase
        .from("profiles")
        .select("first_name, email, notify_announcements")
        .eq("user_id", applicantUserId)
        .maybeSingle();
      if (applicantProfile) {
        // notify_announcements is the master "send me emails" toggle. Default
        // to true if missing so we never silently drop critical updates.
        applicantWantsEmail = applicantProfile.notify_announcements !== false;
        resolvedFirstName = resolvedFirstName || (applicantProfile.first_name as string) || "";
        resolvedEmail = resolvedEmail || (applicantProfile.email as string) || "";
      }
    } catch (e) {
      console.warn("Applicant profile lookup failed (non-critical)", e);
    }

    /* ---- 2. In-app notification (always sent, non-blocking) ---- */
    const content = NOTIFICATION_MAP[newStatus];
    let notificationCreated = false;

    try {
      // Escape the coordinator/admin-controlled project name before it lands in the
      // notification title (audit T-D; body fields are already escaped below).
      const titleWithProject = projectName
        ? `${content.title} — ${escapeHtml(projectName)}`
        : content.title;
      // Self-healing path: enqueue + immediate-attempt via safe_create_notification.
      // If the live insert fails for any reason, the outbox worker retries with
      // exponential backoff (30s → 32m) and DLQs after 5 attempts. Admin alert
      // fires automatically via the audit_log error trigger.
      const { data: outboxId, error: notifError } = await supabase.rpc("safe_create_notification", {
        p_user_id: applicantUserId,
        p_title: titleWithProject,
        p_body_html: content.bodyFn({ coordinatorName, schedulingUrl, projectName }),
        p_notification_type: content.type,
        p_link_url: content.linkUrl,
        p_source: "notify-applicant-status",
      });

      if (notifError) {
        console.error("Notification enqueue failed", {
          applicantUserId,
          error: notifError.message,
        });
      } else {
        notificationCreated = true;
        console.info("Notification queued", { applicantUserId, type: content.type, outboxId });
      }
    } catch (e) {
      console.error("Notification error", e);
    }

    /* ---- 3. Audit log (non-blocking) ---- */
    try {
      await supabase.rpc("write_audit_log", {
        p_event_type: `applicant_status_${newStatus}`,
        p_table_name: "project_applications",
        p_record_id: applicationId,
        p_user_id: user.id,
        p_changed_fields: [applicantUserId, newStatus],
      });
    } catch (e) {
      console.warn("Audit log failed (non-critical)", e);
    }

    /* ---- 4a. Email — branded interview invite (non-blocking) ---- */
    let emailSent = false;
    if (
      newStatus === "invited_to_interview" &&
      resolvedEmail &&
      schedulingUrl &&
      applicantWantsEmail
    ) {
      const idempotencyKey = `interview-invite-${applicationId}-${Date.now()}`;
      try {
        const emailResult = await queueTransactionalEmail({
          supabase,
          templateName: "interview-invite",
          recipientEmail: resolvedEmail,
          idempotencyKey,
          messageId: idempotencyKey,
          templateData: {
            firstName: resolvedFirstName || undefined,
            coordinatorName,
            schedulingUrl,
          },
        });

        if (!emailResult.ok) {
          console.error("Interview email queue failed", {
            status: emailResult.status,
            error: emailResult.error,
            applicantEmail: resolvedEmail,
            applicationId,
          });
        } else {
          emailSent = !emailResult.suppressed;
          console.info("Interview email processed", {
            applicantEmail: resolvedEmail,
            queued: !emailResult.suppressed,
            suppressed: emailResult.suppressed,
            messageId: emailResult.messageId,
          });
        }
      } catch (e) {
        console.error("Interview email send error", e);
      }
    } else if (resolvedEmail && applicantWantsEmail) {
      /* ---- 4b. Email — generic status change (all other transitions) ---- */
      const idempotencyKey = `applicant-status-${applicationId}-${newStatus}-${Date.now()}`;
      try {
        const ctaPath = content.linkUrl || "/applications";
        const emailResult = await queueTransactionalEmail({
          supabase,
          templateName: "applicant-status-change",
          recipientEmail: resolvedEmail,
          idempotencyKey,
          messageId: idempotencyKey,
          templateData: {
            firstName: resolvedFirstName || undefined,
            statusLabel: content.statusLabel,
            statusMessage: content.emailMessageFn({ coordinatorName, schedulingUrl, projectName }),
            projectName: projectName || undefined,
            ctaUrl: `${APP_BASE_URL}${ctaPath}`,
            ctaLabel: "View Your Applications",
          },
        });

        if (!emailResult.ok) {
          console.error("Status email queue failed", {
            status: emailResult.status,
            error: emailResult.error,
            applicantEmail: resolvedEmail,
            applicationId,
            newStatus,
          });
        } else {
          emailSent = !emailResult.suppressed;
          console.info("Status email processed", {
            applicantEmail: resolvedEmail,
            newStatus,
            queued: !emailResult.suppressed,
            suppressed: emailResult.suppressed,
            messageId: emailResult.messageId,
          });
        }
      } catch (e) {
        console.error("Status email send error", e);
      }
    } else if (!applicantWantsEmail) {
      console.info("Skipped status email — applicant has notify_announcements disabled", {
        applicantUserId,
        newStatus,
      });
    }

    /* ---- 5. Discord role assignment for active_participant (non-blocking) ---- */
    let discordRoleAssigned = false;

    if (newStatus === "active_participant") {
      try {
        // Fetch project Discord role
        const { data: projectData } = await supabase
          .from("projects")
          .select("discord_role_id, discord_role_name")
          .eq("id", projectId)
          .single();

        const discordRoleId = projectData?.discord_role_id as string | undefined;
        const discordRoleName = projectData?.discord_role_name as string | undefined;

        if (discordRoleId) {
          // Fetch applicant profile for Discord info
          const { data: applicantProfile } = await supabase
            .from("profiles")
            .select("discord_user_id, discord_username")
            .eq("user_id", applicantUserId)
            .single();

          const applicantDiscordUserId = applicantProfile?.discord_user_id as string | undefined;

          if (applicantDiscordUserId) {
            // Assign Discord role automatically (with retry)
            const result = await assignDiscordRole(applicantDiscordUserId, discordRoleId);
            if (result.ok) {
              discordRoleAssigned = true;
              console.info("Discord role assigned", {
                applicantUserId,
                discordUserId: applicantDiscordUserId,
                roleId: discordRoleId,
                roleName: discordRoleName,
              });

              // Log to audit
              try {
                await supabase.rpc("write_audit_log", {
                  p_event_type: "discord_role_assigned",
                  p_table_name: "project_applications",
                  p_record_id: applicationId,
                  p_user_id: user.id,
                  p_changed_fields: [applicantUserId, discordRoleId, discordRoleName || ""],
                });
              } catch (auditErr) {
                console.warn("Discord role audit log failed", auditErr);
              }

              // Post welcome message in welcome channel (idempotent per application)
              try {
                const { data: priorWelcome } = await supabase
                  .from("audit_log")
                  .select("id")
                  .eq("event_type", "discord_welcome_posted")
                  .eq("record_id", applicationId)
                  .limit(1)
                  .maybeSingle();

                if (!priorWelcome) {
                  const welcome = await postProjectWelcome({
                    discordUserId: applicantDiscordUserId,
                    discordRoleId,
                  });
                  if (welcome.ok) {
                    try {
                      await supabase.rpc("write_audit_log", {
                        p_event_type: "discord_welcome_posted",
                        p_table_name: "project_applications",
                        p_record_id: applicationId,
                        p_user_id: user.id,
                        p_changed_fields: [applicantUserId, discordRoleId, discordRoleName || ""],
                      });
                    } catch (auditErr) {
                      console.warn("Welcome post audit log failed", auditErr);
                    }
                  } else {
                    try {
                      await supabase.rpc("write_audit_log", {
                        p_event_type: "discord_welcome_post_failed",
                        p_table_name: "project_applications",
                        p_record_id: applicationId,
                        p_user_id: user.id,
                        p_changed_fields: [applicantUserId, discordRoleId],
                        p_error_message: welcome.error || "Unknown error",
                      });
                    } catch (auditErr) {
                      console.warn("Welcome failure audit log failed", auditErr);
                    }
                  }
                }
              } catch (welcomeErr) {
                console.error("Welcome post flow error (non-blocking)", welcomeErr);
              }
            } else {
              console.error("Discord role assignment failed", {
                applicantUserId,
                error: result.error,
              });

              // Log failure to audit
              try {
                await supabase.rpc("write_audit_log", {
                  p_event_type: "discord_role_assignment_failed",
                  p_table_name: "project_applications",
                  p_record_id: applicationId,
                  p_user_id: user.id,
                  p_changed_fields: [applicantUserId, discordRoleId],
                  p_error_message: result.error || "Unknown error",
                });
              } catch (auditErr) {
                console.warn("Discord role failure audit log failed", auditErr);
              }
            }
          }
        }
      } catch (e) {
        console.error("Discord role assignment flow error", e);
      }
    }

    /* ---- 6. Community Contributor Agreement trigger (active_participant only) ---- */
    if (newStatus === "active_participant") {
      try {
        await supabase.rpc("mark_community_agreement_required", {
          p_application_id: applicationId,
        });
        // Fire the dedicated trigger function (handles notification + email + opt-in gating)
        await supabase.functions.invoke("send-community-agreement-trigger", {
          body: { application_id: applicationId },
          headers: { "x-internal-secret": serviceKey },
        });
      } catch (e) {
        console.error("Community agreement trigger failed (non-critical)", e);
      }
    }

    /* ---- Response ---- */
    return jsonResponse({
      success: true,
      notificationCreated,
      emailSent,
      discordRoleAssigned,
    });
  })
);
