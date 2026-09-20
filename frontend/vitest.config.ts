import { defineConfig } from "vitest/config";

// Unit tier only: src co-located *.test.ts. E2E specs (tests/e2e) belong to
// Playwright — without this include, vitest mis-collects them and fails.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
