# PayChaos AI — Project Context

## 1. Project Name

**PayChaos AI — Autonomous Payment Reliability Engineer**

PayChaos AI is being built for the **Razorpay AI Buildathon — Open Track**.

---

## 2. One-Line Project Description

**PayChaos AI is a Razorpay Test Mode-only payment reliability platform that deliberately injects controlled payment and webhook failures, detects money/state invariant violations, explains likely root causes from evidence, recommends fixes, reruns regression tests, and calculates an explainable Go-Live Reliability Score.**

---

# 3. Problem We Are Solving

Payment integrations often appear reliable when only the happy path is tested.

A normal integration test may prove that:

1. an order is created;
2. Razorpay Checkout opens;
3. the customer completes a test payment;
4. the application receives a success response;
5. the merchant marks the order as paid.

However, real payment systems operate in distributed environments where failures can occur between independent systems.

Examples include:

- webhook delivery is delayed;
- the same webhook is delivered more than once;
- webhook events arrive in an unexpected order;
- the webhook handler fails temporarily;
- an application retries payment-processing logic;
- the user closes or refreshes a browser during payment;
- the application sees one state while Razorpay has another state;
- the application processes the same successful payment more than once;
- an internal order is updated incorrectly;
- reconciliation logic fails;
- a payment succeeds externally but the merchant application does not converge to the correct state.

These failures may not necessarily cause a Razorpay payment itself to fail.

Instead, they can cause **merchant-side money or business-state inconsistencies**.

Examples:

- one payment causes two fulfilment actions;
- a successful payment is treated as failed;
- a failed payment is treated as successful;
- duplicate webhooks create duplicate application-side effects;
- the amount recorded by the merchant differs from the expected order amount;
- the merchant system never converges to the payment provider's verified state.

These types of failures are difficult to identify with simple happy-path testing.

PayChaos AI exists to test these reliability conditions deliberately and safely.

---

# 4. Why This Problem Matters to Razorpay and Merchants

Razorpay can correctly process a payment while a merchant's integration still handles the resulting state incorrectly.

Payment reliability therefore depends on more than whether a payment gateway responds successfully.

A merchant must also correctly implement:

- payment-state handling;
- idempotency;
- webhook verification;
- duplicate-event handling;
- retry handling;
- reconciliation;
- event ordering tolerance;
- internal order-state transitions;
- amount validation;
- failure recovery.

Problems in these areas can create:

- duplicate fulfilment;
- missing fulfilment;
- customer-support incidents;
- inconsistent order/payment states;
- accounting confusion;
- incorrect inventory changes;
- unreliable retry behavior;
- difficult production debugging;
- loss of trust in the merchant's payment experience.

For Razorpay, better merchant integration reliability can mean:

- fewer integration-related incidents incorrectly attributed to the payment gateway;
- safer merchant launches;
- easier debugging of payment-state inconsistencies;
- better use of webhooks and reconciliation;
- clearer distinction between gateway state and merchant application state.

PayChaos AI is therefore positioned as a **pre-production reliability testing and diagnosis tool for Razorpay integrations**.

It is not intended to replace Razorpay.

It tests whether the merchant application behaves correctly when interacting with Razorpay Test Mode under adverse but controlled conditions.

---

# 5. Exact Solution PayChaos Provides

PayChaos AI provides a controlled environment where a developer can:

1. use a built-in Demo Merchant;
2. create real Razorpay **Test Mode** orders and payments;
3. receive real Razorpay Test Mode webhook events;
4. record payment and application evidence;
5. start a controlled chaos test;
6. inject a predefined failure condition inside the PayChaos-controlled environment;
7. observe how the payment integration behaves;
8. evaluate deterministic money and state invariants;
9. create a finding when an invariant is violated;
10. build an evidence timeline explaining what happened;
11. classify the likely root cause;
12. recommend an engineering fix;
13. rerun the relevant test after the fix;
14. determine whether the finding has been resolved;
15. calculate an explainable payment-integration reliability score;
16. present an overall Go-Live Readiness result.

The product is therefore not merely a payment simulator.

Its primary value is the combination of:

**controlled failure injection + deterministic correctness checks + evidence-based diagnosis + regression verification + explainable readiness scoring.**

---

# 6. Complete End-to-End Project Flow

The canonical project flow is:

```text
Developer / Merchant Engineer
        │
        ▼
PayChaos AI Dashboard
        │
        ▼
Demo Merchant
        │
        ▼
Create Test Order
        │
        ▼
Razorpay Test Mode
        │
        ▼
Razorpay Checkout / Test Payment
        │
        ├─────────────────────────────┐
        │                             │
        ▼                             ▼
Checkout Result                Razorpay Webhooks
        │                             │
        └──────────────┬──────────────┘
                       ▼
             PayChaos Event Capture
                       │
                       ▼
              Event Normalization
                       │
                       ▼
             Payment-State Correlation
                       │
                       ▼
                Chaos Runner
                       │
                       ▼
           Controlled Failure Injection
                       │
                       ▼
              Evidence Collection
                       │
                       ▼
             Money Invariant Engine
                       │
               ┌───────┴─────────┐
               │                 │
             PASS            FAIL / UNKNOWN
                                 │
                                 ▼
                              Finding
                                 │
                                 ▼
                         Evidence Timeline
                                 │
                                 ▼
                        Root-Cause Diagnosis
                                 │
                                 ▼
                       Recommended Fix
                                 │
                                 ▼
                         Regression Re-Test
                                 │
                        ┌────────┴────────┐
                        │                 │
                     RESOLVED       STILL FAILING
                        │                 │
                        └────────┬────────┘
                                 ▼
                     Reliability Evaluation
                                 │
                                 ▼
                    Go-Live Reliability Score
                                 │
                                 ▼
                       Readiness Explanation
```

The system must preserve traceability between:

- internal payment attempts;
- Razorpay orders;
- Razorpay payments;
- webhook events;
- chaos runs;
- invariant evaluations;
- findings;
- diagnoses;
- recommendations;
- regression runs;
- reliability scores.

---

# 7. Target Users

## Primary Users

### Merchant Developers

Developers integrating Razorpay into an application who want to know whether their implementation remains correct under failure conditions.

### Payment Engineers

Engineers responsible for:

- payment workflows;
- webhooks;
- reconciliation;
- payment reliability;
- distributed-system behavior.

### QA / Test Engineers

Engineers who need repeatable reliability tests beyond happy-path payment testing.

## Secondary Users

### Engineering Leads

Technical leads assessing whether a payment integration is ready for release.

### Buildathon Judges

Judges evaluating whether PayChaos AI demonstrates a meaningful, technically credible use of Razorpay and AI-assisted reliability engineering.

---

# 8. Main Use Cases

PayChaos AI should support the following main use cases.

## Use Case 1 — Establish a Healthy Baseline

A developer performs a normal Razorpay Test Mode payment and verifies that expected payment invariants pass.

---

## Use Case 2 — Test Duplicate Webhook Handling

A developer runs a duplicate-webhook chaos scenario.

PayChaos verifies that repeated delivery does not create duplicate merchant-side payment effects.

---

## Use Case 3 — Test Delayed Event Processing

A developer delays controlled processing of a webhook or event and verifies that the application eventually converges to the correct state.

---

## Use Case 4 — Test Out-of-Order Event Handling

A developer tests whether event-processing assumptions create invalid merchant state when events are replayed or processed in a controlled alternative order.

---

## Use Case 5 — Test Transient Handler Failure

PayChaos simulates a controlled internal webhook-processing failure and verifies that retries do not corrupt state.

---

## Use Case 6 — Detect Payment-State Divergence

PayChaos detects when:

- expected internal state;
- observed application state; and
- verified Razorpay Test Mode state

do not agree.

---

## Use Case 7 — Diagnose a Reliability Failure

When an invariant fails, PayChaos produces:

- evidence;
- timeline;
- likely root cause;
- explanation;
- recommended fix.

---

## Use Case 8 — Re-Test a Fix

After the developer fixes the application, PayChaos reruns the relevant scenario and records whether the previously failing invariant now passes.

---

## Use Case 9 — Assess Go-Live Readiness

PayChaos combines scenario results, invariant results, severity and regression status into an explainable reliability score.

---

# 9. Core Features

The core product capabilities are:

1. Demo Merchant
2. Razorpay Test Mode order creation
3. Razorpay Test Mode Checkout
4. payment result capture
5. webhook endpoint
6. webhook signature verification
7. webhook/event persistence
8. payment/event correlation
9. controlled chaos runner
10. predefined chaos scenarios
11. deterministic money invariant engine
12. PASS / FAIL / UNKNOWN evaluation
13. findings
14. structured evidence
15. event/payment timeline
16. root-cause classification
17. recommended fixes
18. regression testing
19. reliability scoring
20. Go-Live Readiness presentation
21. security controls
22. automated and manual test coverage
23. clear separation between real Razorpay Test Mode data and simulated test behavior

---

# 10. P0 Mandatory Features

P0 represents the minimum complete product required for submission.

P0 always takes priority over P1 and P2.

## P0.1 — Demo Merchant

Provide a small controlled merchant experience where Razorpay Test Mode payments can be created and observed.

The Demo Merchant exists for reliability testing.

It is not intended to become a full commerce product.

---

## P0.2 — Real Razorpay Test Mode Integration

The project must use actual Razorpay Test Mode for the payment flow.

Required capabilities include:

- Test Mode credentials;
- Razorpay order creation;
- Razorpay Checkout;
- payment identifiers;
- server-side verification where required;
- real Razorpay Test Mode webhook delivery.

---

## P0.3 — Verified Webhook Processing

Required behavior:

- receive configured Razorpay webhooks;
- verify webhook signatures;
- reject invalid signatures;
- preserve appropriate raw event evidence;
- process events idempotently;
- correlate events with internal payment records.

---

## P0.4 — Payment and Event Evidence Store

PayChaos must persist sufficient evidence to determine:

- what payment was attempted;
- which Razorpay order was involved;
- which Razorpay payment was involved;
- which events were observed;
- when events were observed;
- what the merchant state became;
- which chaos scenario was active;
- which invariant evaluated the result.

---

## P0.5 — Controlled Chaos Runner

The user must be able to execute predefined chaos scenarios safely.

Chaos must occur only inside the controlled PayChaos Test Mode environment.

---

## P0.6 — Frozen Small P0 Chaos Scenario Set

The mandatory P0 chaos scenario set is deliberately limited to four scenarios:

```text
C01 — Duplicate Webhook Delivery
C03 — Invalid Webhook Signature
C07 — Payment Succeeds but Client Confirmation Is Lost
C11 — Failed Payment Must Never Mark Order Paid
```

These four scenarios cover the mandatory P0 story across:

- duplicate/replay safety and business idempotency;
- webhook authenticity;
- independence from browser confirmation;
- failed-payment safety.

Additional scenario wrappers are P1 and must not delay P0 completion.

The underlying payment protections tested by P1 scenarios—such as out-of-order safety, retry safety, transaction atomicity, unsupported-event handling and replay safety—may still be mandatory P0 implementation/tests where required by `MONEY_INVARIANTS.md`, `RAZORPAY_GUIDE.md`, `DATABASE.md`, `SECURITY.md` or `TESTING.md`.

---

## P0.7 — Deterministic Money Invariant Engine

PayChaos must evaluate explicit correctness rules.

Each invariant must return:

```text
PASS
FAIL
UNKNOWN
```

The invariant engine—not an LLM—is authoritative.

---

## P0.8 — Findings

Failed invariants create structured findings containing:

- failed rule;
- severity;
- affected payment/run;
- relevant evidence;
- timestamps;
- expected behavior;
- observed behavior.

---

## P0.9 — Evidence Timeline

The user must be able to understand the sequence of relevant events for a failure.

Evidence should include only information that is safe and necessary.

---

## P0.10 — Root-Cause Diagnosis

PayChaos must classify likely failure causes using structured evidence and deterministic signals.

The diagnosis must never replace verified system state.

---

## P0.11 — Recommended Fix

A finding should include an actionable recommendation relevant to the identified failure class.

---

## P0.12 — Regression Re-Test

The user must be able to rerun the relevant scenario after fixing the integration and determine whether the issue is resolved.

---

## P0.13 — Explainable Reliability Score

PayChaos must calculate a deterministic score based on known test results.

The user must be able to understand why the score changed.

---

## P0.14 — Go-Live Readiness

The dashboard must summarize whether the tested integration appears:

- not ready;
- needs attention;
- or ready according to the implemented PayChaos test suite.

This is a PayChaos assessment only.

It is **not** an official Razorpay certification.

---

## P0.15 — Security Enforcement

P0 must enforce:

- Test Mode-only operation;
- server-side secret isolation;
- verified webhook signatures;
- no arbitrary chaos targets;
- no sensitive card-data storage;
- safe logging;
- environment validation.

---

## P0.16 — Tests

Critical logic must be covered by automated tests.

Important end-to-end behavior must also be manually verified using Razorpay Test Mode.

---

# 11. P1 Differentiating Features

P1 features should only be implemented after P0 is reliable.

Potential P1 capabilities include:

## P1.1 — Rich Evidence Explanation

Generate clear human-readable summaries from structured findings.

---

## P1.2 — More Advanced Diagnosis Correlation

Correlate multiple signals across:

- webhook timeline;
- payment state;
- application state;
- invariant results.

---

## P1.3 — Additional Chaos Scenarios

After the four mandatory P0 scenarios are complete, tested and manually verified, the following existing catalogue scenarios may be implemented as P1 wrappers:

```text
C02 — Out-of-Order Webhook / Event Delivery
C04 — Webhook Handler Timeout / Slow Processing
C05 — Webhook Handler Returns Server Error
C06 — Duplicate Fulfilment Attempt
C08 — Database Failure During Webhook Processing
C09 — Replay of Already Processed Old Event
C10 — Unknown / Unhandled Webhook Event
```

Existing C12–C15 remain P1 as already defined in `CHAOS_SCENARIOS.md`.

P1 scenario wrappers must not delay P0 completion.

---

## P1.4 — Scenario-Specific Regression History

Show whether a particular failure:

- first failed;
- was fixed;
- remained fixed in later tests.

---

## P1.5 — Reliability Trend

Show historical reliability score changes based on genuine recorded runs.

Do not fabricate trend data.

---

## P1.6 — Rule-Based Engineering Guidance

Provide deeper fix guidance specific to:

- idempotency;
- event ordering;
- retries;
- reconciliation;
- state transitions.

---

## P1.7 — Lightweight AI/ML Differentiators

Only if P0 is complete, safe and tested.

Possible options include:

- simple anomaly grouping;
- finding clustering;
- deterministic natural-language explanations;
- locally executed lightweight models if technically justified.

No paid runtime AI API is required.

---

# 12. P2 Stretch Features

P2 work must not jeopardize P0 or P1.

Possible stretch features include:

- additional Razorpay Test Mode payment scenarios;
- expanded scenario library;
- richer timeline visualizations;
- comparison between multiple reliability runs;
- advanced anomaly clustering;
- more detailed readiness breakdowns;
- downloadable reliability reports;
- expanded regression analytics;
- developer-oriented integration recommendations;
- scenario presets for different merchant architectures.

P2 is optional.

A polished and correct P0 is more valuable than a partially working P2.

---

# 13. Explicitly Out of Scope

The following are not part of this project.

## Production Chaos Testing

PayChaos must never run chaos tests against:

- Razorpay Live Mode;
- real customer payments;
- production merchant systems.

---

## Arbitrary External Targets

PayChaos is not a general-purpose chaos attack tool.

Users must not be able to supply arbitrary:

- websites;
- APIs;
- IP addresses;
- webhook targets;
- infrastructure endpoints

for failure injection.

---

## Payment Gateway Replacement

PayChaos does not:

- process payments itself;
- replace Razorpay;
- act as a financial ledger;
- become the source of payment truth.

---

## Card Storage

PayChaos must never intentionally store:

- PAN/card number;
- CVV;
- raw card credentials.

Razorpay-hosted/client-side payment mechanisms should handle sensitive card entry.

---

## Live Financial Transactions

No real money is required or permitted for the buildathon implementation.

---

## Full Merchant Platform

The Demo Merchant is intentionally small.

The project does not need:

- catalog management;
- shipping;
- tax systems;
- full user account systems;
- enterprise commerce features.

---

## Autonomous Production Remediation

PayChaos does not automatically modify a real merchant's payment code or production infrastructure.

---

## Runtime Paid LLM Dependency

OpenAI API and Anthropic API are not required.

PayChaos must remain functional without paid runtime AI APIs.

---

## LLM-Based Payment Decisions

An LLM must never decide:

- whether a payment actually succeeded;
- authoritative paid/unpaid status;
- payment amount correctness;
- whether fulfilment should occur;
- financial ledger state;
- whether an invariant passed.

---

## Unnecessary Distributed Architecture

Do not introduce unnecessary:

- microservices;
- message brokers;
- separate agent services;
- Kubernetes;
- paid infrastructure;
- complex event platforms

for a one-week prototype unless a verified requirement makes them unavoidable.

---

# 14. Technology Stack

The intended core stack is:

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui

## Backend

Prefer the Next.js server/runtime for the primary application backend.

Avoid unnecessary separate backend services.

---

## Database

- Supabase PostgreSQL

Supabase may also provide project-appropriate platform functionality where useful, but PostgreSQL remains the primary persistent store.

---

## Payments

- Razorpay Test Mode
- Razorpay Orders
- Razorpay Checkout
- Razorpay Test Mode Webhooks

Only required Razorpay features should be implemented.

---

## Data / Analysis

If genuinely useful:

- Python
- pandas
- NumPy

Possible optional ML:

- scikit-learn

Python must not be introduced simply to create architecture complexity.

---

## Testing

- Vitest
- Playwright

Additional lightweight testing utilities may be used when justified.

---

## Source Control

- Git
- GitHub

---

## Deployment

- Vercel free tier where feasible
- Supabase free tier
- Razorpay Test Mode

---

## Development Assistants

- ChatGPT Plus
- Claude Max / Claude Agent Teams

These assist with project development.

They are **not runtime APIs for PayChaos AI**.

---

# 15. ₹0 Cost Requirement

The target operational cost for the buildathon project is:

**₹0**

The project should use free tiers and developer-accessible services wherever possible.

Do not require:

- paid AI APIs;
- paid hosting;
- paid databases;
- paid domains;
- paid queues;
- paid observability platforms;
- paid messaging services;
- paid background-processing platforms.

A feature requiring paid infrastructure should normally be rejected unless there is no practical free alternative and it is absolutely required for P0.

---

# 16. One-Week Development Constraint

The full project must be achievable in approximately one week.

This constraint affects every architecture decision.

## Rules

Prefer:

- one application;
- one primary database;
- simple data flows;
- explicit state;
- deterministic logic;
- small scenario catalogue;
- small invariant catalogue;
- reusable UI;
- strong tests for core behavior.

Avoid:

- architecture theatre;
- premature scalability;
- unnecessary abstractions;
- unnecessary microservices;
- complex orchestration;
- large ML pipelines;
- large agent systems at runtime.

The priority order is:

```text
Correct P0
    ↓
Tested P0
    ↓
Secure P0
    ↓
Polished P0
    ↓
P1 differentiators
    ↓
P2 stretch
```

---

# 17. Razorpay Test Mode-Only Safety Requirement

This is a non-negotiable requirement.

PayChaos AI must operate only with Razorpay Test Mode.

The application must not intentionally support PayChaos chaos execution using Razorpay Live Mode credentials.

## Safety expectations

The implementation should make accidental production execution difficult.

Where technically practical, the application should:

- validate configuration before starting a chaos run;
- reject unsupported/live configuration;
- isolate test-mode environment variables;
- display Test Mode clearly in relevant UI;
- document Test Mode setup;
- prevent arbitrary chaos targets.

The final application and documentation must state clearly that all demonstrated Razorpay transactions are **Test Mode transactions**.

---

# 18. Demo Merchant Purpose

The Demo Merchant is a controlled merchant application used to make payment reliability visible.

Its purpose is not to demonstrate ecommerce design.

Its purpose is to provide an application whose payment behavior can be:

- executed;
- observed;
- intentionally stressed;
- evaluated;
- diagnosed;
- retested.

The Demo Merchant provides the business-side state needed to demonstrate problems such as:

- duplicate fulfilment;
- incorrect order status;
- stale payment state;
- missing state convergence.

It should remain intentionally small.

---

# 19. Chaos Testing Purpose

Chaos testing in PayChaos means deliberately introducing controlled adverse conditions into the PayChaos-owned **test environment**.

The purpose is to answer:

> Does this payment integration remain correct when expected distributed-system failure modes occur?

Chaos is not an attack.

Chaos scenarios must be:

- predefined;
- constrained;
- observable;
- reversible where relevant;
- reproducible;
- limited to Razorpay Test Mode and PayChaos-controlled processing.

Examples may include:

- duplicated event processing;
- delayed processing;
- controlled alternative event ordering;
- transient internal handler failure;
- repeated application processing.

Each scenario must have:

- a documented purpose;
- known expected behavior;
- required evidence;
- one or more invariants.

---

# 20. Money Invariant Engine Purpose

The Money Invariant Engine is the authoritative correctness layer of PayChaos AI.

Its purpose is to evaluate deterministic rules that should remain true even during failures.

An invariant represents a rule such as:

> One external payment must not create multiple successful business-side effects.

or:

> The captured amount must agree with the amount expected for the associated order.

Each invariant must be:

- deterministic;
- explainable;
- testable;
- evidence-driven;
- assigned a stable identifier.

Possible results are:

```text
PASS
FAIL
UNKNOWN
```

## PASS

Available evidence proves the rule held.

## FAIL

Available evidence proves the rule was violated.

## UNKNOWN

Available evidence is insufficient to make a safe determination.

`UNKNOWN` is preferable to inventing certainty.

The invariant engine is authoritative over its own evaluations.

AI-generated text is not.

---

# 21. Root-Cause Diagnosis Purpose

The diagnosis layer answers:

> Given the failed invariant and available evidence, what most likely caused this reliability problem?

Its purpose is to convert low-level payment evidence into useful engineering guidance.

The diagnosis process should use structured inputs including:

- invariant result;
- payment identifiers;
- event ordering;
- duplicate counts;
- processing attempts;
- expected state;
- observed state;
- timestamps;
- relevant application actions.

The expected pipeline is:

```text
Invariant Failure
        ↓
Evidence Pack
        ↓
Deterministic Signal Extraction
        ↓
Root-Cause Classification
        ↓
Explanation
        ↓
Recommended Fix
```

Possible categories may include:

- missing idempotency;
- duplicate business processing;
- missing reconciliation;
- incorrect payment-state transition;
- incorrect assumptions about event ordering;
- retry-handling error;
- amount mismatch.

Diagnosis is advisory.

The underlying recorded evidence and invariant result remain authoritative.

---

# 22. Reliability Score / Go-Live Readiness Purpose

The Reliability Score summarizes the observed reliability of the tested integration.

Its purpose is to help a developer quickly answer:

> Based on the scenarios PayChaos actually tested, how ready does this integration appear to be?

The score should derive from genuine recorded results such as:

- scenario outcomes;
- invariant outcomes;
- failure severity;
- unresolved findings;
- successful regression results;
- UNKNOWN evaluations.

The score must be:

- deterministic;
- explainable;
- reproducible;
- based on real test results.

It must not be an arbitrary AI-generated percentage.

The score should have a clear breakdown showing why points were lost or gained.

The associated Go-Live Readiness label should be treated as:

**a PayChaos engineering assessment based on its implemented tests.**

It is not:

- financial advice;
- an SLA;
- an official Razorpay certification;
- a guarantee that production failures cannot occur.

---

# 23. AI Responsibilities

AI-related behavior in PayChaos must remain bounded by evidence.

AI may assist with:

- explaining failed invariants;
- summarizing timelines;
- mapping deterministic signals to probable root causes;
- explaining engineering consequences;
- generating understandable remediation guidance;
- grouping related findings;
- prioritizing engineering attention;
- presenting reliability results clearly.

The runtime P0 product should not depend on a paid LLM.

Deterministic rules and structured templates are acceptable and preferred when they deliver reliable P0 behavior.

AI-like intelligence should be valuable because it interprets evidence—not because the project calls an external model.

---

# 24. What AI Is NOT Allowed to Control

AI or LLM output must never be the authoritative source for:

- whether money moved;
- whether a payment succeeded;
- whether a payment failed;
- payment amount;
- authoritative order state;
- authoritative Razorpay state;
- whether a merchant should fulfil an order;
- whether a refund exists;
- whether a payment is captured;
- invariant PASS/FAIL status;
- reconciliation truth;
- ledger or accounting state;
- webhook signature validity.

Authoritative truth must come from:

```text
Verified Razorpay Test Mode evidence
+
verified application state
+
deterministic rules
+
deterministic money invariants
```

AI may explain those facts.

AI may not replace them.

---

# 25. Security Principles

Security must be designed into the project from the beginning.

## Principle 1 — Test Mode Only

Chaos must never run against real payment systems.

---

## Principle 2 — Secrets Stay Server-Side

Never expose:

- Razorpay key secret;
- webhook secret;
- Supabase privileged/service credentials;
- other private credentials

to browser code, logs or Git.

---

## Principle 3 — No Sensitive Card Storage

PayChaos must not intentionally store:

- card numbers;
- CVV;
- raw card credentials.

---

## Principle 4 — Verify Webhook Authenticity

Razorpay webhook signatures must be validated before trusting an incoming event.

---

## Principle 5 — Idempotency by Design

Webhook/event processing must safely tolerate duplicate delivery.

---

## Principle 6 — Explicit Trust Boundaries

The application must distinguish between:

- browser-supplied information;
- internal server state;
- database state;
- verified Razorpay information.

---

## Principle 7 — Restrict Chaos Targets

The chaos runner must not accept arbitrary internet targets.

It should operate only on predefined PayChaos-controlled behaviors.

---

## Principle 8 — Safe Logs

Logs must not expose secrets or sensitive payment information.

---

## Principle 9 — Least Privilege

Use the least amount of database or service privilege needed by each execution path.

---

## Principle 10 — Fail Safely

If PayChaos cannot establish required evidence or configuration safely, it should return an error or `UNKNOWN`, not fabricate success.

---

# 26. Testing Principles

No phase is complete merely because code exists.

Testing must demonstrate correctness.

## Core Testing Layers

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
Invariant Tests
    ↓
Regression Tests
    ↓
Playwright E2E
    ↓
Manual Verification
```

## Testing Rules

### Deterministic Logic Must Have Unit Tests

Especially:

- state transitions;
- event normalization;
- invariant rules;
- score calculation;
- diagnosis mapping;
- idempotency behavior.

### Webhooks Must Be Tested

Including:

- valid signature;
- invalid signature;
- duplicate event;
- repeated processing;
- malformed input where relevant.

### Chaos Scenarios Must Be Repeatable

A chaos scenario must have:

- known setup;
- known expected result;
- cleanup or reset behavior where needed.

### Real Razorpay Test Mode Must Be Manually Verified

Mocks alone are insufficient to claim Razorpay integration works.

### Automated Tests and Manual Verification Are Different

Both should be recorded separately.

### No Fake Test Results

Never claim a test passed unless it actually ran successfully.

---

# 27. Five Project Phases

The project is frozen into five phases.

---

## Phase 1 — Foundation + Demo Merchant

### Goal

Create the reliable foundation on which the payment system will be built.

### Typical scope

- repository/application foundation;
- Next.js/TypeScript/Tailwind/shadcn setup;
- core UI shell;
- Supabase foundation;
- approved initial schema;
- environment handling;
- Demo Merchant foundation;
- domain types;
- security boundaries;
- test infrastructure.

### Not Phase 1

Do not prematurely implement the full Razorpay, chaos or diagnosis systems.

---

## Phase 2 — Razorpay Test Mode + Payments + Webhooks

### Goal

Build and verify the real Razorpay Test Mode payment path.

### Typical scope

- test order creation;
- Checkout;
- payment-attempt tracking;
- payment verification where required;
- webhook receiver;
- signature validation;
- webhook persistence;
- normalization;
- idempotency;
- payment correlation;
- baseline payment state.

### Completion requires

Real manual Razorpay Test Mode verification.

---

## Phase 3 — Chaos Engine + Money Invariant Engine

### Goal

Introduce controlled reliability failures and deterministically detect correctness violations.

### Typical scope

- chaos runner;
- P0 scenarios;
- event manipulation/replay mechanisms where approved;
- evidence collection;
- invariant evaluation;
- PASS / FAIL / UNKNOWN;
- findings;
- scenario/invariant mapping.

---

## Phase 4 — Diagnosis + Reliability Score + AI Differentiators

### Goal

Transform invariant failures into understandable engineering guidance and readiness results.

### Typical scope

- evidence packs;
- root-cause diagnosis;
- recommendations;
- regression workflow;
- deterministic score;
- Go-Live Readiness;
- safe AI-like differentiation.

P1 AI/ML features are considered only after the P0 logic works.

---

## Phase 5 — UI Polish + Testing + Security + Deployment + Demo

### Goal

Turn the implemented system into a secure, tested, polished buildathon submission.

### Typical scope

- final dashboard polish;
- finding/evidence presentation;
- end-to-end testing;
- regression validation;
- security review;
- production-build verification;
- Vercel deployment;
- Supabase deployment/configuration;
- final Razorpay Test Mode configuration;
- final documentation;
- demo rehearsal;
- submission assets.

---

# 28. Definition of Project Success

PayChaos AI is successful when the final build can demonstrate the following end-to-end behavior.

## Required Success Path

1. A user opens PayChaos AI.
2. The Demo Merchant creates a real Razorpay Test Mode order.
3. A real Razorpay Test Mode payment is performed.
4. PayChaos receives and verifies relevant webhook events.
5. Payment and application evidence is persisted.
6. A healthy baseline can produce passing invariant results.
7. The user selects a supported chaos scenario.
8. PayChaos injects that scenario in its controlled environment.
9. The scenario produces observable evidence.
10. A relevant deterministic money/state invariant evaluates the evidence.
11. A real violation creates a finding.
12. The user can inspect why the finding occurred.
13. PayChaos identifies a probable evidence-backed root cause.
14. PayChaos recommends an engineering fix.
15. The relevant scenario can be rerun.
16. PayChaos records whether the regression now passes.
17. The reliability score reflects genuine test outcomes.
18. The user can see a clear Go-Live Readiness summary.
19. All operations remain Razorpay Test Mode only.
20. Required automated and manual tests pass.
21. No sensitive secrets or card details are exposed.
22. The application can be demonstrated reliably to judges.

The project does not need enterprise scale.

It needs to provide a technically credible, complete and reliable P0 implementation.

---

# 29. Final Demo Story

The final demonstration should tell a simple engineering story.

## Act 1 — Healthy Integration

Open PayChaos AI.

Explain:

> This is a controlled Demo Merchant integrated with Razorpay Test Mode.

Create an order.

Complete a Razorpay Test Mode payment.

Show:

- payment attempt;
- Razorpay identifiers;
- received webhook/event evidence;
- correct merchant state;
- passing money invariants.

---

## Act 2 — Introduce a Reliability Failure

Select one strong predefined chaos scenario.

For example, a duplicate-event/idempotency scenario.

Clearly state whether the test uses:

- a real incoming Razorpay Test Mode event;
- PayChaos replay of recorded Test Mode evidence;
- controlled internal processing simulation.

Do not misrepresent simulated behavior as something Razorpay itself did.

Run the scenario.

---

## Act 3 — Detect the Problem

Show the resulting finding.

Display:

- failed invariant;
- expected state;
- observed state;
- affected payment/run;
- event timeline;
- relevant evidence.

Explain that this result is deterministic.

---

## Act 4 — Diagnose It

Show:

- probable root cause;
- evidence supporting the diagnosis;
- recommended fix.

Example narrative:

> The payment itself succeeded. The merchant-side logic processed the same payment effect twice because the handler lacked an effective idempotency guard.

---

## Act 5 — Regression

Apply or demonstrate the corrected implementation.

Run the same scenario again.

Show that:

- the duplicated event is tolerated;
- the invariant now passes;
- the finding is resolved.

---

## Act 6 — Go-Live Readiness

Open the reliability overview.

Show:

- scenarios executed;
- passed invariants;
- unresolved failures;
- resolved regressions;
- reliability score;
- explanation of the score;
- Go-Live Readiness status.

Conclude with the core product message:

> PayChaos AI does not guess whether payments are correct. It deliberately tests the integration, verifies deterministic money invariants from evidence, explains failures, and helps engineers prove that the fix actually works.

---

# 30. Important Terminology / Glossary

## Application State

The state stored by the PayChaos Demo Merchant or application for a payment/order.

Application state is not automatically equivalent to Razorpay state.

---

## Authoritative Evidence

Verified information used for deterministic evaluation.

Examples:

- persisted internal application state;
- verified Razorpay Test Mode webhook data;
- verified Razorpay API information where used;
- deterministic processing records.

---

## Chaos Run

One execution of a predefined reliability failure scenario.

A chaos run should have its own identifier and associated evidence.

---

## Chaos Scenario

A predefined, controlled adverse condition used to test payment reliability.

---

## Controlled Simulation

A failure or state manipulation created inside the PayChaos-controlled test environment.

It must be clearly distinguished from actual Razorpay behavior.

---

## Demo Merchant

The small merchant application included with PayChaos for performing and observing Test Mode payment behavior.

---

## Diagnosis

An evidence-backed classification of the probable cause of a failed invariant.

A diagnosis is advisory.

---

## Evidence

Recorded information supporting an invariant result or diagnosis.

Examples:

- identifiers;
- timestamps;
- states;
- webhook observations;
- processing attempts;
- scenario metadata.

---

## Evidence Pack

The structured collection of evidence supplied to the diagnosis layer for one finding.

---

## Finding

A structured reliability issue produced when an invariant fails.

---

## Go-Live Readiness

A PayChaos-generated summary of the tested integration's reliability based only on scenarios and invariants actually executed.

It is not official Razorpay certification.

---

## Idempotency

A design property where repeated processing of the same logical operation does not create duplicate business effects.

---

## Invariant

A deterministic correctness rule that should remain true under expected payment and failure conditions.

---

## Money Invariant

An invariant specifically protecting payment or money-related correctness.

---

## Normalized Event

A consistent internal representation derived from incoming or replayed event evidence.

---

## P0

Mandatory functionality required for a complete submission.

P0 always takes priority.

---

## P1

Differentiating functionality that may be built after P0 is reliable.

---

## P2

Optional stretch functionality.

---

## Payment Attempt

The internal record representing one payment attempt initiated by the Demo Merchant.

---

## Razorpay Order

An order created using Razorpay Test Mode APIs.

---

## Razorpay Payment

The Razorpay Test Mode payment associated with an order.

---

## Real Razorpay Test Mode Behavior

An action or event that genuinely occurred through Razorpay Test Mode.

Examples include:

- order creation;
- Checkout interaction;
- Test Mode payment;
- Razorpay-generated Test Mode webhook delivery.

---

## Regression Run

A repeat execution of a relevant test after a finding has been addressed.

---

## Reliability Score

A deterministic numerical summary derived from real PayChaos test outcomes.

It must be explainable.

---

## Root Cause

The most likely engineering reason for an observed invariant violation based on available evidence.

---

## Synthetic Data

Data generated by PayChaos for testing, demonstration or fixtures rather than produced directly by Razorpay Test Mode.

Synthetic data must be clearly labeled.

---

## Synthetic Metric

A metric generated for demonstration rather than calculated from real recorded test results.

Synthetic metrics should generally be avoided.

If used, they must be clearly labeled as synthetic/demo-only.

---

## Test Fixture

A predefined payload, state or event used by automated tests.

Fixtures are not evidence that Razorpay itself emitted the associated event.

---

## Test Mode

Razorpay's non-live environment used for development and integration testing without real-money transactions.

PayChaos supports Test Mode only.

---

## UNKNOWN

An invariant result indicating that available evidence is insufficient to safely determine PASS or FAIL.

---

## Verified State

A state supported by trusted system evidence rather than assumption or generated explanation.

---

## Webhook

An event notification delivered by Razorpay to a configured server endpoint.

Webhook authenticity must be verified before the event is trusted.

---

# SOURCE OF TRUTH RULES

These rules apply to all PayChaos AI development work.

## Rule 1 — Repository Documentation Is the Source of Truth

The repository documentation is more authoritative than old ChatGPT, Claude or other AI conversation history.

If an old conversation conflicts with current approved repository documentation:

**the repository documentation wins.**

---

## Rule 2 — PROJECT_CONTEXT.md Must Be Read First

Every new:

- ChatGPT project chat;
- Claude session;
- Claude Agent Team;
- implementation phase;
- architecture review;
- security review;
- QA review

must read `PROJECT_CONTEXT.md` before making project decisions.

It provides the canonical project boundaries and intent.

More specific repository documents may define detailed implementation contracts, but they must remain consistent with this document.

---

## Rule 3 — Do Not Depend on Old Conversation History

A new AI session must be able to work from repository documentation and approved handoffs.

Important project decisions must therefore be written into the repository rather than existing only in an AI conversation.

---

## Rule 4 — Phase Boundaries Are Intentional

The project is intentionally divided into five phases.

Work should remain inside the currently requested phase.

Do not implement future-phase features merely because they are convenient.

---

## Rule 5 — Completed Phases Must Not Be Casually Rewritten

Once a phase has been:

```text
IMPLEMENTED
→ TESTED
→ MANUALLY VERIFIED
→ DOCUMENTED
→ APPROVED
```

later phases should not redesign or replace that work without a confirmed reason.

Valid reasons include:

1. a confirmed bug;
2. a security vulnerability;
3. a verified Razorpay, Supabase or platform constraint;
4. an incorrect documented assumption discovered through real testing;
5. an approved dependency genuinely required by a later phase.

Significant changes must be documented.

---

## Rule 6 — Every Phase Must End With a Handoff

Every implementation phase must produce a handoff document before approval.

The handoff must include at minimum:

- completed features;
- files added;
- files modified;
- files removed if applicable;
- database changes;
- configuration/environment changes;
- Razorpay configuration changes;
- tests performed;
- exact test results;
- build/type-check/lint status;
- manual verification performed;
- acceptance-criteria status;
- security verification;
- architectural decisions;
- known issues;
- deferred work;
- next-phase dependencies;
- relevant evidence.

The next phase must read the previous approved handoff.

---

## Rule 7 — Code Completion Is Not Phase Completion

A phase is not complete because Claude or another agent says implementation is finished.

The required progression is:

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

All required acceptance criteria must have evidence.

---

## Rule 8 — Payment Truth Must Remain Deterministic

No AI-generated explanation may override:

- verified Razorpay Test Mode evidence;
- verified application state;
- deterministic state rules;
- deterministic money invariants.

When evidence is incomplete, use `UNKNOWN`.

Do not invent certainty.

---

## Rule 9 — Real and Simulated Behavior Must Remain Distinguishable

Documentation, UI, logs and demo narration must distinguish between:

1. real Razorpay Test Mode behavior;
2. PayChaos-controlled simulations;
3. replayed previously recorded Test Mode events;
4. automated-test fixtures;
5. synthetic/demo-only data.

Never present a simulation or fixture as an event Razorpay actually produced.

---

## Rule 10 — P0 Reliability Comes First

When scope, time or complexity creates a tradeoff:

```text
Correctness
>
Payment safety
>
Evidence quality
>
Testability
>
P0 completeness
>
UI polish
>
P1
>
P2
```

PayChaos AI should remain small enough to be completed, tested and demonstrated reliably within the one-week development constraint.