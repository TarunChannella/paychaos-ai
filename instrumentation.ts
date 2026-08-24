/**
 * Phase 1B/2A — application startup environment validation.
 *
 * Next.js calls the exported `register()` function once when a new server
 * instance boots (for both `next dev` and `next start`), before the server
 * starts accepting requests. If `register()` throws, server startup fails —
 * this is the fail-closed startup validation required by
 * docs/SECURITY.md ENV-006 ("Application startup/config validation should
 * fail when required server secrets are missing").
 *
 * This module validates the Phase 1B environment variables
 * (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY) and the Phase 2A Razorpay Test Mode
 * configuration (RAZORPAY_MODE, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) by
 * calling the existing validated accessors in
 * lib/config/{client-env,server-env,razorpay-env}.ts. It does NOT connect
 * to Supabase or Razorpay and does NOT add either SDK — that is Phase 1C
 * (Supabase) and later Phase 2 work (Razorpay API/Checkout/webhooks).
 *
 * Any configuration error thrown here names the invalid/missing variable
 * and never includes its value (see lib/config/env-validation.ts,
 * docs/SECURITY.md ENV-007) and is never logged as a full object — it
 * propagates as a thrown error, which is exactly what aborts Next.js
 * server startup.
 */
export async function register(): Promise<void> {
  // instrumentation.ts is evaluated for every runtime this app configures
  // (today: only the default Node.js server runtime; if an edge runtime is
  // ever added — e.g. edge middleware — Next.js also loads this file for
  // that runtime). lib/config/{server-env,razorpay-env}.ts import the
  // `server-only` package, which is only meant to be pulled into a Node.js
  // server context. Guard on NEXT_RUNTIME and dynamic-import inside the
  // guard so this file never attempts that import while being bundled for
  // a non-Node runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getClientEnv } = await import("./lib/config/client-env");
    const { getServerEnv } = await import("./lib/config/server-env");
    const { getRazorpayEnv } = await import("./lib/config/razorpay-env");

    // Throwing here aborts server startup (fail closed, ENV-006).
    getClientEnv();
    getServerEnv();
    getRazorpayEnv();
  }
}
