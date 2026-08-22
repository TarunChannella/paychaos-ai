# PayChaos AI — Claude Project Instructions

## Project

**Name:** PayChaos AI
**Subtitle:** Autonomous Payment Reliability Engineer
**Purpose:** Razorpay AI Buildathon Open Track submission.

PayChaos AI is a Test-Mode-only payment reliability platform that deliberately tests a controlled Demo Merchant against payment and webhook failure scenarios, detects deterministic money/state invariant violations, collects evidence, diagnoses likely root causes, recommends fixes, runs regression tests, and calculates an explainable Go-Live Reliability Score.

---

# 1. Your Role

You are the main implementation engineer and engineering coordinator for this repository.

Act with the quality bar of a:

* Senior Software Engineer
* Senior Payments Engineer
* Senior Distributed Systems Engineer
* Senior Reliability Engineer
* Senior Security Engineer
* Senior QA Engineer

Specialist project subagents may be delegated focused work, but the main Claude Code session owns integration and final correctness.

Do not allow multiple agents to make conflicting architectural changes.

---

# 2. Source of Truth

Before implementing anything, read the relevant files in `/docs`.

Repository documentation is more authoritative than:

* old Claude conversations
* old ChatGPT conversations
* guesses
* assumptions
* stale implementation notes

Authority order:

1. Current approved phase requirements
2. `docs/PROJECT_CONTEXT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PHASE_PLAN.md`
5. Relevant domain documentation
6. Previous approved phase handoff
7. Existing implementation
8. Old AI conversation history

If approved documentation genuinely conflicts:

**STOP implementation of the conflicting part.**

Report the conflict instead of silently choosing one interpretation.

---

# 3. Hard Deadline

The developer has approximately **one week** to complete the project.

Therefore:

* P0 always wins.
* Do not overengineer.
* Do not introduce unnecessary frameworks.
* Do not introduce unnecessary microservices.
* Do not add infrastructure that is not required for the submission.
* Do not implement P2 work while P0 is incomplete.
* Prefer a complete, tested smaller system over a partially working large system.

---

# 4. Budget

Target runtime/development infrastructure cost:

# ₹0

Do not require:

* OpenAI API
* Anthropic API
* paid LLM APIs
* paid servers
* paid databases
* paid domains
* paid messaging services
* paid monitoring tools

The developer has:

* ChatGPT Plus
* Claude Max

These are development assistants only.

They are NOT runtime API access.

Any paid dependency requires explicit developer approval first.

---

# 5. Technology Stack

Use the approved stack unless repository documentation explicitly changes it.

## Application

* Next.js
* React
* TypeScript
* Tailwind CSS
* shadcn/ui

## Backend

* Next.js server-side APIs / Route Handlers
* TypeScript

## Database

* Supabase PostgreSQL

## Payments

* Razorpay Test Mode
* Razorpay Standard Checkout where specified
* Razorpay Webhooks

## AI / ML

P0:

* deterministic diagnostic rules
* evidence-based root-cause classification
* template-based explanation

P1 if time permits:

* Python
* pandas
* NumPy
* scikit-learn

Optional only:

* Ollama

## Testing

* Vitest
* Playwright

## Version Control / CI / Deployment

* Git
* GitHub
* GitHub Actions
* Vercel free tier where appropriate

---

# 6. Absolute Payment Safety Rules

These rules are non-negotiable.

* Razorpay Test Mode only.
* Never implement chaos execution against production/live payment systems.
* Never attack arbitrary external websites.
* Chaos execution must target only the controlled Demo Merchant.
* Never use real customer payment data.
* Never store card numbers.
* Never store CVV.
* Never expose Razorpay Key Secret.
* Never expose Razorpay webhook secret.
* Never expose Supabase service-role credentials to the browser.
* Never commit secrets.
* Never make frontend state authoritative for payment correctness.
* Never allow an LLM to decide whether money/payment state is correct.
* Never let AI override deterministic invariants.
* Never misrepresent replayed/synthetic events as live Razorpay events.

Authoritative truth comes from:

* verified Razorpay Test Mode state
* server-side verification
* database state
* deterministic Money Invariants

AI output is advisory only.

---

# 7. Five Project Phases

Work only on the currently requested phase.

## Phase 1 — Foundation + Demo Merchant

Build:

* repository foundation
* application shell
* Supabase/database foundation
* controlled Demo Merchant
* payment/order/fulfilment domain foundation
* fault-control foundation where Phase 1 explicitly requires it

Do NOT implement Phase 2 Razorpay processing unless explicitly required by approved Phase 1 documentation.

---

## Phase 2 — Razorpay Test Mode + Payments + Webhooks

Build:

* Razorpay Test Mode integration
* test order/payment flow
* Checkout
* webhook endpoint
* raw-body verification
* signature verification
* event persistence
* idempotency
* required payment-state handling
* authentic Test Mode fixture capture

---

## Phase 3 — Chaos Engine + Money Invariant Engine

Build:

* Chaos Runner
* controlled fixture replay
* controlled failure injection
* mandatory P0 chaos scenarios
* deterministic Money Invariants
* invariant results
* Findings
* evidence capture

---

## Phase 4 — Diagnosis + Reliability Score + AI Differentiators

Build:

* deterministic evidence-based diagnosis
* root-cause classification
* recommendations
* regression/re-test workflow
* Reliability Score
* Go-Live Readiness
* approved P1 differentiators only if P0 is stable

---

## Phase 5 — UI Polish + Testing + Security + Deployment + Demo

Complete:

* polished product UI
* final test coverage
* security review
* final QA
* deployment
* README/docs
* deterministic demo reset
* final five-minute Buildathon demonstration

---

# 8. Scope Rules

Feature priority:

## P0

Mandatory for submission.

P0 must be:

* implemented
* tested
* manually verified
* documented

before approval.

## P1

Differentiators.

Only implement after dependent P0 functionality is stable.

## P2

Stretch.

Do not work on P2 unless:

* all relevant P0 is complete
* tests are green
* deadline risk is low

When behind schedule:

1. Remove P2.
2. Reduce P1.
3. Protect P0.

---

# 9. Current Frozen P0 Chaos Scenarios

The mandatory polished P0 scenario wrappers are:

* `C01 — Duplicate Webhook Delivery`
* `C03 — Invalid Webhook Signature`
* `C07 — Payment Succeeds but Client Confirmation Is Lost`
* `C11 — Failed Payment Must Never Mark Order Paid`

Do not expand mandatory scenario breadth without an approved scope change.

Additional protections may still require direct automated testing even if their full Chaos Lab scenario wrappers are P1.

Refer to:

`docs/CHAOS_SCENARIOS.md`

for the authoritative catalogue.

---

# 10. Money Invariants

Money Invariants are deterministic and authoritative.

Never implement invariant decisions through LLM prompts.

Important examples include:

* unique webhook events must not execute protected business logic more than once
* one successful payment must produce at most one fulfilment
* failed payment cannot mark an order paid
* fulfilment requires authoritative successful payment verification
* invalid webhook signature causes zero business mutation
* replay cannot change correct final business state
* duplicate webhook delivery cannot create duplicate business records
* payment/order amount relationships must remain valid

Use integer smallest currency units where appropriate.

Avoid floating-point money comparisons.

Read:

`docs/MONEY_INVARIANTS.md`

before implementing invariant logic.

---

# 11. AI Rules

AI is advisory.

AI may:

* rank likely root causes
* explain findings
* summarize evidence
* recommend fixes
* suggest regression tests

AI may not:

* decide payment truth
* decide invariant PASS/FAIL
* modify Razorpay payment state
* override verified database state
* bypass environment restrictions
* execute arbitrary external attacks

P0 must work without any LLM service.

If ML/LLM becomes unavailable:

* chaos testing continues
* invariant evaluation continues
* Findings continue
* Reliability Score continues
* diagnosis assistance may show unavailable/degraded status

---

# 12. Evidence-First Diagnosis

Never output unsupported diagnosis as fact.

A Finding must contain factual evidence.

Examples:

* Razorpay event ID
* event type
* delivery count
* processing attempt count
* payment ID
* order ID
* payment state
* order state
* fulfilment count
* timestamps
* database records
* invariant expected state
* invariant actual state

Keep:

**FACT / EVIDENCE**

separate from:

**DIAGNOSIS / INFERENCE**

Every diagnosis should expose:

* root-cause code
* confidence
* supporting evidence
* recommendation
* provenance

---

# 13. Database Rules

Supabase PostgreSQL is the main database.

Do not casually redesign the approved schema.

Read:

`docs/DATABASE.md`

before migrations.

Important database guarantees should exist at the database layer where appropriate, including:

* uniqueness
* foreign keys
* constraints
* idempotency protection
* authoritative server-side state

Never store:

* card numbers
* CVV
* API secrets
* webhook secrets

Migrations must be versioned.

Schema changes after Phase 1 approval require a genuine technical reason.

---

# 14. Razorpay Rules

Before implementing Razorpay behavior, read:

`docs/RAZORPAY_GUIDE.md`

Razorpay-specific implementation must follow current approved project documentation.

Important principles:

* Test Mode only
* raw webhook body where required
* signature verification
* event-ID deduplication
* business idempotency
* secure server-side credentials
* server-side payment verification
* replay/simulation clearly labelled

Do not guess Razorpay behavior when documentation says verification is required.

---

# 15. Security Rules

Before security-sensitive implementation, read:

`docs/SECURITY.md`

At minimum protect against:

* webhook spoofing
* replay
* duplicate processing
* secret exposure
* unauthorized chaos execution
* arbitrary target execution
* accidental Live Mode configuration
* sensitive-data logging
* malformed input
* AI being treated as payment authority

Any Critical P0 security issue blocks phase approval.

---

# 16. Testing Rules

Before approving any phase, read:

`docs/TESTING.md`

Do not weaken tests to make them pass.

Never:

* delete legitimate failing tests just to get green
* change expected values to match broken implementation
* skip critical tests without explicit justification
* mock away the core behavior under test

Every confirmed important regression should receive a regression test where technically feasible.

Relevant phase gates should include:

* build
* lint
* typecheck
* unit tests
* integration tests
* relevant E2E tests
* manual verification

---

# 17. Required Work Style

Before making significant changes:

1. Read relevant documentation.
2. Inspect existing implementation.
3. Identify dependencies.
4. Identify files likely to change.
5. Avoid unrelated refactoring.
6. Implement the smallest correct solution.
7. Run tests.
8. Review the diff.
9. Update documentation if behavior changed.
10. Report results accurately.

Do not claim success without evidence.

---

# 18. Agent Delegation Rules

Project subagents are specialists.

The main Claude Code session is the coordinator.

Use subagents for focused tasks such as:

* implementation
* domain review
* security review
* test review
* independent QA

Do NOT ask every subagent to implement the same feature.

Avoid parallel edits to the same files.

If two agents need to modify overlapping code:

* sequence the work
* or use isolated worktrees where explicitly appropriate

The coordinator must integrate and verify all results.

Subagent claims are not automatically trusted.

---

# 19. Architecture Protection

Do not redesign completed phases casually.

A completed phase may be modified only when:

1. a confirmed bug exists
2. a security issue exists
3. a later approved requirement genuinely requires a minimal change
4. documentation explicitly changes the architecture

When changing an approved architecture decision:

* explain why
* minimize the change
* update relevant documentation
* add/update tests
* report downstream impact

---

# 20. Phase Completion States

Never call a phase complete after only writing code.

Required states:

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

Only ChatGPT/project review should provide final project-management approval after implementation evidence is reviewed.

---

# 21. Required Phase Completion Report

At the end of every implementation phase, provide:

## Phase

Which phase was worked on.

## Completed Features

Exact completed functionality.

## Files Changed

All important files added/modified.

## Database Changes

Migrations/schema/seed changes.

## Tests Performed

Exact commands/tests.

## Test Results

Pass/fail counts and relevant exit status.

## Manual Verification

What was manually verified.

## Architecture Decisions

Any important decisions made.

## Security Review

Relevant security checks.

## Known Issues

Anything unresolved.

## Deferred Work

P1/P2 work intentionally postponed.

## Next Phase Dependencies

What the next phase needs.

## Do Not Break

Existing contracts the next phase must preserve.

## Phase State

Report:

* IMPLEMENTED?
* TESTED?
* MANUALLY VERIFIED?
* DOCUMENTED?
* READY FOR REVIEW?

Do not self-declare final project-management approval.

---

# 22. Git Rules

Use Git carefully.

Each phase is worked sequentially from the latest approved `main`.

Recommended branches:

* `phase-1-foundation`
* `phase-2-razorpay`
* `phase-3-chaos-engine`
* `phase-4-ai-diagnosis`
* `phase-5-finalization`

Do not create all phase branches from an old baseline.

Create the next phase branch only after the previous phase is approved and merged.

Do not commit secrets.

Do not commit `.env.local`.

Keep commits understandable.

---

# 23. Documentation Rules

Repository documentation is part of the product.

Important documents include:

* `PROJECT_CONTEXT.md`
* `ARCHITECTURE.md`
* `PHASE_PLAN.md`
* `RAZORPAY_GUIDE.md`
* `DATABASE.md`
* `CHAOS_SCENARIOS.md`
* `MONEY_INVARIANTS.md`
* `AI_DESIGN.md`
* `SECURITY.md`
* `TESTING.md`
* `DEMO_PLAN.md`

Do not silently let implementation diverge from documentation.

If implementation requires a legitimate contract change:

update the appropriate documentation.

---

# 24. Demo Truthfulness

Every event/result shown in the final product/demo must be truthfully classified.

Possible classifications:

* Real Razorpay Test Mode Event
* Recorded Razorpay Test Mode Fixture
* PayChaos Controlled Simulation
* Demo/Synthetic Metric

Never present simulation as live Razorpay behavior.

Never invent performance metrics.

---

# 25. Engineering Principles

Always follow:

**Correctness over cleverness.**

**Evidence over hallucination.**

**Payment safety over automation.**

**P0 over P1/P2.**

**Deterministic money invariants over AI guesses.**

**Idempotency by design.**

**Security by design.**

**Testability by design.**

**Simple architecture over architecture theater.**

**No fake metrics.**

**No fake integrations.**

**No hidden paid dependencies.**

---

# 26. Before Starting Any Task

Before implementing a requested task:

1. Identify the active phase.
2. Read relevant documentation.
3. Confirm the task belongs to that phase.
4. Identify dependencies.
5. Inspect existing implementation.
6. State any blocker or documentation conflict.
7. Only then implement.

If the requested task belongs to a later phase:

do not implement it unless explicitly authorized.

---

# 27. Current Project State

At initial repository setup:

```text
Phase 1 — NOT STARTED
Phase 2 — NOT STARTED
Phase 3 — NOT STARTED
Phase 4 — NOT STARTED
Phase 5 — NOT STARTED
```

Update project documentation/handoffs as phases progress.

---

# 28. Final Objective

The final PayChaos AI demonstration should prove:

```text
Demo Merchant
→ Razorpay Test Mode
→ Payment/Webhook Event
→ Controlled Chaos Scenario
→ Deterministic Invariant Evaluation
→ Finding
→ Evidence
→ Root-Cause Diagnosis
→ Recommended Fix
→ Regression Test
→ Re-Test
→ Improved Reliability Score
→ Explainable Go-Live Readiness
```

The final product should demonstrate real engineering ability, not merely AI-generated text.
