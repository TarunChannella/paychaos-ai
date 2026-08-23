import { defineConfig } from "vitest/config";
import path from "node:path";

// Phase 1A foundation config: path alias mirrors tsconfig's "@/*" -> "./*"
// so unit tests can import application modules the same way app code does.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    passWithNoTests: false,
    // Explicit thread pool: more reliable worker start-up than the default
    // forked-process pool observed on this OneDrive-synced Windows path.
    pool: "threads",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
    },
  },
});
