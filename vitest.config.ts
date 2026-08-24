import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // Integration tests render whole pages that import from the `@/design-system`
    // barrel, which (like any barrel) eagerly loads the full MUI-based component
    // library. Under parallel CPU load the heaviest page tests can exceed the 5s
    // default purely on import/first-render time (not a hang). 15s gives realistic
    // headroom without masking genuine hangs.
    testTimeout: 15000,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    // Inline @testing-library/jest-dom so Vitest's resolver rewrites its
    // extension-less lodash imports (avoids "Cannot find module .../isEqualWith"
    // under Node ESM strict resolution).
    server: {
      deps: {
        inline: ["@testing-library/jest-dom"],
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
