/**
 * Compile-time contract checks for the `packages/shared-types` barrel.
 *
 * There is no frontend unit-test runner here (see CLAUDE.md), so the type system is the
 * test: `npx tsc --noEmit` fails if any assertion below stops holding.
 *
 * What these guard: the barrel re-exports `./generated/portfolio`, which is produced by a
 * manual two-step (`scripts/export_schema.py`, then `npx json2ts`) that nothing enforces --
 * no CI job, no hook, and the drift check the README documents is never run. The generated
 * file was last regenerated 2026-04-12 and had drifted from the backend models by months.
 *
 * The specific hazard is silent: a stale generated interface and a current hand-written one
 * can carry the *same name*, so importing from the barrel gives you the wrong shape with no
 * error anywhere. These assertions turn that into a build failure.
 */
import type {
  CorporateComparisonHistoryPoint,
  CorporateComparisonHistoryResponse,
} from "../../../../packages/shared-types";

// The history chart reads this to mark where average_dcf_value changed definition
// (enterprise value below 2, intrinsic value per share from 2 on). Without it the chart
// draws that discontinuity as if it were a valuation move.
const _carriesMetricSchemaVersion: CorporateComparisonHistoryPoint["metric_schema_version"] = 0;

// Nullable, not optional. Both averages cover only the rows whose equity bridge resolved,
// so a snapshot with no such rows has no average at all and the API sends null. Typing it
// `?: number` lets a consumer do arithmetic on a value that is null at runtime.
const _spreadIsNullable: CorporateComparisonHistoryPoint["average_expected_return_spread"] = null;
const _dcfValueIsNullable: CorporateComparisonHistoryPoint["average_dcf_value"] = null;

const _responseCarriesPoints: CorporateComparisonHistoryResponse["points"] = [];

// Referenced so the declarations are not dead code to a linter; the assertions above are
// the point, and they are enforced at compile time regardless.
export const SHARED_TYPES_CONTRACT_CHECKED = [
  _carriesMetricSchemaVersion,
  _spreadIsNullable,
  _dcfValueIsNullable,
  _responseCarriesPoints,
] as const;
