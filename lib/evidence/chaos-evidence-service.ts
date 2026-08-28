/**
 * Phase 3E-B — server-only orchestration for per-chaos-run evidence assembly.
 *
 * `assembleChaosRunEvidence(chaosRunId)` is the single trusted entry point,
 * and its ONLY input is an internal `chaos_runs.id` UUID — never a URL, host,
 * hostname, IP, webhook URL, callback URL, target endpoint, scenario
 * definition, order state, payment state, snapshot JSON, provider status,
 * script, shell command or SQL fragment.
 *
 * The whole operation is two steps and nothing else:
 *
 *   1. `lib/evidence/chaos-evidence-repository.ts` performs strictly
 *      read-only, explicitly allowlisted `SELECT`s;
 *   2. `lib/evidence/chaos-run-evidence.ts` deterministically assembles those
 *      rows into a versioned `ChaosRunEvidenceBundleV1`.
 *
 * There is no third step, and specifically no evaluation step: this function
 * assigns no `PASS`, `FAIL`, `UNKNOWN`, `NOT_APPLICABLE` or `ERROR`, persists
 * no `invariant_results` row, creates no finding, produces no diagnosis or
 * recommendation, and never calls an LLM. Phase 3F alone decides what these
 * facts mean (docs/PHASE_PLAN.md "Phase 3F — Money Invariant Engine";
 * CLAUDE.md §10 "Money Invariants are deterministic and authoritative").
 *
 * It performs ZERO database writes and ZERO network requests. Assembling
 * evidence must never be able to change the evidence it is assembling — a
 * read that mutated state would make the bundle a description of its own side
 * effects rather than of the chaos run.
 */
import "server-only";

import {
  buildChaosRunEvidenceBundle,
  type ChaosRunEvidenceBundleV1,
} from "@/lib/evidence/chaos-run-evidence";
import { loadChaosRunEvidenceSource } from "@/lib/evidence/chaos-evidence-repository";

/**
 * Assembles the deterministic evidence bundle for one chaos run.
 *
 * Returns `null` when no chaos run with that id exists — a genuinely absent
 * record, never conflated with a database read failure (which surfaces as
 * `ChaosEvidenceRepositoryError` from the repository below). Every other
 * missing or contradictory fact becomes a deterministic `EvidenceGap` inside
 * the bundle rather than an exception, so a historical run whose evidence was
 * never captured can still be inspected truthfully instead of crashing the
 * caller.
 *
 * Deterministic: called twice against unchanged data it returns a deep-equal
 * bundle. Nothing here reads the clock or generates an identifier.
 */
export async function assembleChaosRunEvidence(
  chaosRunId: string,
): Promise<ChaosRunEvidenceBundleV1 | null> {
  const source = await loadChaosRunEvidenceSource(chaosRunId);
  if (!source) {
    return null;
  }
  return buildChaosRunEvidenceBundle(source);
}
