## Problem
A `client_error` reports "Push notifications are not ready because the app service worker is unavailable." in the EditProfilePage bundle when users attempt to enable push notifications. The app intentionally unregisters all service workers on startup (PWA disabled), so push notifications fundamentally cannot work when no SW is active. The current `isSupported()` check only verifies API existence, not actual SW availability, causing a race condition where `getReadyRegistration()` briefly sees a stale controller before unregister completes, and `pushManager.subscribe()` throws.

## Fix
Strengthen `PushSubscriptionService` so it correctly reports push as unsupported when no active service worker exists, preventing the subscription attempt entirely.

### Changes

1. **`src/services/push-subscription.service.ts`**
   - Modify `isSupported()` to also require an active service worker controller (`navigator.serviceWorker.controller`) or the ability to get a ready registration immediately.
   - Harden `getReadyRegistration()` to verify `registration.active?.state === 'activated'` before returning the registration.

2. **`src/test/ui/PushNotificationToggle.test.tsx`**
   - Add a mock for `navigator.serviceWorker.controller` so `isSupported` returns true in tests.

## Safety
- No new dependencies.
- `PushNotificationToggle` already renders a "not available" UI when `isSupported` is false.
- No backend changes.
- This prevents the caught-but-reported error from reaching the triage queue.