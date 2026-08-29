import "server-only";

import { getInvariantDefinition } from "@/lib/invariants/registry";
import { isMoneyInvariantId } from "@/lib/invariants/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

import { isUuid, type FindingErrorCode, type FindingRow } from "./types";

/**
 * Phase 3G — the INSERT-ONLY `findings` repository.
 *
 * WHAT THIS MODULE MAY DO. Read `invariant_results`. Read `findings`. Insert
 * one `findings` row. That is the complete list.
 *
 * WHAT IT MAY NOT DO. It exposes no `UPDATE`, no `UPSERT` and no `DELETE`. The
 * Phase 3G migration DOES grant `service_role` UPDATE and DELETE, because a
 * finding is a mutable lifecycle object that Phase 4 will move through
 * STILL_FAILING/RESOLVED and populate with diagnosis and recommendation. That
 * is a DATABASE capability, not a Phase 3G permission: capability lives in the
 * migration so Phase 4 needs no privilege migration, and the restraint lives
 * here plus in `tests/unit/findings/phase3g-static-guard.test.ts`.
 *
 * NO VERDICT IS DECIDED HERE. This repository never inspects payment state,
 * never reads a chaos run's outcome, and never concludes that anything failed.
 * It stores a report of an already-persisted `FAIL`.
 *
 * FORWARD COMPATIBILITY WITH PHASE 4. When a finding already exists for an
 * invariant result, the ONLY things compared are `invariant_result_id` and the
 * deterministic title. `status`, every diagnosis/recommendation field,
 * `resolved_at` and `updated_at` are all legitimately Phase 4's to change, so
 * a finding that has since moved to RESOLVED — or acquired a diagnosis — is
 * returned exactly as it stands. Regeneration never resets status, never
 * clears a diagnosis and never touches `updated_at`.
 *
 * SAFE ERRORS ONLY. Every failure surfaces as a `FindingRepositoryError`
 * carrying a stable code and a fixed message. A raw Supabase/Postgres error,
 * its details and its hint are never propagated: they can carry column values,
 * and this repository sits one join away from payment evidence.
 */

export class FindingRepositoryError extends Error {
  readonly code: FindingErrorCode;

  constructor(code: FindingErrorCode, message: string) {
    super(message);
    this.name = "FindingRepositoryError";
    this.code = code;
  }
}

/** Explicit allowlist projections. Never `select("*")`. */
const FINDING_COLUMNS =
  "id, invariant_result_id, status, title, created_at, updated_at";

const INVARIANT_RESULT_COLUMNS =
  "id, invariant_id, invariant_version, order_id, payment_attempt_id, payment_id, chaos_run_id, result, severity, expected_summary, observed_summary, reason, evidence_refs, evaluated_at";

type FindingDbRow = Pick<
  Database["public"]["Tables"]["findings"]["Row"],
  | "id"
  | "invariant_result_id"
  | "status"
  | "title"
  | "created_at"
  | "updated_at"
>;

export type InvariantResultDbRow =
  Database["public"]["Tables"]["invariant_results"]["Row"];

function toFindingRow(row: FindingDbRow): FindingRow {
  return {
    id: row.id,
    invariantResultId: row.invariant_result_id,
    status: row.status,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The deterministic Finding title: `"<INV-ID> — <frozen invariant name>"`.
 *
 * Registry-derived and nothing else. No timestamp, no UUID, no counter, no
 * run-specific text — so the same invariant result always produces the same
 * title, on any machine, at any time. That stability is what makes an existing
 * finding's title usable as an integrity check rather than noise.
 *
 * The version gate matters. A persisted result records the
 * `invariant_version` that was in force when the verdict was reached. If the
 * registry has since moved to a new version, titling the finding with today's
 * name would silently re-describe a historical evaluation using semantics it
 * was never evaluated under. That is an integrity error, not a rename.
 */
export function deterministicFindingTitle(
  invariantId: string,
  invariantVersion: string,
): string {
  if (!isMoneyInvariantId(invariantId)) {
    throw new FindingRepositoryError(
      "FINDING_INVARIANT_UNKNOWN",
      "A persisted invariant result named an invariant outside the frozen P0 catalogue.",
    );
  }

  const definition = getInvariantDefinition(invariantId);
  if (definition === undefined) {
    throw new FindingRepositoryError(
      "FINDING_INVARIANT_UNKNOWN",
      "A persisted invariant result named an invariant outside the frozen P0 catalogue.",
    );
  }

  if (definition.version !== invariantVersion) {
    throw new FindingRepositoryError(
      "FINDING_INVARIANT_VERSION_MISMATCH",
      "A persisted invariant result was evaluated under an invariant version the frozen catalogue no longer defines.",
    );
  }

  return `${definition.invariantId} — ${definition.name}`;
}

/** Reads one persisted invariant result by exact ID, or `null`. */
export async function findInvariantResultById(
  invariantResultId: string,
): Promise<InvariantResultDbRow | null> {
  if (!isUuid(invariantResultId)) {
    throw new FindingRepositoryError(
      "FINDING_INVARIANT_RESULT_ID_INVALID",
      "A finding was requested for an identifier that is not an internal UUID.",
    );
  }

  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("invariant_results")
    .select(INVARIANT_RESULT_COLUMNS)
    .eq("id", invariantResultId)
    .maybeSingle();

  if (error) {
    throw new FindingRepositoryError(
      "FINDING_READ_FAILED",
      "The authoritative invariant result could not be read.",
    );
  }

  return data ?? null;
}

/**
 * Reads every persisted invariant result for one chaos run, ordered by
 * `invariant_id` so a run-level summary is deterministic.
 */
export async function listInvariantResultsForChaosRun(
  chaosRunId: string,
): Promise<readonly InvariantResultDbRow[]> {
  if (!isUuid(chaosRunId)) {
    throw new FindingRepositoryError(
      "FINDING_CHAOS_RUN_ID_INVALID",
      "Findings were requested for an identifier that is not an internal UUID.",
    );
  }

  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("invariant_results")
    .select(INVARIANT_RESULT_COLUMNS)
    .eq("chaos_run_id", chaosRunId)
    .order("invariant_id", { ascending: true });

  if (error) {
    throw new FindingRepositoryError(
      "FINDING_READ_FAILED",
      "The authoritative invariant results for this chaos run could not be read.",
    );
  }

  return data ?? [];
}

/** Reads the one finding for an invariant result, or `null`. */
export async function findFindingByInvariantResultId(
  invariantResultId: string,
): Promise<FindingRow | null> {
  if (!isUuid(invariantResultId)) {
    throw new FindingRepositoryError(
      "FINDING_INVARIANT_RESULT_ID_INVALID",
      "A finding was requested for an identifier that is not an internal UUID.",
    );
  }

  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("findings")
    .select(FINDING_COLUMNS)
    .eq("invariant_result_id", invariantResultId)
    .maybeSingle();

  if (error) {
    throw new FindingRepositoryError(
      "FINDING_READ_FAILED",
      "The finding for this invariant result could not be read.",
    );
  }

  return data ? toFindingRow(data) : null;
}

/** Reads one finding by its own ID, or `null`. */
export async function findFindingById(
  findingId: string,
): Promise<FindingRow | null> {
  if (!isUuid(findingId)) {
    throw new FindingRepositoryError(
      "FINDING_INVARIANT_RESULT_ID_INVALID",
      "A finding was requested for an identifier that is not an internal UUID.",
    );
  }

  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("findings")
    .select(FINDING_COLUMNS)
    .eq("id", findingId)
    .maybeSingle();

  if (error) {
    throw new FindingRepositoryError(
      "FINDING_READ_FAILED",
      "The finding could not be read.",
    );
  }

  return data ? toFindingRow(data) : null;
}

/**
 * Whether an existing finding may be reused for this invariant result.
 *
 * DELIBERATELY NARROW. Only the two immutable creation facts are compared.
 * Everything else on a finding is Phase 4's to change, and a regeneration that
 * demanded `status === "OPEN"` would raise a false conflict the moment a
 * regression run legitimately resolved the issue.
 */
export function isReusableFinding(
  existing: FindingRow,
  invariantResultId: string,
  expectedTitle: string,
): boolean {
  return (
    existing.invariantResultId === invariantResultId &&
    existing.title === expectedTitle
  );
}

export type FindingPersistence =
  | { readonly kind: "INSERTED"; readonly finding: FindingRow }
  | { readonly kind: "ALREADY_PRESENT"; readonly finding: FindingRow };

/**
 * Creates the OPEN finding for one already-verified failed invariant result,
 * or returns the existing one unchanged.
 *
 * The caller has already established that the referenced result is persisted
 * and carries `result = 'FAIL'`; this function does not re-derive that, and it
 * takes no verdict, severity, evidence or title from its caller — the title is
 * computed from the frozen registry.
 *
 * Read-then-insert is a genuine race, so the losing writer re-reads rather
 * than retrying: `findings_invariant_result_id_uniq` decides the winner, and
 * both callers return the same row.
 */
export async function insertOpenFinding(
  invariantResultId: string,
  title: string,
): Promise<FindingPersistence> {
  if (!isUuid(invariantResultId)) {
    throw new FindingRepositoryError(
      "FINDING_INVARIANT_RESULT_ID_INVALID",
      "A finding was requested for an identifier that is not an internal UUID.",
    );
  }

  const existing = await findFindingByInvariantResultId(invariantResultId);
  if (existing !== null) {
    if (!isReusableFinding(existing, invariantResultId, title)) {
      throw new FindingRepositoryError(
        "FINDING_INTEGRITY_CONFLICT",
        "A different finding already exists for this invariant result and was not overwritten.",
      );
    }
    return { kind: "ALREADY_PRESENT", finding: existing };
  }

  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from("findings")
    .insert({
      invariant_result_id: invariantResultId,
      status: "OPEN",
      title,
    })
    .select(FINDING_COLUMNS)
    .single();

  if (error || !data) {
    // Most likely the UNIQUE index rejected a concurrent duplicate. Re-read
    // and reconcile against the winner rather than assuming or retrying.
    const winner = await findFindingByInvariantResultId(invariantResultId);
    if (winner === null) {
      throw new FindingRepositoryError(
        "FINDING_INSERT_FAILED",
        "The finding could not be created and no existing finding was found for this invariant result.",
      );
    }
    if (!isReusableFinding(winner, invariantResultId, title)) {
      throw new FindingRepositoryError(
        "FINDING_INTEGRITY_CONFLICT",
        "A different finding already exists for this invariant result and was not overwritten.",
      );
    }
    return { kind: "ALREADY_PRESENT", finding: winner };
  }

  return { kind: "INSERTED", finding: toFindingRow(data) };
}
