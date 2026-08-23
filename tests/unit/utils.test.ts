import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

// Phase 1A foundation test: proves Vitest itself works (TypeScript support,
// the "@/*" path alias, and jsdom environment) by exercising the small
// pure `cn` class-name utility that the shadcn/ui foundation depends on.
// This intentionally is not a domain test — the Demo Merchant domain
// (orders/payments/fulfilments) does not exist yet in Phase 1A.
describe("cn", () => {
  it("merges plain class name strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("resolves conflicting Tailwind utility classes to the last one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
