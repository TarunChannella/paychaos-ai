import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Phase 2G readiness: server-only module. Same rationale as every other
// server-only module's test file in this repo.
vi.mock("server-only", () => ({}));

import {
  ACCESS_SESSION_COOKIE_NAME,
  SESSION_LIFETIME_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "@/lib/access/session";

const SECRET_A = "fake-session-secret-a-not-real-" + "x".repeat(10);
const SECRET_B = "fake-session-secret-b-not-real-" + "y".repeat(10);

describe("createSessionToken / verifySessionToken", () => {
  it("a freshly created token verifies against the same secret", () => {
    const { token, maxAgeSeconds } = createSessionToken(SECRET_A, 1_000_000);
    expect(maxAgeSeconds).toBe(SESSION_LIFETIME_SECONDS);
    expect(verifySessionToken(SECRET_A, token, 1_000_000)).toBe(true);
  });

  it("verifies right up until (but not including) the expiry instant", () => {
    const now = 1_000_000;
    const { token } = createSessionToken(SECRET_A, now);
    const expiresAt = now + SESSION_LIFETIME_SECONDS * 1000;
    expect(verifySessionToken(SECRET_A, token, expiresAt - 1)).toBe(true);
    expect(verifySessionToken(SECRET_A, token, expiresAt)).toBe(false);
    expect(verifySessionToken(SECRET_A, token, expiresAt + 1)).toBe(false);
  });

  it("rejects a token verified against the wrong secret", () => {
    const { token } = createSessionToken(SECRET_A, 1_000_000);
    expect(verifySessionToken(SECRET_B, token, 1_000_000)).toBe(false);
  });

  it("rejects a token with a tampered expiry (forged extension attempt)", () => {
    const { token } = createSessionToken(SECRET_A, 1_000_000);
    const [expiresAtMs, signature] = token.split(".");
    const forged = `${Number(expiresAtMs) + 1_000_000_000}.${signature}`;
    expect(verifySessionToken(SECRET_A, forged, 1_000_000)).toBe(false);
  });

  it("rejects a token with a tampered signature", () => {
    const { token } = createSessionToken(SECRET_A, 1_000_000);
    const [expiresAtMs] = token.split(".");
    const forged = `${expiresAtMs}.${"0".repeat(64)}`;
    expect(verifySessionToken(SECRET_A, forged, 1_000_000)).toBe(false);
  });

  it("rejects malformed tokens without throwing", () => {
    expect(verifySessionToken(SECRET_A, "", 1_000_000)).toBe(false);
    expect(verifySessionToken(SECRET_A, "not-a-token", 1_000_000)).toBe(false);
    expect(verifySessionToken(SECRET_A, "123.not-hex", 1_000_000)).toBe(false);
    expect(verifySessionToken(SECRET_A, "123.456.789", 1_000_000)).toBe(false);
    expect(verifySessionToken(SECRET_A, undefined, 1_000_000)).toBe(false);
    expect(verifySessionToken(SECRET_A, null, 1_000_000)).toBe(false);
  });

  it("two tokens created for the same secret/instant are byte-identical (deterministic HMAC)", () => {
    const first = createSessionToken(SECRET_A, 1_000_000);
    const second = createSessionToken(SECRET_A, 1_000_000);
    expect(first.token).toBe(second.token);
  });
});

describe("session module marks itself server-only", () => {
  it("imports the server-only marker package", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../../lib/access/session.ts"),
      "utf-8",
    );
    expect(source).toMatch(/import\s+["']server-only["']/);
  });

  it("exports a fixed, non-guessable-by-accident cookie name", () => {
    expect(ACCESS_SESSION_COOKIE_NAME).toBe("paychaos_session");
  });
});
