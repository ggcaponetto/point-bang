import { defineConfig } from "vitest/config";

// Mirrors the root project's contract: the LOGIC modules carry a 90% gate
// (they are the old public/editor.js + editor-i18n.js), React glue gets
// smoke-level render tests and stays out of the coverage denominator.
// No @vitejs/plugin-react here — its types target vite 8 while vitest
// bundles an older vite, and esbuild's automatic JSX transform is all the
// tests need.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/model.ts", "src/i18n.ts", "src/locales.ts"],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
