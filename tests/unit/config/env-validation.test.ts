import { describe, expect, it } from "vitest";
import {
  EnvValidationError,
  requireExactValue,
  requireHttpUrl,
  requireNonEmptyString,
  requirePrefixedString,
} from "@/lib/config/env-validation";

// Phase 1B: the shared, value-free validation primitives used by both
// client-env.ts and server-env.ts. Tested directly with obviously-fake
// values only — no real credentials are ever required.
describe("requireNonEmptyString", () => {
  it("returns the value when present and non-empty", () => {
    expect(requireNonEmptyString("SOME_VAR", "test-value")).toBe("test-value");
  });

  it("rejects an undefined value", () => {
    expect(() => requireNonEmptyString("SOME_VAR", undefined)).toThrow(
      EnvValidationError,
    );
  });

  it("rejects an empty string", () => {
    expect(() => requireNonEmptyString("SOME_VAR", "")).toThrow(
      EnvValidationError,
    );
  });

  it("rejects a whitespace-only string", () => {
    expect(() => requireNonEmptyString("SOME_VAR", "   \t  ")).toThrow(
      EnvValidationError,
    );
  });

  it("names the failing variable without leaking the (empty) value", () => {
    try {
      requireNonEmptyString("MY_SECRET_VAR", "");
      throw new Error("expected requireNonEmptyString to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as EnvValidationError).variable).toBe("MY_SECRET_VAR");
      expect((err as EnvValidationError).message).toContain("MY_SECRET_VAR");
    }
  });

  it("never includes the supplied secret value in the error message", () => {
    const secretValue = "sk_super_secret_value_should_never_appear_12345";
    try {
      // whitespace-only is still a rejected value, and this also proves a
      // non-empty-but-invalid-shaped value's content never leaks either.
      requireNonEmptyString("MY_SECRET_VAR", "   ");
      throw new Error("expected requireNonEmptyString to throw");
    } catch (err) {
      expect((err as EnvValidationError).message).not.toContain(secretValue);
    }
  });
});

describe("requireHttpUrl", () => {
  it("returns the value for a valid https URL", () => {
    expect(requireHttpUrl("SOME_URL", "https://example.supabase.co")).toBe(
      "https://example.supabase.co",
    );
  });

  it("returns the value for a valid http URL", () => {
    expect(requireHttpUrl("SOME_URL", "http://localhost:54321")).toBe(
      "http://localhost:54321",
    );
  });

  it("rejects a missing value", () => {
    expect(() => requireHttpUrl("SOME_URL", undefined)).toThrow(
      EnvValidationError,
    );
  });

  it("rejects an empty value", () => {
    expect(() => requireHttpUrl("SOME_URL", "")).toThrow(EnvValidationError);
  });

  it("rejects an obviously malformed URL", () => {
    expect(() => requireHttpUrl("SOME_URL", "not a url")).toThrow(
      EnvValidationError,
    );
  });

  it("rejects a non-http(s) protocol", () => {
    expect(() => requireHttpUrl("SOME_URL", "ftp://example.com")).toThrow(
      EnvValidationError,
    );
  });

  it("error message names the variable but never the malformed value", () => {
    const malformed = "not-a-real-url-xyz-should-not-leak";
    try {
      requireHttpUrl("MY_URL_VAR", malformed);
      throw new Error("expected requireHttpUrl to throw");
    } catch (err) {
      expect((err as EnvValidationError).message).toContain("MY_URL_VAR");
      expect((err as EnvValidationError).message).not.toContain(malformed);
    }
  });
});

// Phase 2A: shared validators added for RAZORPAY_MODE / RAZORPAY_KEY_ID.
// Tested directly with obviously-fake values only.
describe("requireExactValue", () => {
  it("returns the value when it exactly matches the expected value", () => {
    expect(requireExactValue("SOME_FLAG", "test", "test")).toBe("test");
  });

  it("rejects a missing value", () => {
    expect(() => requireExactValue("SOME_FLAG", undefined, "test")).toThrow(
      EnvValidationError,
    );
  });

  it("rejects an empty value", () => {
    expect(() => requireExactValue("SOME_FLAG", "", "test")).toThrow(
      EnvValidationError,
    );
  });

  it("rejects a value that does not exactly match", () => {
    expect(() => requireExactValue("SOME_FLAG", "live", "test")).toThrow(
      EnvValidationError,
    );
  });

  it("rejects a value that only partially matches (case/whitespace)", () => {
    expect(() => requireExactValue("SOME_FLAG", "Test", "test")).toThrow(
      EnvValidationError,
    );
    expect(() => requireExactValue("SOME_FLAG", " test", "test")).toThrow(
      EnvValidationError,
    );
  });

  it("error message names the variable but never the rejected value", () => {
    const rejected = "definitely-not-test-should-not-leak";
    try {
      requireExactValue("MY_FLAG_VAR", rejected, "test");
      throw new Error("expected requireExactValue to throw");
    } catch (err) {
      expect((err as EnvValidationError).message).toContain("MY_FLAG_VAR");
      expect((err as EnvValidationError).message).not.toContain(rejected);
    }
  });
});

describe("requirePrefixedString", () => {
  it("returns the value when it starts with the required prefix", () => {
    expect(
      requirePrefixedString("SOME_ID", "rzp_test_abc123", "rzp_test_"),
    ).toBe("rzp_test_abc123");
  });

  it("rejects a missing value", () => {
    expect(() =>
      requirePrefixedString("SOME_ID", undefined, "rzp_test_"),
    ).toThrow(EnvValidationError);
  });

  it("rejects an empty value", () => {
    expect(() => requirePrefixedString("SOME_ID", "", "rzp_test_")).toThrow(
      EnvValidationError,
    );
  });

  it("rejects a value with a different prefix (e.g. a Live Mode key)", () => {
    expect(() =>
      requirePrefixedString("SOME_ID", "rzp_live_abc123", "rzp_test_"),
    ).toThrow(EnvValidationError);
  });

  it("rejects a value with no recognizable prefix at all", () => {
    expect(() =>
      requirePrefixedString("SOME_ID", "not-a-razorpay-key", "rzp_test_"),
    ).toThrow(EnvValidationError);
  });

  it("error message names the variable but never the rejected value", () => {
    const rejected = "rzp_live_should-not-leak-987654";
    try {
      requirePrefixedString("MY_ID_VAR", rejected, "rzp_test_");
      throw new Error("expected requirePrefixedString to throw");
    } catch (err) {
      expect((err as EnvValidationError).message).toContain("MY_ID_VAR");
      expect((err as EnvValidationError).message).not.toContain(rejected);
    }
  });
});
