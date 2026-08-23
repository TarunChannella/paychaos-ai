import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 1E: `app/demo-merchant/actions.ts` Server Action, exercised against
// a MOCKED application service (no network). Proves:
//   - the action accepts NO arguments (structural proof the browser cannot
//     submit payment_status/business_status/amount/currency/id through it
//     — docs instructions Section 21 C/D);
//   - success revalidates "/demo-merchant";
//   - failure returns one generic safe message and never leaks the
//     underlying error.
vi.mock("server-only", () => ({}));

const createDemoMerchantOrderMock = vi.fn();
vi.mock("@/lib/demo-merchant/service", () => ({
  createDemoMerchantOrder: createDemoMerchantOrderMock,
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const logEventMock = vi.fn();
vi.mock("@/lib/security/logger", () => ({
  logEvent: logEventMock,
}));

beforeEach(() => {
  createDemoMerchantOrderMock.mockReset();
  revalidatePathMock.mockReset();
  logEventMock.mockReset();
});

describe("createDemoMerchantOrderAction", () => {
  it("is declared with zero parameters — no field the browser can submit through it", async () => {
    const { createDemoMerchantOrderAction } =
      await import("@/app/demo-merchant/actions");
    expect(createDemoMerchantOrderAction.length).toBe(0);
  });

  it("on success: calls the service with no arguments, revalidates /demo-merchant, returns ok:true", async () => {
    createDemoMerchantOrderMock.mockResolvedValue({ id: "order-1" });

    const { createDemoMerchantOrderAction } =
      await import("@/app/demo-merchant/actions");
    const result = await createDemoMerchantOrderAction();

    expect(createDemoMerchantOrderMock).toHaveBeenCalledWith();
    expect(revalidatePathMock).toHaveBeenCalledWith("/demo-merchant");
    expect(result).toEqual({ ok: true });
  });

  it("on failure: returns one generic safe message and never forwards the raw error text", async () => {
    createDemoMerchantOrderMock.mockRejectedValue(
      new Error("supabase connection string: postgres://secret@host/db"),
    );

    const { createDemoMerchantOrderAction } =
      await import("@/app/demo-merchant/actions");
    const result = await createDemoMerchantOrderAction();

    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "Could not create the test order. Please try again.",
    );
    expect(result.error).not.toContain("postgres://");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("on failure: logs only a safe error name, never the raw error/message", async () => {
    createDemoMerchantOrderMock.mockRejectedValue(
      new Error("supabase connection string: postgres://secret@host/db"),
    );

    const { createDemoMerchantOrderAction } =
      await import("@/app/demo-merchant/actions");
    await createDemoMerchantOrderAction();

    expect(logEventMock).toHaveBeenCalledTimes(1);
    const [, fields] = logEventMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    for (const value of Object.values(fields)) {
      expect(String(value)).not.toContain("postgres://");
      expect(String(value)).not.toContain("secret");
    }
  });
});
