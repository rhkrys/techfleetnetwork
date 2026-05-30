import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { writeFileSync, mkdirSync } from "fs";

// Stable build identifier injected into the bundle and emitted as /version.json
// so a long-lived browser tab can detect deploys and refresh BEFORE attempting
// to fetch a stale chunk hash.
const BUILD_ID =
  process.env.VITE_BUILD_ID ||
  process.env.COMMIT_REF ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  `${Date.now()}`;

const LOVABLE_CLOUD_URL = process.env.VITE_SUPABASE_URL || "https://iqsjhrhsjlgjiaedzmtz.supabase.co";
const LOVABLE_CLOUD_PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_NnnYUf3wUfVWGyOlhQf9UQ_92QsC3YE";
const LOVABLE_CLOUD_PROJECT_ID = process.env.VITE_SUPABASE_PROJECT_ID || "iqsjhrhsjlgjiaedzmtz";

/**
 * Emit /version.json into the build output. This file is intentionally
 * uncached (see public/_headers) so the version watcher always sees fresh data.
 */
function emitVersionManifest(): Plugin {
  return {
    name: "emit-version-manifest",
    apply: "build",
    closeBundle() {
      try {
        const dir = path.resolve(__dirname, "dist");
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          path.join(dir, "version.json"),
          JSON.stringify({ buildId: BUILD_ID, builtAt: new Date().toISOString() }),
          "utf8",
        );
      } catch {
        // Non-fatal: version.json is an enhancement, not a hard requirement.
      }
    },
  };
}

/**
 * Lovable's preview/debug tooling evaluates small predicates in the browser.
 * Keep production CSP strict while allowing that tooling only during dev serve.
 */
function allowPreviewEvalInDev(): Plugin {
  return {
    name: "allow-preview-eval-in-dev-csp",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(/script-src 'self' 'unsafe-inline'/g, "script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    },
  };
}

/**
 * Phase-2 triage refactor — PART B-14.
 *
 * SupportWidget was removed but its dynamic-import URL kept reappearing in
 * the wild, producing "Failed to fetch dynamically imported module" reports.
 * This guard fails the build if any `src/` file still references the symbol
 * by name, ensuring the dead chunk URL stops being shipped.
 */
function supportWidgetBuildGuard(): Plugin {
  return {
    name: "support-widget-build-guard",
    apply: "build",
    transform(code, id) {
      if (!id.includes("/src/")) return null;
      if (/\bSupportWidget\b/.test(code)) {
        this.error(
          `[support-widget-build-guard] '${id}' references the removed SupportWidget symbol. ` +
            `Delete the import — the chunk URL must not be shipped. (see plan PART B-14)`,
        );
      }
      return null;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(LOVABLE_CLOUD_URL),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(LOVABLE_CLOUD_PUBLISHABLE_KEY),
    "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(LOVABLE_CLOUD_PROJECT_ID),
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    allowPreviewEvalInDev(),
    emitVersionManifest(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "@tanstack/react-query"],
  },
  optimizeDeps: {
    include: ["@tanstack/react-query", "react", "react-dom", "react-router-dom"],
  },
  build: {
    target: "es2020",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "query-vendor": ["@tanstack/react-query"],
          "ui-vendor": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-popover",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-tabs",
            "@radix-ui/react-select",
          ],
          "form-vendor": ["react-hook-form", "@hookform/resolvers", "zod"],
          "date-vendor": ["date-fns"],
          "d3-geo": ["d3-geo", "topojson-client"],
          "supabase-vendor": ["@supabase/supabase-js"],
          "chart-vendor": ["recharts"],
          "editor-vendor": ["react-quill-new"],
          // AG Grid is ~400KB gzipped and only used on admin/data table pages.
          // Isolating it ensures it ships in its own chunk that's lazy-loaded
          // by src/components/AgGrid.tsx on first table mount.
          "aggrid-vendor": ["ag-grid-react", "ag-grid-community"],
        },
      },
    },
    cssCodeSplit: true,
    chunkSizeWarningLimit: 500,
  },
}));
