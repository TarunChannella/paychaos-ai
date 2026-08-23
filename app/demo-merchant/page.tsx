import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { DEMO_MERCHANT_PRODUCT } from "@/lib/demo-merchant/product";
import { listDemoMerchantOrders } from "@/lib/demo-merchant/service";
import {
  formatAmountForDisplay,
  formatConceptualState,
} from "@/lib/demo-merchant/view-model";

import { CreateOrderButton } from "./create-order-button";

// Phase 1E Demo Merchant screen.
//
// `force-dynamic` ensures this page always renders server-side against the
// real, current Supabase state on every request — never a cached/static
// snapshot — so a browser refresh always shows the durable persisted order
// list (docs instructions Section 11).
export const dynamic = "force-dynamic";

export default async function DemoMerchantPage() {
  const orders = await listDemoMerchantOrders(10);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-col items-center gap-3 text-center">
        <Badge variant="outline" className="text-sm">
          Razorpay Test Mode
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          PayChaos AI — Demo Merchant
        </h1>
        <p className="max-w-md text-balance text-sm text-muted-foreground">
          A small controlled merchant used to make payment reliability testing
          possible in later phases.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-card-foreground">
          {DEMO_MERCHANT_PRODUCT.name}
        </h2>
        <p className="mt-1 text-2xl font-semibold text-card-foreground">
          {formatAmountForDisplay(
            DEMO_MERCHANT_PRODUCT.amountSubunits,
            DEMO_MERCHANT_PRODUCT.currency,
          )}{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {DEMO_MERCHANT_PRODUCT.currency}
          </span>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Creating an order below creates an INTERNAL PayChaos order only — it
          does not contact Razorpay.
        </p>

        <div className="mt-6 flex flex-col items-center gap-2">
          <CreateOrderButton />
          <p className="max-w-sm text-center text-xs text-muted-foreground">
            Razorpay Checkout is not connected in Phase 1. This screen creates
            the merchant-side internal order used by the later Test Mode payment
            flow.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Recent Internal Orders
        </h2>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No internal test orders yet. Create one above.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {orders.map((order) => (
              <li
                key={order.id}
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
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link
        href="/"
        className="text-center text-sm text-muted-foreground underline underline-offset-4"
      >
        Back to home
      </Link>
    </div>
  );
}
