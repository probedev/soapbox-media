import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Lite unit-test setup: node environment, tests colocated as *.test.ts next to
// the code. The `@/` alias mirrors tsconfig so tests import the same way the app
// does. No jsdom / testing-library yet - add them when we want component tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
