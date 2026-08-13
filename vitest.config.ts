import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // lcov feeds Codecov and the Sonar scan in CI
      reporter: ["text", "lcov"],
      include: [
        "lib/**/*.ts",
        "server.ts",
        "cli.ts",
        "public/math.js",
        "public/transport.js",
        "public/editor.js",
        "public/editor-i18n.js",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
