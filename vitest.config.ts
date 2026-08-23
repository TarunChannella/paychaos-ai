import { defineConfig } from "vitest/config";
import path from "node:path";

// Phase 1A foundation config: path alias mirrors tsconfig's "@/*" -> "./*"
// so unit tests can import application modules the same way app code does.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    passWithNoTests: false,
    // Phase 1C-B final-gate correction: `threads` (chosen in Phase 1A on the
    // theory that it was more reliable than the forked-process pool on this
    // OneDrive-synced Windows path) instead reproducibly hit
    // "[vitest-pool-runner]: Timeout waiting for worker to respond" with 0
    // tests collected across 4 independent runs in the prior session.
    // `pool: "forks"` collected and passed all files/tests in the large
    // majority of runs observed while making this change, a substantial
    // improvement — but it is NOT fully deterministic either: one run out
    // of four during verification hit the same worker-timeout signature.
    // See the Phase 1C-B final-gate report for the exact run-by-run
    // evidence. This suite is fully independent per-file (no shared module
    // state, unlike vitest.integration.config.ts's real-network suite), so
    // normal per-file parallelism is kept — forks does not need
    // fileParallelism/isolate relaxed here.
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
    },
  },
});
