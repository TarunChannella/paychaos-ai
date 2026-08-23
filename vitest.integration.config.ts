import { defineConfig } from "vitest/config";
import path from "node:path";

// Phase 1C-B — REAL-NETWORK Supabase integration suite. Separate from
// vitest.config.ts (the offline unit suite) on purpose:
//   - only picks up tests/integration/supabase/**/*.integration.test.ts,
//     never tests/unit/** and never anything vitest.config.ts already
//     covers, so the two suites cannot double-run each other's tests;
//   - loads tests/integration/supabase/setup-env.ts, which reads
//     .env.local and opens a REAL connection to a real Supabase project —
//     this is why this config is never referenced by `npm run test` (see
//     package.json's "test" script) and only runs via the explicit
//     `npm run test:integration:supabase` script;
//   - `isolate: false` + `fileParallelism: false` (which also forces
//     `maxWorkers` to 1 in Vitest 4 — see vitest's own doc comment on
//     `fileParallelism`): this suite deliberately shares module state (see
//     tests/integration/supabase/helpers.ts) and runs its files
//     sequentially, in one worker, in a fixed order (numeric filename
//     prefixes) so cleanup/end-state verification files can rely on what
//     earlier files created. Real network I/O also makes unbounded
//     parallel execution needlessly flaky. This relaxation is scoped to
//     this integration config only — vitest.config.ts (offline unit tests)
//     keeps Vitest's normal per-file isolation.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/supabase/**/*.integration.test.ts"],
    passWithNoTests: false,
    pool: "threads",
    fileParallelism: false,
    isolate: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["./tests/integration/supabase/setup-env.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
    },
  },
});
