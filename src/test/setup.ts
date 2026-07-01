import "@testing-library/jest-dom";

// Polyfill ResizeObserver for Radix UI components in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Polyfill scrollIntoView for cmdk in jsdom
Element.prototype.scrollIntoView = vi.fn();

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Global Supabase client stub.
//
// The gate-test CI job intentionally runs with NO VITE_SUPABASE_URL
// (unit tests must pass against jsdom + local fixtures, never real Supabase).
// `createClient()` in @supabase/supabase-js validates the URL eagerly and
// throws "supabaseUrl is required" at construction, so ANY test that
// transitively imports "@/integrations/supabase/client" without its own mock
// crashes at import time. This provides a safe, chainable no-op stub so those
// imports succeed. Tests that need specific behaviour declare their own
// `vi.mock("@/integrations/supabase/client", …)`, which takes precedence over
// this setup-file mock. We do NOT touch the frozen client.ts itself.
vi.mock("@/integrations/supabase/client", () => {
  // A PostgREST-style query builder: thenable (resolves to {data:[],error:null})
  // and chainable for any method (.select/.eq/.order/.single/…).
  const makeQuery = () => {
    const promise = Promise.resolve({ data: [], error: null, count: 0 });
    return new Proxy(promise, {
      get(target, prop, receiver) {
        if (prop === "then" || prop === "catch" || prop === "finally") {
          const v = Reflect.get(target, prop, target);
          return typeof v === "function" ? v.bind(target) : v;
        }
        return () => receiver;
      },
    });
  };

  const auth = {
    getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    getClaims: () => Promise.resolve({ data: null, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
    signInWithOAuth: () => Promise.resolve({ data: {}, error: null }),
    signUp: () => Promise.resolve({ data: {}, error: null }),
    signOut: () => Promise.resolve({ error: null }),
    setSession: () => Promise.resolve({ data: {}, error: null }),
    refreshSession: () => Promise.resolve({ data: {}, error: null }),
    resetPasswordForEmail: () => Promise.resolve({ data: {}, error: null }),
    verifyOtp: () => Promise.resolve({ data: {}, error: null }),
    exchangeCodeForSession: () => Promise.resolve({ data: {}, error: null }),
    mfa: {
      listFactors: () => Promise.resolve({ data: { totp: [], all: [] }, error: null }),
      enroll: () => Promise.resolve({ data: {}, error: null }),
      challenge: () => Promise.resolve({ data: {}, error: null }),
      verify: () => Promise.resolve({ data: {}, error: null }),
      getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: {}, error: null }),
    },
  };

  const storage = {
    from: () => ({
      upload: () => Promise.resolve({ data: {}, error: null }),
      remove: () => Promise.resolve({ data: {}, error: null }),
      list: () => Promise.resolve({ data: [], error: null }),
      getPublicUrl: () => ({ data: { publicUrl: "" } }),
      createSignedUrl: () => Promise.resolve({ data: { signedUrl: "" }, error: null }),
      download: () => Promise.resolve({ data: null, error: null }),
    }),
  };

  const channel = () => {
    const ch: any = {
      on: () => ch,
      subscribe: (cb?: (status: string) => void) => {
        if (typeof cb === "function") cb("SUBSCRIBED");
        return ch;
      },
      unsubscribe: () => Promise.resolve("ok"),
      send: () => Promise.resolve("ok"),
    };
    return ch;
  };

  const supabase = {
    from: makeQuery,
    rpc: makeQuery,
    auth,
    storage,
    channel,
    removeChannel: () => Promise.resolve("ok"),
    removeAllChannels: () => Promise.resolve([]),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    realtime: { setAuth: () => {} },
  };

  return { supabase };
});
