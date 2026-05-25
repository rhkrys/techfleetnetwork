import { supabase } from "@/integrations/supabase/client";

export type ClassEmailAction = "submitted" | "approved" | "changes_requested" | "archived";

interface ClassRecipientRow {
  owner_user_id: string;
  owner_email: string | null;
  owner_name: string | null;
  class_title: string;
}

interface AdminRecipientRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
}

async function getActorName(): Promise<string | undefined> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return undefined;
  const { data } = await supabase
    .from("profiles")
    .select("first_name,last_name")
    .eq("user_id", user.id)
    .maybeSingle();
  const name = `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim();
  return name || undefined;
}

async function sendOne(args: {
  recipientEmail: string;
  recipientUserId: string;
  recipientName?: string;
  recipientRole: "teacher" | "admin";
  classId: string;
  classTitle: string;
  action: ClassEmailAction;
  actorName?: string;
  reason?: string;
}) {
  const linkPath =
    args.recipientRole === "admin" ? "/admin/classes" : `/teach/classes/${args.classId}`;
  try {
    await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "class-status-change",
        recipientEmail: args.recipientEmail,
        idempotencyKey: `class-${args.action}-${args.classId}-${args.recipientUserId}`,
        templateData: {
          action: args.action,
          recipientName: args.recipientName,
          recipientRole: args.recipientRole,
          classTitle: args.classTitle,
          actorName: args.actorName,
          reason: args.reason,
          linkPath,
        },
      },
    });
  } catch (err) {
    // Email is best-effort; in-app notifications already cover the action.
    console.warn("class-status-change email failed", err);
  }
}

/**
 * Fire class-status emails to the teacher (owner) and all admins.
 * Always best-effort — never throws.
 */
export async function sendClassStatusEmails(
  classId: string,
  action: ClassEmailAction,
  reason?: string,
): Promise<void> {
  try {
    const [{ data: ownerRows }, { data: adminRows }, actorName] = await Promise.all([
      (supabase as any).rpc("get_class_email_recipients", { p_class_id: classId }),
      (supabase as any).rpc("list_admin_email_recipients"),
      getActorName(),
    ]);

    const owner = (ownerRows as ClassRecipientRow[] | null)?.[0];
    if (!owner) return;

    const classTitle = owner.class_title;

    if (owner.owner_email) {
      await sendOne({
        recipientEmail: owner.owner_email,
        recipientUserId: owner.owner_user_id,
        recipientName: owner.owner_name ?? undefined,
        recipientRole: "teacher",
        classId,
        classTitle,
        action,
        actorName,
        reason,
      });
    }

    const admins = (adminRows as AdminRecipientRow[] | null) ?? [];
    for (const a of admins) {
      if (!a.email) continue;
      // Don't double-email the actor themselves with an admin notice.
      if (a.user_id === owner.owner_user_id && action === "submitted") continue;
      await sendOne({
        recipientEmail: a.email,
        recipientUserId: a.user_id,
        recipientName: a.full_name ?? undefined,
        recipientRole: "admin",
        classId,
        classTitle,
        action,
        actorName,
        reason,
      });
    }
  } catch (err) {
    console.warn("sendClassStatusEmails failed", err);
  }
}
