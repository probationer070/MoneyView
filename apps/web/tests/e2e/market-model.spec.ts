import { expect, test } from "@playwright/test";
import type { MarketRegimeContext, MarketSpread } from "../../../../packages/shared-types";
import { isOneScreenRoute, ONE_SCREEN_ROUTES } from "../../components/ui/oneScreenRoutes";
import {
  changeFigure,
  formatBp,
  instrumentNameKey,
  isMarketPageTab,
  MARKET_PAGE_TAB_KEY,
  MARKET_PAGE_TABS,
  regimeView,
  spreadFigure,
  withFigures,
} from "../../components/market/marketModel";

const REGIME: MarketRegimeContext = {
  regime_label: "risk_on",
  regime_summary: "Most tracked equity indices are advancing and cross-asset signals lean toward pro-cyclical risk appetite.",
  equity_advancers: 3,
  equity_decliners: 1,
  breadth_ratio: 0.75,
  equity_index_count: 4,
  risk_on_signals: 5,
  risk_off_signals: 0,
  signal_count: 5,
};
const ready = (overrides: Partial<MarketRegimeContext> = {}) => ({ status: "ready" as const, regime: { ...REGIME, ...overrides } });

test.describe("regimeView", () => {
  test("each known label maps to its catalog key and tone, with the backend's counts as sent", () => {
    expect(regimeView(ready())).toEqual({
      kind: "ready", labelKey: "market.regime.riskOn", tone: "up", advancers: 3, indexCount: 4, riskOn: 5, riskOff: 0,
    });
    expect(regimeView(ready({ regime_label: "mixed" }))).toMatchObject({ kind: "ready", labelKey: "market.regime.mixed", tone: "neutral" });
    expect(regimeView(ready({ regime_label: "risk_off" }))).toMatchObject({ kind: "ready", labelKey: "market.regime.riskOff", tone: "down" });
  });

  test("unknown is its own state, never mixed", () => {
    expect(regimeView(ready({ regime_label: "unknown" }))).toEqual({ kind: "unknown" });
  });

  test("regimeView reads only its own labels", () => {
    for (const label of ["constructor", "toString", "__proto__", "hasOwnProperty", "", "RISK_ON"]) {
      expect(regimeView(ready({ regime_label: label })), label).toEqual({ kind: "unknown" });
    }
  });

  test("no equity index means unknown, whatever the label", () => {
    expect(regimeView(ready({ regime_label: "mixed", equity_index_count: 0, equity_advancers: 0 }))).toEqual({ kind: "unknown" });
  });

  test("loading and error carry no regime; ready without a payload is unknown", () => {
    expect(regimeView({ status: "loading", regime: null })).toEqual({ kind: "loading" });
    expect(regimeView({ status: "error", regime: null })).toEqual({ kind: "error" });
    expect(regimeView({ status: "ready", regime: null })).toEqual({ kind: "unknown" });
  });
});

test.describe("withFigures", () => {
  test("splits a template so each figure is its own part, in either word order", () => {
    expect(withFigures("Indices up {breadth}", { breadth: "3/4" })).toEqual([
      { kind: "text", text: "Indices up " },
      { kind: "figure", text: "3/4" },
    ]);
    expect(withFigures("지수 {breadth} 상승", { breadth: "3/4" })).toEqual([
      { kind: "text", text: "지수 " },
      { kind: "figure", text: "3/4" },
      { kind: "text", text: " 상승" },
    ]);
  });

  test("a placeholder with no value stays visible as text", () => {
    expect(withFigures("Signals on {on} / off {off}", { on: "5" })).toEqual([
      { kind: "text", text: "Signals on " },
      { kind: "figure", text: "5" },
      { kind: "text", text: " / off " },
      { kind: "text", text: "{off}" },
    ]);
  });

  test("no placeholder is one text part; a prototype name is not a value; an empty template is nothing", () => {
    expect(withFigures("Regime unavailable", {})).toEqual([{ kind: "text", text: "Regime unavailable" }]);
    expect(withFigures("{constructor}", {})).toEqual([{ kind: "text", text: "{constructor}" }]);
    expect(withFigures("", {})).toEqual([]);
  });
});

test("isMarketPageTab accepts the two tabs and rejects prototype names and junk", () => {
  expect(MARKET_PAGE_TABS).toEqual(["instruments", "spreads"]);
  expect(MARKET_PAGE_TAB_KEY).toBe("moneyview.tab.market.pageTab");
  for (const tab of MARKET_PAGE_TABS) expect(isMarketPageTab(tab), tab).toBe(true);
  for (const junk of ["constructor", "toString", "summary", "", null, undefined, 0]) {
    expect(isMarketPageTab(junk), String(junk)).toBe(false);
  }
});

const SPREAD: MarketSpread = {
  id: "ai", label: "AI", numerator: "BOTZ", denominator: "^GSPC", requested_window_days: 90,
  actual_window_start: "2026-06-15", actual_window_end: "2026-09-11", actual_window_days: 88, observations: 62,
  basis: "(BOTZ_t / BOTZ_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15",
  series: [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: 103.4 }],
  latest: 103.4, refused_reason: null,
};

test.describe("spreadFigure", () => {
  test("a computed pair carries its value and both tickers", () => {
    expect(spreadFigure(SPREAD)).toEqual({ id: "ai", label: "AI", pair: "BOTZ/^GSPC", latest: 103.4, refused: false });
  });

  test("a refused pair has no value, even if one is sent", () => {
    expect(spreadFigure({ ...SPREAD, refused_reason: "insufficient overlapping history", latest: 100, series: [] }))
      .toEqual({ id: "ai", label: "AI", pair: "BOTZ/^GSPC", latest: null, refused: true });
  });
});

test.describe("isOneScreenRoute with the overview listed", () => {
  test("'/' is one-screen, and listing it does not make every path one-screen", () => {
    expect(ONE_SCREEN_ROUTES).toContain("/");
    expect(isOneScreenRoute("/")).toBe(true);
    for (const path of ["/portfolio", "/news", "/detail/AAPL", "/corporate-xyz", ""]) {
      expect(isOneScreenRoute(path), path).toBe(false);
    }
    expect(isOneScreenRoute("/corporate/x")).toBe(true);
  });
});

test.describe("changeFigure", () => {
  test("an index or other non-rate instrument shows its percent change", () => {
    expect(changeFigure({ delta_pct: 1.24, delta_abs: 3 }, "index")).toEqual({ kind: "pct", pct: 1.24 });
  });

  test("no delta is missing, never a zero percent", () => {
    expect(changeFigure(null, "index")).toEqual({ kind: "missing" });
    expect(changeFigure(undefined, "index")).toEqual({ kind: "missing" });
  });

  test("a rate shows its absolute change in basis points", () => {
    expect(changeFigure({ delta_pct: 2.5, delta_abs: 0.1 }, "rate")).toEqual({ kind: "bp", bp: 10 });
  });

  test("a rate change that rounds to zero is 0, not -0", () => {
    const figure = changeFigure({ delta_pct: -1, delta_abs: -0.004 }, "rate");
    expect(figure).toEqual({ kind: "bp", bp: 0 });
    expect(Object.is((figure as { bp: number }).bp, 0)).toBe(true);
  });

  test("a rate without an absolute change is missing, not a percent", () => {
    expect(changeFigure({ delta_pct: 1, delta_abs: null }, "rate")).toEqual({ kind: "missing" });
  });

  test("an unknown instrument type falls back to the percent change", () => {
    expect(changeFigure({ delta_pct: 1.5 }, "future_type")).toEqual({ kind: "pct", pct: 1.5 });
  });

  test("a non-finite percent is missing", () => {
    expect(changeFigure({ delta_pct: NaN }, "index")).toEqual({ kind: "missing" });
  });
});

test("formatBp signs positive and negative moves and leaves zero unsigned", () => {
  expect(formatBp(10)).toBe("+10bp");
  expect(formatBp(-3)).toBe("-3bp");
  expect(formatBp(0)).toBe("0bp");
});

test.describe("instrumentNameKey", () => {
  test("maps the tickers to their catalog keys", () => {
    expect(instrumentNameKey("SOXX")).toBe("market.names.semis");
    expect(instrumentNameKey("^TNX")).toBe("market.names.us10y");
    expect(instrumentNameKey("XYZ")).toBeNull();
  });

  test("every one of the 14 tickers has its own key", () => {
    const tickers = [
      "^GSPC", "^DJI", "^IXIC", "^KS200", "SOXX", "SKYY", "BOTZ", "^TNX",
      "GC=F", "CL=F", "NG=F", "KRW=X", "BTC-USD", "^VIX",
    ];
    const keys = tickers.map((ticker) => instrumentNameKey(ticker));
    expect(keys.every((key) => key !== null)).toBe(true);
    expect(new Set(keys).size).toBe(14);
  });
});
