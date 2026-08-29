-- PayChaos AI — Phase 3G additive migration.
--
-- Creates `public.findings` (docs/DATABASE.md Section 17) — one reliability
-- issue generated from exactly one deterministic invariant failure. This is
-- the ONLY migration Phase 3G introduces, and it completes the approved
-- ten-table P0 schema.
--
-- This migration is SCHEMA ONLY. It creates no finding, decides no payment
-- truth, evaluates no invariant, and writes zero rows. It creates no
-- function, no trigger and no view.
--
-- This migration does NOT:
--   - create `regression_runs` or `reliability_score_snapshots` (Phase 4
--     tables, not authorized here);
--   - create any generic evidence table (`finding_evidence`, `evidence`,
--     `evidence_items`, …). There is deliberately no such table:
--     traceability is finding -> invariant_result -> evidence_refs ->
--     records that already exist (docs/MONEY_INVARIANTS.md Section 42);
--   - alter ANY existing table — no ALTER TABLE statement appears below;
--   - touch `invariant_results`, `chaos_runs`, `event_processing_attempts`,
--     `webhook_events`, `orders`, `payment_attempts`, `payments`,
--     `fulfilments`, or either existing RPC;
--   - modify, backfill or reinterpret any historical evidence row.
-- It is purely additive, per docs/DATABASE.md Section 44.
--
-- COMPLETE FINAL TABLE, PARTIAL POPULATION (architect ruling, Phase 3G).
-- docs/DATABASE.md Section 17 documents ONE table definition, not a Phase 3
-- subset plus a Phase 4 extension, and its Phase-Ownership matrix places
-- **CREATE** in the Phase 3 column with Phase 4 only "adding/using"
-- diagnosis and recommendation. Every diagnosis/recommendation column is
-- already documented `Nullable = Yes, Default NULL`, which only makes sense
-- if the column exists before anything populates it. So the full and final
-- table is created here, once, and Phase 4 ships pure application code
-- rather than an ALTER against a frozen table.
--
-- Phase 3G application code populates ONLY:
--   id, invariant_result_id, status = 'OPEN', title, created_at, updated_at
-- and leaves all seven diagnosis/recommendation/resolution columns NULL.
-- `tests/unit/findings/phase3g-static-guard.test.ts` enforces that at the
-- source level; the real integration test re-proves it against live rows.
--
-- FINDING AUTHORITY. A finding may exist ONLY for an already-persisted
-- `invariant_results.result = 'FAIL'` row (docs/DATABASE.md Section 17,
-- CLAUDE.md Section 12). PASS and UNKNOWN never produce one, and UNKNOWN in
-- particular is NEVER upgraded to a finding merely because evidence was
-- insufficient. That rule is deliberately enforced in the trusted server
-- service rather than in SQL: `result` lives on the referenced
-- `invariant_results` row, and a CHECK cannot read another table. The
-- database still guarantees the part it can — every finding must reference
-- a real invariant result, and at most one finding may exist per result.
--
-- NO DUPLICATED EVIDENCE. `findings` deliberately does NOT carry severity,
-- expected_summary, observed_summary, reason, evidence_refs, chaos_run_id,
-- order_id, payment_attempt_id or payment_id. Those facts already live on
-- the immutable `invariant_results` row and are read through the FK. A copy
-- could only ever drift from, or contradict, the authoritative evidence.
--
-- ============================================================================

-- ============================================================================
-- TABLE: findings  (docs/DATABASE.md Section 17)
-- ============================================================================

create table public.findings (
  id uuid primary key default gen_random_uuid(),

  -- The authoritative failed evaluation this finding reports. NOT NULL: a
  -- finding with no invariant result would be an issue about nothing, and
  -- would have to have decided on its own that something failed.
  --
  -- ON DELETE RESTRICT, consistent with docs/DATABASE.md Section 41
  -- ("Normal application behavior should not delete reliability evidence")
  -- and required by the Demo Reset order in Section 39, which deletes
  -- `findings` at step 2 and `invariant_results` at step 3 — an ordering
  -- that is only meaningful under RESTRICT.
  --
  -- UNIQUE: docs/DATABASE.md Section 17 declares this column as "FK +
  -- UNIQUE" and lists `UNIQUE(invariant_result_id)` under Constraints —
  -- "This prevents one failed invariant execution from creating duplicate
  -- findings." It is therefore a genuine named table CONSTRAINT below, not
  -- a standalone CREATE UNIQUE INDEX: the two enforce the same rule, but
  -- only the constraint matches the documented contract and shows up in
  -- `information_schema.table_constraints`. PostgreSQL creates the backing
  -- unique index automatically, so Section 17's required unique
  -- `invariant_result_id` INDEX is satisfied by the same declaration.
  --
  -- Enforced by PostgreSQL, not by an application `if`
  -- (docs/ARCHITECTURE.md Section 25).
  invariant_result_id uuid not null
    references public.invariant_results (id) on delete restrict,

  status text not null default 'OPEN',

  -- Server-generated, deterministic, factual. Derived from the frozen
  -- invariant registry as "<INV-ID> — <invariant name>". Never
  -- caller-supplied, never AI-generated, and must contain no secret, no raw
  -- webhook payload, no signature and no customer PII.
  title text not null,

  -- ---------------------------------------------------------------------
  -- Phase 4 territory. Created here so Phase 4 needs no schema migration;
  -- deliberately left NULL by Phase 3G.
  -- ---------------------------------------------------------------------
  diagnosis_code text,
  diagnosis_strength text,
  diagnosis_summary text,
  recommendation_code text,
  recommendation_text text,
  diagnosed_at timestamptz,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint findings_invariant_result_id_uniq unique (invariant_result_id),

  constraint findings_status_valid check (
    status in ('OPEN', 'STILL_FAILING', 'RESOLVED')
  ),

  -- NULL is allowed (Phase 3G leaves it NULL); when present it must be one
  -- of the three approved evidence-strength labels. docs/DATABASE.md
  -- Section 17: "Do not invent probabilistic confidence percentages."
  constraint findings_diagnosis_strength_valid check (
    diagnosis_strength is null
    or diagnosis_strength in (
      'STRONG_EVIDENCE', 'PARTIAL_EVIDENCE', 'INSUFFICIENT_EVIDENCE'
    )
  ),

  -- ARCHITECT RULING (Phase 3G): resolved_at is non-null IF AND ONLY IF
  -- status = 'RESOLVED'. docs/DATABASE.md Section 17 requires a
  -- "consistency CHECK" without spelling out the expression; this is the
  -- ruled form. OPEN and STILL_FAILING must both carry resolved_at NULL, so
  -- a resolution timestamp can never survive a finding reopening, and a
  -- RESOLVED finding can never lack the time it was resolved.
  constraint findings_resolved_at_consistent check (
    (status = 'RESOLVED' and resolved_at is not null)
    or (status <> 'RESOLVED' and resolved_at is null)
  )
);

comment on table public.findings is
  'Phase 3G — one reliability issue generated from exactly one '
  'deterministic invariant failure (docs/DATABASE.md Section 17). A '
  'finding is created ONLY from a persisted invariant_results row whose '
  'result is FAIL; PASS and UNKNOWN never produce one, and UNKNOWN is '
  'never upgraded to a finding because evidence was insufficient. A '
  'finding never decides payment truth itself — it reports an already-'
  'persisted deterministic verdict. Severity, expected/observed state, '
  'reason and evidence references are NOT copied here: they are read '
  'through invariant_result_id, which is immutable append-only evidence.';

comment on column public.findings.invariant_result_id is
  'The one authoritative failed evaluation this finding reports. NOT NULL '
  'and UNIQUE — at most one finding per invariant result, enforced by the '
  'database rather than by application code. ON DELETE RESTRICT so an '
  'invariant result can never be deleted out from under its finding.';

comment on column public.findings.status is
  'OPEN / STILL_FAILING / RESOLVED. Phase 3G creates every finding as '
  'OPEN and NEVER updates status. STILL_FAILING and RESOLVED are written '
  'only by the Phase 4 regression lifecycle.';

comment on column public.findings.title is
  'Deterministic server-generated title, "<INV-ID> — <frozen invariant '
  'name>". FACT only: never caller-supplied, never AI-generated, and free '
  'of secrets, raw payloads, signatures and customer PII. Stable across '
  'regeneration — a differing title for the same invariant_result_id is '
  'treated as an integrity conflict, never silently rewritten.';

comment on column public.findings.diagnosis_code is
  'Phase 4. NULL after Phase 3G creation. Advisory only — a diagnosis may '
  'never modify payment status, order amount, invariant result or webhook '
  'authenticity (docs/DATABASE.md Section 17).';

comment on column public.findings.diagnosis_strength is
  'Phase 4. NULL after Phase 3G creation. STRONG_EVIDENCE / '
  'PARTIAL_EVIDENCE / INSUFFICIENT_EVIDENCE only — deliberately an '
  'evidence-strength label, never a probabilistic confidence percentage.';

comment on column public.findings.diagnosis_summary is
  'Phase 4. NULL after Phase 3G creation. Evidence-based explanation; '
  'must never contain a secret, raw webhook payload, signature or PII.';

comment on column public.findings.recommendation_code is
  'Phase 4. NULL after Phase 3G creation.';

comment on column public.findings.recommendation_text is
  'Phase 4. NULL after Phase 3G creation.';

comment on column public.findings.diagnosed_at is
  'Phase 4. NULL after Phase 3G creation.';

comment on column public.findings.resolved_at is
  'Phase 4. NULL after Phase 3G creation. Constrained to be non-null if '
  'and only if status = RESOLVED (architect ruling, Phase 3G).';

comment on column public.findings.updated_at is
  'Phase 3G sets this only at insert (via the default) and NEVER writes it '
  'again — Phase 3G production performs no UPDATE on this table at all. '
  'Phase 4 owns every subsequent lifecycle write.';

-- Required indexes — docs/DATABASE.md Sections 17 "Indexes" and 42.
--
-- Section 17 requires four: a unique `invariant_result_id`, plus `status`,
-- `diagnosis_code` and `created_at`. The first is NOT repeated here — the
-- `findings_invariant_result_id_uniq` UNIQUE constraint above already
-- creates its own backing unique index of the same name, and adding a
-- second identical index would be redundant storage that PostgreSQL would
-- have to maintain on every write.
--
-- These three are therefore the only explicit CREATE INDEX statements, and
-- no speculative index is added.
create index findings_status_idx on public.findings (status);
create index findings_diagnosis_code_idx on public.findings (diagnosis_code);
create index findings_created_at_idx on public.findings (created_at);

-- ============================================================================
-- ROW LEVEL SECURITY AND PRIVILEGES  (docs/DATABASE.md Sections 40/41,
-- docs/SECURITY.md Section 25)
--
-- Same explicit, source-controlled access model as every prior P0
-- migration: RLS enabled with ZERO policies (which denies all access to
-- anon/authenticated), privileges additionally REVOKEd explicitly rather
-- than relying on the absence of a GRANT alone, and narrow explicit GRANTs
-- to `service_role` only. No browser ever reaches this table directly.
--
-- UPDATE IS GRANTED HERE — deliberately UNLIKE `invariant_results`, which
-- grants no UPDATE to any role. The two tables are different kinds of
-- record. An invariant result is immutable historical evidence; a finding
-- is a mutable lifecycle object by documented design (docs/DATABASE.md
-- Section 17: status moves OPEN -> STILL_FAILING -> RESOLVED, and Phase 4
-- populates diagnosis and recommendation). Granting the capability now
-- means Phase 4 needs no privilege migration against a frozen table.
--
-- CAPABILITY IS NOT PERMISSION. Phase 3G production code must not, and
-- does not, execute a single UPDATE against this table: Finding generation
-- is INSERT-only, there is no updateFinding/resolveFinding/setDiagnosis
-- function, and `tests/unit/findings/phase3g-static-guard.test.ts` fails
-- the build if `.update(`/`.upsert(` ever appears against `findings` in
-- Phase 3G production source.
--
-- DELETE is retained for service_role because docs/DATABASE.md Section 39
-- lists `findings` as step 2 of the intentional administrative Demo Reset,
-- and because integration tests must remove their own rows. That is a
-- controlled, explicitly-documented operation, not normal application
-- behavior — Phase 3G production performs no DELETE either.
-- ============================================================================

alter table public.findings enable row level security;

revoke all privileges on table public.findings from anon, authenticated;

grant select, insert, update, delete on public.findings to service_role;
