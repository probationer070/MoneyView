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
export interface TriggerLabelOut { id: string; label: LabelOut }
export interface RiskAlertSummary {
  id: number; origin: "live" | "backfill"; rules_version: string; status: "open" | "released";
  start_date: string; release_date: string | null; days: number; trigger_themes: string[]; theme_count: number;
  warnings_at_start: string[]; primary_theme: string; fwd5: number | null; fwd10: number | null;
  fwd20: number | null; useful: boolean | null; w1_proxy: boolean;
  max_dd10: number | null; trigger_labels: TriggerLabelOut[];
}
export interface RiskAlertDetail {
  id: number; origin: "live" | "backfill"; rules_version: string; status: "open" | "released";
  start_date: string; release_date: string | null; w1_proxy: boolean; trigger_themes: string[];
  themes: ThemeStintOut[]; warnings_at_start: WarningAtStart[];
  crash: DeckOut<CrashCardOut>; candidates: DeckOut<CandidateCardOut>; start_snapshot: StartSnapshotOut;
  outcome: OutcomeOut; news: NewsItemOut[]; macro_figures: MacroFigureOut[]; news_shortfall: number;
  news_note: "before_collection" | "feed_failed" | null;
}
export interface SurgeComponentsOut {
  magnitude_z: number | null; accel_pct: number | null; accel_rank: number | null;
  breadth_pct: number | null; rsi: number | null;
}
export interface SurgeLeaderOut { ticker: string; name: string; return5_pct: number | null }
export interface SurgeComponentInfoOut {
  id: "magnitude" | "accel" | "breadth" | "rsi"; label: LabelOut; rule: LabelOut;
}
export interface SurgeThemeOut {
  theme: string; label: LabelOut; event_id: number; start_date: string; shown: boolean;
  components: SurgeComponentsOut; overheated: boolean; leaders: SurgeLeaderOut[];
}
export interface SurgeLatestOut {
  banner: boolean; cap_share: number; themes: SurgeThemeOut[]; components_info: SurgeComponentInfoOut[];
  banner_since: string | null;
}
export interface MoverOut {
  rank: number; ticker: string; name: string; theme: string; return_pct: number; close: number;
  return5_pct: number | null; rsi: number | null;
}
export interface MoversLatestOut { as_of: string; items: MoverOut[] }
export interface MoversDayOut { date: string; items: MoverOut[] }
export type SurgeEndReason = "below_ema" | "stalled" | "rules_changed";
export interface SurgeEventOut {
  id: number; origin: "live" | "backfill"; rules_version: string; theme: string; label: LabelOut;
  start_date: string; end_date: string | null; end_reason: SurgeEndReason | null; shown: boolean;
  components: SurgeComponentsOut; overheated_on: string | null; fwd5: number | null; fwd10: number | null;
  fwd20: number | null; max_runup10: number | null; leaders: SurgeLeaderOut[];
}
export interface SurgeEventDetailOut extends SurgeEventOut { components_info: SurgeComponentInfoOut[] }
export interface ThemeLevelPoint { date: string; level: number }
export interface RiskData { bars_coverage: number; fred_errors: string[] }
export interface RiskLatest {
  as_of: string | null; evaluated_at: string | null; rules_version: string;
  backfill: "pending" | "running" | "done" | "degraded" | "failed"; data: RiskData | null; warnings: RiskWarning[];
  warnings_on: number; warnings_total: number; alert: RiskAlertDetail | null; last_alert: RiskAlertSummary | null;
  surge: SurgeLatestOut | null; movers: MoversLatestOut | null;
}
