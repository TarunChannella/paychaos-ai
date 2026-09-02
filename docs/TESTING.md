# PayChaos AI — Testing Strategy

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer  
**Document Status:** Source-of-truth testing specification  
**Environment:** Razorpay Test Mode only  
**Primary Test Framework:** Vitest  
**Browser / E2E Framework:** Playwright  
**Database:** Supabase PostgreSQL  
**External Payment Verification:** Razorpay Test Mode  
**Runtime Cost Target:** ₹0  
**Development Constraint:** Approximately one week  
**Primary Goal:** Prove correctness, security, repeatability and demo reliability — not maximize test count

---

# 0. Purpose and Authority of This Document

This document defines the complete testing strategy for PayChaos AI.

It governs:

- unit tests;
- integration tests;
- database tests;
- Razorpay Test Mode verification;
- webhook tests;
- chaos scenario tests;
- Money Invariant tests;
- diagnosis tests;
- Reliability Score tests;
- security tests;
- browser/UI tests;
- end-to-end tests;
- regression testing;
- manual QA;
- demo rehearsal;
- phase test gates;
- test evidence required for approval.

This document must remain consistent with:

```text
PROJECT_CONTEXT.md
ARCHITECTURE.md
PHASE_PLAN.md
RAZORPAY_GUIDE.md
DATABASE.md
CHAOS_SCENARIOS.md
MONEY_INVARIANTS.md
AI_DESIGN.md
SECURITY.md
```

Authority remains separated by domain.

For Razorpay platform behavior:

```text
RAZORPAY_GUIDE.md
+
current official Razorpay documentation
```

are authoritative.

For database schema and constraints:

```text
DATABASE.md
```

is authoritative.

For chaos mechanics:

```text
CHAOS_SCENARIOS.md
```

is authoritative.

For Money Invariant IDs and rules:

```text
MONEY_INVARIANTS.md
```

is authoritative.

For diagnosis and AI boundaries:

```text
AI_DESIGN.md
```

is authoritative.

For security:

```text
SECURITY.md
```

is authoritative.

For implementation-phase acceptance:

```text
PHASE_PLAN.md
```

is authoritative.

If a test exposes a conflict between implementation and an approved source-of-truth document:

**the implementation must normally be fixed.**

Do not silently weaken the test to preserve broken implementation.

---

# 1. Testing Goals

PayChaos testing has seven primary goals.

## Goal 1 — Prove Payment Correctness

Prove that payment and Demo Merchant state remain correct under:

- normal payment flow;
- duplicate processing;
- failed payments;
- replay;
- event reordering;
- processing failure;
- database failure.

---

## Goal 2 — Prove Security Boundaries

Prove that:

- invalid webhooks are rejected;
- secrets remain server-side;
- Live Mode is rejected;
- arbitrary chaos targets are impossible;
- browser code cannot authoritatively mutate payment state.

---

## Goal 3 — Prove Determinism

Given the same:

```text
evidence
+
rule version
+
configuration
```

deterministic systems must produce the same result.

This applies especially to:

- state transitions;
- Money Invariants;
- diagnosis rules;
- recommendation mapping;
- Reliability Score;
- Go-Live Readiness.

---

## Goal 4 — Prove Fault Tolerance

Controlled adverse conditions must not produce:

- duplicate fulfilment;
- false paid state;
- impossible partial state;
- corrupted evidence;
- fake PASS results.

---

## Goal 5 — Prove Evidence Quality

Failures must be reconstructable from factual records.

A Finding must be traceable through:

```text
Finding
→ Invariant Result
→ Chaos Run
→ Processing Attempts
→ Payment / Order
→ Webhook / Evidence
```

---

## Goal 6 — Prove Repeatability

The same supported chaos scenario must be:

- reproducible;
- resettable;
- rerunnable;
- suitable for regression testing.

---

## Goal 7 — Prove Demo Readiness

The final deployed workflow must work reliably enough to demonstrate within approximately five minutes.

---

# 2. Testing Principles

## Principle 1 — Correctness Over Test Count

PayChaos does not target:

```text
100 tests
500 tests
90% coverage
```

merely for appearance.

A smaller suite proving high-risk payment behavior is more valuable than hundreds of shallow tests.

---

## Principle 2 — Test the Real Boundary Where It Matters

Critical provider integration requires real Razorpay Test Mode verification.

Mocks alone cannot prove:

- Razorpay Order creation works;
- Standard Checkout works;
- real webhook delivery works;
- deployed webhook configuration works.

---

## Principle 3 — Deterministic Logic Gets Deterministic Tests

Pure/domain logic should be exercised with controlled fixtures.

This includes:

- state transitions;
- event normalization;
- invariant evaluation;
- diagnosis mapping;
- score arithmetic.

---

## Principle 4 — Database Constraints Must Be Tested Directly

If correctness depends on PostgreSQL uniqueness or RLS:

test the database constraint itself.

Do not merely test the application path that normally avoids violating it.

---

## Principle 5 — Negative Paths Are First-Class

Tests must prove not only:

```text
valid payment works
```

but also:

```text
invalid signature does nothing
duplicate does nothing extra
failed payment does not fulfil
unsupported event does nothing
Live Mode does not start
```

---

## Principle 6 — Evidence Before Explanation

Tests must verify factual records independently from diagnosis output.

---

## Principle 7 — UNKNOWN Is Valid

Missing required evidence must produce:

```text
UNKNOWN
```

where defined.

It must not become fake PASS.

---

## Principle 8 — Real, Replay, Simulation and Fixture Remain Distinct

Every test must preserve provenance.

Approved classifications include:

```text
REAL_RAZORPAY_WEBHOOK
PAYCHAOS_REPLAY
PAYCHAOS_SIMULATION
TEST_FIXTURE
VERIFIED_CHECKOUT_RESULT
SYNTHETIC_DEMO
```

where applicable.

---

## Principle 9 — Vulnerable Behavior May Be Demonstrated Only Deliberately

PayChaos may intentionally expose a controlled vulnerable Demo Merchant profile for demonstrating detection.

That behavior must be:

- Test Mode only;
- internally controlled;
- clearly labelled;
- isolated to the chaos run;
- restored/reset afterward.

---

## Principle 10 — No Fake Test Results

Never report:

```text
PASS
```

unless the test was actually run and passed.

---

# 3. Test Pyramid / Test Layers

The canonical testing layers are:

```text
                    Manual Razorpay / Demo Verification
                              ▲
                         Playwright E2E
                              ▲
                     Chaos Scenario Tests
                              ▲
                Database / Integration Tests
                              ▲
                     Unit / Domain Tests
```

PayChaos uses the following practical execution chain:

```text
Unit Tests
    ↓
Integration Tests
    ↓
Database Tests
    ↓
Webhook Tests
    ↓
Razorpay Test Mode Verification
    ↓
Chaos Scenario Tests
    ↓
Money Invariant Tests
    ↓
Diagnosis / Score Tests
    ↓
Regression Tests
    ↓
Playwright E2E
    ↓
Manual Verification
    ↓
Demo Rehearsal
```

No single layer replaces the others.

---

# 4. Unit Testing

Use:

```text
Vitest
```

for deterministic unit tests.

Primary targets:

- configuration validation;
- amount validation;
- state machines;
- Checkout signature utility behavior;
- webhook signature utility behavior;
- event normalization;
- provenance classification;
- idempotency-key derivation;
- Money Invariant evaluators;
- diagnosis signal extraction;
- root-cause ranking;
- recommendation mapping;
- Reliability Score calculation;
- readiness classification.

---

## Unit Test Characteristics

Unit tests should normally be:

- deterministic;
- fast;
- isolated;
- independent from real Razorpay;
- independent from browser automation;
- independent from production secrets.

---

## Money Tests

Use integer smallest-currency units.

Example:

```text
50000
```

represents ₹500.00.

Do not test money using floating point.

---

# 5. Integration Testing

Integration tests prove that multiple real application modules cooperate correctly.

Examples:

```text
Webhook Route
→ Signature Verification
→ Event Persistence
→ Event Processor
→ Merchant State
```

and:

```text
Chaos Runner
→ Replay
→ Processor
→ Invariant Engine
→ Finding
```

Primary integration-test areas:

- server route → service → database;
- payment attempt persistence;
- event correlation;
- webhook processing;
- duplicate handling;
- fulfilment idempotency;
- chaos-run orchestration;
- evidence generation;
- Finding generation;
- regression workflow.

---

# 6. Database Testing

Database tests are mandatory because important PayChaos correctness relies on PostgreSQL.

---

## 6.1 Migration Tests

Verify a fresh database can apply migrations from zero.

Required assertions:

- migrations execute in order;
- required tables exist;
- required indexes exist;
- foreign keys exist;
- unique constraints exist;
- CHECK constraints exist;
- RLS is enabled.

---

## 6.2 Constraint Tests

At minimum verify rejection of:

- negative amount;
- zero amount;
- invalid status;
- duplicate Razorpay receipt;
- duplicate Razorpay Order ID;
- duplicate Razorpay Payment ID;
- duplicate Razorpay Event ID;
- duplicate fulfilment idempotency key;
- duplicate Finding for one invariant result where constrained;
- duplicate regression-to-chaos-run relationship.

---

## 6.3 Foreign-Key Tests

Attempt orphaned records.

Examples:

```text
payment → nonexistent payment_attempt
fulfilment → nonexistent payment
invariant_result → nonexistent chaos_run
regression → nonexistent finding
```

Expected:

```text
database rejection
```

### Fulfilment Order/Payment Path Consistency

Create two valid orders/payment paths, then attempt through the trusted merchant-processing service to create a fulfilment whose `order_id` belongs to one path while `payment_id` belongs to the other.

Expected:

```text
service/transaction rejection
zero fulfilment mutation
zero business-state mutation
```

This is a cross-record domain-integrity test; it is not satisfied by testing the two foreign keys independently.

---

## 6.4 Concurrency Tests

Mandatory where technically practical:

### Event Race

Two concurrent requests insert identical:

```text
razorpay_event_id
```

Expected:

```text
1 canonical webhook event
```

### Business Effect Race

Two processing attempts create the same semantic:

```text
fulfilments.idempotency_key
```

Expected:

```text
at most 1 successful fulfilment row
```

---

## 6.5 RLS Tests

Using unprivileged/anon Supabase access:

```text
INSERT → denied
UPDATE → denied
DELETE → denied
```

and:

```text
SELECT → denied
```

unless an explicit read-only policy is later approved.

Trusted server operations must still work.

---

## 6.6 Database Transaction Tests

Test failure inside the required merchant-processing transaction.

Expected:

```text
no impossible partial payment/business state
```

---

## 6.7 Evidence Chain Test

Construct one controlled test path that can reconstruct:

```text
order
→ payment attempt
→ payment
→ webhook event
→ processing attempt
→ chaos run
→ invariant result
→ finding
```

---

## 6.8 Reset Test

Demo Reset must:

- clear runtime/demo rows;
- preserve schema;
- preserve migrations;
- preserve RLS;
- preserve environment configuration;
- preserve source-controlled fixtures.

---

# 7. Razorpay Integration Testing

Razorpay testing has two distinct layers.

---

## 7.1 Automated Razorpay-Contract Tests

Use deterministic test input and adapters/mocks for:

- configuration;
- request construction;
- signature verification;
- API failure behavior;
- persistence;
- normalization.

These tests do **not** prove the external Razorpay service is reachable.

---

## 7.2 Real Razorpay Test Mode Verification

Mandatory manual integration verification must prove:

```text
Demo Merchant
→ Server-created Razorpay Test Mode Order
→ Standard Checkout
→ Test Mode payment
→ server Checkout verification
→ real Razorpay Test Mode webhook
→ webhook verification
→ database evidence
→ correct merchant state
```

A real Test Mode webhook must be received before Phase 2 approval.

---

## 7.3 Razorpay Order Tests

Automated:

- Test key accepted;
- Live key rejected;
- amount uses smallest currency unit;
- receipt stable;
- API failure does not cause uncontrolled duplicate order creation;
- Razorpay Order ID persists correctly.

Manual:

- real Test Mode Order appears in Razorpay Dashboard.

---

## 7.4 Checkout Verification Tests

Automated:

- valid signature accepted;
- invalid signature rejected;
- wrong payment ID rejected;
- wrong order relationship rejected;
- browser order ID cannot override trusted server order.

Manual:

- real Test Mode Checkout completes.

---

# 8. Webhook Testing

Webhook tests must cover authentication, input handling, idempotency and processing.

---

## Mandatory Cases

```text
valid signature
invalid signature
missing signature
modified raw body
malformed payload
supported event
unsupported event
duplicate event
repeated processing
out-of-order processing
database failure
```

---

## Real Webhook Verification

A real Test Mode webhook must show:

- measured `latency_ms` below 5000 ms for the normal critical durable request path;
- valid signature;
- `x-razorpay-event-id`;
- event type;
- Razorpay identifiers;
- correct correlation;
- `REAL_RAZORPAY_WEBHOOK` provenance.

---

## Invalid Signature Rule

The strongest assertion is not merely:

```text
HTTP request rejected
```

It is:

```text
HTTP request rejected
+
zero trusted webhook insertion
+
zero order mutation
+
zero payment mutation
+
zero fulfilment
```

---

# 9. Chaos Scenario Testing

The frozen mandatory P0 scenario-wrapper suite consists of:

```text
C01 Duplicate webhook delivery
C03 Invalid webhook signature
C07 Payment succeeds but client confirmation is lost
C11 Failed payment must never mark order paid
```

The following existing wrappers are P1:

```text
C02 C04 C05 C06 C08 C09 C10 C12 C13 C14 C15
```

Each implemented P0 scenario requires automated verification.

Deferring a dedicated scenario wrapper to P1 does **not** defer the underlying mandatory P0 correctness test. P0 must still test, where required by the domain specifications:

- out-of-order state safety;
- retry/idempotency safety;
- transaction rollback/atomicity;
- unsupported-event no-effect behavior;
- replay/stale-event safety;
- business-effect uniqueness.

---

## Scenario Test Contract

Every chaos scenario test must verify:

1. preconditions;
2. safety precheck;
3. known initial state;
4. correct mechanism classification;
5. fault/replay activation;
6. relevant processing attempts;
7. expected final state;
8. mapped Money Invariants;
9. evidence persistence;
10. provenance;
11. cleanup/reset;
12. scenario result.

---

## Vulnerable-Path Test

Where the Demo Merchant deliberately exposes a vulnerable mode:

the automated test must prove that PayChaos actually detects it.

A vulnerable demo that accidentally still passes is not a valid demonstration.

---

## Corrected-Path Test

The corresponding healthy/fixed implementation must pass the same supported scenario.

---

# 10. Money Invariant Testing

The authoritative P0 invariant set is:

```text
INV-001 Unique Webhook Protected Logic Once
INV-002 One Captured Payment, At Most One Fulfilment
INV-003 Failed Payment Never Marks Order Paid
INV-004 Fulfilment Requires Verified Successful Payment
INV-005 Invalid Webhook Signature Causes Zero Mutation
INV-006 Processed Event Replay Preserves Final Business State
INV-007 Duplicate Delivery Creates No Duplicate Business Record
INV-008 Order / Attempt / Payment Amount and Currency Consistency
INV-009 Failed Processing Is Atomic or Safely Retryable
INV-010 Fulfilment Has Exactly One Valid Payment Path
INV-011 Payment State Is Legal, Monotonic and Convergent
INV-012 Unsupported Event Causes No Business Effect
```

---

## Required Result Tests

Each invariant must test:

```text
PASS
FAIL
UNKNOWN
```

where logically applicable.

If a particular invariant cannot logically produce one of these states, that exception must be documented.

---

## Determinism Test

For each invariant:

```text
same evidence snapshot
+
same invariant version
```

evaluated repeatedly must produce exactly the same:

- result;
- reason;
- expected summary;
- observed summary;
- affected entity interpretation.

Timestamps generated by persistence may differ.

The correctness decision must not.

---

## Authoritative Scenario Mapping

Tests must use the authoritative mappings from `MONEY_INVARIANTS.md`:

| Scenario | Priority | Required Invariants |
|---|---|---|
| C01 | P0 | INV-001, INV-002, INV-006, INV-007 |
| C02 | P1 | INV-002, INV-004, INV-011 |
| C03 | P0 | INV-004, INV-005 |
| C04 | P1 | INV-001, INV-002, INV-009, INV-011 |
| C05 | P1 | INV-001, INV-002, INV-009, INV-011 |
| C06 | P1 | INV-002, INV-004, INV-007, INV-010 |
| C07 | P0 | INV-002, INV-004, INV-011 |
| C08 | P1 | INV-002, INV-009, INV-010, INV-011 |
| C09 | P1 | INV-002, INV-006, INV-011 |
| C10 | P1 | INV-012 |
| C11 | P0 | INV-003, INV-004, INV-011 |
| C12 | P1 | INV-004, INV-014 |
| C13 | P1 | INV-011 |
| C14 | P1 | No dedicated money invariant unless an independent money invariant evaluates |
| C15 | P1 | INV-001, INV-002, INV-009, INV-011 |

These mappings supersede the retired provisional invariant references in the original chaos catalogue.

---

# 11. Diagnosis Testing

P0 diagnosis is deterministic.

It must be tested as an expert-rule system.

---

## Required Tests Per Root-Cause Category

For each P0 diagnosis category:

- positive evidence pattern;
- negative pattern;
- contradictory evidence;
- insufficient-evidence path;
- deterministic candidate ranking;
- recommendation mapping.

---

## Diagnosis Must Never Invent Facts

A diagnosis test must prove that every factual statement presented as supporting evidence can be traced to stored evidence.

---

## Evidence-Strength Tests

Test:

```text
STRONG_EVIDENCE
PARTIAL_EVIDENCE
INSUFFICIENT_EVIDENCE
```

against known evidence patterns.

---

## Scenario ID Is Not Enough

A diagnosis test must not simply assert:

```text
C01 → MISSING_IDEMPOTENCY
```

The failed invariant and evidence signals must support the classification.

---

# 12. Reliability Score Testing

Reliability Score testing is mandatory in Phase 4.

The authoritative algorithm is `RELIABILITY-V1` in `AI_DESIGN.md`.

The score must be:

- deterministic;
- reproducible;
- based on persisted genuine results;
- explainable;
- independent of AI/ML/LLM output.

## Mandatory Scenario Inputs

The four required P0 scenario inputs are:

```text
C01
C03
C07
C11
```

For each scenario, tests must select the latest eligible terminal run with `data_classification = RECORDED_TEST_EVIDENCE`. `SYNTHETIC_DEMO` is excluded. If none exists, the derived current state is NOT RUN.

## Exact Deduction Vectors

Tests must assert these exact `RELIABILITY-V1` deductions:

| State | Deduction |
|---|---:|
| PASS | 0 |
| FAIL Critical | 25 |
| FAIL High | 20 |
| FAIL Medium | 15 |
| FAIL Low | 10 |
| UNKNOWN | 15 |
| BLOCKED | 15 |
| ERROR | 15 |
| NOT RUN | 15 |

Formula:

```text
score = max(0, 100 - sum(C01, C03, C07, C11 deductions))
```

## Scenario-Aware Score Eligibility

Every score fixture must respect the frozen scenario-aware classification
matrix in `AI_DESIGN.md` → `Reliability Score V1`:

| Scenario | Required `chaos_runs.data_classification` |
|---|---|
| C01 | `RECORDED_TEST_EVIDENCE` |
| C03 | `SYNTHETIC_DEMO` |
| C07 | `RECORDED_TEST_EVIDENCE` |
| C11 | `RECORDED_TEST_EVIDENCE` |

The required classification is exact in both directions. `SYNTHETIC_DEMO` is
score-eligible **only** for C03; a C03 run labelled `RECORDED_TEST_EVIDENCE`
is ineligible.

Selection ordering is `LATEST_SELECTION_V1` — `created_at DESC, id DESC` —
applied after eligibility filtering. `completed_at` is required for finality
but is never the ordering key.

## Required Exact Fixtures

### SCORE-FIX-01 — All Required PASS

```text
C01 PASS
C03 PASS
C07 PASS
C11 PASS
Expected score = 100
```

With every readiness gate satisfied, expected readiness = READY.

### SCORE-FIX-02 — One Critical Failure

```text
3 PASS + 1 Critical FAIL
Expected score = 75
Expected readiness = NOT READY
```

### SCORE-FIX-03 — One High Failure

```text
3 PASS + 1 High FAIL
Expected score = 80
Expected readiness = NOT READY
```

### SCORE-FIX-04 — One UNKNOWN

```text
3 PASS + 1 UNKNOWN
Expected score = 85
Expected readiness = NEEDS ATTENTION
```

### SCORE-FIX-05 — One BLOCKED

```text
3 PASS + 1 BLOCKED
Expected score = 85
Expected readiness = NEEDS ATTENTION
```

### SCORE-FIX-06 — One ERROR

```text
3 PASS + 1 ERROR
Expected score = 85
Expected readiness = NEEDS ATTENTION
```

### SCORE-FIX-07 — One NOT RUN

```text
3 PASS + 1 NOT RUN
Expected score = 85
Expected readiness = NEEDS ATTENTION
```

### SCORE-FIX-08 — Successful Regression

Original scenario run:

```text
FAIL Critical
```

Newer eligible regression chaos run:

```text
PASS
```

Expected:

- historical FAIL remains stored;
- latest scenario deduction = 0;
- score uses the new current PASS state.

### SCORE-FIX-09 — Still-Failing Regression

Newer eligible regression remains FAIL.

Expected:

- original history remains;
- current deduction still reflects the latest FAIL severity;
- readiness remains NOT READY.

### SCORE-FIX-10 — Synthetic Data Exclusion

Use a scenario whose eligibility requires `RECORDED_TEST_EVIDENCE` — that is
**C01, C07 or C11**, never C03.

Add a newer:

```text
SYNTHETIC_DEMO
```

run for that scenario that would otherwise change the score.

Expected:

- genuine score is unchanged;
- the synthetic run is not selected as the current genuine result;
- an older eligible `RECORDED_TEST_EVIDENCE` run remains the current state.

This fixture must **not** be written against C03, whose approved provenance is
`SYNTHETIC_DEMO` and which is deliberately score-eligible under that
classification.

### SCORE-FIX-11 — C03 Synthetic Is Eligible

```text
C03 run, data_classification = SYNTHETIC_DEMO
status = COMPLETED, outcome = PASS, completed_at set
```

Expected:

- the run **is** eligible;
- current state = `PASS`;
- deduction = 0;
- the breakdown reports C03 provenance as `SYNTHETIC_DEMO`, described as a
  controlled PayChaos security simulation;
- the breakdown never describes C03 as a real Razorpay event or recorded
  provider evidence.

### SCORE-FIX-12 — C03 Recorded Evidence Is Ineligible

```text
C03 run, data_classification = RECORDED_TEST_EVIDENCE
status = COMPLETED, outcome = PASS, completed_at set
```

Expected:

- the run is **not** eligible;
- it is not selected as C03's current state;
- if it is the only C03 candidate, C03 is `NOT RUN` with deduction 15.

This guards against "fixing" a low score later by falsely relabelling C03 as
real recorded evidence.

### SCORE-FIX-13 — Terminal Technical Failure

```text
status = FAILED, outcome = ERROR, completed_at set
```

Expected:

- the run is eligible (`FAILED` is a terminal status);
- current state = `ERROR`;
- deduction = 15.

### SCORE-FIX-14 — Inconsistent FAIL Contract

```text
status = COMPLETED, outcome = FAIL
zero persisted invariant_results rows with result = FAIL
```

Expected:

- current state = `ERROR`;
- deduction = 15;
- never `PASS`, and never a severity-derived deduction.

### SCORE-FIX-15 — Deterministic Tie-Break

Two eligible candidates for the same scenario with the **same** `created_at`
and different `id` values.

Expected:

- the higher `id` under deterministic descending string ordering is selected;
- the result is stable across repeated evaluation.

### SCORE-FIX-16 — `created_at` Beats `completed_at`

Two eligible candidates where the run with the **later** `created_at` has the
**earlier** `completed_at`.

Expected:

- the later `created_at` wins, per `LATEST_SELECTION_V1`;
- `completed_at` ordering does not influence selection.

### SCORE-FIX-17 — Non-Final Rows Are Not Eligible

```text
outcome = null
completed_at = null
```

Expected:

- neither row is score-eligible;
- no arithmetic is invented for an unfinished run;
- if no other candidate exists, the scenario is `NOT RUN` with deduction 15.

## Readiness Gate Tests

Test the exact `Go-Live Readiness V1` rules from `AI_DESIGN.md`, including:

- baseline failure => NOT READY;
- Live/Test/security gate failure => NOT READY;
- unresolved Critical/High P0 finding => NOT READY;
- required UNKNOWN/BLOCKED/ERROR/NOT RUN => NEEDS ATTENTION when no NOT READY condition applies;
- READY only when score = 100 and all required verification gates pass.

## Score Repeatability

Same persisted source data + `RELIABILITY-V1` must produce:

```text
same score
same readiness
same breakdown
```

---

# 13. Security Testing

Security testing is P0.

Required coverage includes:

- Test Mode enforcement;
- valid/invalid signatures;
- replay protection;
- database authorization;
- client/server secret separation;
- unauthorized chaos;
- arbitrary-target rejection;
- malformed input;
- AI authority isolation;
- secret-safe errors/logs.

---

## Critical Security Failure Rule

Any confirmed issue involving:

```text
Live Mode possibility
secret exposure
forged webhook acceptance
unauthorized fulfilment
duplicate fulfilment
arbitrary chaos target
unauthorized chaos
service-role client exposure
AI payment authority
```

blocks final approval.

---

# 14. UI Testing

UI tests should focus on reliability information, not pixel-perfect snapshots.

Required UI assertions include:

- Test Mode label visible;
- correct payment/business states;
- evidence provenance badges;
- chaos status visible;
- invariant result visible;
- Finding details visible;
- evidence/inference distinction visible;
- regression status visible;
- Reliability Score breakdown visible;
- readiness disclaimer visible.

---

## Avoid Brittle UI Tests

Do not rely unnecessarily on:

- exact DOM nesting;
- fragile CSS classes;
- text positions;
- animations.

Prefer:

- roles;
- labels;
- semantic text;
- stable `data-testid` only where necessary.

---

# 15. E2E Testing

Use:

```text
Playwright
```

for application-level browser workflows.

---

## E2E Scope

Playwright should cover PayChaos-controlled behavior.

Real Razorpay-hosted Checkout may remain a manual verification step if provider-hosted payment automation is unstable or unsuitable.

Do not fake a Razorpay Checkout test and claim it proved the external provider flow.

---

## Core E2E Paths

### E2E-01 — Phase 1 Demo Merchant

```text
Open app
→ Demo Merchant
→ create/view order
→ state visible
```

---

### E2E-02 — Evidence Inspection

```text
Open known test dataset
→ payment
→ webhook
→ source label
→ current merchant state
```

---

### E2E-03 — Chaos Failure Flow

```text
Open chaos
→ select C01 demo scenario
→ run
→ view invariant FAIL
→ open Finding
→ inspect evidence
```

---

### E2E-04 — Regression Flow

```text
Open Finding
→ start regression
→ rerun same scenario
→ new invariant PASS
→ Finding RESOLVED
```

---

### E2E-05 — Reliability Overview

```text
Open reliability
→ score visible
→ breakdown visible
→ readiness visible
→ disclaimer visible
```

---

## Main Final E2E

The final critical Playwright path should cover the application-controlled portion of the judge-facing flow:

```text
known state
→ chaos
→ invariant
→ finding
→ diagnosis
→ regression
→ reliability overview
```

Real external Checkout and real webhook are then manually verified as part of final deployment QA.

---

# 16. Regression Testing

Regression has two meanings.

---

## 16.1 Software Regression Tests

When a confirmed product bug is fixed:

add an automated test reproducing it where technically feasible.

---

## 16.2 PayChaos Domain Regression

The product itself supports:

```text
Original invariant FAIL
→ Finding
→ fix
→ new chaos run
→ new invariant evaluation
→ RESOLVED / STILL_FAILING
```

The original result must never be overwritten.

---

# BUG REGRESSION RULE

Every confirmed P0 or P1 software bug fixed after discovery must receive a regression test where technically feasible.

The regression test should:

1. reproduce the original faulty behavior;
2. fail before the fix where practical;
3. pass after the fix;
4. remain in the permanent test suite.

If an automated regression is technically infeasible:

the handoff must document:

- why;
- manual reproduction steps;
- manual verification evidence.

---

# 17. Manual QA

Manual QA complements automation.

It is mandatory for external integrations and judge-facing behavior.

---

## Manual QA Responsibilities

The developer must verify:

- real Razorpay Test Mode flow;
- real webhook arrival;
- Razorpay Dashboard state;
- deployed environment configuration;
- browser secret exposure;
- UI provenance;
- responsive behavior;
- final demo sequence.

---

## Manual Evidence

Acceptable evidence may include:

- screenshots;
- Razorpay Test Mode event/payment IDs;
- Supabase record inspection;
- browser screenshots;
- terminal test output;
- Vercel deployment URL.

Never capture secret values.

---

# 18. Demo Rehearsal Testing

A technically correct product may still fail during presentation.

The demo therefore has its own test.

---

## Rehearsal Target

The main story should fit within approximately:

```text
5 minutes
```

without rushing critical explanations.

---

## Rehearsal Flow

```text
1. Open PayChaos
2. Show Razorpay Test Mode label
3. Show healthy Test Mode payment/evidence
4. Run one strong chaos scenario
5. Show deterministic invariant failure
6. Show Finding
7. Show factual evidence
8. Show diagnosis/recommendation
9. Run regression/fixed path
10. Show PASS / RESOLVED
11. Show Reliability Score
12. Show Go-Live Readiness
```

---

## Recommended Main Demo Scenario

The frozen primary final demo scenario is:

```text
C01 Duplicate Webhook Delivery
```

C06 is an optional P1 supporting scenario only if it is implemented after mandatory P0 approval. It must not replace C01 as the primary final demo.

---

## Rehearsal Rule

The complete judge-facing sequence must be performed successfully at least twice before final approval.

---

# 19. Test Data Strategy

PayChaos uses four data classes.

---

## Data Class A — Real Razorpay Test Mode Evidence

Created through real Test Mode interaction.

Examples:

- Razorpay Order;
- Razorpay Payment;
- real webhook.

Use for:

- manual integration verification;
- authentic replay source;
- final demo.

---

## Data Class B — Captured Sanitized Test Fixtures

Derived from authentic Test Mode evidence but sanitized.

Use for:

- normalization;
- webhook processing;
- replay;
- unit/integration testing.

Must not be presented as a newly delivered Razorpay event.

---

## Data Class C — Deterministic Synthetic Fixtures

Hand-created controlled application states.

Use for:

- invariant FAIL/PASS/UNKNOWN;
- database failure;
- score fixtures;
- diagnosis signals;
- security tests.

---

## Data Class D — Synthetic Demo Fallback

Use only if a backup demo state is required.

Must use explicit:

```text
SYNTHETIC_DEMO
```

classification.

Must not silently enter genuine Reliability Score inputs.

---

# 20. Fixture Strategy

Fixtures must remain small and understandable.

Preferred fixture groups:

```text
webhook/payment-captured
webhook/payment-failed
webhook/order-paid
webhook/unknown-event
webhook/invalid-signature-input
merchant/healthy-paid
merchant/unpaid
merchant/duplicate-fulfilment-vulnerable
merchant/partial-processing
invariants/*
diagnosis/*
score/*
```

Exact file paths remain implementation-level.

---

## Fixture Rules

Fixtures must:

- contain no Key Secret;
- contain no webhook secret;
- contain no service-role key;
- contain no PAN;
- contain no CVV;
- contain no OTP;
- remove unnecessary personal data.

---

## Fixture Provenance

Fixtures must not use:

```text
REAL_RAZORPAY_WEBHOOK
```

as evidence of a current delivery.

Use:

```text
TEST_FIXTURE
```

or explicit captured-fixture metadata.

---

# 21. Synthetic / Demo Data Rules

Synthetic data is useful for testing.

It is not factual provider evidence.

Rules:

1. synthetic fixtures may test invariant logic;
2. synthetic runs must be visibly classified;
3. synthetic histories must not be presented as genuine real-world history;
4. synthetic runs cannot silently improve/decrease the genuine Reliability Score;
5. synthetic data must never be described as a webhook Razorpay actually sent.

---

# 22. Test Isolation

Tests must not depend on execution order.

---

## Unit Isolation

Each unit test creates its own inputs.

---

## Database Isolation

Use one of:

- per-test transaction rollback where compatible;
- unique test identifiers;
- controlled cleanup;
- dedicated test database/schema.

Do not rely on arbitrary existing rows.

---

## Chaos Isolation

Each chaos run gets its own:

```text
chaos_run_id
```

Fault state belongs to that run.

No global persistent fault should affect another test.

---

## External Integration Isolation

Razorpay Test Mode is the only external payment environment.

Never use Live Mode for testing.

---

# 23. Test Reset / Cleanup

Cleanup is part of correctness.

---

## Scenario Cleanup

After each scenario:

- disable fault state;
- release held processing if appropriate;
- close/complete run state;
- ensure no global fault remains.

Cleanup should occur even after:

```text
FAIL
ERROR
```

where technically possible.

---

## Demo Reset

Demo Reset clears runtime/demo records in this dependency-safe order:

```text
fulfilments
regression_runs
event_processing_attempts
findings
invariant_results
chaos_runs
webhook_events
payments
payment_attempts
orders
```

CORRECTED (Phase 5): `fulfilments` is deleted FIRST, because
`fulfilments.trigger_processing_attempt_id` references
`event_processing_attempts` `ON DELETE RESTRICT`. The previously documented
order deleted `event_processing_attempts` first and failed in production.

Every delete is qualified as `where id is not null`. Supabase `safeupdate`
refuses an unqualified `DELETE` in the API role context (SQLSTATE `21000`),
which is why an unqualified form can pass in the SQL editor and still fail
from the application. A static test fails if any of the ten deletes loses its
`WHERE`; safeupdate itself stays enabled.

The reset runs as ONE transaction inside
`public.reset_paychaos_demo_runtime()`. **If it fails, zero reset-table
mutations commit** — a partial reset is not a reachable state, and tests must
not assert one.

Order is asserted by a test that DERIVES the foreign-key graph from the
migrations rather than from a hand-written list of pairs. The previous test
hand-listed seven pairs, omitted the one that mattered, and passed while the
order was wrong.

---

## Demo Reset Must Preserve

```text
database schema
migration history
RLS
environment secrets
Razorpay configuration
source-controlled fixtures
```

---

## Reset Security

Reset is server-side administrative behavior.

It must not be an unrestricted public endpoint.

---

# 24. CI Testing

CI should remain simple and free.

Recommended CI responsibilities:

```text
install dependencies
typecheck
lint
unit/integration tests
production build
Playwright where environment supports it
```

---

## CI Must Not Require Real Razorpay Secrets

Ordinary CI should use:

- fake test-only signing secrets;
- sanitized fixtures;
- test database credentials where safely configured.

Real Razorpay Test Mode provider verification remains a protected/manual test.

---

## CI Secret Rule

Never print:

```text
env
printenv
secret values
full environment dump
```

in CI logs.

---

## Pull Request / Branch Rule

No branch may be merged into `main` after phase approval if mandatory CI/test gates are red.

---

# 25. Local Testing

Local development is the primary implementation feedback loop.

Recommended order:

```text
focused test
→ related test file/module suite
→ complete Vitest suite
→ typecheck
→ lint
→ build
→ Playwright if affected
```

---

## When Database Logic Changes

Also run:

- migration tests;
- constraint tests;
- relevant integration tests.

---

## When Webhook Logic Changes

Also run:

- signature tests;
- raw-body tests;
- duplicate tests;
- malformed-input tests.

---

## When Chaos Logic Changes

Also run:

- scenario safety;
- cleanup;
- provenance;
- mapped invariant tests.

---

# 26. Pre-Merge Checks

Before merging an approved phase branch into `main`:

1. required source-of-truth docs reviewed;
2. relevant acceptance criteria checked;
3. mandatory command gate passes;
4. affected integration tests pass;
5. affected Playwright tests pass;
6. manual checks complete;
7. known issues documented;
8. phase handoff complete;
9. no P0 blocker remains;
10. approval explicitly given.

---

# MANDATORY COMMAND GATE

Before phase approval, run the relevant equivalents of:

```bash
npm run build
npm run lint
npm run typecheck
npm test
```

When Playwright is introduced/affected:

```bash
npx playwright test
```

or the repository-defined equivalent.

---

## Important Command Rule

These are the conceptual mandatory commands.

When implementation begins:

the repository may use different script names.

The phase handoff must record the **actual exact command** used.

Example:

```text
Typecheck command:
npm run typecheck

Exit code:
0
```

---

## Command Evidence Required

For every mandatory command record:

```text
command
date/time if useful
exit code
passed count
failed count
skipped count
relevant warning/error summary
```

Where a tool does not provide a test count:

record:

```text
count not reported by tool
```

Do not invent one.

---

# 27. Phase Completion Checks

The global state remains:

```text
IMPLEMENTED
→ TESTED
→ MANUALLY VERIFIED
→ DOCUMENTED
→ APPROVED
```

`IMPLEMENTED` alone never advances the phase.

---

# PHASE TEST GATES

# Phase 1 Approval Gate

Phase 1 may be approved only when all required foundation checks pass.

## Automated

Required:

- Demo Merchant domain unit tests;
- amount validation;
- state-transition tests;
- environment validation;
- Supabase connectivity/integration;
- migration tests;
- RLS/security-foundation tests;
- Phase 1 Playwright flow;
- build;
- lint;
- typecheck.

---

## Manual

Developer verifies:

```text
Open app
→ Demo Merchant
→ create/view order
→ correct amount/currency
→ correct unpaid state
→ refresh
→ data persists
```

Also verify:

- no server secret in browser;
- expected Supabase rows exist.

---

## Evidence Required

- exact commands;
- exit codes;
- test summary;
- Playwright result;
- screenshot/manual notes;
- acceptance criteria status.

---

## Blocking Failures

- build failure;
- migration failure;
- broken Demo Merchant state;
- secret exposure;
- browser authoritative write;
- required test failure.

---

# Phase 2 Approval Gate

Phase 2 requires both automation and real Razorpay Test Mode verification.

## Automated

Must cover:

- Test key accepted;
- Live key rejected;
- Checkout signature valid/invalid;
- webhook valid/invalid/missing signature;
- modified raw body;
- event normalization;
- supported events;
- unknown event safe handling;
- database event dedupe;
- concurrent duplicate insertion where practical;
- business-effect idempotency;
- out-of-order state safety;
- API failure handling;
- build/type/lint.

---

## Manual Real Integration

Must prove:

```text
real Test Mode Order
real Standard Checkout
real Test Mode Payment
server Checkout verification
real Test Mode webhook
webhook signature verification
database persistence
correct order/payment correlation
exactly one fulfilment
```

Mocks alone are insufficient.

---

## Required Event Coverage

P0 handles:

```text
payment.captured
payment.failed
order.paid
```

---

## Phase 2 Cannot Be Approved If

- no real webhook has been received;
- the measured normal deployed webhook request path is 5000 ms or slower;
- invalid signature can mutate state;
- duplicate processing creates duplicate fulfilment;
- Live key is accepted;
- a public payment-enabled deployment bypasses the required operator access gate;
- secret appears client-side;
- build/tests fail.

---

# Phase 3 Approval Gate

Phase 3 requires:

```text
STATIC SCENARIO REGISTRY       PASS
CHAOS SAFETY GATE              PASS
CONTROLLED REPLAY              PASS
P0 FAILURE INJECTION           PASS
INVARIANT ENGINE               PASS
PASS/FAIL/UNKNOWN              PASS
FINDING GENERATION             PASS
EVIDENCE TRACEABILITY          PASS
PROVENANCE LABELING            PASS
AUTOMATED TESTS                PASS
MANUAL VERIFICATION            PASS
```

---

## Automated Requirements

For every implemented P0 scenario:

- safety precheck;
- injection/replay;
- expected result;
- mapped invariants;
- evidence;
- provenance;
- cleanup.

Every P0 invariant:

- deterministic tests;
- PASS;
- FAIL;
- UNKNOWN where applicable.

---

## Manual

Developer must successfully:

```text
real baseline evidence
→ choose scenario
→ run
→ inspect run ID
→ inspect replay/simulation
→ inspect invariant
→ inspect Finding
→ inspect evidence
→ reset/rerun
```

Original real Razorpay evidence must remain unchanged.

---

# Phase 4 Approval Gate

Phase 4 requires:

```text
EVIDENCE PACKS                PASS
DETERMINISTIC DIAGNOSIS       PASS
RECOMMENDATIONS               PASS
REGRESSION ENGINE             PASS
HISTORY PRESERVATION          PASS
DETERMINISTIC SCORE           PASS
SCORE BREAKDOWN               PASS
GO-LIVE READINESS             PASS
NO PAID RUNTIME AI            VERIFIED
AUTOMATED TESTS               PASS
MANUAL VERIFICATION           PASS
```

---

## Diagnosis Tests

Required:

- root-cause mappings;
- supporting evidence;
- contradictory evidence;
- insufficient evidence;
- recommendation mapping.

---

## Regression Tests

Required:

- original Finding remains;
- new chaos run exists;
- same scenario is used;
- new invariant result created;
- RESOLVED only after approved passing result;
- STILL_FAILING remains failing.

---

## Reliability Tests

Required:

- all-pass fixture;
- Critical failure fixture;
- mixed severity fixture;
- UNKNOWN fixture;
- resolved regression fixture;
- unresolved regression fixture;
- synthetic-data exclusion.

---

## AI Failure Test

Diagnosis provider failure must leave:

- Finding intact;
- invariant intact;
- score available;
- regression available.

---

# Phase 5 Approval Gate

Final project approval requires:

```text
ALL P0 FEATURES               COMPLETE
FULL TEST SUITE               PASS
PRODUCTION BUILD              PASS
SECURITY REVIEW               PASS
VERCEL DEPLOYMENT             PASS
SUPABASE DEPLOYMENT           PASS
REAL TEST MODE PAYMENT        VERIFIED
REAL TEST MODE WEBHOOK        VERIFIED
CHAOS RUN                     VERIFIED
INVARIANT ENGINE              VERIFIED
FINDING                       VERIFIED
DIAGNOSIS                     VERIFIED
REGRESSION                    VERIFIED
RELIABILITY SCORE             VERIFIED
DEMO REHEARSAL                PASS
DOCUMENTATION                 COMPLETE
```

---

## Additional Phase 5 Requirements

- critical Playwright flow passes;
- deployment URL works;
- deployed Supabase schema correct;
- no Critical security issue remains;
- no secret exposed;
- responsive UI acceptable;
- console has no unexplained critical error;
- README/source docs match reality;
- complete demo rehearsed twice.

---

# 28. Final Submission QA

Final submission QA is performed against the deployed system.

No new architecture work should begin during this gate.

Fix confirmed blockers only.

---

# 29. Failure-Reporting Format

Every failed automated/manual verification should be recorded in a consistent form.

```text
TEST / ISSUE ID:
Txx or BUG-xxx

Title:

Phase:

Priority:
P0 / P1 / P2

Severity:
BLOCKER / HIGH / MEDIUM / LOW

Environment:
LOCAL / CI / VERCEL TEST MODE

Preconditions:

Steps:

Expected Result:

Actual Result:

Evidence:
test output / screenshot / DB rows / safe IDs

Affected Requirement:

Affected Scenario / Invariant:

Reproducible:
YES / NO / INTERMITTENT

Root Cause:
UNKNOWN until verified

Fix:

Regression Test:

Re-Test Result:

Status:
OPEN / FIXED / VERIFIED
```

Do not write an assumed root cause as a confirmed fact.

---

# 30. Known Testing Limitations

## Limitation 1 — Razorpay Is an External Service

Automated local tests cannot prove external Test Mode availability.

Manual Test Mode verification is required.

---

## Limitation 2 — Razorpay Checkout Browser Automation

Automating provider-hosted Checkout may be brittle.

PayChaos may keep the final external Checkout interaction manual while automating application-controlled flow.

---

## Limitation 3 — Serverless Timing

Exact timing behavior on Vercel may differ from local execution.

Timeout scenarios should use deterministic injected deadlines rather than fragile long sleeps.

---

## Limitation 4 — Free-Tier Infrastructure

Supabase/Vercel free-tier cold starts or transient latency may occur.

Do not classify every infrastructure delay as a merchant payment correctness failure.

---

## Limitation 5 — No Production Testing

No test proves Live Mode production behavior.

PayChaos deliberately does not test Live Mode.

---

## Limitation 6 — No Full Load Test

P0 does not need large-scale load/performance testing.

Concurrency tests should target correctness races such as:

- duplicate webhook insertion;
- duplicate fulfilment.

---

## Limitation 7 — Exact Score Formula Is Frozen in AI_DESIGN.md

The Reliability Score formula and readiness thresholds are no longer pending.

`RELIABILITY-V1` and `Go-Live Readiness V1` are frozen in `AI_DESIGN.md` Section 54, including the
exact deduction table and formula. Section 12 of this document already asserts those exact
deduction vectors and the `SCORE-FIX-01`–`SCORE-FIX-17` fixtures against that frozen algorithm (`SCORE-FIX-11` through `SCORE-FIX-17` were added by the Phase 4F-C0 scenario-aware eligibility correction).

Phase 4 implementation and testing must use `RELIABILITY-V1` and `Go-Live Readiness V1` as written in
`AI_DESIGN.md`. Do not invent a different formula or numeric weights, and do not treat the score or
readiness rules as still open for design during Phase 4.

---

## Limitation 8 — No Enterprise Browser Matrix

P0 should prove the main browser path used for the demo.

Broad enterprise cross-browser testing is optional after core correctness.

---

# 31. P0 / P1 / P2 Test Priorities

## P0 — Mandatory

P0 testing includes:

- foundation unit tests;
- database constraints;
- RLS;
- Razorpay Test Mode integration;
- webhook authentication;
- idempotency;
- C01, C03, C07 and C11 mandatory scenario verification;
- underlying P0 correctness tests for deferred P1 wrapper behaviors;
- INV-001–INV-012;
- findings;
- evidence;
- deterministic diagnosis;
- regression;
- score/readiness;
- security;
- critical Playwright;
- deployed manual flow.

---

## P1 — Only After P0

Potential P1 tests include:

- C02, C04, C05, C06, C08, C09, C10 and C12–C15 if their scenario wrappers are implemented;
- ML classifier evaluation;
- historical score snapshots;
- richer trend/history;
- expanded browser coverage;
- stronger dependency/security automation.

---

## P2 — Stretch

Potential:

- Ollama behavior;
- advanced anomaly grouping;
- richer code-fix suggestions;
- large scenario libraries;
- performance/load experiments.

P2 test work must not delay P0 stability.

---

# COMPLETE P0 TEST MATRIX

Automation-status terminology:

```text
AUTO = mandatory automated
MANUAL = mandatory manual
HYBRID = automated + mandatory manual verification
```

Some mandatory P0 tests below exercise an underlying correctness behavior that also has a dedicated P1 scenario wrapper. In those cases, the P0 test may call the trusted processor/domain test harness directly; implementing the P1 UI/Chaos Runner wrapper is not required for P0 approval.

---

## T01 — Valid Razorpay Webhook Is Accepted

| Field | Definition |
|---|---|
| Test ID | `T01` |
| Requirement Covered | Verified Razorpay webhook processing |
| Test Level | Integration + manual external verification |
| Setup | Supported sanitized webhook fixture with valid test signing secret; separately obtain one genuine Razorpay Test Mode webhook |
| Action | Submit valid signed payload / receive real webhook |
| Expected Result | Signature valid; canonical event accepted; supported processing allowed |
| Automation | **HYBRID** |
| Phase | Phase 2 |
| Priority | P0 |

---

## T02 — Invalid Webhook Signature Is Rejected

| Field | Definition |
|---|---|
| Test ID | `T02` |
| Requirement Covered | Webhook authentication |
| Test Level | Integration / security |
| Setup | Supported fixture with incorrect signature |
| Action | POST to webhook verification boundary |
| Expected Result | Non-success trust result; event cannot enter trusted processing |
| Automation | **AUTO** |
| Phase | Phase 2 |
| Priority | P0 |

---

## T03 — Invalid Signature Causes Zero Business-State Mutation

| Field | Definition |
|---|---|
| Test ID | `T03` |
| Requirement Covered | INV-005 / C03 / SEC-003 |
| Test Level | Integration + database |
| Setup | Record order/payment/fulfilment counts before invalid request |
| Action | Send wrong/missing/modified signature payload |
| Expected Result | No trusted webhook; no payment/order/fulfilment mutation |
| Automation | **AUTO** |
| Phase | Phase 2 foundation, Phase 3 invariant wrapper |
| Priority | P0 |

---

## T04 — Duplicate Webhook Does Not Duplicate Fulfilment

| Field | Definition |
|---|---|
| Test ID | `T04` |
| Requirement Covered | Event + business idempotency |
| Test Level | Database / integration / chaos |
| Setup | Healthy paid path; one existing fulfilment; verified source event |
| Action | Process duplicate/replay multiple times |
| Expected Result | One canonical event; fulfilment count remains exactly one |
| Automation | **AUTO** |
| Phase | Phase 2 + Phase 3 C01 |
| Priority | P0 |

---

## T05 — Vulnerable Merchant Fails Duplicate-Webhook Chaos

| Field | Definition |
|---|---|
| Test ID | `T05` |
| Requirement Covered | Controlled vulnerable-path detection |
| Test Level | Chaos / invariant |
| Setup | Explicit vulnerable Demo Merchant profile that deliberately defeats semantic business idempotency in Test Mode |
| Action | Run approved duplicate-processing scenario |
| Expected Result | Duplicate business effect is created safely in controlled demo; relevant invariant FAILS; Finding created; provenance says PayChaos Simulation/Replay |
| Automation | **AUTO** |
| Phase | Phase 3 |
| Priority | P0 |

Important:

The test passes when **PayChaos correctly reports the vulnerable merchant as failing**.

It does not pass when the vulnerable merchant appears healthy.

---

## T06 — Out-of-Order Events Do Not Corrupt Safe Merchant

| Field | Definition |
|---|---|
| Test ID | `T06` |
| Requirement Covered | C02 / INV-011 |
| Test Level | Chaos integration |
| Setup | Correlated captured/order-paid evidence and known merchant state |
| Action | Replay supported events in alternate order |
| Expected Result | Final PAID/FULFILLED state remains correct; no duplicate fulfilment; no state regression |
| Automation | **AUTO** |
| Phase | Phase 3 |
| Priority | P0 |

---

## T07 — Failed Payment Cannot Mark Order Paid

| Field | Definition |
|---|---|
| Test ID | `T07` |
| Requirement Covered | C11 / INV-003 |
| Test Level | Integration / invariant |
| Setup | Failure-only authoritative evidence; no capture evidence |
| Action | Process failure |
| Expected Result | Order is not PAID; no fulfilment |
| Automation | **AUTO + manual Test Mode failure verification** |
| Phase | Phase 2/3 |
| Priority | P0 |

---

## T08 — Fulfilment Requires Authoritative Payment Verification

| Field | Definition |
|---|---|
| Test ID | `T08` |
| Requirement Covered | INV-004 |
| Test Level | Integration / invariant |
| Setup | Order with no authoritative captured-payment evidence |
| Action | Attempt fulfilment from browser success/unverified evidence |
| Expected Result | Fulfilment rejected/not created |
| Automation | **AUTO** |
| Phase | Phase 3 |
| Priority | P0 |

---

## T09 — Old Webhook Replay Preserves Final State

| Field | Definition |
|---|---|
| Test ID | `T09` |
| Requirement Covered | C09 / INV-006 |
| Test Level | Chaos integration |
| Setup | Successfully processed historical verified webhook; known final merchant state |
| Action | Replay internally as `PAYCHAOS_REPLAY` |
| Expected Result | Protected final state unchanged; no duplicate fulfilment; original event unchanged |
| Automation | **AUTO** |
| Phase | Phase 3 |
| Priority | P0 |

---

## T10 — Unknown Webhook Event Is Safe

| Field | Definition |
|---|---|
| Test ID | `T10` |
| Requirement Covered | C10 / INV-012 |
| Test Level | Unit + integration |
| Setup | `TEST_FIXTURE` with intentionally unsupported event type |
| Action | Normalize/process event |
| Expected Result | Unsupported/skipped safely; zero payment/business effect |
| Automation | **AUTO** |
| Phase | Phase 2/3 |
| Priority | P0 |

---

## T11 — Database Failure Does Not Leave Impossible State

| Field | Definition |
|---|---|
| Test ID | `T11` |
| Requirement Covered | C08 / INV-009 |
| Test Level | Database integration / chaos |
| Setup | Known pre-processing state; controlled DB failure checkpoint |
| Action | Inject failure during critical processing |
| Expected Result | Transaction safely rolls back or remains safely retryable; no impossible partial state |
| Automation | **AUTO** |
| Phase | Phase 3 |
| Priority | P0 |

---

## T12 — Duplicate Business Record Is Detected

| Field | Definition |
|---|---|
| Test ID | `T12` |
| Requirement Covered | INV-002 / INV-007 / C06 |
| Test Level | Invariant / database |
| Setup | Controlled vulnerable fixture with duplicate `FULFIL_ORDER` business-effect rows |
| Action | Evaluate mapped invariants |
| Expected Result | Deterministic FAIL; Critical Finding created |
| Automation | **AUTO** |
| Phase | Phase 3 |
| Priority | P0 |

For P0, the “ledger/business record” is the explicit:

```text
fulfilments
```

business-effect record.

PayChaos is not a financial ledger.

---

## T13 — Chaos Cannot Start Outside TEST

| Field | Definition |
|---|---|
| Test ID | `T13` |
| Requirement Covered | Chaos safety / Test Mode enforcement |
| Test Level | Security / unit + integration |
| Setup | `RAZORPAY_MODE` not `test` and/or Live-format key |
| Action | Request chaos run |
| Expected Result | `BLOCKED`; no replay, fault, mutation or external chaos call |
| Automation | **AUTO** |
| Phase | Phase 3 |
| Priority | P0 |

---

## T14 — Chaos Cannot Target Arbitrary URL

| Field | Definition |
|---|---|
| Test ID | `T14` |
| Requirement Covered | Arbitrary target prevention |
| Test Level | Security |
| Setup | Request includes unapproved `target_url`/host/IP field |
| Action | Attempt chaos run |
| Expected Result | Validation/security rejection; no outbound request |
| Automation | **AUTO** |
| Phase | Phase 3 |
| Priority | P0 |

---

## T15 — Razorpay Secrets Never Reach Client

| Field | Definition |
|---|---|
| Test ID | `T15` |
| Requirement Covered | SEC-001 / secret boundary |
| Test Level | Security + build/manual |
| Setup | Server configured with sentinel Test Mode secrets |
| Action | Inspect client bundle, API responses, browser runtime/DevTools |
| Expected Result | Key Secret and webhook secret absent |
| Automation | **HYBRID** |
| Phase | Phase 1/2/5 |
| Priority | P0 |

---

## T16 — Supabase Service-Role Key Never Reaches Client

| Field | Definition |
|---|---|
| Test ID | `T16` |
| Requirement Covered | SEC-010 |
| Test Level | Security + build/manual |
| Setup | Server-side sentinel service-role value |
| Action | Inspect bundles/network/browser environment |
| Expected Result | Privileged key absent |
| Automation | **HYBRID** |
| Phase | Phase 1/5 |
| Priority | P0 |

---

## T17 — Money Invariant Engine Is Deterministic

| Field | Definition |
|---|---|
| Test ID | `T17` |
| Requirement Covered | ARCH-INV-008 / MI-SAFE-008 |
| Test Level | Unit |
| Setup | Fixed evidence snapshots for every P0 invariant |
| Action | Evaluate repeatedly |
| Expected Result | Same result/reason for same version/input |
| Automation | **AUTO** |
| Phase | Phase 3 |
| Priority | P0 |

---

## T18 — Diagnosis Failure Cannot Change Invariant Truth

| Field | Definition |
|---|---|
| Test ID | `T18` |
| Requirement Covered | AI failure boundary |
| Test Level | Integration |
| Setup | Existing FAIL Finding; force diagnosis provider/rule explanation layer to error |
| Action | Run diagnosis |
| Expected Result | Invariant result unchanged; Finding remains; score/regression still available |
| Automation | **AUTO** |
| Phase | Phase 4 |
| Priority | P0 |

---

## T19 — Failed Invariant Creates Finding

| Field | Definition |
|---|---|
| Test ID | `T19` |
| Requirement Covered | Finding creation contract |
| Test Level | Integration |
| Setup | Persisted P0 invariant result = FAIL |
| Action | Invoke Finding creation |
| Expected Result | One structured Finding linked to invariant result |
| Automation | **AUTO** |
| Phase | Phase 3 |
| Priority | P0 |

---

## T20 — Finding Contains Factual Evidence

| Field | Definition |
|---|---|
| Test ID | `T20` |
| Requirement Covered | Evidence-first finding |
| Test Level | Integration |
| Setup | Known failed scenario |
| Action | Load Finding/evidence pack |
| Expected Result | References point to factual database/payment/event/processing evidence; no fabricated factual claim |
| Automation | **AUTO + manual UI inspection** |
| Phase | Phase 3/4 |
| Priority | P0 |

---

## T21 — Diagnosis Separates Evidence From Inference

| Field | Definition |
|---|---|
| Test ID | `T21` |
| Requirement Covered | AI trust model |
| Test Level | Unit + UI/integration |
| Setup | Known Finding with evidence and deterministic diagnosis |
| Action | Generate/display diagnosis |
| Expected Result | Supporting evidence IDs are factual; root cause/recommendation clearly advisory/inference |
| Automation | **HYBRID** |
| Phase | Phase 4 |
| Priority | P0 |

---

## T22 — Reliability Score Is Deterministic

| Field | Definition |
|---|---|
| Test ID | `T22` |
| Requirement Covered | ARCH-INV-010 / P4-AC-10 |
| Test Level | Unit |
| Setup | Frozen score fixture + algorithm version |
| Action | Calculate repeatedly |
| Expected Result | Identical score and breakdown |
| Automation | **AUTO** |
| Phase | Phase 4 |
| Priority | P0 |

Exact numeric assertions become mandatory when the Reliability Score specification freezes the formula.

---

## T23 — Critical Finding Blocks Highest Go-Live Ready State

| Field | Definition |
|---|---|
| Test ID | `T23` |
| Requirement Covered | Critical-finding readiness gate |
| Test Level | Unit |
| Setup | Score input containing unresolved Critical Finding |
| Action | Calculate readiness |
| Expected Result | Highest ready/review-ready classification is not returned |
| Automation | **AUTO** |
| Phase | Phase 4 |
| Priority | P0 |

Exact readiness label/threshold follows the future authoritative reliability specification.

---

## T24 — Regression Proves Fix

| Field | Definition |
|---|---|
| Test ID | `T24` |
| Requirement Covered | Regression lifecycle |
| Test Level | Integration / chaos |
| Setup | Original deterministic FAIL + Finding; corrected Demo Merchant behavior |
| Action | Rerun same scenario through Regression Engine |
| Expected Result | New invariant result = PASS; Finding may become RESOLVED; original FAIL remains stored |
| Automation | **AUTO + manual demonstration** |
| Phase | Phase 4 |
| Priority | P0 |

Important:

The historical invariant row does **not** literally change from FAIL to PASS.

Regression creates:

```text
old result = FAIL
new result = PASS
finding = RESOLVED
```

---

## T25 — Demo Reset Produces Deterministic Known State

| Field | Definition |
|---|---|
| Test ID | `T25` |
| Requirement Covered | Database reset contract |
| Test Level | Database integration |
| Setup | Runtime rows across all P0 tables |
| Action | Execute protected Demo Reset |
| Expected Result | Runtime/demo rows removed; schema/migrations/RLS/configuration/fixtures preserved; next baseline starts cleanly |
| Automation | **AUTO + manual final check** |
| Phase | Phase 3/5 |
| Priority | P0 |

---

## T26 — Production Build Passes

| Field | Definition |
|---|---|
| Test ID | `T26` |
| Requirement Covered | Deployability |
| Test Level | Build |
| Setup | Phase branch with required environment-safe build configuration |
| Action | Run repository build command |
| Expected Result | Exit code 0 |
| Automation | **AUTO** |
| Phase | Every phase; mandatory Phase 5 |
| Priority | P0 |

---

## T27 — Lint Passes

| Field | Definition |
|---|---|
| Test ID | `T27` |
| Requirement Covered | Static quality gate |
| Test Level | Static analysis |
| Setup | Repository |
| Action | Run lint script |
| Expected Result | Exit code 0 or explicitly reviewed non-blocking configuration warning |
| Automation | **AUTO** |
| Phase | Every phase once configured |
| Priority | P0 |

---

## T28 — TypeScript Typecheck Passes

| Field | Definition |
|---|---|
| Test ID | `T28` |
| Requirement Covered | Type correctness |
| Test Level | Static analysis |
| Setup | Repository |
| Action | Run typecheck |
| Expected Result | Exit code 0 |
| Automation | **AUTO** |
| Phase | Every phase |
| Priority | P0 |

---

## T29 — Core Automated Suite Passes

| Field | Definition |
|---|---|
| Test ID | `T29` |
| Requirement Covered | Overall automated correctness |
| Test Level | Unit + integration + security + scenario |
| Setup | Required test environment |
| Action | Run full relevant automated suite |
| Expected Result | No P0 failures; no unexplained critical skips |
| Automation | **AUTO** |
| Phase | Every phase; full suite Phase 5 |
| Priority | P0 |

---

## T30 — Main E2E Demo Flow Passes

| Field | Definition |
|---|---|
| Test ID | `T30` |
| Requirement Covered | Judge-facing workflow |
| Test Level | Playwright + manual external verification |
| Setup | Known healthy baseline / controlled demo state |
| Action | Execute main application flow through chaos, Finding, diagnosis, regression and readiness; verify real Test Mode payment/webhook separately where needed |
| Expected Result | Complete demo path works with correct evidence/provenance and no critical UI failure |
| Automation | **HYBRID** |
| Phase | Phase 5 |
| Priority | P0 |

---

# Additional Mandatory P0 Coverage

T01–T30 are the minimum named cross-project test matrix.

They do **not** replace lower-level tests required by the source-of-truth documents.

The implementation must additionally include focused tests for:

```text
all mandatory C01/C03/C07/C11 scenario contracts
all INV-001–INV-012 evaluators
database constraints
RLS
Checkout verification
payment/order amount+currency consistency
event provenance
processing-attempt history
diagnosis taxonomy
recommendation mapping
score fixtures
security input validation
reset cleanup
```

---

# NO TEST WEAKENING RULE

Tests exist to detect incorrect implementation.

They must not be changed merely to make the build green.

Do not:

- delete a failing critical test because it exposes a bug;
- reduce an assertion without documented technical justification;
- skip a critical test to reach approval;
- convert a failing test into a snapshot of broken behavior;
- mock away the exact behavior being verified;
- replace real database constraint testing with a mocked repository;
- replace required real Razorpay manual verification with mocks;
- change expected results merely to match broken implementation;
- remove an invariant FAIL fixture because implementation cannot pass it;
- silently exclude security failures from CI.

---

## When a Test May Legitimately Change

A test may change if:

1. source-of-truth requirements changed through approved documentation;
2. the test itself is proven incorrect;
3. a platform constraint changes expected behavior;
4. the test was flaky because it asserted irrelevant timing/implementation detail.

The handoff must explain:

```text
why the test changed
old behavior
new behavior
coverage impact
whether coverage became weaker
review decision
```

Any coverage weakening requires explicit review.

---

# 28. Final QA Checklist

## Fresh Repository

- [ ] clone repository from scratch;
- [ ] install dependencies successfully;
- [ ] no untracked required local file is missing.

---

## Environment Setup

- [ ] `.env.example` accurately lists required variables;
- [ ] local secret setup documented;
- [ ] Razorpay is Test Mode only;
- [ ] no Live credential exists.

---

## Database

- [ ] fresh migration succeeds;
- [ ] all expected P0 tables exist;
- [ ] required indexes/constraints exist;
- [ ] RLS active;
- [ ] Demo Reset works;
- [ ] reset preserves schema/RLS/migrations.

---

## Demo Seed / Reset

- [ ] no fake completed Razorpay history required;
- [ ] deterministic test fixtures available;
- [ ] fallback synthetic data clearly labeled;
- [ ] reset produces known state.

---

## Razorpay Test Mode Connectivity

- [ ] server creates real Test Mode Order;
- [ ] Standard Checkout opens;
- [ ] Test payment completes;
- [ ] Checkout signature verifies.

---

## Webhooks

- [ ] public deployed webhook reachable;
- [ ] real webhook arrives;
- [ ] signature verifies;
- [ ] event ID stored;
- [ ] event is labeled real;
- [ ] duplicate safe;
- [ ] invalid signature safe.

---

## Chaos Suite

- [ ] C01/C03/C07/C11 mandatory implementation status documented;
- [ ] P1 scenario-wrapper deferrals are documented without weakening underlying P0 correctness tests;
- [ ] required P0 scenarios pass their completion contracts;
- [ ] vulnerable demo path fails when expected;
- [ ] corrected path passes;
- [ ] cleanup works;
- [ ] arbitrary target blocked.

---

## Invariant Results

- [ ] INV-001–INV-012 implemented;
- [ ] PASS cases tested;
- [ ] FAIL cases tested;
- [ ] UNKNOWN cases tested where applicable;
- [ ] deterministic repeatability proven.

---

## Findings

- [ ] FAIL creates Finding;
- [ ] evidence trace exists;
- [ ] Finding contains expected/observed factual state.

---

## Diagnosis

- [ ] root cause derives from evidence/signals;
- [ ] evidence and inference visually separated;
- [ ] insufficient evidence behaves safely;
- [ ] recommendations are deterministic.

---

## Re-Test

- [ ] original failure remains;
- [ ] new regression run created;
- [ ] same scenario reruns;
- [ ] new invariant result created;
- [ ] resolved/still-failing status correct.

---

## Reliability Score

- [ ] deterministic;
- [ ] breakdown visible;
- [ ] UNKNOWN not treated as normal PASS;
- [ ] Critical unresolved finding affects readiness correctly;
- [ ] synthetic fallback data not silently included.

---

## Responsive UI

Verify at minimum:

- desktop;
- typical laptop;
- narrow/mobile-width sanity check.

The project need not provide a perfect mobile ecommerce experience.

---

## Browser Console

- [ ] no unexplained runtime exception;
- [ ] no failed critical API request;
- [ ] no secret printed;
- [ ] no hydration/error loop.

---

## Secret Scan

Search tracked source and built client artifacts for:

```text
rzp_live_
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
SUPABASE_SERVICE_ROLE_KEY
PAYCHAOS_ACCESS_TOKEN
PAYCHAOS_SESSION_SECRET
```

Variable names may legitimately appear.

Real values must not.

---

## Documentation

- [ ] README matches actual setup;
- [ ] source-of-truth documents match implementation;
- [ ] Phase handoffs complete;
- [ ] no fake test results documented;
- [ ] no secret values documented;
- [ ] known limitations documented.

---

## Deployment URL

- [ ] Vercel URL opens;
- [ ] access gate works if enabled;
- [ ] Razorpay Test Mode visible;
- [ ] deployed Supabase connected;
- [ ] deployed webhook works.

---

## Five-Minute Demo

- [ ] complete flow rehearsed successfully;
- [ ] narration distinguishes real/replay/simulation;
- [ ] main scenario predictable;
- [ ] reset/fallback available;
- [ ] final demo repeated successfully twice.

---

# 29. Test Evidence Required in Every Phase Handoff

Every phase handoff must contain a testing section with:

```text
Tests Added
Tests Modified
Tests Removed
Exact Commands Executed
Exit Codes
Passed Count
Failed Count
Skipped Count
Build Result
Typecheck Result
Lint Result
Playwright Result
Manual Verification
Screenshots / Safe Evidence
Known Test Gaps
Accepted Exclusions
Regression Tests Added
```

---

## Acceptance-Criteria Mapping

Every phase acceptance criterion must be marked:

```text
PASS
FAIL
NOT VERIFIED
```

and include evidence.

Do not write:

```text
probably passes
should work
Claude says completed
```

as acceptance evidence.

---

# 30. Approval Authority Rule

Claude may report implementation/testing evidence.

Claude does not self-approve a phase.

The review process must examine:

- actual commands;
- actual results;
- manual verification;
- source-of-truth consistency;
- unresolved issues.

Only after review should the phase receive:

```text
APPROVED
```

---

# 31. Test Maintenance Rule

Tests are part of the project architecture.

When later phases change behavior for an approved reason:

review affected tests.

Do not leave old tests silently skipped.

---

## Frozen Behavior

Tests protecting these areas become especially important regression boundaries after approval:

### After Phase 1

```text
money representation
order state model
server/client secret boundary
RLS
fulfilment business-effect model
```

### After Phase 2

```text
Razorpay Order correlation
Checkout verification
webhook raw-body verification
event dedupe
business idempotency
provenance
```

### After Phase 3

```text
scenario IDs
chaos safety
replay semantics
invariant IDs/results
Finding origin
evidence links
```

### After Phase 4

```text
diagnosis taxonomy
recommendation mapping
regression semantics
Reliability Score formula
readiness thresholds
```

---

# 32. TESTING DEFINITION OF DONE

Testing is ready only when every mandatory requirement below is satisfied.

## Coverage

- [ ] all P0 functional requirements map to tests;
- [ ] T01–T30 are implemented or explicitly mapped to equivalent tests;
- [ ] core payment flow is covered;
- [ ] negative payment paths are covered;
- [ ] security-critical behavior is covered.

---

## Razorpay

- [ ] real Test Mode Order manually verified;
- [ ] real Checkout manually verified;
- [ ] real Test Mode webhook manually verified;
- [ ] Checkout signature tests exist;
- [ ] webhook signature tests exist;
- [ ] invalid signature mutation test exists.

---

## Database

- [ ] migration tests exist;
- [ ] uniqueness tests exist;
- [ ] foreign-key tests exist;
- [ ] RLS tests exist;
- [ ] duplicate concurrency tests exist where practical;
- [ ] transaction rollback test exists;
- [ ] Demo Reset test exists.

---

## Chaos

- [ ] P0 chaos scenarios have automated verification;
- [ ] safety prechecks are tested;
- [ ] provenance is tested;
- [ ] vulnerable path is safely demonstrable where required;
- [ ] fixed path is verified;
- [ ] cleanup is tested.

---

## Money Invariants

- [ ] every P0 invariant has deterministic tests;
- [ ] PASS behavior tested;
- [ ] FAIL behavior tested;
- [ ] UNKNOWN tested where applicable;
- [ ] authoritative scenario mapping used;
- [ ] AI has no influence on invariant result.

---

## Findings / Evidence

- [ ] FAIL creates Finding;
- [ ] PASS does not create normal failure Finding;
- [ ] UNKNOWN is not converted to fake FAIL/PASS;
- [ ] evidence references are traceable;
- [ ] Finding displays factual expected/observed state.

---

## Diagnosis

- [ ] root-cause mapping tested;
- [ ] evidence strength tested;
- [ ] contradictory evidence tested;
- [ ] insufficient evidence tested;
- [ ] evidence separated from inference;
- [ ] diagnosis failure cannot alter authoritative state.

---

## Regression

- [ ] same scenario reruns;
- [ ] original failure preserved;
- [ ] new invariant result created;
- [ ] RESOLVED behavior tested;
- [ ] STILL_FAILING behavior tested;
- [ ] confirmed implementation bugs receive regression tests where feasible.

---

## Reliability

- [ ] score deterministic;
- [ ] score breakdown tested;
- [ ] all-pass fixture exists;
- [ ] Critical failure fixture exists;
- [ ] UNKNOWN fixture exists;
- [ ] regression fixture exists;
- [ ] synthetic data exclusion tested;
- [ ] exact numeric vectors added when formula is frozen.

---

## Security

- [ ] Live Mode rejected;
- [ ] arbitrary target rejected;
- [ ] invalid signature zero mutation;
- [ ] Razorpay secrets absent from client;
- [ ] Supabase service-role key absent from client;
- [ ] unauthorized chaos rejected;
- [ ] browser authoritative DB mutation denied;
- [ ] unsafe AI output cannot mutate payment truth.

---

## Build / Static Gates

- [ ] build passes;
- [ ] lint passes;
- [ ] TypeScript typecheck passes;
- [ ] core automated suite passes;
- [ ] critical Playwright flow passes.

---

## Manual Verification

- [ ] Phase-specific manual QA complete;
- [ ] final deployed real Test Mode flow complete;
- [ ] final webhook verified;
- [ ] final chaos scenario verified;
- [ ] final Finding/diagnosis/regression verified;
- [ ] Reliability Score verified;
- [ ] demo rehearsed end-to-end twice.

---

## Evidence

- [ ] commands documented;
- [ ] exit codes documented;
- [ ] passed/failed/skipped counts documented where available;
- [ ] manual evidence documented;
- [ ] no fake results;
- [ ] no secret values in evidence.

---

## Blocking Rule

Testing is **not ready** if any of these remain:

```text
critical failing test
unexplained skipped P0 security test
unverified real Razorpay webhook
invalid-signature mutation
duplicate fulfilment on healthy path
Live Mode accepted
arbitrary chaos target accepted
Money Invariant nondeterminism
Finding without factual evidence
AI modifying authoritative truth
broken regression history
nondeterministic Reliability Score
failed production build
failed main demo flow
```

---

# Final Testing Principle

The PayChaos testing model is:

```text
Deterministic Unit Tests
        ↓
Real Database Integrity Tests
        ↓
Verified Webhook Tests
        ↓
Real Razorpay Test Mode Verification
        ↓
Controlled Chaos
        ↓
Deterministic Money Invariants
        ↓
Evidence-Backed Findings
        ↓
Deterministic Diagnosis
        ↓
Regression Re-Test
        ↓
Deterministic Reliability Assessment
        ↓
Playwright + Manual Demo Verification
```

The governing rule is:

**Do not prove PayChaos by counting tests.  
Prove it by showing that dangerous payment states are prevented, deliberate vulnerabilities are detected, fixes are verified, evidence is trustworthy, and the complete Razorpay Test Mode demo can be repeated reliably.**