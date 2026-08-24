import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Phase 2B: server-only adapter module. Same rationale as
// tests/unit/config/razorpay-env.test.ts — the real `server-only` package
// throws under plain Vitest/Node resolution, so it is stubbed here to
// exercise the real adapter logic.
vi.mock("server-only", () => ({}));

const FAKE_KEY_ID = "rzp_test_fake_key_id_not_real";
const FAKE_KEY_SECRET = "fake-razorpay-key-secret-not-real";

const TRACKED_ENV_KEYS = [
  "RAZORPAY_MODE",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
] as const;
type TrackedEnvKey = (typeof TRACKED_ENV_KEYS)[number];
type EnvSnapshot = Partial<Record<TrackedEnvKey, string>>;

let originalEnv: EnvSnapshot;

function snapshotEnv(): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const key of TRACKED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) snapshot[key] = value;
  }
  return snapshot;
}

function clearTrackedEnv(): void {
  for (const key of TRACKED_ENV_KEYS) delete process.env[key];
}

function restoreEnv(snapshot: EnvSnapshot): void {
  clearTrackedEnv();
  for (const key of TRACKED_ENV_KEYS) {
    const value = snapshot[key];
    if (value !== undefined) process.env[key] = value;
  }
}

function setFakeValidRazorpayEnv(): void {
  process.env.RAZORPAY_MODE = "test";
  process.env.RAZORPAY_KEY_ID = FAKE_KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = FAKE_KEY_SECRET;
}

beforeEach(() => {
  originalEnv = snapshotEnv();
  clearTrackedEnv();
  // Every module (including the cached getRazorpayEnv() singleton inside
  // lib/config/razorpay-env.ts) must be re-imported fresh per test, or a
  // later test's env changes would be silently ignored by the first test's
  // already-cached validated config.
  vi.resetModules();
});

afterEach(() => {
  restoreEnv(originalEnv);
  vi.resetModules();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createRazorpayOrder", () => {
  it("creates an Order using the exact trusted amount/currency/receipt and maps the result", async () => {
    setFakeValidRazorpayEnv();
    const { createRazorpayOrder } = await import("@/lib/razorpay/adapter");

    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://api.razorpay.com/v1/orders");
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({
        amount: 50_000,
        currency: "INR",
        receipt: "receipt-abc-123",
      });
      return jsonResponse(200, {
        id: "order_fake_razorpay_id",
        status: "created",
      });
    });

    const result = await createRazorpayOrder(
      { amountSubunits: 50_000, currency: "INR", receipt: "receipt-abc-123" },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({
      razorpayOrderId: "order_fake_razorpay_id",
      razorpayOrderStatus: "created",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("authenticates with HTTP Basic Auth built from the validated server-only config", async () => {
    setFakeValidRazorpayEnv();
    const { createRazorpayOrder } = await import("@/lib/razorpay/adapter");

    const expectedAuth = `Basic ${Buffer.from(`${FAKE_KEY_ID}:${FAKE_KEY_SECRET}`).toString("base64")}`;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(expectedAuth);
      return jsonResponse(200, { id: "order_x", status: "created" });
    });

    await createRazorpayOrder(
      { amountSubunits: 1000, currency: "INR", receipt: "r1" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not multiply/transform the already-subunit amount", async () => {
    setFakeValidRazorpayEnv();
    const { createRazorpayOrder } = await import("@/lib/razorpay/adapter");

    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.amount).toBe(50_000);
      return jsonResponse(200, { id: "order_x", status: "created" });
    });

    await createRazorpayOrder(
      { amountSubunits: 50_000, currency: "INR", receipt: "r-500" },
      fetchImpl as unknown as typeof fetch,
    );
  });

  it("throws RazorpayOrderRejectedError on a definite 4xx rejection, without exposing the Key Secret", async () => {
    setFakeValidRazorpayEnv();
    const { createRazorpayOrder, RazorpayOrderRejectedError } =
      await import("@/lib/razorpay/adapter");

    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, {
        error: { code: "BAD_REQUEST_ERROR", description: "invalid receipt" },
      }),
    );

    try {
      await createRazorpayOrder(
        { amountSubunits: 50_000, currency: "INR", receipt: "r-bad" },
        fetchImpl as unknown as typeof fetch,
      );
      throw new Error("expected createRazorpayOrder to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RazorpayOrderRejectedError);
      const rejected = err as InstanceType<typeof RazorpayOrderRejectedError>;
      expect(rejected.httpStatus).toBe(400);
      expect(rejected.safeErrorCode).toBe("BAD_REQUEST_ERROR");
      expect(rejected.message).not.toContain(FAKE_KEY_SECRET);
    }
  });

  it("throws RazorpayOrderAmbiguousError on a 5xx provider error", async () => {
    setFakeValidRazorpayEnv();
    const { createRazorpayOrder, RazorpayOrderAmbiguousError } =
      await import("@/lib/razorpay/adapter");

    const fetchImpl = vi.fn(async () =>
      jsonResponse(502, { error: "bad gateway" }),
    );

    await expect(
      createRazorpayOrder(
        { amountSubunits: 50_000, currency: "INR", receipt: "r-502" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(RazorpayOrderAmbiguousError);
  });

  it("throws RazorpayOrderAmbiguousError when fetch itself rejects (network failure)", async () => {
    setFakeValidRazorpayEnv();
    const { createRazorpayOrder, RazorpayOrderAmbiguousError } =
      await import("@/lib/razorpay/adapter");

    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    await expect(
      createRazorpayOrder(
        { amountSubunits: 50_000, currency: "INR", receipt: "r-net" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(RazorpayOrderAmbiguousError);
  });

  it("throws RazorpayOrderAmbiguousError when a 2xx response is missing id/status", async () => {
    setFakeValidRazorpayEnv();
    const { createRazorpayOrder, RazorpayOrderAmbiguousError } =
      await import("@/lib/razorpay/adapter");

    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { unexpected: "shape" }),
    );

    await expect(
      createRazorpayOrder(
        { amountSubunits: 50_000, currency: "INR", receipt: "r-shape" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(RazorpayOrderAmbiguousError);
  });

  it("never generates its own receipt — uses exactly the caller-supplied value", async () => {
    setFakeValidRazorpayEnv();
    const { createRazorpayOrder } = await import("@/lib/razorpay/adapter");

    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect(body.receipt).toBe("caller-controlled-receipt-42");
      return jsonResponse(200, { id: "order_x", status: "created" });
    });

    await createRazorpayOrder(
      {
        amountSubunits: 1,
        currency: "INR",
        receipt: "caller-controlled-receipt-42",
      },
      fetchImpl as unknown as typeof fetch,
    );
  });

  it("rejects a receipt longer than RAZORPAY_RECEIPT_MAX_LENGTH before any network call (Phase 2B correction)", async () => {
    setFakeValidRazorpayEnv();
    const {
      createRazorpayOrder,
      RazorpayReceiptInvalidError,
      RAZORPAY_RECEIPT_MAX_LENGTH,
    } = await import("@/lib/razorpay/adapter");

    expect(RAZORPAY_RECEIPT_MAX_LENGTH).toBe(40);

    const tooLongReceipt = "r".repeat(RAZORPAY_RECEIPT_MAX_LENGTH + 1);
    const fetchImpl = vi.fn();

    await expect(
      createRazorpayOrder(
        { amountSubunits: 1, currency: "INR", receipt: tooLongReceipt },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(RazorpayReceiptInvalidError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a receipt of exactly RAZORPAY_RECEIPT_MAX_LENGTH characters", async () => {
    setFakeValidRazorpayEnv();
    const { createRazorpayOrder, RAZORPAY_RECEIPT_MAX_LENGTH } =
      await import("@/lib/razorpay/adapter");

    const exactLengthReceipt = "r".repeat(RAZORPAY_RECEIPT_MAX_LENGTH);
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { id: "order_x", status: "created" }),
    );

    await expect(
      createRazorpayOrder(
        { amountSubunits: 1, currency: "INR", receipt: exactLengthReceipt },
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toEqual({
      razorpayOrderId: "order_x",
      razorpayOrderStatus: "created",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty receipt before any network call", async () => {
    setFakeValidRazorpayEnv();
    const { createRazorpayOrder, RazorpayReceiptInvalidError } =
      await import("@/lib/razorpay/adapter");

    const fetchImpl = vi.fn();

    await expect(
      createRazorpayOrder(
        { amountSubunits: 1, currency: "INR", receipt: "" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(RazorpayReceiptInvalidError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when RAZORPAY_KEY_ID is a fake Live Mode key (server-only config still enforced)", async () => {
    process.env.RAZORPAY_MODE = "test";
    process.env.RAZORPAY_KEY_ID = "rzp_live_fake_live_key_not_real";
    process.env.RAZORPAY_KEY_SECRET = FAKE_KEY_SECRET;

    const { createRazorpayOrder } = await import("@/lib/razorpay/adapter");
    const { EnvValidationError } = await import("@/lib/config/env-validation");

    const fetchImpl = vi.fn();

    await expect(
      createRazorpayOrder(
        { amountSubunits: 1, currency: "INR", receipt: "r-live" },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(EnvValidationError);
    // The config check must fail before any network call is attempted.
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("razorpay adapter module marks itself server-only", () => {
  it("imports the server-only marker package", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/razorpay/adapter.ts"),
      "utf-8",
    );
    expect(source).toMatch(/^import\s+["']server-only["'];/m);
  });
});
