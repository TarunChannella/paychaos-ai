# PayChaos AI — Five-Phase Implementation Plan

**Project:** PayChaos AI — Autonomous Payment Reliability Engineer  
**Purpose:** Razorpay AI Buildathon — Open Track  
**Plan Status:** Source-of-truth implementation plan  
**Development Window:** Approximately 7 working days  
**Primary Priority:** Complete, correct, secure, demonstrable P0  
**Runtime Cost Target:** ₹0  
**Payment Environment:** Razorpay Test Mode only

---

# 1. Purpose of This Document

This document defines exactly how PayChaos AI is implemented across five phases.

It exists to ensure that:

- each phase has a clear boundary;
- Claude and Claude Agent Teams know exactly what they are allowed to build;
- the project remains achievable in approximately one week;
- later phases do not casually redesign completed work;
- P0 payment correctness and reliability remain more important than optional features;
- each phase produces enough evidence and documentation for the next phase to continue without relying on old conversation history.

The five phases are fixed:

```text
PHASE 1 — Foundation + Demo Merchant
        ↓
PHASE 2 — Razorpay Test Mode + Payments + Webhooks
        ↓
PHASE 3 — Chaos Engine + Money Invariant Engine
        ↓
PHASE 4 — Diagnosis + Reliability Score + AI Differentiators
        ↓
PHASE 5 — UI Polish + Testing + Security + Deployment + Demo
```

These phases must be completed in order.

---

# 2. Source-of-Truth Order

Every phase must begin by reading the repository documentation.

Authority is interpreted by responsibility rather than by allowing a generic document to override a more specific approved domain contract.

```text
PROJECT_CONTEXT.md
        ↓
ARCHITECTURE.md
        ↓
PHASE_PLAN.md
        ↓
Relevant domain source-of-truth documents
        ↓
Previous approved phase handoff
        ↓
Current implementation
```

The responsibilities are:

- `PROJECT_CONTEXT.md` governs project purpose, scope, priorities and global safety boundaries.
- `ARCHITECTURE.md` governs system structure and frozen architectural decisions.
- `PHASE_PLAN.md` governs sequencing, phase boundaries, implementation gates and handoffs.
- the relevant domain source-of-truth document is authoritative for the detailed contract inside that domain; for example `DATABASE.md` for schema, `MONEY_INVARIANTS.md` for invariant definitions, `CHAOS_SCENARIOS.md` for scenario mechanics, `SECURITY.md` for security controls, `AI_DESIGN.md` for diagnosis/AI behavior, and `TESTING.md` for test requirements.

A specific domain document may refine a detail intentionally left open by a higher-level document, but it must not violate the higher-level project's scope, architecture or safety boundaries.

If two approved repository documents genuinely conflict, **do not choose one silently and do not implement through the conflict**. Record the conflict, correct the documentation first, and only then implement.

If implementation or an old AI conversation conflicts with approved repository documentation:

**the repository documentation wins.**

---

# 3. Global Phase Completion Model

Every phase uses the following states:

```text
IMPLEMENTED
        ↓
TESTED
        ↓
MANUALLY VERIFIED
        ↓
DOCUMENTED
        ↓
APPROVED
```

## IMPLEMENTED

The required code and configuration for the phase exist.

This state does not mean the phase is complete.

---

## TESTED

Required automated tests have actually been executed.

The handoff must include:

- commands executed;
- test counts where available;
- passed tests;
- failed tests;
- build status;
- type-check status;
- lint status where configured.

No test result may be invented.

---

## MANUALLY VERIFIED

Required real-world behavior has been verified by the developer.

Examples include:

- opening the Demo Merchant;
- performing a real Razorpay Test Mode payment;
- verifying that a real Razorpay webhook arrived;
- running a chaos scenario from the UI;
- inspecting a finding;
- performing the final deployed demo.

Automated tests do not replace manual verification.

---

## DOCUMENTED

The implementation and any approved architectural decisions have been reflected in repository documentation and the phase handoff.

---

## APPROVED

The phase has passed:

- implementation review;
- test review;
- manual verification;
- acceptance criteria;
- security checks;
- documentation review.

A phase must not be considered complete merely because Claude reports that implementation has finished.

---

# 4. Global Implementation Rules

## Rule 1 — Work Only on the Current Phase

Do not implement future-phase features early unless they are a strict dependency for the current phase and the dependency is documented.

---

## Rule 2 — P0 Always Wins

Priority order:

```text
Payment safety
    ↓
Correctness
    ↓
Evidence integrity
    ↓
P0 completeness
    ↓
Testing
    ↓
Security
    ↓
Demo reliability
    ↓
P1
    ↓
P2
```

---

## Rule 3 — No Architecture Redesign by Default

Claude must implement the architecture already defined in `ARCHITECTURE.md`.

Claude must not introduce:

- microservices;
- separate Python runtime services;
- message brokers;
- production chaos agents;
- paid AI APIs;
- arbitrary chaos targets;
- new databases

without an approved architecture decision.

---

## Rule 4 — Deterministic Payment Truth

No LLM or probabilistic AI component may determine:

- payment success;
- payment amount;
- authoritative payment state;
- authoritative order state;
- webhook authenticity;
- invariant PASS/FAIL/UNKNOWN;
- reliability-score arithmetic.

---

## Rule 5 — Real and Simulated Evidence Must Remain Separate

The implementation must distinguish:

```text
REAL_RAZORPAY_WEBHOOK
PAYCHAOS_REPLAY
PAYCHAOS_SIMULATION
TEST_FIXTURE
VERIFIED_CHECKOUT_RESULT
```

where applicable.

---

## Rule 6 — Each Phase Uses Its Own Git Branch

Recommended workflow:

```text
main
 ↓
phase-1-foundation
 ↓
Phase 1 APPROVED
 ↓
merge into main
 ↓
phase-2-razorpay
 ↓
Phase 2 APPROVED
 ↓
merge into main
 ↓
phase-3-chaos-engine
 ↓
Phase 3 APPROVED
 ↓
merge into main
 ↓
phase-4-ai-diagnosis
 ↓
Phase 4 APPROVED
 ↓
merge into main
 ↓
phase-5-finalization
 ↓
Final approval
 ↓
merge into main
```

Each new phase branch must be created from the latest approved `main`.

---

# 5. PHASE 1 — Foundation + Demo Merchant

## 5.1 Phase Objective

Create the stable application, database, testing and Demo Merchant foundation required by every later phase.

At the end of Phase 1, PayChaos should be a working Next.js application connected to Supabase with a small Demo Merchant domain model and a clean architectural/module structure.

Razorpay payment processing is **not** implemented yet.

---

# 5.2 Why This Phase Exists

Later phases require:

- stable project tooling;
- database connectivity;
- domain identifiers;
- environment handling;
- Demo Merchant business state;
- server/client boundaries;
- testing infrastructure.

Building Razorpay integration before these foundations are correct would cause later rework.

---

# 5.3 Dependencies

Phase 1 depends on:

- `PROJECT_CONTEXT.md`;
- `ARCHITECTURE.md`;
- `PHASE_PLAN.md`;
- approved database/data-model specification before migrations are finalized;
- approved security/testing requirements relevant to Phase 1.

No previous implementation phase exists.

---

# 5.4 P0 Features

Phase 1 P0 includes:

1. Next.js project foundation.
2. TypeScript configuration.
3. Tailwind CSS.
4. shadcn/ui foundation.
5. repository structure matching the modular-monolith architecture.
6. environment-variable validation foundation.
7. Supabase connectivity.
8. approved Phase 1 database migrations.
9. Demo Merchant domain model.
10. Demo Merchant screen.
11. simple merchant order creation for internal/test purposes.
12. merchant order/payment/fulfilment state representation.
13. server-side domain/service boundaries.
14. safe logging foundation.
15. Vitest setup.
16. Playwright setup.
17. baseline application build.
18. visible Razorpay Test Mode-only project messaging even though Razorpay integration begins in Phase 2.

---

# 5.5 P1 Features

Only after Phase 1 P0 passes:

- basic dashboard shell;
- improved empty states;
- shared status badges;
- developer-friendly environment-status screen;
- reusable timeline/status UI primitives needed later.

These must not delay Phase 1 approval.

---

# 5.6 P2 / Stretch Features

Possible stretch work:

- advanced theming;
- animations;
- complex dashboard charts;
- elaborate Demo Merchant storefront appearance.

These should normally be deferred.

---

# 5.7 Exact Sub-Phases

## Phase 1A — Repository and Tooling Foundation

Establish:

- Next.js;
- TypeScript;
- Tailwind;
- shadcn/ui;
- formatting/linting;
- Vitest;
- Playwright.

---

## Phase 1B — Environment and Security Foundation

Implement:

- typed environment configuration;
- clear server-only/client-safe separation;
- safe startup validation;
- `.env.example`;
- secret-safe logging conventions.

---

## Phase 1C — Supabase Foundation

Implement:

- Supabase connection helpers;
- migration structure;
- approved Phase 1 tables;
- indexes and integrity constraints required immediately.

---

## Phase 1D — Demo Merchant Domain

Implement:

- merchant order domain types;
- initial statuses;
- expected amount and currency;
- payment-status placeholder;
- fulfilment-status/count representation;
- legal domain transitions required for the Demo Merchant.

---

## Phase 1E — Demo Merchant UI

Create the minimal screen required to:

- view the Demo Merchant;
- view one test product/order concept;
- create or inspect an internal merchant order;
- display current business/payment/fulfilment state.

Do not create Razorpay Checkout yet.

---

## Phase 1F — Foundation Testing

Verify:

- project build;
- type checking;
- environment handling;
- domain state logic;
- Supabase integration;
- Demo Merchant rendering.

---

# 5.8 Exact Implementation Tasks

Claude should:

1. inspect all source-of-truth documentation before editing files;
2. create or verify the single Next.js application;
3. configure TypeScript strictly enough to catch domain mistakes;
4. configure Tailwind and shadcn/ui;
5. establish the repository/module boundaries described in `ARCHITECTURE.md`;
6. create server-safe configuration utilities;
7. ensure secrets cannot accidentally enter client bundles;
8. connect the application to Supabase;
9. create migration infrastructure;
10. apply only the approved Phase 1 subset of the database schema;
11. create Demo Merchant domain types and services;
12. model merchant order amount in the smallest currency unit according to the future Razorpay integration contract;
13. create clear merchant payment and fulfilment state fields;
14. ensure business effects can later be counted or uniquely identified for idempotency testing;
15. create the minimal Demo Merchant page;
16. create reusable loading/error/empty-state handling where immediately useful;
17. configure Vitest;
18. configure Playwright;
19. write Phase 1 tests;
20. verify a production build succeeds;
21. document setup instructions needed for Phase 1;
22. produce the Phase 1 handoff.

---

# 5.9 What the Developer Must Manually Configure

The developer must manually:

1. create or confirm the GitHub repository;
2. create the Phase 1 branch from current `main`;
3. create a Supabase project or approved local Supabase environment;
4. copy the required Supabase connection values into local environment variables;
5. keep all secrets outside Git;
6. run approved database migrations;
7. verify the application can connect to the database;
8. manually inspect the Demo Merchant in the browser.

No Razorpay configuration is required yet unless preparing Phase 2 early outside the codebase.

---

# 5.10 What Claude Should Implement

Claude owns:

- project configuration;
- application structure;
- domain code;
- Supabase integration code;
- migration files;
- Demo Merchant UI;
- test infrastructure;
- tests;
- documentation updates.

Claude must **not**:

- request or embed real secrets;
- implement full Razorpay payment flow;
- implement webhooks;
- implement chaos scenarios;
- implement invariant engine;
- implement diagnosis/scoring.

---

# 5.11 Database Changes

Phase 1 may create only the foundational entities required for:

- Demo Merchant orders;
- internal payment-attempt placeholders if included in the approved data model;
- merchant business state;
- fulfilment/business-effect representation;
- timestamps/correlation IDs needed by later phases.

Exact table and column definitions must come from the approved database source-of-truth document.

Do not create speculative future tables merely to appear complete.

---

# 5.12 APIs / Endpoints Involved

Phase 1 may include internal server capabilities for:

- creating a Demo Merchant order;
- reading Demo Merchant order state;
- health/config checks where useful.

No Razorpay external API interaction is part of Phase 1.

Exact route names remain implementation-level unless separately frozen.

---

# 5.13 UI / Screens Involved

Required:

- application shell;
- Demo Merchant screen.

Optional if easy:

- basic dashboard landing screen;
- environment/Test Mode status indicator.

The UI does not need final Phase 5 polish.

---

# 5.14 Tests Required

## Unit Tests

Test:

- merchant order creation logic;
- legal state transitions;
- amount validation;
- configuration validation;
- any shared deterministic utilities.

## Integration Tests

Test:

- Supabase read/write path;
- required constraints;
- internal Demo Merchant creation flow.

## UI / E2E

At least one Playwright path should verify:

```text
Open application
→ Open Demo Merchant
→ Create/view internal merchant order
→ See correct state
```

## Build Verification

Run:

- type check;
- tests;
- production build;
- lint if configured.

---

# 5.15 Security Checks

Verify:

- no secrets committed;
- server-only variables are not exposed to the browser;
- privileged Supabase credentials are not client-accessible;
- browser cannot directly mutate authoritative tables;
- amount and server requests are validated;
- logs contain no credentials;
- Test Mode-only project statement is present.

---

# 5.16 Acceptance Criteria

## P1-AC-01

The application starts successfully in local development.

## P1-AC-02

A production Next.js build succeeds.

## P1-AC-03

Supabase connectivity works.

## P1-AC-04

Approved Phase 1 migrations apply cleanly.

## P1-AC-05

The Demo Merchant can create or display a merchant order with expected amount, currency and business state.

## P1-AC-06

Merchant payment and fulfilment state are represented separately enough for later reliability testing.

## P1-AC-07

No Razorpay or Supabase secret appears in client-side code or Git.

## P1-AC-08

Vitest runs successfully.

## P1-AC-09

Playwright runs successfully for the Phase 1 flow.

## P1-AC-10

No Phase 2–4 functionality has been unnecessarily implemented.

---

# 5.17 Manual Verification Steps

The developer must:

1. start the application;
2. open the Demo Merchant;
3. create or inspect a Demo Merchant order;
4. confirm expected amount/currency are correct;
5. confirm payment state is not falsely shown as paid;
6. confirm fulfilment state is correct;
7. refresh the browser and confirm durable state persists;
8. inspect browser-accessible environment data and confirm no private secret is exposed;
9. inspect Supabase and confirm the expected records exist.

---

# 5.18 Completion Gate

Phase 1 can be approved only when:

```text
IMPLEMENTED          PASS
TESTED               PASS
MANUALLY VERIFIED    PASS
DOCUMENTED           PASS
APPROVED             REQUIRED
```

Blocking issues:

- broken build;
- broken Supabase connection;
- insecure secret handling;
- unstable Demo Merchant domain state;
- incomplete tests.

---

# 5.19 Expected Handoff Document

```text
handoffs/PHASE-1-HANDOFF.md
```

---

# 5.20 What Phase 2 Is Allowed to Depend On

Phase 2 may depend on:

- stable Next.js application;
- environment utilities;
- Supabase access layer;
- merchant order domain;
- internal identifiers;
- Demo Merchant UI;
- test infrastructure;
- approved Phase 1 migrations.

---

# 5.21 What Must Not Be Changed After Approval

Without a confirmed reason, Phase 2+ must not replace:

- modular-monolith architecture;
- Supabase as primary database;
- Demo Merchant order identity;
- amount/currency semantics;
- server/client secret boundary;
- foundational test setup;
- core Demo Merchant business-effect representation.

---

# 6. PHASE 2 — Razorpay Test Mode + Payments + Webhooks

## 6.1 Phase Objective

Implement and manually verify the real Razorpay Test Mode payment path.

By the end of Phase 2, PayChaos must have trustworthy payment evidence from:

- server-created Razorpay Test Mode Orders;
- Razorpay Checkout;
- verified Checkout success;
- real Razorpay Test Mode webhooks;
- idempotent merchant processing.

---

# 6.2 Why This Phase Exists

Chaos testing is meaningless unless the underlying real payment integration works correctly.

Phase 2 establishes the evidence foundation that Phase 3 will intentionally stress.

---

# 6.3 Dependencies

Phase 2 requires:

- approved Phase 1;
- approved Phase 1 handoff;
- Razorpay Test Mode integration specification;
- approved payment/event data model;
- supported webhook event list;
- security/testing requirements;
- Razorpay Test Mode account access.

---

# 6.4 P0 Features

1. Test Mode configuration validation.
2. minimal single-workspace operator access gate for any public payment-enabled deployment.
3. server-side Razorpay adapter.
4. Razorpay Order creation.
5. internal payment-attempt correlation.
6. Razorpay Checkout.
7. Checkout result handling.
8. server-side Checkout signature verification.
9. public webhook endpoint exempt from operator login and authenticated by Razorpay webhook signature.
10. raw-body webhook signature verification.
11. invalid-signature rejection.
12. webhook event persistence.
13. Razorpay event-ID deduplication.
14. duplicate-delivery tracking where required.
15. event normalization.
16. payment/order correlation.
17. merchant-side payment-state update.
18. business-effect idempotency.
19. measured webhook request-path timing against the frozen P0 5-second response requirement.
20. real Test Mode webhook manual verification.
21. basic payment/event evidence view.

---

# 6.5 P1 Features

After P0:

- optional Razorpay payment/order reconciliation API call;
- improved payment event timeline;
- webhook diagnostics panel;
- manual retry control for failed internal processing.

Only add these if P0 is stable.

---

# 6.6 P2 / Stretch Features

Potential stretch:

- additional Razorpay event types;
- more complex reconciliation;
- advanced webhook delivery analytics.

Do not add refunds or unrelated Razorpay products unless later scope explicitly requires them.

---

# 6.7 Exact Sub-Phases

## Phase 2A — Razorpay Test Configuration

Implement:

- server-only Razorpay configuration;
- Test Mode key validation;
- Live Mode rejection.

---

## Phase 2B — Razorpay Order Creation

Implement:

```text
Demo Merchant order
→ internal payment attempt
→ server Razorpay Order creation
→ store Razorpay order_id
```

---

## Phase 2C — Checkout Integration

Implement:

- Checkout-safe browser data;
- Razorpay Checkout launch;
- success response submission to server;
- server-side signature verification.

---

## Phase 2D — Webhook Ingestion

Implement:

- public endpoint;
- raw request body handling;
- signature verification;
- event identity extraction;
- verified event persistence.

---

## Phase 2E — Event Deduplication and Normalization

Implement:

- database-enforced event uniqueness;
- duplicate recognition;
- normalized internal event representation;
- clear event provenance.

---

## Phase 2F — Merchant Processing and Idempotency

Implement:

- verified event processing;
- merchant state transition;
- fulfilment/business-effect boundary;
- business-level idempotency.

---

## Phase 2G — Real Test Mode Verification

Perform:

- actual Razorpay Test Mode payment;
- actual webhook receipt;
- database inspection;
- UI inspection.

---

# 6.8 Exact Implementation Tasks

Claude should:

1. implement or enable the minimal single-workspace operator access gate before using a public payment-enabled deployment;
2. add server-only Razorpay SDK/API adapter;
3. reject Live Mode configuration;
4. implement internal payment-attempt creation;
5. create Razorpay Orders server-side;
6. persist order correlation;
7. provide only safe Checkout configuration to browser;
8. integrate Razorpay Checkout;
9. post Checkout result back to the trusted server;
10. verify Checkout signature;
11. reject invalid Checkout verification;
12. implement the webhook route using the raw request body;
13. verify Razorpay webhook HMAC signature;
14. reject unverified payloads before domain processing;
15. extract and persist the Razorpay event identifier;
16. enforce database uniqueness for external logical events;
17. preserve external event evidence safely;
18. represent real Razorpay events with explicit provenance;
19. normalize only supported P0 events;
20. correlate order/payment/event IDs;
21. route normalized events through the event processor;
22. update Demo Merchant state deterministically;
23. enforce business-effect idempotency;
24. store processing attempts/results;
25. create minimal UI for inspecting payment and webhook evidence;
26. write unit/integration tests;
27. support a real manual webhook verification path;
28. produce Phase 2 handoff.
---

# 6.9 What the Developer Must Manually Configure

The developer must:

1. open Razorpay Dashboard in Test Mode;
2. obtain Test Mode Key ID;
3. obtain Test Mode Key Secret;
4. place them in local/server environment variables;
5. never paste secrets into source files or AI-visible public artifacts;
6. configure a webhook secret;
7. configure `PAYCHAOS_ACCESS_GATE`, `PAYCHAOS_ACCESS_TOKEN` and `PAYCHAOS_SESSION_SECRET` before using any public payment-enabled deployment;
8. confirm operator/payment routes require the access-gate session while `/api/webhooks/razorpay` remains publicly reachable and signature-authenticated;
9. expose the PayChaos webhook route through a public HTTPS URL;
10. use either a temporary free deployment/tunnel or Vercel preview for Phase 2 verification;
11. configure the exact supported webhook events in Razorpay;
12. configure the webhook URL and secret;
13. perform a real Razorpay Test Mode payment;
14. confirm the webhook arrives.

Final deployment remains Phase 5.

---

# 6.10 What Claude Should Implement

Claude implements all application-side:

- Razorpay integration;
- payment services;
- Checkout UI integration;
- server verification;
- webhook route;
- signature verification;
- event persistence;
- normalization;
- deduplication;
- merchant processing;
- evidence UI;
- tests.

Claude must not:

- create or expose Live Mode support;
- implement chaos replay yet;
- implement P0 chaos scenarios;
- implement invariant findings/diagnosis;
- embed credentials.

---

# 6.11 Database Changes

Phase 2 adds or finalizes the approved structures for:

- payment attempts;
- Razorpay order/payment identifiers;
- verified Checkout evidence;
- external webhook events;
- event delivery/processing attempts if separately modeled;
- normalized event data;
- merchant payment-state correlation;
- business-effect idempotency records.

Required database integrity includes:

- external event uniqueness;
- payment/order correlation constraints;
- business-effect uniqueness where appropriate.

---

# 6.12 APIs / Endpoints Involved

Required server capabilities include:

- create payment/order;
- verify Checkout result;
- receive Razorpay webhook;
- read payment/event history.

Exact route names may follow the established architecture.

External systems:

- Razorpay Test Mode Orders API;
- Razorpay Checkout;
- Razorpay Test Mode webhook delivery.

---

# 6.13 UI / Screens Involved

Required:

- Demo Merchant payment action;
- Razorpay Checkout integration;
- payment result state;
- payment/evidence inspection view.

Useful if simple:

- webhook event list;
- source badge showing `Razorpay Test Mode`;
- processing state badge.

---

# 6.14 Tests Required

## Unit Tests

- Test/Live configuration validation;
- Checkout signature verification;
- webhook signature verification;
- event normalization;
- payment-state transitions;
- idempotency keys.

## Negative Security Tests

- invalid Checkout signature;
- invalid webhook signature;
- malformed supported payload;
- missing required IDs;
- Live key rejected.

## Idempotency Tests

- same external event delivered twice;
- same logical business effect triggered from multiple paths;
- concurrent duplicate insert behavior where practical.

## Integration Tests

- payment-attempt persistence;
- webhook persistence;
- event correlation;
- business-effect update.

## Manual Integration Test

A real Razorpay Test Mode payment and real Test Mode webhook are mandatory.

---

# 6.15 Security Checks

Verify:

- any public payment-enabled deployment has the minimal operator access gate enabled;
- operator/payment/reset/chaos mutation routes are not anonymously accessible;
- the Razorpay webhook route is exempt from operator login but remains protected by webhook signature verification;
- Key Secret remains server-side;
- webhook secret remains server-side;
- `rzp_live_` is rejected;
- raw webhook signature verified before trusting payload;
- invalid signature causes no merchant state mutation;
- browser cannot fake paid state;
- database uniqueness prevents duplicate event insertion races;
- no card number/CVV is stored;
- logs redact sensitive information.

---

# 6.16 Acceptance Criteria

## P2-AC-01

Any publicly reachable payment-enabled PayChaos deployment requires the minimal operator access gate, while the Razorpay webhook route remains signature-authenticated and does not require operator login.

## P2-AC-02

Server can create a real Razorpay Test Mode Order.

## P2-AC-03

Razorpay Checkout opens for the created order.

## P2-AC-04

A Test Mode payment can be completed.

## P2-AC-05

Checkout success signature is verified server-side.

## P2-AC-06

A real Razorpay Test Mode webhook reaches PayChaos.

## P2-AC-07

Webhook signature is verified before processing.

## P2-AC-08

Invalid webhook signature cannot mutate authoritative state.

## P2-AC-09

Verified webhook evidence is durably stored.

## P2-AC-10

External events are database-deduplicated.

## P2-AC-11

Duplicate delivery does not create duplicate merchant business effect.

## P2-AC-12

Razorpay order/payment IDs correlate to the internal payment attempt.

## P2-AC-13

Real Razorpay evidence is clearly identified as real Test Mode evidence.

## P2-AC-14

Observed deployed normal webhook processing completes within the frozen P0 5-second response requirement, with `latency_ms` recorded for the manual verification evidence.

## P2-AC-15

Automated tests and build pass.

## P2-AC-16

Developer manually verifies the full Test Mode flow.
---

# 6.17 Manual Verification Steps

1. run PayChaos;
2. open Demo Merchant;
3. start payment;
4. confirm a Razorpay Test Mode Order is created;
5. complete Test Mode Checkout;
6. confirm server verification succeeds;
7. inspect the merchant order;
8. confirm expected payment state;
9. inspect Supabase;
10. confirm Razorpay identifiers were stored;
11. confirm a real webhook record exists;
12. confirm signature verification status;
13. inspect processing state;
14. verify only one business effect exists;
15. manually redeliver/retry a webhook through approved Razorpay Test Mode tooling if practical;
16. verify duplicate processing remains safe;
17. confirm UI labels the evidence as Razorpay Test Mode;
18. if using a public payment-enabled deployment, confirm operator/payment routes require the access gate while the Razorpay webhook remains publicly reachable;
19. inspect the recorded real-webhook `latency_ms` and confirm the normal critical durable request path completed in under 5000 ms.

---

# 6.18 Completion Gate

Phase 2 cannot be approved without:

```text
REAL TEST MODE ORDER          VERIFIED
REAL TEST MODE CHECKOUT       VERIFIED
SERVER SIGNATURE CHECK        VERIFIED
REAL WEBHOOK DELIVERY         VERIFIED
WEBHOOK SIGNATURE CHECK       VERIFIED
WEBHOOK LATENCY < 5000 MS     VERIFIED
PUBLIC ACCESS GATE            VERIFIED IF PUBLIC PAYMENT DEPLOYMENT
DATABASE DEDUPLICATION        VERIFIED
BUSINESS IDEMPOTENCY          VERIFIED
AUTOMATED TESTS               PASS
MANUAL VERIFICATION           PASS
DOCUMENTATION                 COMPLETE
```

Mocked Razorpay tests alone are insufficient.

---

# 6.19 Expected Handoff Document

```text
handoffs/PHASE-2-HANDOFF.md
```

---

# 6.20 What Phase 3 Is Allowed to Depend On

Phase 3 may treat the following as stable:

- verified Razorpay order flow;
- Checkout verification;
- webhook trust boundary;
- real event evidence storage;
- normalized events;
- internal event processor;
- event provenance;
- payment correlation;
- business-effect idempotency;
- payment evidence UI.

---

# 6.21 What Must Not Be Changed After Approval

Without a confirmed reason, later phases must not replace:

- Razorpay adapter architecture;
- server-created Orders model;
- Checkout server-verification requirement;
- raw-body webhook signature verification;
- event deduplication strategy;
- external event identity/provenance model;
- event-processing boundary;
- merchant business-effect idempotency.

---

# 7. PHASE 3 — Chaos Engine + Money Invariant Engine

## 7.1 Phase Objective

Build controlled chaos testing on top of the verified Phase 2 payment/event pipeline and deterministically detect payment reliability violations.

At the end of Phase 3, PayChaos should be able to:

```text
Select approved scenario
→ run controlled fault
→ collect evidence
→ evaluate money invariants
→ PASS / FAIL / UNKNOWN
→ generate finding when FAIL
```

---

# 7.2 Why This Phase Exists

This phase contains the core technical differentiation of PayChaos.

Phase 2 proves the integration works normally.

Phase 3 asks:

> Does the integration remain correct under controlled distributed-system failures?

---

# 7.3 Dependencies

Requires:

- approved Phase 2;
- approved Phase 2 handoff;
- frozen P0 chaos scenario catalogue;
- frozen P0 invariant catalogue;
- approved evidence requirements;
- stable internal event processor;
- stable provenance model;
- stable merchant business-effect model.

---

# 7.4 P0 Features

1. static scenario registry;
2. chaos-run identity;
3. Test Mode safety gate;
4. approved replay architecture;
5. controlled failure-injection layer;
6. explicit source classification;
7. C01 — Duplicate Webhook Delivery;
8. C03 — Invalid Webhook Signature;
9. C07 — Payment Succeeds but Client Confirmation Is Lost;
10. C11 — Failed Payment Must Never Mark Order Paid;
11. processing-attempt evidence;
12. deterministic Money Invariant Engine;
13. PASS/FAIL/UNKNOWN;
14. invariant-result persistence;
15. finding generation;
16. finding deduplication;
17. evidence-pack/timeline foundation;
18. chaos run UI;
19. finding detail UI.

The mandatory P0 chaos set is frozen at exactly four scenario wrappers: C01, C03, C07 and C11.

The underlying implementation must still satisfy all mandatory P0 payment, webhook, database, state-machine and invariant protections even when a dedicated scenario wrapper is deferred to P1.

---

# 7.5 P1 Features

Only after Phase 3 P0 is complete, tested and manually verified, the following existing scenario wrappers may be added as P1:

```text
C02 — Out-of-Order Webhook / Event Delivery
C04 — Webhook Handler Timeout / Slow Processing
C05 — Webhook Handler Returns Server Error
C06 — Duplicate Fulfilment Attempt
C08 — Database Failure During Webhook Processing
C09 — Replay of Already Processed Old Event
C10 — Unknown / Unhandled Webhook Event
C12–C15 — existing P1 catalogue scenarios
```

Richer scenario comparison and evidence visualization also remain P1.

Only include P1 scenarios that are repeatable and testable. P1 must not delay Phase 3 approval.

---

# 7.6 P2 / Stretch Features

Potential stretch:

- scenario presets;
- larger scenario library;
- complex fault combinations;
- randomized chaos campaigns.

Random uncontrolled fuzzing is not required.

---

# 7.7 Exact Sub-Phases

## Phase 3A — Scenario Registry and Safety Gate

Create:

- static approved scenario definitions;
- scenario IDs;
- prerequisites;
- invariant mappings;
- safety checks.

---

## Phase 3B — Chaos Run Model

Implement:

- unique chaos-run ID;
- run lifecycle;
- source payment/event linkage;
- scenario configuration;
- result state.

---

## Phase 3C — Controlled Replay

Implement replay of previously verified Razorpay Test Mode evidence through the internal event processor.

Replay must be labeled:

```text
PAYCHAOS_REPLAY
```

and retain a reference to the original verified external event.

---

## Phase 3D — Failure Injection

Implement the approved P0 fault primitives only.

---

## Phase 3E — Evidence Snapshot

Collect all deterministic inputs required for invariant evaluation.

---

## Phase 3F — Money Invariant Engine

Implement:

- stable invariant definitions;
- deterministic evaluators;
- evidence requirement checks;
- PASS;
- FAIL;
- UNKNOWN.

---

## Phase 3G — Finding Generation

Create findings from failed invariants.

---

## Phase 3H — Chaos and Finding UI

Allow user to:

- choose scenario;
- choose eligible payment/event if required;
- run scenario;
- view run status;
- view invariant results;
- open finding/evidence.

---

# 7.8 Exact Implementation Tasks

Claude should:

1. implement a static P0 scenario registry;
2. reject unknown scenario IDs;
3. ensure scenario targets are internal only;
4. validate Razorpay Test Mode before chaos execution;
5. create chaos-run records;
6. link runs to source payment/event evidence;
7. implement internal replay of verified events;
8. preserve original external event unchanged;
9. classify replay separately;
10. implement approved fault primitives;
11. persist processing attempts;
12. collect evidence required by each invariant;
13. implement invariant definitions as deterministic TypeScript;
14. return UNKNOWN when required evidence is missing;
15. persist invariant results;
16. generate findings only from FAIL results;
17. attach structured evidence references;
18. deduplicate same run/invariant finding where appropriate;
19. build chaos-run screen;
20. build invariant results view;
21. build basic evidence timeline;
22. build finding detail view;
23. write unit tests for every P0 invariant;
24. write tests for every P0 scenario;
25. verify scenario cleanup/reset;
26. verify provenance labels;
27. generate Phase 3 handoff.

---

# 7.9 What the Developer Must Manually Configure

Little external configuration should be required.

The developer must:

1. ensure Phase 2 Razorpay Test Mode configuration remains valid;
2. create fresh Test Mode payments needed as source evidence;
3. select or trigger chaos scenarios through the UI;
4. inspect Supabase records;
5. manually verify that replay/simulation is visibly distinguished from real Razorpay events.

The user must **not** configure arbitrary external chaos targets.

---

# 7.10 What Claude Should Implement

Claude owns:

- scenario registry;
- chaos-run orchestration;
- replay;
- approved fault injection;
- evidence collection;
- invariant engine;
- finding engine;
- Phase 3 UI;
- tests.

Claude must not:

- redesign Phase 2 webhook verification;
- send chaos traffic to arbitrary URLs;
- change Razorpay configuration;
- create Live Mode support;
- use an LLM for invariant results;
- implement reliability score yet except interfaces explicitly required for later use.

---

# 7.11 Database Changes

Phase 3 adds approved structures for:

- chaos runs;
- replay/simulation processing attempts;
- invariant results;
- findings;
- finding-evidence links or equivalent;
- fault configuration/run metadata.

The database must preserve:

- original real Razorpay event;
- replay processing attempt;
- scenario/run identity;
- invariant result;
- finding relationship.

---

# 7.12 APIs / Endpoints Involved

Required internal capabilities:

- list supported chaos scenarios;
- start chaos run;
- inspect chaos run;
- read invariant results;
- read findings/evidence.

Replay occurs through the internal event-processing boundary.

It is not an arbitrary public webhook generator.

---

# 7.13 UI / Screens Involved

Required:

- chaos scenario list;
- scenario detail/run action;
- chaos run detail;
- invariant results;
- findings list or finding detail;
- basic evidence timeline.

Labels must distinguish:

- real Razorpay evidence;
- PayChaos replay;
- PayChaos simulation.

---

# 7.14 Tests Required

## Scenario Tests

For each P0 scenario test:

- prerequisites;
- start;
- fault activation;
- expected processing;
- cleanup;
- provenance.

## Invariant Tests

Every P0 invariant must have tests for:

```text
PASS
FAIL
UNKNOWN
```

where logically applicable.

## Replay Tests

Verify:

- replay references original event;
- replay does not mutate original event;
- replay source is labeled correctly.

## Safety Tests

Verify:

- unknown scenario rejected;
- arbitrary URL/target impossible;
- Live Mode safety check fails closed;
- scenario cannot execute against unsupported target.

## Finding Tests

Verify:

- FAIL creates finding;
- PASS does not create finding;
- UNKNOWN does not become fake failure unless explicitly specified;
- duplicate generation is controlled.

---

# 7.15 Security Checks

Verify:

- no external target input exists;
- no arbitrary code execution;
- scenario registry is server-authoritative;
- replay uses verified source evidence where required;
- Test Mode validation precedes run;
- replay cannot forge `REAL_RAZORPAY_WEBHOOK`;
- original evidence remains immutable;
- chaos configuration is recorded;
- secrets do not appear in evidence timeline.

---

# 7.16 Acceptance Criteria

## P3-AC-01

User can select a predefined P0 chaos scenario.

## P3-AC-02

Unknown scenarios are rejected.

## P3-AC-03

Chaos cannot target arbitrary external systems.

## P3-AC-04

Every chaos run has a stable run ID.

## P3-AC-05

Replay references previously verified source evidence.

## P3-AC-06

Replay is labeled `PAYCHAOS_REPLAY`.

## P3-AC-07

At least one scenario demonstrates a meaningful reliability failure or validates resilience.

## P3-AC-08

Every implemented P0 invariant is deterministic.

## P3-AC-09

Invariants return PASS/FAIL/UNKNOWN correctly.

## P3-AC-10

Missing evidence results in UNKNOWN rather than false PASS.

## P3-AC-11

Invariant FAIL generates a structured finding.

## P3-AC-12

Finding links to relevant evidence.

## P3-AC-13

User can inspect the relevant event/payment timeline.

## P3-AC-14

Real and simulated/replayed evidence is visibly distinguishable.

## P3-AC-15

Automated tests pass.

---

# 7.17 Manual Verification Steps

1. perform or select a healthy Razorpay Test Mode payment;
2. verify baseline evidence exists;
3. open Chaos screen;
4. select a P0 scenario;
5. confirm safety labels;
6. run scenario;
7. inspect chaos-run ID;
8. inspect processing attempts;
9. confirm replay/simulation provenance;
10. inspect invariant results;
11. confirm expected PASS/FAIL/UNKNOWN;
12. for a failing scenario, open finding;
13. inspect expected vs observed behavior;
14. inspect evidence timeline;
15. rerun/reset scenario and verify reproducibility;
16. ensure original real Razorpay event was not changed.

---

# 7.18 Completion Gate

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

# 7.19 Expected Handoff Document

```text
handoffs/PHASE-3-HANDOFF.md
```

---

# 7.20 What Phase 4 Is Allowed to Depend On

Phase 4 may depend on:

- stable chaos-run records;
- stable scenario IDs;
- stable invariant IDs;
- deterministic invariant results;
- finding records;
- evidence packs/references;
- event timeline data;
- original/replay provenance.

---

# 7.21 What Must Not Be Changed After Approval

Phase 4+ must not casually change:

- scenario identity semantics;
- replay provenance model;
- fault safety boundary;
- invariant authority;
- PASS/FAIL/UNKNOWN semantics;
- finding origin from deterministic failures;
- evidence references.

---

# 8. PHASE 4 — Diagnosis + Reliability Score + AI Differentiators

## 8.1 Phase Objective

Transform deterministic reliability findings into clear engineering guidance and an explainable Go-Live Reliability assessment.

At the end of Phase 4, PayChaos should provide:

```text
Finding
→ evidence-backed root cause
→ recommended fix
→ regression re-test
→ updated deterministic reliability score
→ Go-Live Readiness
```

---

# 8.2 Why This Phase Exists

Phase 3 tells the developer:

> Something is wrong.

Phase 4 must answer:

> Why is it probably wrong, what should I fix, did the fix work, and what does this mean for readiness?

---

# 8.3 Dependencies

Requires:

- approved Phase 3;
- Phase 3 handoff;
- frozen diagnosis/root-cause catalogue;
- frozen recommendation mapping;
- frozen reliability-score formula;
- frozen Go-Live Readiness thresholds;
- stable invariant results and evidence model.

---

# 8.4 P0 Features

1. evidence-pack builder;
2. deterministic signal extraction;
3. root-cause classification;
4. evidence-strength labeling;
5. deterministic recommendation catalogue;
6. regression-run model;
7. rerun original scenario;
8. RESOLVED / STILL FAILING outcome;
9. deterministic reliability-score calculation;
10. score breakdown;
11. Go-Live Readiness classification;
12. readiness explanation;
13. finding diagnosis UI;
14. recommendation UI;
15. regression UI;
16. reliability overview.

P0 does **not** require an external LLM.

---

# 8.5 P1 Features

Potential differentiators:

- richer natural-language explanation templates;
- finding grouping;
- historical scenario regression summary;
- reliability trend from real stored runs;
- deterministic prioritization of findings;
- lightweight local anomaly grouping if it materially helps the demo.

---

# 8.6 P2 / Stretch Features

Possible:

- scikit-learn clustering;
- more sophisticated anomaly detection;
- advanced recommendation ranking;
- downloadable report;
- deeper historical analytics.

P2 must be cut immediately if schedule is under pressure.

---

# 8.7 Exact Sub-Phases

## Phase 4A — Evidence Packs

Build structured evidence input for diagnosis.

---

## Phase 4B — Deterministic Signal Extraction

Derive signals such as:

- duplicate processing count;
- fulfilment count;
- missing convergence;
- amount mismatch;
- failed retry;
- event-order assumption.

---

## Phase 4C — Root-Cause Classification

Map signals and invariant failures to approved root-cause categories.

---

## Phase 4D — Recommended Fixes

Map diagnosis categories to engineering recommendations.

---

## Phase 4E — Regression Engine

Implement:

```text
Original finding
→ start regression
→ rerun same scenario
→ reevaluate relevant invariant
→ RESOLVED / STILL FAILING
```

---

## Phase 4F — Reliability Score

Implement deterministic scoring.

---

## Phase 4G — Go-Live Readiness

Map score and critical findings to readiness status.

---

## Phase 4H — P1 AI Differentiators

Only if all P0 Phase 4 acceptance criteria already pass.

---

# 8.8 Exact Implementation Tasks

Claude should:

1. define typed diagnosis signals;
2. build evidence packs from persisted records;
3. implement deterministic signal extraction;
4. implement approved root-cause rules;
5. handle insufficient evidence explicitly;
6. produce evidence-strength label;
7. implement recommendation catalogue;
8. associate recommendation with finding;
9. create regression-run records;
10. connect regression run to original finding;
11. rerun original scenario through existing Chaos Runner;
12. evaluate original applicable invariants;
13. mark finding `RESOLVED` or `STILL_FAILING` according to approved rules;
14. preserve original failure evidence;
15. implement deterministic score formula;
16. calculate score from actual recorded results;
17. expose score breakdown;
18. calculate Go-Live Readiness status;
19. show untested/UNKNOWN conditions clearly;
20. build diagnosis UI;
21. build recommendation UI;
22. build regression action/result UI;
23. build reliability overview;
24. write unit tests for diagnosis mappings;
25. write regression tests;
26. write exact score tests;
27. verify no AI component can mutate payment/invariant state;
28. only then consider approved P1 intelligence;
29. produce Phase 4 handoff.

---

# 8.9 What the Developer Must Manually Configure

P0 requires no external AI API.

The developer must:

1. ensure existing Razorpay Test Mode configuration remains functional;
2. select findings for manual inspection;
3. if demonstrating a corrected behavior, enable/use the approved fixed Demo Merchant profile or corresponding implementation state;
4. manually initiate regression;
5. inspect score/readiness before and after regression;
6. verify all displayed metrics are calculated from actual runs.

Do not configure OpenAI API or Anthropic API.

---

# 8.10 What Claude Should Implement

Claude implements:

- evidence pack;
- deterministic signals;
- diagnosis rules;
- recommendations;
- regression engine;
- reliability formula;
- readiness classification;
- UI;
- tests.

Claude must not:

- call paid runtime LLM APIs;
- change invariant results;
- infer payment truth from diagnosis;
- delete original finding history after successful regression;
- fabricate confidence;
- fabricate metrics.

---

# 8.11 Database Changes

Phase 4 adds approved structures for:

- diagnosis results;
- recommendations;
- regression runs;
- finding resolution status;
- reliability-score snapshots if the data model requires persisted snapshots.

Prefer derived calculations where persistence is unnecessary.

Do not create redundant tables solely for architecture appearance.

---

# 8.12 APIs / Endpoints Involved

Required capabilities include:

- read finding diagnosis;
- initiate regression;
- inspect regression result;
- read reliability score;
- read Go-Live Readiness.

The Regression API must invoke the existing Chaos Runner rather than creating a second test engine.

---

# 8.13 UI / Screens Involved

Required:

- finding detail with diagnosis;
- evidence supporting diagnosis;
- recommended fix;
- regression/re-test action;
- regression history/result;
- reliability score;
- score breakdown;
- Go-Live Readiness.

Useful P1:

- trend/history based only on real records.

---

# 8.14 Tests Required

## Diagnosis Tests

For each P0 diagnosis category:

- required signal combination;
- correct category;
- insufficient-evidence path;
- no unsupported inference.

## Recommendation Tests

Verify deterministic category-to-recommendation mapping.

## Regression Tests

Verify:

- original finding remains;
- new run links correctly;
- same scenario executes;
- expected invariant reevaluates;
- pass marks resolved;
- fail remains failing.

## Score Tests

Test exact known fixtures for:

- all PASS;
- critical FAIL;
- mixed severities;
- UNKNOWN results;
- resolved regression;
- unresolved finding.

## Readiness Tests

Verify exact threshold/band behavior.

---

# 8.15 Security Checks

Verify:

- diagnosis cannot modify authoritative payment state;
- recommendation cannot execute code;
- no external AI credentials required;
- regression still passes chaos safety gate;
- original evidence remains immutable;
- synthetic/demo metrics are labeled if any exist;
- reliability score reads only approved deterministic inputs.

---

# 8.16 Acceptance Criteria

## P4-AC-01

Every P0 failed invariant can produce an evidence pack.

## P4-AC-02

Supported failures map to deterministic root-cause categories.

## P4-AC-03

Diagnosis references supporting evidence.

## P4-AC-04

Insufficient evidence is reported rather than hallucinated.

## P4-AC-05

A recommendation is generated from approved deterministic mapping.

## P4-AC-06

A user can start a regression for an existing finding.

## P4-AC-07

Regression reruns the original supported scenario.

## P4-AC-08

Original failure history remains preserved.

## P4-AC-09

Finding becomes RESOLVED only when the relevant approved criteria pass.

## P4-AC-10

Reliability score is deterministic.

## P4-AC-11

Score breakdown is visible and explainable.

## P4-AC-12

UNKNOWN is not counted as a normal PASS.

## P4-AC-13

Go-Live Readiness is derived from the frozen deterministic rules.

## P4-AC-14

UI states clearly that readiness is a PayChaos assessment, not Razorpay certification.

## P4-AC-15

P0 operates with no paid LLM API.

---

# 8.17 Manual Verification Steps

1. open a known failed finding;
2. inspect failed invariant;
3. inspect evidence pack;
4. verify diagnosis matches observed deterministic evidence;
5. verify recommendation is technically relevant;
6. initiate regression;
7. rerun the same scenario;
8. confirm new chaos run exists;
9. confirm old finding evidence still exists;
10. inspect new invariant result;
11. confirm correct RESOLVED/STILL FAILING status;
12. inspect reliability score before and after;
13. manually verify score breakdown;
14. verify readiness label;
15. verify UI contains no claim of official Razorpay certification.

---

# 8.18 Completion Gate

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

P1 AI differentiators are not part of this gate.

---

# 8.19 Expected Handoff Document

```text
handoffs/PHASE-4-HANDOFF.md
```

---

# 8.20 What Phase 5 Is Allowed to Depend On

Phase 5 may treat these as stable:

- diagnosis categories;
- recommendation mapping;
- regression semantics;
- score formula;
- readiness formula;
- deterministic authority boundaries;
- finding lifecycle.

---

# 8.21 What Must Not Be Changed After Approval

Phase 5 must not casually change:

- invariant authority;
- deterministic diagnosis inputs;
- regression semantics;
- scoring formula;
- readiness thresholds;
- evidence provenance;
- AI/non-AI authority boundary.

UI polish must not change payment truth.

---

# 9. PHASE 5 — UI Polish + Testing + Security + Deployment + Demo

## 9.1 Phase Objective

Turn the complete P0 system into a secure, tested, deployed and judge-ready buildathon submission.

This phase should prioritize reliability of the demo over adding new features.

---

# 9.2 Why This Phase Exists

A technically correct system can still fail a buildathon if:

- the workflow is confusing;
- deployment breaks;
- webhooks are misconfigured;
- test data is misleading;
- security errors remain;
- the demo cannot be repeated;
- the product story is unclear.

Phase 5 converts the engineering system into a reliable final submission.

---

# 9.3 Dependencies

Requires:

- approved Phase 1;
- approved Phase 2;
- approved Phase 3;
- approved Phase 4;
- all handoffs;
- frozen security requirements;
- frozen testing requirements;
- final demo/submission plan.

---

# 9.4 P0 Features

1. final navigation and dashboard organization;
2. final Demo Merchant presentation;
3. clear Test Mode labeling;
4. clear real/replay/simulation labels;
5. payment evidence timeline polish;
6. finding presentation polish;
7. diagnosis/recommendation presentation;
8. regression result presentation;
9. reliability score/readiness presentation;
10. complete automated test run;
11. Playwright critical-path tests;
12. security review;
13. secret scan/manual secret inspection;
14. production build verification;
15. Vercel deployment;
16. Supabase deployed migration verification;
17. deployed Razorpay Test Mode webhook;
18. real deployed Test Mode payment verification;
19. final documentation;
20. final demo rehearsal;
21. backup demo data/fixtures clearly labeled if required;
22. submission assets.

---

# 9.5 P1 Features

Only if P0 deployment and demo are already stable:

- visual polish;
- subtle animations;
- better charts;
- score history;
- nicer evidence timeline;
- additional demo scenario.

---

# 9.6 P2 / Stretch Features

Usually cut.

Possible only if everything else passes:

- downloadable reports;
- advanced analytics;
- additional ML;
- elaborate visual effects;
- expanded scenario catalogue.

---

# 9.7 Exact Sub-Phases

## Phase 5A — P0 Freeze

Stop adding new P0 architecture.

Create a final bug list.

Classify each item:

```text
BLOCKER
HIGH
MEDIUM
LOW
```

---

## Phase 5B — UI / UX Polish

Optimize the judge-facing flow.

---

## Phase 5C — Full Automated Test Pass

Run all:

- unit;
- integration;
- security;
- scenario;
- invariant;
- diagnosis;
- scoring;
- Playwright tests.

---

## Phase 5D — Security Review

Review:

- secrets;
- environment;
- webhook verification;
- Test Mode enforcement;
- chaos boundaries;
- database privilege;
- logs.

---

## Phase 5E — Deployment

Deploy:

- Next.js to Vercel;
- migrations to Supabase;
- environment variables;
- Razorpay Test Mode webhook URL.

---

## Phase 5F — Deployed End-to-End Verification

Perform real Test Mode payment and webhook flow against the deployed application.

---

## Phase 5G — Demo Preparation

Prepare and rehearse the final story.

---

## Phase 5H — Documentation and Submission

Finalize repository documentation and submission materials.

---

# 9.8 Exact Implementation Tasks

Claude should:

1. review all prior handoffs;
2. avoid architectural redesign;
3. fix confirmed bugs only;
4. improve information hierarchy;
5. ensure all source/provenance labels are visible;
6. make Demo Merchant flow obvious;
7. make Chaos flow obvious;
8. make finding evidence understandable;
9. make diagnosis and recommendation easy to follow;
10. make regression outcome clear;
11. make score breakdown understandable;
12. add explicit Go-Live disclaimer;
13. complete critical Playwright flows;
14. run all unit/integration tests;
15. run type check;
16. run lint;
17. run production build;
18. fix security findings;
19. verify no secrets in repository;
20. verify Live Mode configuration is rejected;
21. prepare Vercel configuration;
22. verify deployed Supabase environment;
23. verify deployed webhook endpoint;
24. perform final deployed Test Mode flow with developer;
25. verify final demo scenario;
26. prepare fallback demo state if necessary;
27. clearly label any fallback synthetic/test-fixture data;
28. update README and remaining docs;
29. generate final Phase 5 handoff;
30. produce final submission readiness checklist.

---

# 9.9 What the Developer Must Manually Configure

The developer must:

1. connect GitHub repository to Vercel;
2. create/select the Vercel project;
3. enter required environment variables manually;
4. ensure Test Mode Key ID/Secret are used;
5. ensure webhook secret is configured;
6. deploy Supabase migrations;
7. copy the final Vercel HTTPS webhook URL;
8. update the Razorpay Test Mode webhook URL;
9. select the required webhook events;
10. trigger a real deployed Test Mode payment;
11. confirm webhook receipt;
12. verify final UI;
13. rehearse the demo;
14. collect screenshots/video if required;
15. prepare buildathon submission fields.

---

# 9.10 What Claude Should Implement

Claude owns:

- final code fixes;
- UI polish;
- test completion;
- security hardening;
- deployment configuration files;
- documentation;
- demo support assets that do not require manual account access.

Claude must not:

- silently add new architecture;
- introduce paid services;
- change Razorpay to Live Mode;
- fabricate demo events;
- claim synthetic data is real;
- weaken tests to get a green result.

---

# 9.11 Database Changes

Phase 5 should normally introduce **no new domain model**.

Allowed changes:

- bug fixes;
- missing constraints;
- verified indexes;
- security-policy corrections;
- migrations genuinely required for deployment.

A significant new table or domain concept requires justification.

---

# 9.12 APIs / Endpoints Involved

All prior APIs are exercised.

Phase 5 should avoid introducing new major APIs.

Critical endpoints to verify include:

- payment/order creation;
- Checkout verification;
- webhook ingestion;
- chaos execution;
- finding/reliability queries;
- regression initiation.

---

# 9.13 UI / Screens Involved

Final judge-facing flow should include:

1. Dashboard / Reliability Overview
2. Demo Merchant
3. Payment / Evidence Detail
4. Chaos Scenarios
5. Chaos Run Detail
6. Finding Detail
7. Diagnosis + Recommendation
8. Regression Result
9. Reliability Score / Go-Live Readiness

The exact navigation may combine some views where that improves simplicity.

---

# 9.14 Tests Required

## Full Automated Suite

Run all tests from Phases 1–4.

## Required Critical Playwright Flow

At minimum:

```text
Open app
→ Demo Merchant
→ verify base UI
→ navigate dashboard
→ inspect chaos/finding/reliability flow
```

Where external Razorpay Checkout cannot be fully automated reliably, manually verify it and test the surrounding internal flow automatically.

## Security Regression Tests

- Live key rejection;
- webhook signature rejection;
- no arbitrary chaos target;
- idempotent duplicate processing;
- secret-safe output;
- provenance labels.

## Build

Production build must succeed.

---

# 9.15 Security Checks

Final security review must verify:

- Razorpay Test Mode only;
- no Live Mode switch;
- no secrets in Git;
- no secrets in browser bundle;
- webhook raw-body verification;
- invalid signatures rejected;
- database privilege boundary;
- no arbitrary chaos URL;
- no arbitrary code execution;
- real/replay/simulation provenance;
- no card/CVV storage;
- logs redacted;
- privileged environment variables present only server-side;
- synthetic metrics clearly labeled;
- no runtime paid AI dependency.

---

# 9.16 Acceptance Criteria

## P5-AC-01

Production build succeeds.

## P5-AC-02

Full automated test suite passes or any accepted exclusions are documented.

## P5-AC-03

Critical Playwright flow passes.

## P5-AC-04

Application deploys successfully to Vercel.

## P5-AC-05

Supabase deployed schema is correct.

## P5-AC-06

Deployed application creates a real Razorpay Test Mode Order.

## P5-AC-07

Deployed Razorpay Checkout succeeds.

## P5-AC-08

Deployed webhook endpoint receives and verifies a real Test Mode webhook.

## P5-AC-09

A final P0 chaos scenario runs successfully.

## P5-AC-10

An invariant result is shown correctly.

## P5-AC-11

A failing scenario can show a finding and evidence.

## P5-AC-12

Diagnosis and recommendation are displayed.

## P5-AC-13

Regression flow works.

## P5-AC-14

Reliability score is shown with breakdown.

## P5-AC-15

Go-Live Readiness includes correct disclaimer.

## P5-AC-16

Real and replayed/simulated data are visibly distinguished.

## P5-AC-17

No known critical security issue remains.

## P5-AC-18

No secret is exposed.

## P5-AC-19

README and source-of-truth documentation are updated.

## P5-AC-20

Final demo has been manually rehearsed end-to-end.

---

# 9.17 Manual Verification Steps

Perform the full judge-facing flow:

1. open deployed PayChaos;
2. confirm `Razorpay Test Mode` is visible;
3. open Demo Merchant;
4. create a Test Mode payment;
5. complete Razorpay Checkout;
6. verify payment state;
7. inspect the real webhook;
8. verify evidence source labeling;
9. show baseline reliability;
10. select the final chaos scenario;
11. run it;
12. inspect chaos run;
13. inspect invariant;
14. inspect finding;
15. inspect evidence timeline;
16. inspect diagnosis;
17. inspect recommended fix;
18. run regression;
19. inspect resolved/still-failing result;
20. inspect reliability score;
21. explain score breakdown;
22. show Go-Live Readiness disclaimer;
23. repeat the entire demo once more to prove repeatability.

---

# 9.18 Completion Gate

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

# 9.19 Expected Handoff Document

```text
handoffs/PHASE-5-HANDOFF.md
```

This is also the final technical submission handoff.

---

# 9.20 What Final Submission May Depend On

The final submission may depend on:

- approved main branch;
- deployed Vercel application;
- Supabase project;
- Razorpay Test Mode configuration;
- Phase 1–5 handoffs;
- source-of-truth documentation;
- final screenshots/demo assets.

---

# 9.21 What Must Not Be Changed After Approval

After Phase 5 approval, do not make major changes unless fixing a confirmed submission blocker.

Avoid:

- dependency upgrades;
- architecture refactors;
- schema redesign;
- scenario changes;
- score formula changes;
- UI rewrites;
- new P1/P2 functionality.

After final approval:

**stability is more valuable than novelty.**

---

# 10. Recommended One-Week Schedule

The project has approximately seven working days.

The schedule should prioritize the technically riskiest work:

- Razorpay integration;
- real webhooks;
- chaos;
- invariants.

---

## Day 1 — Phase 1

### Goal

Finish and approve Foundation + Demo Merchant.

### Work

- project tooling;
- Supabase;
- base data model;
- Demo Merchant;
- tests;
- handoff.

### End-of-Day Requirement

Phase 1 should preferably be:

```text
APPROVED
```

If not, finish the blocking P0 work before starting Phase 2.

Do not use schedule pressure as a reason to carry foundational bugs forward.

---

## Day 2 — Phase 2A to Phase 2C

### Goal

Working Razorpay Test Mode order and Checkout.

### Work

- Test Mode config;
- Razorpay adapter;
- order creation;
- Checkout;
- server-side Checkout verification;
- core tests.

### End-of-Day Requirement

A real Test Mode Checkout should preferably work.

---

## Day 3 — Phase 2D to Phase 2G

### Goal

Complete real webhook integration and approve Phase 2.

### Work

- webhook endpoint;
- raw-body signature verification;
- event storage;
- deduplication;
- merchant processing;
- real webhook manual verification;
- handoff.

### Hard Requirement

Do not start Phase 3 while the real Razorpay webhook path is unverified.

---

## Day 4 — Phase 3A to Phase 3D

### Goal

Controlled chaos execution.

### Work

- scenario registry;
- chaos-run model;
- replay;
- first P0 fault scenario;
- safety tests.

### Target

Have one complete scenario running end-to-end.

---

## Day 5 — Phase 3E to Phase 3H

### Goal

Complete invariants, findings and evidence.

### Work

- invariant engine;
- PASS/FAIL/UNKNOWN;
- finding generation;
- timeline;
- scenario tests;
- manual verification;
- Phase 3 approval.

### Schedule Rule

If Phase 3 is behind, cut additional scenarios before cutting invariant correctness.

---

## Day 6 — Phase 4

### Goal

Diagnosis, regression and deterministic readiness.

### Work

- evidence packs;
- diagnosis;
- recommendations;
- regression;
- scoring;
- Go-Live Readiness;
- tests.

### Schedule Rule

P1 AI/ML is allowed only if Phase 4 P0 is already passing.

---

## Day 7 — Phase 5

### Goal

Stable final submission.

### Work

- UI polish;
- complete test suite;
- security audit;
- deployment;
- Razorpay webhook reconfiguration;
- deployed Test Mode verification;
- demo rehearsal;
- documentation;
- submission preparation.

### Day 7 Rule

No experimental architecture work.

No optional ML unless the entire submission is already stable.

---

# 11. Schedule Checkpoints

Recommended checkpoint targets:

| Time | Required State |
|---|---|
| End Day 1 | Phase 1 approved |
| End Day 3 | Real Razorpay payment + webhook working; Phase 2 approved |
| End Day 5 | Chaos + invariants + findings working; Phase 3 approved |
| End Day 6 | Diagnosis + regression + score working; Phase 4 approved |
| Day 7 | Deployed, tested, secure, demo-ready |

If a checkpoint slips:

**apply the Scope Cut Rule immediately.**

---

# 12. P0 Minimum Demo Configuration

If schedule becomes very constrained, the smallest acceptable complete P0 remains:

```text
Demo Merchant
+
Real Razorpay Test Mode payment
+
Real verified webhook
+
Correct event persistence
+
Idempotent merchant processing
+
One strong chaos scenario
+
A small deterministic invariant set
+
At least one meaningful failed finding
+
Evidence timeline
+
Rule-based diagnosis
+
Recommended fix
+
Regression re-test
+
Deterministic reliability score
+
Go-Live Readiness
+
Strong final demo
```

Do not sacrifice the complete end-to-end story merely to claim a larger feature count.

---

# 13. Claude / Claude Agent Team Execution Rules

For every phase, Claude or the agent team must:

1. read `PROJECT_CONTEXT.md`;
2. read `ARCHITECTURE.md`;
3. read `PHASE_PLAN.md`;
4. read the relevant domain specifications;
5. read the previous approved phase handoff;
6. inspect the repository before proposing changes;
7. work only inside current-phase scope;
8. preserve completed-phase behavior;
9. implement P0 before P1;
10. implement P1 before P2;
11. run tests rather than merely write tests;
12. report exact results;
13. report build/type/lint status;
14. identify manual steps for the developer;
15. identify deviations from architecture;
16. produce the required handoff.

For Claude Agent Teams:

- one agent/team lead should own integration;
- agents may split work by bounded modules;
- multiple agents must not independently redesign shared domain models;
- database migrations should have one clear owner;
- Razorpay trust/security logic should have one clear owner;
- invariant definitions should have one clear owner;
- final integration must be reviewed centrally.

---

# 14. Cross-Phase Change Rule

An approved earlier phase may only be modified for one of the following reasons:

1. confirmed functional bug;
2. confirmed security issue;
3. failing acceptance criterion discovered later;
4. verified Razorpay/Supabase/Vercel constraint;
5. incorrect frozen assumption;
6. necessary dependency for an approved later-phase P0 requirement.

Any such change must record:

```text
Reason
Affected previous phase
Files changed
Database impact
Security impact
Tests rerun
Architecture decision if required
```

A change made only because:

> "this implementation looks cleaner"

is not sufficient reason for a major rewrite.

---

# 15. PHASE HANDOFF FORMAT

Every phase must end with a handoff document.

File names:

```text
handoffs/PHASE-1-HANDOFF.md
handoffs/PHASE-2-HANDOFF.md
handoffs/PHASE-3-HANDOFF.md
handoffs/PHASE-4-HANDOFF.md
handoffs/PHASE-5-HANDOFF.md
```

Every handoff must contain the following.

---

## 15.1 Phase Identification

```text
Phase:
Branch:
Commit / revision:
Date:
```

---

## 15.2 Completion Status

```text
IMPLEMENTED:
TESTED:
MANUALLY VERIFIED:
DOCUMENTED:
APPROVED:
```

A phase cannot mark itself APPROVED without review.

---

## 15.3 Completed Features

List:

- every completed P0 feature;
- completed P1 features;
- completed P2 features.

Clearly identify anything partially implemented.

---

## 15.4 Files Changed

Include:

- files added;
- files modified;
- files removed;
- important generated files.

Do not dump every dependency file unless relevant.

---

## 15.5 Database Changes

Include:

- migrations added;
- tables added/modified;
- columns added/modified;
- constraints;
- indexes;
- RLS/security changes;
- data migration requirements.

---

## 15.6 Environment / Configuration Changes

Include:

- variables added;
- variables removed;
- variables renamed;
- manual setup needed.

Never include secret values.

---

## 15.7 Razorpay Configuration Changes

Include:

- Test Mode configuration changes;
- webhook events selected;
- webhook URL changes;
- webhook secret requirements;
- manual verification performed.

Never include secret values.

---

## 15.8 Tests Performed

List exact commands.

Example categories:

```text
unit
integration
Playwright
build
type-check
lint
manual Test Mode
security
```

---

## 15.9 Test Results

Include exact factual results:

```text
Passed:
Failed:
Skipped:
Build:
Type check:
Lint:
Playwright:
```

Do not say "all good" without evidence.

---

## 15.10 Manual Verification

Record:

- what the developer manually tested;
- what happened;
- evidence or screenshots where appropriate;
- what remains unverified.

---

## 15.11 Acceptance Criteria Results

For every phase acceptance criterion:

```text
ID:
Status: PASS / FAIL / NOT VERIFIED
Evidence:
```

---

## 15.12 Security Verification

Report at minimum:

- secret handling;
- Test Mode safety;
- webhook security if relevant;
- chaos safety if relevant;
- database access;
- sensitive logging.

---

## 15.13 Architectural Decisions

Record:

- new decisions;
- deviations from architecture;
- why the deviation was needed;
- whether an ADR/document update was created.

If none:

```text
No new architectural decisions.
```

---

## 15.14 Known Issues

Include:

- confirmed bugs;
- non-blocking issues;
- reliability concerns;
- environment concerns;
- test gaps.

Do not hide issues to obtain approval.

---

## 15.15 Deferred Work

Clearly separate:

```text
Deferred P0
Deferred P1
Deferred P2
```

Deferred P0 normally blocks phase approval unless explicitly accepted.

---

## 15.16 Dependencies for Next Phase

State exactly what the next phase may assume works.

---

## 15.17 Things the Next Phase Must Not Break

List frozen behavior from the completed phase.

Examples:

- database invariants;
- event provenance;
- webhook verification;
- business idempotency;
- invariant semantics;
- scoring formula.

---

## 15.18 Evidence

Include relevant evidence such as:

- screenshots;
- database records;
- test output summaries;
- Razorpay Test Mode event IDs where safe;
- demo verification notes.

Do not expose secrets.

---

## 15.19 Final Recommendation

The handoff must end with:

```text
RECOMMENDATION:

APPROVE
or
DO NOT APPROVE
```

with a short reason.

Final approval is made only after independent review of the handoff and evidence.

---

# 16. SCOPE CUT RULE

If the project falls behind schedule, scope is reduced in this exact order.

## Step 1 — Remove P2 First

Immediately remove:

- advanced ML;
- advanced analytics;
- extra scenarios;
- downloadable reports;
- elaborate animations;
- complex visualizations;
- advanced trend analysis.

P2 is never allowed to delay the submission.

---

## Step 2 — Reduce P1

If more time must be recovered, reduce:

- additional chaos scenarios;
- richer explanation features;
- advanced historical views;
- finding clustering;
- anomaly detection;
- extra UI polish.

Keep only P1 features that materially improve the demo without introducing risk.

---

## Step 3 — Preserve Critical P0

Never remove critical P0 payment-safety or reliability features merely to meet schedule.

The following are protected P0:

```text
Razorpay Test Mode-only enforcement
Server-side secret isolation
Real Razorpay Test Mode order/payment flow
Server-side Checkout verification
Real webhook handling
Webhook signature verification
Webhook/event persistence
Event deduplication
Business-effect idempotency
Controlled internal chaos
Real/replay/simulation provenance
Deterministic Money Invariants
PASS / FAIL / UNKNOWN
Findings
Evidence traceability
Evidence-based diagnosis
Regression re-test
Deterministic Reliability Score
Go-Live Readiness explanation
Critical automated tests
Real Test Mode manual verification
Security review
Working deployed demo
```

These are the project.

Cutting them would remove the core PayChaos value proposition.

---

# 17. Emergency Schedule Rule

If time becomes severely constrained, reduce **breadth**, not **correctness**.

Prefer:

```text
1 excellent chaos scenario
+
4 strong invariants
```

over:

```text
10 unreliable chaos scenarios
+
weak or ambiguous invariant logic
```

Prefer:

```text
simple rule-based diagnosis
```

over:

```text
unfinished ML system
```

Prefer:

```text
clear score breakdown
```

over:

```text
fancy dashboard animation
```

Prefer:

```text
one repeatable final demo
```

over:

```text
many partially working screens
```

---

# 18. Final Phase Discipline Rule

The project should advance only through:

```text
IMPLEMENT
    ↓
TEST
    ↓
MANUALLY VERIFY
    ↓
DOCUMENT
    ↓
REVIEW
    ↓
APPROVE
    ↓
MERGE TO MAIN
    ↓
CREATE NEXT PHASE BRANCH
```

The next phase must not be used to hide unfinished work from the previous phase.

---

# 19. Final Project Priority

When any ambiguity occurs, choose the path that maximizes:

```text
Payment correctness
+
Security
+
Evidence quality
+
Reliability
+
Testability
+
Demo repeatability
```

while minimizing:

```text
Infrastructure complexity
+
Unnecessary architecture
+
Optional ML
+
P2 scope
+
One-week delivery risk
```

The intended result is not the largest possible buildathon project.

The intended result is a **complete, credible and demonstrably reliable PayChaos AI P0 implementation**.