-- PayChaos AI — Phase 4E-R1 additive migration.
--
-- Creates `public.regression_runs` (docs/DATABASE.md Section 18) — the tenth
-- and final table of the approved P0 schema (docs/DATABASE.md Section 3),
-- whose CREATE the Phase-to-Table matrix (Section 50) assigns to Phase 4.
--
-- This migration is SCHEMA ONLY. It starts no regression, executes no chaos,
-- evaluates no invariant, resolves no finding and writes zero rows. It
-- creates no function, no trigger, no view and no RPC. It alters NO existing
-- table — no ALTER TABLE statement appears below — and it creates no Phase
-- 4F/4G/P1 table (`reliability_score_snapshots` remains uncreated).
--
-- WHAT THIS TABLE IS. One row links one historical `findings` row to ONE NEW
-- `chaos_runs` row executed to re-test it (REG-001/REG-002). It is a join
-- plus a lifecycle status, and deliberately nothing else: the scenario, the
-- required invariants, the evidence and the outcome are all reachable through
-- the two foreign keys, so copying any of them here could only ever drift
-- from the authoritative rows.
--
-- HISTORICAL EVIDENCE IS IMMUTABLE. A regression NEVER rewrites the original
-- failure. REG-004 and docs/MONEY_INVARIANTS.md Principle 4 ("A historical
-- invariant result is never changed from FAIL -> PASS. A regression creates a
-- new invariant result.") are structurally protected: the new evaluation
-- writes new `invariant_results` rows keyed to the NEW chaos run, and both
-- foreign keys below are ON DELETE RESTRICT so neither the original finding
-- nor either chaos run can be deleted out from under this record.
--
-- NO TIMESTAMP/STATUS CHECK (architect decision D-1, Phase 4E). Section 18
-- specifies exactly one CHECK — the status vocabulary — and deliberately does
-- not constrain `started_at`/`completed_at` against it, unlike Section 17's
-- explicit "consistency CHECK" requirement for `findings.resolved_at`. The
-- application repository owns lifecycle consistency through explicit,
-- individually guarded state transitions. Nothing is invented here.
--
-- NO `updated_at` (architect decision D-1). Section 18's column list has
-- seven columns and no `updated_at`, unlike `chaos_runs` and `findings`.
-- `created_at` records creation and `started_at`/`completed_at` record the
-- lifecycle; a fourth timestamp would be surface this table never asked for.
-- ============================================================================

-- ============================================================================
-- TABLE: regression_runs  (docs/DATABASE.md Section 18)
-- ============================================================================

create table public.regression_runs (
  id uuid primary key default gen_random_uuid(),

  -- The original historical issue being re-tested. NOT NULL: a regression
  -- with no finding would be a re-test of nothing.
  --
  -- ON DELETE RESTRICT, per docs/DATABASE.md Section 41 ("Normal application
  -- behavior should not delete reliability evidence") and required by the
  -- Demo Reset order in Section 39, which deletes `regression_runs` at step 1
  -- and `findings` at step 2 — an ordering only meaningful under RESTRICT.
  --
  -- Deliberately NOT unique: docs/DATABASE.md Section 18 places UNIQUE on
  -- `chaos_run_id` only. A finding may legitimately be re-tested many times
  -- over its life, and every attempt stays in history. The partial unique
  -- index further below constrains only how many may be ACTIVE at once.
  finding_id uuid not null
    references public.findings (id) on delete restrict,

  -- The NEW chaos run this regression executed (REG-001). NOT NULL and
  -- UNIQUE: docs/DATABASE.md Section 18 declares this column "FK +
  -- UNIQUE", and Section 42 requires a unique `chaos_run_id` index. One
  -- chaos run therefore belongs to at most one regression, so a run can
  -- never be double-counted as a re-test of two different findings.
  --
  -- A genuine table CONSTRAINT rather than a standalone CREATE UNIQUE INDEX,
  -- matching the Phase 3G precedent for a documented UNIQUE: both enforce the
  -- same rule, but only the constraint appears in
  -- `information_schema.table_constraints`. PostgreSQL creates the backing
  -- unique index automatically, satisfying Section 42.
  --
  -- ON DELETE RESTRICT for the same evidence-preservation reason as above.
  chaos_run_id uuid not null
    references public.chaos_runs (id) on delete restrict,

  status text not null default 'PENDING',

  -- Set when the regression claims execution (PENDING -> RUNNING). NULL
  -- while PENDING, and still NULL on a regression that terminalized as ERROR
  -- before it ever started.
  started_at timestamptz,

  -- Set exactly once, when the regression reaches a terminal status
  -- (RESOLVED / STILL_FAILING / ERROR).
  completed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint regression_runs_chaos_run_id_uniq unique (chaos_run_id),

  -- The five approved values (docs/DATABASE.md Section 18). RESOLVED and
  -- STILL_FAILING are the two conclusive verdicts. ERROR means this
  -- regression did NOT establish either proof — an inconclusive UNKNOWN
  -- evaluation, a BLOCKED run, or a technical execution failure. ERROR is
  -- explicitly NOT a statement that a payment failed.
  constraint regression_runs_status_valid check (
    status in ('PENDING', 'RUNNING', 'RESOLVED', 'STILL_FAILING', 'ERROR')
  )
);

comment on table public.regression_runs is
  'Phase 4E — links one historical finding to one NEW chaos run executed to '
  're-test it (docs/DATABASE.md Section 18, REG-001/REG-002). The original '
  'finding and its failed invariant result remain unchanged historical '
  'evidence: a regression creates a new chaos run and new invariant '
  'results, and never rewrites the original failure (REG-004). Scenario, '
  'required invariants and outcome are read through the two foreign keys '
  'and are deliberately not copied here.';

comment on column public.regression_runs.finding_id is
  'The original historical finding being re-tested. ON DELETE RESTRICT so a '
  'finding can never be deleted out from under its regression history. NOT '
  'unique: a finding may be re-tested many times, and every attempt is '
  'retained. See regression_runs_active_finding_uniq for the active-run '
  'boundary.';

comment on column public.regression_runs.chaos_run_id is
  'The NEW chaos run this regression executed (REG-001). UNIQUE — one chaos '
  'run belongs to at most one regression, so a run can never count as a '
  're-test of two findings. Never the original failing run.';

comment on column public.regression_runs.status is
  'PENDING / RUNNING / RESOLVED / STILL_FAILING / ERROR. ERROR means the '
  'regression established neither fixed nor still-failing proof '
  '(inconclusive UNKNOWN evaluation, BLOCKED run, or technical execution '
  'failure) — it is NOT a claim that a payment failed. An inconclusive '
  'regression never resolves a finding.';

comment on column public.regression_runs.started_at is
  'Set when the regression claims execution (PENDING -> RUNNING). Remains '
  'NULL on a regression that terminalized before it ever started.';

comment on column public.regression_runs.completed_at is
  'Set exactly once, when the regression reaches RESOLVED, STILL_FAILING or '
  'ERROR. Preserved verbatim on an idempotent repeat finalization.';

comment on column public.regression_runs.created_at is
  'Row creation. There is deliberately no updated_at on this table '
  '(docs/DATABASE.md Section 18 defines seven columns and no such column).';

-- ============================================================================
-- INDEXES  (docs/DATABASE.md Sections 18 and 42)
--
-- The required unique `chaos_run_id` index is provided by the
-- `regression_runs_chaos_run_id_uniq` table constraint above.
-- ============================================================================

create index regression_runs_finding_id_idx
  on public.regression_runs (finding_id);

create index regression_runs_status_idx
  on public.regression_runs (status);

create index regression_runs_created_at_idx
  on public.regression_runs (created_at);

-- ARCHITECT-APPROVED CONCURRENCY BOUNDARY (Phase 4E decision D-3).
--
-- At most ONE regression may be active (PENDING or RUNNING) for a given
-- finding at any moment. This is a concurrency boundary, NOT a
-- one-regression-ever restriction: rows in a terminal status (RESOLVED,
-- STILL_FAILING, ERROR) are excluded from the index entirely, so a finding
-- accumulates unlimited historical regression attempts and may always be
-- re-tested again once its previous attempt has finished.
--
-- It exists because two concurrent start requests — a double-clicked button,
-- a retried request — would otherwise each create their own new chaos run and
-- their own PENDING regression, which the UNIQUE on `chaos_run_id` cannot
-- prevent. The database is the authority for that race; the application read
-- guard is a fast, friendly pre-check, not the enforcement.
--
-- This index is additive to the four Section 42 requires.
create unique index regression_runs_active_finding_uniq
  on public.regression_runs (finding_id)
  where status in ('PENDING', 'RUNNING');

comment on index public.regression_runs_active_finding_uniq is
  'Concurrency boundary, not a one-regression-ever rule: at most one '
  'PENDING/RUNNING regression per finding. Terminal rows are excluded, so '
  'unlimited historical regression attempts remain possible.';

-- ============================================================================
-- ROW LEVEL SECURITY AND PRIVILEGES  (docs/DATABASE.md Sections 40/41,
-- docs/SECURITY.md Section 25)
--
-- The same explicit, source-controlled access model as every prior P0
-- migration: RLS enabled with ZERO policies (which denies all access to
-- anon/authenticated), privileges additionally REVOKEd explicitly rather than
-- relying on the absence of a GRANT alone, and narrow explicit GRANTs to
-- `service_role` only. No browser ever reaches this table directly, and no
-- permissive client policy exists to be widened later by accident.
--
-- UPDATE IS GRANTED, like `findings` and unlike `invariant_results`. A
-- regression run is a lifecycle object by documented design (Section 18:
-- PENDING -> RUNNING -> RESOLVED/STILL_FAILING/ERROR), not immutable
-- evidence. CAPABILITY IS NOT PERMISSION: Phase 4E-R1 production code writes
-- only through explicit, individually guarded state-transition functions —
-- there is no generic `setRegressionStatus(id, status)` anywhere, which
-- `tests/unit/regression/phase4e-r1-static-guard.test.ts` enforces at the
-- source level.
--
-- DELETE is retained for `service_role` because docs/DATABASE.md Section 39
-- lists `regression_runs` as step 1 of the intentional administrative Demo
-- Reset, and because integration tests must remove their own rows by exact
-- id. That is a controlled, documented operation — Phase 4E production
-- performs no DELETE at all.
-- ============================================================================

alter table public.regression_runs enable row level security;

revoke all privileges on table public.regression_runs from anon, authenticated;

grant select, insert, update, delete on public.regression_runs to service_role;
