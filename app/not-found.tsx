import Link from "next/link";

/** Phase 5B — a plain 404 that offers a way back into the console. */
export default function NotFound() {
  return (
    <div
      className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-6 py-16"
      data-testid="route-not-found"
    >
      <h1 className="text-lg font-semibold text-foreground">Not found.</h1>
      <p className="text-sm text-muted-foreground">
        This page does not exist, or the identifier in the address does not
        match any record.
      </p>
      <Link
        href="/"
        className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
      >
        Back to Overview
      </Link>
    </div>
  );
}
