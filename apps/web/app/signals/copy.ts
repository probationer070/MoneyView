// The one place the design-system plan's i18n task migrates. English only for now.
export const SIGNALS_COPY = {
  title: "Macro Signals",
  subtitle: "Weekly FRED rule verdicts and heuristic S&P 500 scenario probabilities.",
  runNow: "Run now", running: "Running…", lastRun: "Last run", mostLikely: "Most likely",
  saveFailed: "Could not save. Try again.",
  runFailed: "The run failed. Check the server log.",
  noSnapshot: "No snapshot yet. Run the engine to create this week's.",
  loading: "Loading signals…", unavailable: "Signals could not be loaded.", failures: "Data problems in the last run",
  states: { triggered: "Triggered", near: "Near", not_triggered: "Not triggered", stale: "Data stale" },
  table: { signal: "Signal", direction: "Dir.", state: "State", value: "Value", threshold: "Threshold", observed: "Observed", contribution: "Contribution (pp)" },
  trend: "Scenario probabilities, last 26 weeks", trendRulesChanged: "rules changed",
  manual: "Manual signals (this week)", note: "Note", save: "Save", notSet: "Not set this week",
  disclaimer: "These probabilities are a heuristic built from subjective likelihood ratios, not a statistical model estimate, and are not investment advice.",
} as const;
