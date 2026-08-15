export * from "./generated/portfolio";
export * from "./corporate";
export * from "./portfolio";

// Explicit re-export, and it must stay explicit.
//
// `./generated/portfolio` also declares CorporateComparisonHistoryPoint. Two `export *`
// declarations providing the same name cancel each other out silently -- the name simply
// stops being exported -- so relying on ordering here would break every importer without a
// word. An explicit re-export takes precedence over both stars and pins which definition
// wins: the hand-written one, which carries metric_schema_version and the nullable averages
// the generated copy has been missing since 2026-04-12.
//
// `apps/web/tests/types/shared-types-contract.ts` fails the build if that stops being true.
export type {
  CorporateComparisonHistoryPoint,
  CorporateComparisonHistoryResponse,
} from "./portfolio";
