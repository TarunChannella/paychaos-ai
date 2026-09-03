"use client";

import { useRef, useState } from "react";

import { DemoUnlockDialog } from "@/components/access/demo-unlock-dialog";

/**
 * PayChaos AI — one unlock flow for every protected control.
 *
 * WHY A HOOK. Eight separate controls change state: two families, one posting
 * Server Actions and one calling APIs. Copying the dialog, the retry and the
 * "was this a lock or a real failure?" decision into each of them would mean
 * eight chances to get it subtly wrong — and the wrong version fails open in
 * the UX sense, leaving a reviewer staring at an unexplained error.
 *
 * IT IS NOT AUTHORIZATION, AND CANNOT BE. It runs in the browser. Every one of
 * these actions is refused server-side first; this only decides whether to
 * OFFER the code after the server has already said no. A visitor who never
 * opens the dialog and posts directly is refused by exactly the same code.
 *
 * IT DISTINGUISHES A LOCK FROM A FAILURE. Only the specific locked signal
 * opens the dialog — a 401, or the server's own stable locked message. A
 * genuine business error after authorization still surfaces as itself, which
 * is the difference between "you need a code" and "that operation failed".
 * Turning every failure into an access prompt would hide real bugs.
 */

/** The stable message the gated Server Actions return when unauthorized. */
export const LOCKED_MESSAGE =
  "Interactive actions require the Demo Access Code.";

/** What the server says when the gate is enabled but unusable. */
export const UNAVAILABLE_MESSAGE =
  "Interactive demo access is currently unavailable.";

/** A 401 from a protected API route means "no authorized session". */
export function isLockedStatus(status: number): boolean {
  return status === 401;
}

/**
 * A 503 means the gate itself is misconfigured. Deliberately NOT treated as a
 * lock: asking for a code that cannot be verified would send a reviewer round
 * a loop they cannot exit.
 */
export function isUnavailableStatus(status: number): boolean {
  return status === 503;
}

export function useDemoUnlock() {
  const [open, setOpen] = useState(false);
  // The action the visitor originally asked for, held only until it runs.
  const pending = useRef<(() => void) | null>(null);

  /** Offer the code, then continue what the visitor actually clicked. */
  function requestUnlock(retry: () => void): void {
    pending.current = retry;
    setOpen(true);
  }

  function close(): void {
    pending.current = null;
    setOpen(false);
  }

  const unlockDialog = (
    <DemoUnlockDialog
      open={open}
      onClose={close}
      onUnlocked={() => {
        const retry = pending.current;
        pending.current = null;
        setOpen(false);
        // A session now exists, so the original intent is resumed rather than
        // making the visitor find the control again.
        retry?.();
      }}
    />
  );

  return { requestUnlock, unlockDialog };
}
