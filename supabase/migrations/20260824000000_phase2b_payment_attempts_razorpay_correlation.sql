-- PayChaos AI — Phase 2B additive migration.
--
-- Adds the two Razorpay Order correlation columns docs/DATABASE.md Section
-- 10 already documents as part of the complete, final `payment_attempts`
-- schema but which the approved Phase 1 migration
-- (20260823000000_phase1_foundation_schema.sql) intentionally omitted —
-- see that file's own header comment and docs/DATABASE.md Section 10
-- "Phase Ownership" (Phase 2 row: "Uses/adds the Razorpay Order
-- correlation fields ... Adding the already-approved Phase 2 Razorpay
-- fields is not considered an architecture redesign.").
--
-- This migration does NOT edit, rewrite, or squash the approved Phase 1
-- migration — it is purely additive, per docs/DATABASE.md Section 44
-- "Migration Ownership by Phase".
--
-- This migration does NOT create `payments`, `webhook_events`, or
-- `event_processing_attempts` — those remain later Phase 2 work, not part
-- of this Phase 2B Order-creation slice.
--
-- This migration contains no secrets. It only defines schema/constraints.
--
-- NOT APPLIED YET: prepared for later manual/developer-driven application
-- against the real Supabase project, using the same protocol already used
-- for the Phase 1 migration.

alter table public.payment_attempts
  add column razorpay_order_id text,
  add column razorpay_order_status text;

comment on column public.payment_attempts.razorpay_order_id is
  'Phase 2B — Razorpay Test Mode Order ID. NULL until the trusted server '
  'Razorpay integration successfully creates an Order (PAYATT-005). See '
  'docs/DATABASE.md Section 10.';

comment on column public.payment_attempts.razorpay_order_status is
  'Phase 2B — latest verified/observed Razorpay Order status. NULL until '
  'a Razorpay Order has been created for this attempt. See '
  'docs/DATABASE.md Section 10.';

-- Partial UNIQUE constraint: enforced only for non-null values, so many
-- rows may share razorpay_order_id = NULL (before Order creation) while a
-- real Razorpay Order ID can never be attached to more than one
-- payment_attempts row (docs/DATABASE.md Section 10 "Constraints":
-- "UNIQUE(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL").
create unique index payment_attempts_razorpay_order_id_unique
  on public.payment_attempts (razorpay_order_id)
  where razorpay_order_id is not null;

-- RLS was already enabled on payment_attempts by the Phase 1 migration
-- (`alter table public.payment_attempts enable row level security`), with
-- zero policies defined and anon/authenticated privileges already
-- explicitly revoked there (docs/DATABASE.md Section 40). Adding columns
-- to an existing table does not reset RLS or table-level privileges — no
-- RLS/GRANT/REVOKE statement is needed or added here, and this migration
-- creates no policy of any kind.
