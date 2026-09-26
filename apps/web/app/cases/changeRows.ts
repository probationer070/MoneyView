import { toWire, type FieldTarget } from "./caseFields";
import type {
  Confidence, DistributionLeaf, ForkLeaf, ForkRequest, Overrides, Shape, SimulateRequest, ThreeP,
} from "./caseTypes";
import { MAX_RUNS, MIN_RUNS } from "./caseTypes";

export interface NarrativeState {
  claim: string;
  threeP: ThreeP | "";
  confidence: Confidence | "";
  evidenceSource: string;
}

export const EMPTY_NARRATIVE: NarrativeState = { claim: "", threeP: "", confidence: "", evidenceSource: "" };

export interface ForkRow {
  id: number;
  targetKey: string;
  value: string;
  narrative: NarrativeState;
}

export interface SimulateRow {
  id: number;
  targetKey: string;
  shape: Shape;
  params: Record<string, string>;
  narrative: NarrativeState;
}

export const SHAPE_PARAMS: Record<Shape, readonly { name: string; label: string }[]> = {
  triangular: [{ name: "low", label: "Low" }, { name: "mode", label: "Most likely" }, { name: "high", label: "High" }],
  normal: [{ name: "mean", label: "Mean" }, { name: "sd", label: "Std dev" }],
  uniform: [{ name: "low", label: "Low" }, { name: "high", label: "High" }],
};

type Parsed = { value: number } | { problem: string };

function parseNumber(text: string, what: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === "") return { problem: `${what} is required` };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { problem: `"${trimmed}" is not a number` };
  return { value };
}

function narrativeProblem(target: FieldTarget, narrative: NarrativeState): string | null {
  if (!target.meta.narrated) return null;
  if (!narrative.claim.trim()) return `${target.meta.label} is narrated: a change to it needs a claim`;
  if (!narrative.threeP) return `${target.meta.label} is narrated: choose possible, plausible or probable`;
  return null;
}

function emptyOverrides<Leaf>(): Overrides<Leaf> {
  return { case: {}, segments: {} };
}

function place<Leaf>(overrides: Overrides<Leaf>, target: FieldTarget, leaf: Leaf): void {
  if (target.scope === "case") {
    overrides.case[target.meta.field] = leaf;
    return;
  }
  const segment = target.segment as string;
  overrides.segments[segment] = { ...(overrides.segments[segment] ?? {}), [target.meta.field]: leaf };
}

function narrativeFields(narrative: NarrativeState) {
  return {
    claim: narrative.claim.trim(),
    three_p: narrative.threeP as ThreeP,
    ...(narrative.confidence ? { confidence: narrative.confidence } : {}),
  };
}

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
}

export interface ForkBuild {
  request: ForkRequest;
  /** Rows whose value parses and differs from the parent's, whether or not they have problems. */
  changedCount: number;
  problems: Record<number, string>;
  unchanged: number[];
}

export function buildForkRequest(
  caseName: string,
  rows: ForkRow[],
  targets: Map<string, FieldTarget>,
  current: (targetKey: string) => number | null,
): ForkBuild {
  const request: ForkRequest = { case_name: caseName.trim(), overrides: emptyOverrides<ForkLeaf>() };
  const problems: Record<number, string> = {};
  const unchanged: number[] = [];
  const seen = new Set<string>();
  let changedCount = 0;

  for (const row of rows) {
    const target = targets.get(row.targetKey);
    if (!target) {
      problems[row.id] = "choose a field";
      continue;
    }
    if (seen.has(row.targetKey)) {
      problems[row.id] = `${target.meta.label} is already changed in another row`;
      continue;
    }
    seen.add(row.targetKey);

    const parsed = parseNumber(row.value, "a new value");
    if ("problem" in parsed) {
      problems[row.id] = parsed.problem;
      continue;
    }
    if (target.meta.integer && !Number.isInteger(parsed.value)) {
      problems[row.id] = `${target.meta.label} takes a whole number`;
      continue;
    }
    const wire = toWire(target.meta, parsed.value);
    const before = current(row.targetKey);
    if (before !== null && sameValue(wire, before)) {
      unchanged.push(row.id);
      continue;
    }
    changedCount += 1;

    const missing = narrativeProblem(target, row.narrative);
    if (missing) {
      problems[row.id] = missing;
      continue;
    }
    const leaf: ForkLeaf = target.meta.narrated
      ? {
          value: wire,
          ...narrativeFields(row.narrative),
          ...(row.narrative.evidenceSource.trim() ? { evidence_source: row.narrative.evidenceSource.trim() } : {}),
        }
      : wire;
    place(request.overrides, target, leaf);
  }
  return { request, changedCount, problems, unchanged };
}

export interface SimulateBuild {
  request: SimulateRequest;
  problems: Record<number, string>;
  runsProblem: string | null;
  seedProblem: string | null;
}

export function buildSimulateRequest(
  rows: SimulateRow[],
  runsText: string,
  seedText: string,
  targets: Map<string, FieldTarget>,
): SimulateBuild {
  const problems: Record<number, string> = {};
  const distributions = emptyOverrides<DistributionLeaf>();
  const seen = new Set<string>();

  for (const row of rows) {
    const target = targets.get(row.targetKey);
    if (!target) {
      problems[row.id] = "choose a field";
      continue;
    }
    if (seen.has(row.targetKey)) {
      problems[row.id] = `${target.meta.label} already has a distribution in another row`;
      continue;
    }
    seen.add(row.targetKey);

    const leaf: DistributionLeaf = { shape: row.shape };
    let bad: string | null = null;
    for (const param of SHAPE_PARAMS[row.shape]) {
      const parsed = parseNumber(row.params[param.name] ?? "", param.label);
      if ("problem" in parsed) {
        bad = parsed.problem;
        break;
      }
      // A spread on a rate is in percentage points on screen and a fraction on the wire,
      // exactly like the rate itself.
      leaf[param.name] = toWire(target.meta, parsed.value);
    }
    if (bad) {
      problems[row.id] = bad;
      continue;
    }
    const missing = narrativeProblem(target, row.narrative);
    if (missing) {
      problems[row.id] = missing;
      continue;
    }
    place(distributions, target, target.meta.narrated ? { ...leaf, ...narrativeFields(row.narrative) } : leaf);
  }

  const runs = Number(runsText.trim());
  const runsProblem =
    Number.isInteger(runs) && runs >= MIN_RUNS && runs <= MAX_RUNS
      ? null
      : `runs must be a whole number from ${MIN_RUNS.toLocaleString("en-US")} to ${MAX_RUNS.toLocaleString("en-US")}`;
  const seedTrimmed = seedText.trim();
  const seed = seedTrimmed === "" ? undefined : Number(seedTrimmed);
  const seedValid = seed !== undefined && Number.isInteger(seed) && seed >= 0 && seed <= Number.MAX_SAFE_INTEGER;
  const seedProblem = seedTrimmed === "" || seedValid ? null : "the seed must be a whole number of 0 or more";
  const request: SimulateRequest = {
    runs: Number.isInteger(runs) ? runs : 0,
    ...(seedValid ? { seed } : {}),
    distributions,
  };
  return { request, problems, runsProblem, seedProblem };
}

/** Rows whose field the refusal names as a whole word -- `base_margin` must not match `margin_target`. */
export function rowsNamedIn(
  detail: string,
  rows: { id: number; targetKey: string }[],
  targets: Map<string, FieldTarget>,
): number[] {
  return rows
    .filter((row) => {
      const field = targets.get(row.targetKey)?.meta.field;
      return field !== undefined && new RegExp(`(^|[^A-Za-z0-9_])${field}([^A-Za-z0-9_]|$)`).test(detail);
    })
    .map((row) => row.id);
}
