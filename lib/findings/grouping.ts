/**
 * Phase 4H-2 — deterministic finding correlation.
 *
 * PURE COUNTING, NOT CLUSTERING. Findings are grouped by exact equality on a
 * persisted key — diagnosis code, invariant id or scenario id. There is no
 * distance metric, no model, no threshold and no inference from timestamps or
 * prose. Two findings are related here if and only if they literally share a
 * value.
 *
 * IT REFUSES TO CORRELATE THIN DATA. A "trend" drawn from one or two rows is
 * noise dressed as insight. Below `MIN_ROWS_FOR_CORRELATION` this returns an
 * explicit low-data result and the UI says so, rather than rendering a chart
 * of nothing.
 *
 * NO PERCENTAGES. Counts only. A percentage over a handful of rows implies a
 * precision the dataset does not have.
 */

export const FINDING_GROUP_KEYS = Object.freeze([
  "diagnosisCode",
  "invariantId",
  "scenarioId",
] as const);

export type FindingGroupKey = (typeof FINDING_GROUP_KEYS)[number];

/** The minimum rows before correlation is worth reporting at all. */
export const MIN_ROWS_FOR_CORRELATION = 3;

export interface GroupableFinding {
  readonly findingId: string;
  readonly diagnosisCode: string | null;
  readonly invariantId: string;
  readonly scenarioId: string | null;
}

export interface FindingGroup {
  readonly key: FindingGroupKey;
  readonly value: string;
  readonly count: number;
  /** Ascending, so the output is stable regardless of input order. */
  readonly findingIds: readonly string[];
}

export interface FindingCorrelation {
  /** False when the dataset is too small to say anything honest. */
  readonly sufficient: boolean;
  readonly totalFindings: number;
  /** Empty when `sufficient` is false. */
  readonly groups: readonly FindingGroup[];
}

function valueFor(
  finding: GroupableFinding,
  key: FindingGroupKey,
): string | null {
  if (key === "diagnosisCode") return finding.diagnosisCode;
  if (key === "invariantId") return finding.invariantId;
  return finding.scenarioId;
}

/**
 * Groups findings by exact value on each supported key.
 *
 * Only groups of two or more are returned: a "group" of one is just a
 * finding, and presenting it as a correlation would be padding.
 */
export function correlateFindings(
  findings: readonly GroupableFinding[],
): FindingCorrelation {
  if (findings.length < MIN_ROWS_FOR_CORRELATION) {
    return { sufficient: false, totalFindings: findings.length, groups: [] };
  }

  const groups: FindingGroup[] = [];

  for (const key of FINDING_GROUP_KEYS) {
    const buckets = new Map<string, string[]>();

    for (const finding of findings) {
      const value = valueFor(finding, key);
      // A null key is an absent fact, not a shared one. Findings that have
      // not been diagnosed must never be grouped together as though
      // "undiagnosed" were a root cause.
      if (value === null) continue;
      const bucket = buckets.get(value);
      if (bucket === undefined) buckets.set(value, [finding.findingId]);
      else bucket.push(finding.findingId);
    }

    for (const [value, findingIds] of buckets) {
      if (findingIds.length < 2) continue;
      groups.push({
        key,
        value,
        count: findingIds.length,
        findingIds: [...findingIds].sort(),
      });
    }
  }

  // Largest group first, then a stable tie-break so the output never depends
  // on Map iteration order.
  groups.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return a.value < b.value ? -1 : 1;
  });

  return { sufficient: true, totalFindings: findings.length, groups };
}
