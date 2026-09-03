import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { PageHeader, PageShell } from "@/components/ui/page";
import { SignalLine, type SignalStep } from "@/components/ui/signal-line";
import { ProvenanceTag } from "@/components/ui/status";
import { DEMO_MERCHANT_PRODUCT } from "@/lib/demo-merchant/product";
import { listDemoMerchantOrders } from "@/lib/demo-merchant/service";
import {
  formatAmountForDisplay,
  formatCheckoutWebhookConfirmationMessage,
  formatConceptualState,
  isPaymentCaptureConfirmedByRealWebhook,
  type PaymentAttemptViewModel,
} from "@/lib/demo-merchant/view-model";

import { CreateOrderButton } from "./create-order-button";
import { CreateRazorpayOrderButton } from "./create-razorpay-order-button";
import { PayWithRazorpayButton } from "./pay-with-razorpay-button";

// Phase 2C — a payment attempt is eligible for Checkout launch only once a
// trusted Razorpay Order correlation exists and the attempt is in an
// appropriate launch state (docs instructions Section 14: do not show the
// button for a FAILED_OBSERVED attempt without a valid order, a CAPTURED
// attempt, or missing/invalid Razorpay Order correlation).
function isEligibleForCheckout(
  attempt: PaymentAttemptViewModel | null,
): attempt is PaymentAttemptViewModel & { razorpayOrderId: string } {
  return (
    attempt !== null &&
    attempt.razorpayOrderId !== null &&
    (attempt.status === "ORDER_CREATED" ||
      attempt.status === "CHECKOUT_IN_PROGRESS")
  );
}

// Phase 1E/2B Demo Merchant screen.
//
// `force-dynamic` ensures this page always renders server-side against the
// real, current Supabase state on every request — never a cached/static
// snapshot — so a browser refresh always shows the durable persisted order
// list (docs instructions Section 11).
export const dynamic = "force-dynamic";

export default async function DemoMerchantPage() {
  const orders = await listDemoMerchantOrders(10);

  /**
   * The lifecycle chain for the most recent order.
   *
   * PROVENANCE IS ONLY CLAIMED WHERE IT IS KNOWN. The webhook step is tagged
   * `verified` solely because the view model's `sourceKind` is literally
   * REAL_RAZORPAY_WEBHOOK and the row records its own signature check — this
   * page genuinely holds that evidence. Every other stage is `recorded`,
   * because "a payment row exists" is not the same claim as "Razorpay
   * confirmed it".
   *
   * Nothing is invented: a stage with no record renders as pending.
   */
  const latest = orders[0] ?? null;

  const lifecycleSteps: SignalStep[] =
    latest === null
      ? []
      : [
          {
            label: "Merchant order created",
            detail: `${formatConceptualState(latest.conceptualState)} · ${formatAmountForDisplay(latest.amountSubunits, latest.currency)}`,
            tone: "recorded",
          },
          latest.latestPaymentAttempt === null
            ? {
                label: "Payment attempt",
                detail: "No payment has been attempted for this order yet.",
                tone: "pending",
              }
            : {
                label: "Payment attempt",
                detail: latest.latestPaymentAttempt.status,
                tone: "recorded",
              },
          latest.latestWebhookEvent === null
            ? {
                label: "Razorpay webhook",
                detail:
                  "No real Razorpay webhook has been correlated to this order yet.",
                tone: "pending",
              }
            : {
                label: `Razorpay webhook — ${latest.latestWebhookEvent.eventType}`,
                detail: latest.latestWebhookEvent.signatureVerified
                  ? "Signature verified server-side."
                  : "Signature NOT verified.",
                // Only here is the truth source actually established.
                tone: latest.latestWebhookEvent.signatureVerified
                  ? "verified"
                  : "fail",
              },
          latest.latestPayment === null
            ? {
                label: "Payment record",
                detail:
                  "No verified payment has been persisted for this order.",
                tone: "pending",
              }
            : {
                label: "Payment record",
                // The provider's own status where recorded, plus whether the
                // Checkout signature was verified server-side — the two facts
                // that decide whether this row may be treated as
                // authoritative.
                detail: [
                  latest.latestPayment.razorpayPaymentStatus ??
                    "status not recorded",
                  latest.latestPayment.checkoutSignatureVerified
                    ? "Checkout signature verified"
                    : "Checkout signature NOT verified",
                ].join(" · "),
                tone: latest.latestPayment.checkoutSignatureVerified
                  ? "recorded"
                  : "fail",
              },
          latest.fulfilmentCount === 0
            ? {
                label: "Fulfilment",
                detail: "No fulfilment has been executed.",
                tone: "pending",
              }
            : {
                label: "Fulfilment",
                detail: `${latest.fulfilmentCount} executed`,
                // More than one fulfilment for one payment is a money-invariant
                // violation, so it is never shown as an ordinary success.
                tone: latest.fulfilmentCount > 1 ? "fail" : "pass",
              },
        ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Controlled test merchant"
        title="Demo Merchant"
        lede="The single controlled merchant PayChaos is allowed to break. Every order, payment attempt and fulfilment below is internal Test Mode state — this is a reliability harness, not a storefront."
      />

      {/* ---- SECTION B — PRODUCT + PAYMENT LIFECYCLE -------------------- */}
      <div className="grid gap-5 lg:grid-cols-12">
        <section className="rounded-2xl border border-border bg-card p-5 shadow-[0_8px_30px_rgb(15_23_42/0.055)] lg:col-span-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Fixed test product
              </span>
              <h2 className="mt-0.5 text-base font-semibold text-card-foreground">
                {DEMO_MERCHANT_PRODUCT.name}
              </h2>
            </div>
            <ProvenanceTag label="Razorpay Test Mode" />
          </div>
          <p
            className="mt-3 text-3xl font-semibold tabular-nums text-card-foreground"
            data-testid="fixed-product-price"
          >
            {formatAmountForDisplay(
              DEMO_MERCHANT_PRODUCT.amountSubunits,
              DEMO_MERCHANT_PRODUCT.currency,
            )}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {DEMO_MERCHANT_PRODUCT.currency}
            </span>
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            The amount and currency are fixed server-side. Creating an order
            creates an INTERNAL PayChaos order only — it does not contact
            Razorpay.
          </p>

          <div className="mt-5 flex flex-col items-start gap-2 border-t border-border pt-4">
            <CreateOrderButton />
            <p className="max-w-xl text-xs leading-5 text-muted-foreground">
              Razorpay Checkout is not connected in Phase 1. This screen creates
              the merchant-side internal order used by the later Test Mode
              payment flow.
            </p>
          </div>
        </section>

        {/* The payment lifecycle for the most recent order, as a chain.
            Every tone below is derived from PERSISTED state — never from what
            a button was clicked a moment ago. A stage with no record yet says
            so rather than being omitted, because an incomplete lifecycle is
            the honest picture when the payment has not happened. */}
        <section
          className="rounded-2xl border border-border bg-card p-5 shadow-[0_8px_30px_rgb(15_23_42/0.055)] lg:col-span-7"
          data-testid="payment-lifecycle"
        >
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
            Payment lifecycle
          </h2>
          <p className="mt-1 max-w-[65ch] text-[13px] leading-6 text-muted-foreground">
            {latest === null
              ? "No payment evidence yet."
              : "The most recent order, from merchant record through to fulfilment."}
          </p>

          {latest === null ? (
            <div className="mt-4" data-testid="lifecycle-empty">
              <p className="text-sm leading-6 text-muted-foreground">
                Create a Test Mode order and complete the demo payment to
                generate real Razorpay evidence. Nothing here implies the
                integration is healthy — it implies nothing has been paid yet.
              </p>
            </div>
          ) : (
            <SignalLine
              className="mt-4"
              steps={lifecycleSteps}
              data-testid="lifecycle-signal-line"
            />
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Test order lifecycle
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Order, payment attempt, provider state, merchant state and
            fulfilment — exactly as persisted. These are the records the money
            invariants are evaluated against.
          </p>
        </div>
        {orders.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
            No internal test orders yet. Create one above.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {orders.map((order) => (
              <li
                key={order.id}
                data-testid="demo-merchant-order"
                data-order-id={order.id}
                className="rounded-lg border border-border bg-card p-4 text-sm"
              >
                <p
                  className="break-all font-mono text-xs text-muted-foreground"
                  data-testid="order-id"
                >
                  {order.id}
                </p>
                <p className="mt-1 font-medium text-card-foreground">
                  {formatAmountForDisplay(order.amountSubunits, order.currency)}
                </p>
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    <dt className="inline font-medium">Currency: </dt>
                    <dd className="inline" data-testid="order-currency">
                      {order.currency}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Payment State: </dt>
                    <dd className="inline" data-testid="order-payment-status">
                      {order.paymentStatus}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Business State: </dt>
                    <dd className="inline" data-testid="order-business-status">
                      {order.businessStatus}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Fulfilment: </dt>
                    <dd className="inline" data-testid="order-fulfilment-count">
                      {order.fulfilmentCount} effect
                      {order.fulfilmentCount === 1 ? "" : "s"}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">State: </dt>
                    <dd className="inline" data-testid="order-conceptual-state">
                      {formatConceptualState(order.conceptualState)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">
                  Created: {new Date(order.createdAt).toLocaleString()}
                </p>

                {order.latestPaymentAttempt && (
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div>
                      <dt className="inline font-medium">Attempt #: </dt>
                      <dd className="inline" data-testid="payment-attempt-no">
                        {order.latestPaymentAttempt.attemptNo}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Attempt Status: </dt>
                      <dd
                        className="inline"
                        data-testid="payment-attempt-status"
                      >
                        {order.latestPaymentAttempt.status}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Razorpay Receipt: </dt>
                      <dd
                        className="inline break-all"
                        data-testid="payment-attempt-receipt"
                      >
                        {order.latestPaymentAttempt.razorpayReceipt}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">
                        Razorpay Order ID:{" "}
                      </dt>
                      <dd
                        className="inline break-all"
                        data-testid="payment-attempt-razorpay-order-id"
                      >
                        {order.latestPaymentAttempt.razorpayOrderId ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">
                        Razorpay Order Status:{" "}
                      </dt>
                      <dd
                        className="inline"
                        data-testid="payment-attempt-razorpay-order-status"
                      >
                        {order.latestPaymentAttempt.razorpayOrderStatus ?? "—"}
                      </dd>
                    </div>
                  </dl>
                )}

                {order.latestPayment && (
                  <dl
                    className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground sm:grid-cols-2"
                    data-testid="persisted-checkout-evidence"
                  >
                    <div>
                      <dt className="inline font-medium">
                        Razorpay Payment ID:{" "}
                      </dt>
                      <dd className="inline break-all">
                        {order.latestPayment.razorpayPaymentId}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">
                        Checkout Signature Verified:{" "}
                      </dt>
                      <dd className="inline">
                        {order.latestPayment.checkoutSignatureVerified
                          ? "Yes"
                          : "No"}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">
                        Provider Payment Status:{" "}
                      </dt>
                      <dd className="inline">
                        {order.latestPayment.razorpayPaymentStatus ??
                          "Awaiting webhook evidence"}
                      </dd>
                    </div>
                    <p
                      className="col-span-full mt-1 font-medium text-card-foreground"
                      data-testid="persisted-checkout-status-message"
                    >
                      {formatCheckoutWebhookConfirmationMessage(order)}
                    </p>
                  </dl>
                )}

                {order.latestWebhookEvent ? (
                  <dl
                    className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground sm:grid-cols-2"
                    data-testid="webhook-evidence"
                  >
                    <p className="col-span-full mb-1">
                      <Badge
                        variant="outline"
                        className="text-xs"
                        data-testid="webhook-evidence-provenance"
                      >
                        Razorpay Test Mode — Real Event
                      </Badge>
                    </p>
                    <div>
                      <dt className="inline font-medium">Event Type: </dt>
                      <dd
                        className="inline"
                        data-testid="webhook-evidence-event-type"
                      >
                        {order.latestWebhookEvent.eventType}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">
                        Signature Verified:{" "}
                      </dt>
                      <dd
                        className="inline"
                        data-testid="webhook-evidence-signature-verified"
                      >
                        {order.latestWebhookEvent.signatureVerified
                          ? "Yes"
                          : "No"}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">Processing State: </dt>
                      <dd
                        className="inline"
                        data-testid="webhook-evidence-processing-status"
                      >
                        {order.latestWebhookEvent.processingStatus}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline font-medium">
                        Duplicate Deliveries:{" "}
                      </dt>
                      <dd
                        className="inline"
                        data-testid="webhook-evidence-duplicate-count"
                      >
                        {order.latestWebhookEvent.duplicateDeliveryCount}
                      </dd>
                    </div>
                    <div className="col-span-full">
                      <dt className="inline font-medium">Received: </dt>
                      <dd className="inline">
                        {new Date(
                          order.latestWebhookEvent.receivedAt,
                        ).toLocaleString()}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  order.latestPayment && (
                    <p
                      className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground"
                      data-testid="webhook-evidence-absent"
                    >
                      No real Razorpay webhook evidence received yet for this
                      payment.
                    </p>
                  )
                )}

                <CreateRazorpayOrderButton orderId={order.id} />
                {isEligibleForCheckout(order.latestPaymentAttempt) && (
                  <PayWithRazorpayButton
                    paymentAttemptId={order.latestPaymentAttempt.id}
                    webhookConfirmed={isPaymentCaptureConfirmedByRealWebhook(
                      order,
                    )}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link
        href="/"
        className="text-center text-sm text-muted-foreground underline underline-offset-4"
      >
        Back to Overview
      </Link>
    </PageShell>
  );
}
