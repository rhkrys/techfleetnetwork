/**
 * Hook for managing Web Push notification subscriptions.
 * Provides subscribe/unsubscribe actions and current subscription state.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { PushSubscriptionService, type SubscribeResult } from "@/services/push-subscription.service";

export type { SubscribeResult } from "@/services/push-subscription.service";

export function usePushNotifications() {
  const { user } = useAuth();
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPermission(PushSubscriptionService.getPermission());
    // Gate "supported" on actually having an active service worker — on
    // deployments without a SW (Tech Fleet today) push cannot work, so we
    // surface the friendly "not available" UI instead of letting users
    // trigger a subscribe() that will fail and log an error.
    PushSubscriptionService.isReady().then((ready) => {
      setIsSupported(ready);
      if (ready) {
        PushSubscriptionService.isSubscribed().then(setIsSubscribed);
      }
    });
  }, []);

  const subscribe = useCallback(async (): Promise<SubscribeResult> => {
    if (!user) return { status: "error", message: "You need to be signed in to enable push notifications." };
    setLoading(true);
    try {
      const result = await PushSubscriptionService.subscribe(user.id);
      setIsSubscribed(result.status === "granted");
      setPermission(PushSubscriptionService.getPermission());
      return result;
    } finally {
      setLoading(false);
    }
  }, [user]);

  const unsubscribe = useCallback(async () => {
    if (!user) return false;
    setLoading(true);
    try {
      const result = await PushSubscriptionService.unsubscribe(user.id);
      if (result) setIsSubscribed(false);
      return result;
    } finally {
      setLoading(false);
    }
  }, [user]);

  return {
    isSupported,
    isSubscribed,
    permission,
    loading,
    subscribe,
    unsubscribe,
  };
}
