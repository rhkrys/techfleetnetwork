/**
 * Push Subscription Service
 *
 * Manages Web Push notification subscriptions:
 * - Requesting notification permission
 * - Subscribing/unsubscribing the browser
 * - Syncing subscriptions with the database
 */

import { supabase } from "@/integrations/supabase/client";
import { reportError } from "@/services/error-reporter.service";
import { createLogger } from "@/services/logger.service";

const log = createLogger("PushSubscriptionService");

export type SubscribeResultStatus = "granted" | "denied" | "dismissed" | "unsupported" | "no_sw" | "error";

export interface SubscribeResult {
  status: SubscribeResultStatus;
  message?: string;
}

let vapidPublicKeyCache: string | null = null;

/** Convert a base64url string to a Uint8Array (for applicationServerKey) */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Get the active SW registration with a timeout to avoid hanging forever */
async function getReadyRegistration(timeoutMs = 5000): Promise<ServiceWorkerRegistration | null> {
  if (!navigator.serviceWorker?.controller && !navigator.serviceWorker?.getRegistration) {
    return null;
  }
  try {
    const result = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return result;
  } catch {
    return null;
  }
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return "Unknown push notification error";
}

function stringifyPushContext(context: Record<string, unknown>): string {
  return Object.entries(context)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" | ");
}

function getSubscriptionFailureMessage(err: unknown): string {
  const message = getErrorMessage(err);
  const lower = message.toLowerCase();

  if (lower.includes("permission")) {
    return "Your browser blocked the notification request. Please review your notification permissions and try again.";
  }

  if (isPushAbortError(err) || lower.includes("abort")) {
    return "Your browser's push service couldn't complete the registration. We've reset the local state — please close and reopen the app, then try enabling push again.";
  }

  if (lower.includes("service worker") || lower.includes("registration")) {
    return "Push notifications are not ready on this device yet. Refresh the page and try again.";
  }

  return "We couldn't finish enabling push notifications on this device.";
}

function isPushAbortError(err: unknown): boolean {
  const message = getErrorMessage(err).toLowerCase();
  return message.includes("registration failed") && message.includes("push service error");
}

async function getVapidPublicKey(): Promise<string | null> {
  if (vapidPublicKeyCache) return vapidPublicKeyCache;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/push-config`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch push config (${response.status})`);
    }

    const data = await response.json();
    vapidPublicKeyCache = typeof data.publicKey === "string" ? data.publicKey : null;
    return vapidPublicKeyCache;
  } catch (error) {
    reportError(error, "PushSubscriptionService.getVapidPublicKey");
    return null;
  }
}

async function clearExistingSubscription(registration: ServiceWorkerRegistration): Promise<void> {
  try {
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
      await existingSubscription.unsubscribe();
    }
  } catch {
    // Ignore cleanup failures; subscription retry still has a chance to succeed.
  }
}

async function refreshServiceWorker(registration: ServiceWorkerRegistration): Promise<void> {
  try {
    await registration.update();
  } catch {
    // Best-effort only.
  }
}

async function clearAllPushSubscriptions(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => clearExistingSubscription(registration)));
  } catch {
    // Best-effort only.
  }
}

async function upsertSubscription(userId: string, subscription: PushSubscription): Promise<SubscribeResult> {
  const json = subscription.toJSON();
  const endpoint = json.endpoint!;
  const p256dh = json.keys?.p256dh ?? "";
  const auth = json.keys?.auth ?? "";

  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: userId, endpoint, p256dh, auth },
    { onConflict: "user_id,endpoint" },
  );

  if (error) {
    const detailedError = new Error(
      `Failed to save push subscription: ${error.message}${error.code ? ` (code: ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}`,
    );
    reportError(detailedError, "PushSubscriptionService.subscribe.upsert", userId);
    return {
      status: "error",
      message: "Your browser allowed notifications, but we couldn't save this device for alerts.",
    };
  }

  return { status: "granted" };
}

export class PushSubscriptionService {
  /** Check if the browser supports push notifications */
  static isSupported(): boolean {
    return (
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }

  /** Get the current notification permission state */
  static getPermission(): NotificationPermission {
    if (!("Notification" in window)) return "denied";
    return Notification.permission;
  }

  /** Request notification permission from the user */
  static async requestPermission(): Promise<NotificationPermission> {
    if (!("Notification" in window)) return "denied";
    return Notification.requestPermission();
  }

  /**
   * Subscribe this browser/device to push notifications and save to DB.
   * Returns a status string for richer UX feedback.
   */
  static async subscribe(userId: string): Promise<SubscribeResult> {
    if (!this.isSupported()) return { status: "unsupported" };

    const permission = await this.requestPermission();
    if (permission === "denied") return { status: "denied" };
    if (permission !== "granted") return { status: "dismissed" };

    try {
      const vapidPublicKey = await getVapidPublicKey();
      if (!vapidPublicKey) {
        return {
          status: "error",
          message: "Push notifications are temporarily unavailable because the app could not load its notification configuration.",
        };
      }

      const registration = await getReadyRegistration();
      if (!registration) {
        // No active service worker on this deployment (PWA/SW intentionally disabled).
        // Treat as unsupported environment rather than an error — push simply isn't
        // available here. Do NOT reportError: this is expected and would spam triage.
        log.info("Push subscribe skipped: no active service worker on this deployment");
        return {
          status: "unsupported",
          message: "Push notifications aren't available in this browser or on this device.",
        };
      }

      await refreshServiceWorker(registration);

      const existingSubscription = await registration.pushManager.getSubscription();
      if (existingSubscription) {
        return await upsertSubscription(userId, existingSubscription);
      }

      // Retry push subscription up to 2 times — AbortError from the push
      // service is often transient (browser/OS timing issue).
      let subscription: PushSubscription | null = null;
      let lastPushError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) {
            await refreshServiceWorker(registration);
            await clearAllPushSubscriptions();
            // Longer backoff: 2s, then 5s — push services need time to recover
            await new Promise((r) => setTimeout(r, attempt === 1 ? 2000 : 5000));
          }

          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
          });
          break; // success
        } catch (pushErr) {
          lastPushError = pushErr;
        }
      }

      if (!subscription) {
        const diagnosticError = new Error(
          `${getErrorMessage(lastPushError)} | ${stringifyPushContext({
            permission,
            online: navigator.onLine,
            hasController: Boolean(navigator.serviceWorker.controller),
            registrationScope: registration.scope,
            existingSubscription: Boolean(existingSubscription),
            displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
          })}`,
        );
        reportError(diagnosticError, "PushSubscriptionService.subscribe.pushManager", userId);

        if (isPushAbortError(lastPushError)) {
          await this.resetPushState(userId);
        }

        return { status: "error", message: getSubscriptionFailureMessage(lastPushError) };
      }

      return await upsertSubscription(userId, subscription);
    } catch (err) {
      log.warn("subscribe", "Push subscription failed", { userId }, err);
      reportError(err, "PushSubscriptionService.subscribe", userId);
      return { status: "error", message: getSubscriptionFailureMessage(err) };
    }
  }

  /** Unsubscribe this browser/device from push notifications */
  static async unsubscribe(userId: string): Promise<boolean> {
    try {
      const registration = await getReadyRegistration();
      if (!registration) return false;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();

        // Remove from database
        const { error } = await supabase
          .from("push_subscriptions")
          .delete()
          .eq("user_id", userId)
          .eq("endpoint", endpoint);

        if (error) {
          reportError(new Error(`Failed to delete push subscription: ${error.message}`), "PushSubscriptionService.unsubscribe.delete", userId);
          return false;
        }
      }

      return true;
    } catch (err) {
      log.warn("unsubscribe", "Push unsubscribe failed", { userId }, err);
      reportError(err, "PushSubscriptionService.unsubscribe", userId);
      return false;
    }
  }

  /** Hard reset local push/service-worker state when the browser storage is corrupted. */
  static async resetPushState(userId?: string): Promise<void> {
    try {
      await clearAllPushSubscriptions();
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch (err) {
      reportError(err, "PushSubscriptionService.resetPushState", userId);
    }
  }

  /** Check if the current device already has an active push subscription */
  static async isSubscribed(): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      const registration = await getReadyRegistration(3000);
      if (!registration) return false;
      const subscription = await registration.pushManager.getSubscription();
      return !!subscription;
    } catch {
      return false;
    }
  }
}
