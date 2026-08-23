import { BaseSequencer, type TestSpecification } from "vitest/node";

/**
 * Phase 1E correction — deterministic file ordering for the real-Supabase
 * integration suite.
 *
 * Vitest 4 does NOT guarantee lexicographic filename ordering by default
 * (observed directly: a verbose run produced 03, 04, 045, 05, 01, 02 —
 * NOT numeric order). This suite's shared module state
 * (tests/integration/supabase/helpers.ts's append-only ID ledgers) and
 * 05-final-state.integration.test.ts's re-verification both require that
 * every other integration file has already run and cleaned up before it
 * runs. `fileParallelism: false` only serializes execution; it does not
 * fix ordering.
 *
 * This sequencer extends BaseSequencer (the officially supported
 * `test.sequence.sequencer` extension point — see vitest's
 * `SequenceOptions.sequencer` doc comment) and overrides `sort` only: it
 * keeps the base sequencer's sort as the default ordering, then forces
 * whichever file matches `05-final-state.integration.test.ts` to the end,
 * regardless of what order the base sort (or the filesystem) produced.
 */
export default class SupabaseIntegrationSequencer extends BaseSequencer {
  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);

    const isFinalState = (file: TestSpecification): boolean =>
      file.moduleId.endsWith("05-final-state.integration.test.ts");

    const finalState = sorted.filter(isFinalState);
    const everythingElse = sorted.filter((file) => !isFinalState(file));

    return [...everythingElse, ...finalState];
  }
}
