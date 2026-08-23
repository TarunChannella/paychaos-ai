import { defineConfig } from "vitest/config";
import path from "node:path";

import SupabaseIntegrationSequencer from "./tests/integration/supabase/sequencer";

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
//     sequentially, in one worker, so cleanup/end-state verification files
//     can rely on what earlier files created. Real network I/O also makes
//     unbounded parallel execution needlessly flaky. This relaxation is
//     scoped to this integration config only — vitest.config.ts (offline
//     unit tests) keeps Vitest's normal per-file isolation.
//   - `sequence.sequencer` (Phase 1E correction): numeric filename
//     prefixes alone do NOT guarantee execution order under Vitest 4 (this
//     was directly observed — a verbose run produced 03/04/045/05/01/02).
//     `./tests/integration/supabase/sequencer.ts` extends Vitest's
//     `BaseSequencer` and forces `05-final-state.integration.test.ts` to
//     run last, regardless of the base file order.
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
    sequence: {
      sequencer: SupabaseIntegrationSequencer,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
    },
  },
});
