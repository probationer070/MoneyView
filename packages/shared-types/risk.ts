/** Mirrors apps/api/models/schema_parts/risk.py. */
export interface LabelOut { ko: string; en: string }
export type WarningState = "on" | "off" | "unknown";
export interface RiskWarning {
  id: string; label: LabelOut; state: WarningState; value: number | null;
  unit: "pct_level" | "pct_change" | "days" | "mm_pct" | "pct_drop"; rule: LabelOut; observed_at: string | null;
}
export interface WarningAtStart { id: string; state: WarningState; value: number | null }
export interface ThemeStintOut {
  theme: string; label: LabelOut; via: "theme" | "sox"; joined_date: string; left_date: string | null;
  dd20_at_join: number | null; fwd5: number | null; fwd10: number | null; fwd20: number | null;
  max_dd10: number | null;
}
export interface HeadlineOut { title: string; url: string; published_date: string; lang: string }
export interface CrashCardOut {
  ticker: string; name: string; theme: string; drawdown_pct: number | null; high_date: string | null;
  high_close: number | null; close: number | null; closes_30d: number[]; headlines: HeadlineOut[];
}
export interface CandidateCardOut {
  ticker: string; name: string; theme: string; pct_from_high63: number | null; corr: number | null;
  corr_with: string | null; corr_with_name: string | null;
}
export interface DeckOut<Card> { as_of: string | null; total: number; cards: Card[] }
export interface SnapshotCardOut { ticker: string; fwd5: number | null; fwd10: number | null; fwd20: number | null }
export interface StartSnapshotOut { crash: SnapshotCardOut[]; candidates: SnapshotCardOut[] }
export interface OutcomeOut {
  primary_theme: string; fwd5: number | null; fwd10: number | null; fwd20: number | null; useful: boolean | null;
}
export interface NewsItemOut {
  title: string; url: string; source: string; published_date: string; lang: string;
  kind: "macro" | "industry"; topic: string | null; theme: string | null; ticker: string | null;
}
export interface MacroValueOut { period: string; value: number }
export interface MacroFigureOut {
  topic: string; series: string; label: LabelOut; kind: "mm_pct" | "level"; latest: MacroValueOut; prior: MacroValueOut;
}
export interface RiskAlertSummary {
  id: number; origin: "live" | "backfill"; rules_version: string; status: "open" | "released";
  start_date: string; release_date: string | null; days: number; trigger_themes: string[]; theme_count: number;
  warnings_at_start: string[]; primary_theme: string; fwd5: number | null; fwd10: number | null;
  fwd20: number | null; useful: boolean | null; w1_proxy: boolean;
}
export interface RiskAlertDetail {
  id: number; origin: "live" | "backfill"; rules_version: string; status: "open" | "released";
  start_date: string; release_date: string | null; w1_proxy: boolean; trigger_themes: string[];
  themes: ThemeStintOut[]; warnings_at_start: WarningAtStart[];
  crash: DeckOut<CrashCardOut>; candidates: DeckOut<CandidateCardOut>; start_snapshot: StartSnapshotOut;
  outcome: OutcomeOut; news: NewsItemOut[]; macro_figures: MacroFigureOut[]; news_shortfall: number;
  news_note: "before_collection" | "feed_failed" | null;
}
export interface RiskData { bars_coverage: number; fred_errors: string[] }
export interface RiskLatest {
  as_of: string | null; evaluated_at: string | null; rules_version: string;
  backfill: "pending" | "running" | "done" | "failed"; data: RiskData | null; warnings: RiskWarning[];
  warnings_on: number; warnings_total: number; alert: RiskAlertDetail | null; last_alert: RiskAlertSummary | null;
}
