# MoneyView Glossary (en ↔ ko)

Rule: a term in this table is translated exactly as written here, everywhere. Expanded
form on first use within a screen, short form after. UI sentences use 합니다체.
Buttons end in a verb ("저장", "실행", "다시 시도"). A verdict states its evidence figure
("ROIC 12.4%가 WACC 8.1%보다 높습니다").

Bilingual small labels (eyebrows, table headers) show the Korean term, then the English term in
capitals: "종목 NAME". Both come from `apps/web/lib/i18n/labels.ts`; add the row here first.

| English | 한국어 | Note |
|---|---|---|
| DCF | 현금흐름할인(DCF) → DCF | |
| WACC | 가중평균자본비용(WACC) → WACC | |
| ROIC | 투하자본이익률(ROIC) → ROIC | |
| VaR / ES | VaR / 기대손실(ES) | |
| Intrinsic value | 내재가치 | Always shown next to the market price |
| Terminal value | 잔존가치 | Never 영구가치 |
| Monte Carlo | 몬테카를로 시뮬레이션 | |
| Simulation Lab | 시뮬레이션 랩 | page title (monte-carlo) |
| Path Simulation | 경로 시뮬레이션 | Monte Carlo tab |
| Risk Analysis | 위험 분석 | Monte Carlo tab |
| Return Distribution | 수익률 분포 | Monte Carlo tab |
| Corporate Valuation | 기업가치 평가 | Monte Carlo tab |
| Correlation Model | 상관관계 모형 | Monte Carlo tab |
| Asset | 자산 | label (correlation setup header) |
| Mu | 기대수익률 | label (correlation setup header); symbol kept as Mu |
| Sigma | 변동성 | label (correlation setup header); symbol kept as Sigma |
| Market Overview | 시장 개요 | nav |
| Portfolio | 포트폴리오 | nav |
| News Feed | 뉴스 | nav |
| Corporate Analysis | 기업 분석 | nav |
| Decision Log | 의사결정 기록 | nav |
| Valuation | 가치평가 | nav |
| Cases | 케이스 | nav |
| Events | 이벤트 | nav |
| Macro Signals / Signals (short) | 거시 신호 | nav; one term for both the full and the short label |
| Triggered / Near / Not triggered / Data stale | 발동 / 근접 / 미발동 / 데이터 오래됨 | signals table state and manual select |
| Threshold (signal rule) | 기준값 | signals table column; not the dev monitor 기준 시간 |
| Contribution (pp) | 기여도 (%p) | signals table column |
| Most likely | 가장 유력 | signals summary |
| Manual signals | 수동 신호 | signals manual panel title |
| Menu | 메뉴 | top bar ☰ button |
| Primary | 주 메뉴 | top bar icon-link landmark |
| All pages | 전체 페이지 | top bar panel landmark |
| Market / Corporate / Decisions (short) | 시장 / 기업 분석 / 의사결정 | top bar current-page label |
| Retry | 다시 시도 | |
| Loading… | 불러오는 중… | |
| Market | 시장 | label |
| Corporate | 기업 분석 | label (corporate eyebrow) |
| Not in the list → add | 목록에 없음 → 추가 | search entry |
| Add for Analysis | 분석에 추가 | button |
| Refresh DCF | DCF 새로고침 | button |
| Name | 종목 | label (table header for a security) |
| Price | 현재가 | label |
| Change | 등락률 | label (table header for a delta) |
| Undervalued | 저평가 | label (DCF status "Undervalued"; translated, never re-thresholded) |
| Overvalued | 고평가 | label (DCF status "Overvalued") |
| Per-share value unavailable | 주당가치 산출 불가 | label (DCF status "Bridge Incomplete") |
| Case | 케이스 | label (eyebrow on a case) |
| Developer runtime | 개발 런타임 | label (eyebrow on the dev monitor) |
| Up / Down / Unchanged | 상승 / 하락 / 보합 | delta, screen-reader text |
| Language | 언어 | language toggle group label |
| Could not be loaded. | 불러오지 못했습니다. | error state body |
| Something went wrong | 문제가 발생했습니다 | error state title (default) |
| Try again | 다시 시도 | error state action |
| No data available | 데이터가 없습니다 | empty state, empty table |
| Run an analysis or refresh the data to see results here. | 분석을 실행하거나 데이터를 새로 고치면 결과가 여기에 표시됩니다. | empty state hint |
| Component Render Failure | 화면 구성 요소 오류 | error boundary title (default) |
| An unexpected error broke the layout context for this graphic. Logs have been traced locally. | 예기치 않은 오류로 이 그래프를 표시하지 못했습니다. 로그는 로컬에 기록되었습니다. | error boundary body (default) |
| Export Disabled | 내보내기 사용 불가 | export button, no data |
| Export JSON / CSV / Markdown | JSON / CSV / Markdown 내보내기 | export buttons |
| Print PDF | PDF 인쇄 | export button |
| Ticker or company name | 종목 코드 또는 기업명 | ticker search placeholder |
| Other | 기타 | folded tail of a chart or donut (chart-4) |
| Chart unavailable | 차트를 표시할 수 없습니다 | chart panel error title (default) |
| Input | 입력 | label (audit table header) |
| Value | 값 | label (audit table header) |
| Year | 연도 | label (trend table header) |
| Source | 출처 | label (audit table header) |
| Ticker | 종목 코드 | label (portfolio table header) |
| Sector | 섹터 | label (portfolio table header) |
| Current Price | 현재가 | label (portfolio table header; the price label is Price) |
| Trend | 추세 | label (portfolio table header) |
| Volatility | 변동성 | label (portfolio table header) |
| Weight | 비중 | label (portfolio table header) |
| Action | 관리 | label (portfolio table header) |
| ROIC - WACC | 투하자본이익률 - WACC | label (table header; ROIC expanded as in the ROIC row, Korean half needs Hangul) |
| Allocation | 배분 | label (allocation table header) |
| Adjust | 조정 | label (allocation table header) |
| Invested Amount | 투자 금액 | label (allocation table header) |
| Projected Net Value | 예상 순자산가치 | label (allocation table header) |
| Final Profit | 최종 손익 | label (allocation table header) |
| Verdict | 판정 | label (corporate verdict block) |
| Assumptions | 가정 | label (corporate assumption table) |
| Item / Value / Status | 항목 / 값 / 상태 | label (table headers) |
| Intrinsic value per share unavailable | 주당가치 산출 불가 | verdict, Bridge Incomplete |
| DCF not calculated | DCF 미계산 | verdict idle state |
| Value creation / Value destruction | 가치 창출 / 가치 훼손 | ROIC - WACC caption |
| Levered beta / Unlevered beta | 레버리지 베타 / 비레버리지 베타 | |
| Country risk premium | 국가위험프리미엄 | |
| Reinvestment rate | 재투자율 | |
| Source data | 원천 데이터 | |
| Core Diagnostics | 진단 차트 | corporate page tab |
| Target Stock Comparison | 종목 비교 | corporate page tab |
| Universe | 유니버스 | comparison universe |
| Watchlist | 관심종목 | |
| Benchmark | 벤치마크 | |
| Load Full Report | 리포트 불러오기 | button |
| Summary | 요약 | corporate page tab; calculation detail tab |
| Data point / Source / As of | 데이터 / 출처 / 기준일 | label (detail tables) |
| Calculation steps | 계산 과정 | detail tab |
| Raw data | 원시 데이터 | detail tab (Source data stays 원천 데이터) |
| Trend (detail tab) | 추이 | detail tab; Trend in the portfolio table stays 추세 |
| Peers | 동종업 비교 | detail tab |
| Rank | 순위 | Peers tab; position high to low, not best to worst |
| Low | 최저 | Peers tab; band minimum |
| High | 최고 | Peers tab; band maximum |
| Sensitivity | 민감도 | detail tab |
| Scenario | 시나리오 | Sensitivity tab; the row a run belongs to |
| Upside | 상승여력 | Sensitivity tab column; shown as a DeltaBadge percent |
| Calculate | 계산 | Sensitivity tab button; runs the two DCF requests |
| Data Lineage | 데이터 리니지 | detail section title |
| Supporting Rows | 근거 행 | detail section title |
| Supporting row / Basis | 근거 행 / 근거 | label (detail table headers) |
| Raw Data Access | 원시 데이터 연결 | detail section title |
| Step | 단계 | label (detail table header) |
| Calculation Audit | 계산 감사 | detail section title |
| Time Horizon | 기간 | detail label |
| Result | 결과 | detail label |
| Download CSV | CSV 받기 | button (detail export) |
| Print | 인쇄 | button (detail export) |
| From the latest audit | 최근 감사 값을 사용했습니다 | WACC caption under the substituted formula |
| Calculation Formula | 계산 공식 | |
| With current values | 현재 값 대입 | substituted formula |
| Not valued | 평가하지 않음 | verdict strip, refused DCF |
| Stale source | 원천 데이터 오래됨 | verdict strip warning |
| Audit uncertain | 감사 불확실 | assumption table badge title; the audit is invalid, missing or estimated |
| Years | 기간 | table header (case years, base to target) |
| Forked from | 파생 원본 | table header (the case this one was forked from) |
| Revenue | 매출 | table header (case valuation, per year and per segment) |
| EBIT | 영업이익 | table header (case valuation) |
| Tax | 세금 | table header (case valuation, per year) |
| Reinvestment | 재투자 | table header (case valuation) |
| FCFF | 잉여현금흐름 | table header (case valuation, per year) |
| Margin | 마진율 | table header (segment in the target year) |
| Segment | 세그먼트 | table header (segment in the target year) |
| Drawdown from peak | 고점 대비 낙폭 | valuation panel row label; the basis is the 252-bar peak |
| Volume vs baseline | 기준 대비 거래량 | valuation panel row label; a multiple, never a percent |
| Trailing PE | 후행 PER | valuation panel row label; a multiple |
| Gap to fair value | 적정가치 대비 괴리 | valuation panel row label; a fraction of price, no horizon |
| Show panel | 패널 보기 | valuation ticker button |
| Stored cases for {ticker} | {ticker} 저장된 케이스 | valuation link; the ticker is a parameter |
| Refusal reasons | 거절 사유 | valuation.refusal.*; the sentence is translated, the backend code is never shown |
| Date | 날짜 | label (events table header; form label; dev-monitor timestamp column is Time) |
| Event | 이벤트 | label (events table header) |
| Category | 카테고리 | label (events table header; form label) |
| Origin | 구분 | label (events table header: built-in, rule, user, computed) |
| Label (event) | 표시 문구 | events form; the text drawn on the chart |
| Note | 메모 | events form label |
| Source URL | 출처 URL | events form label |
| End date | 종료일 | events form label |
| Optional | 선택 사항 | events form placeholder |
| Built-in | 내장 | event origin, and category origin |
| Added by you | 직접 추가 | event origin |
| Computed from prices | 가격에서 계산 | event origin |
| Needs category | 카테고리 필요 | events origin filter |
| All events | 전체 이벤트 | events section title |
| Filter by category / origin | 카테고리별 보기 / 구분별 보기 | events filter labels |
| All categories / All origins | 모든 카테고리 / 모든 구분 | events filter defaults |
| Save changes | 변경 저장 | events form button |
| Add event | 이벤트 추가 | events form button |
| Add category | 카테고리 추가 | events categories button |
| Reset to default | 기본값으로 되돌리기 | events categories button |
| Confirm delete | 삭제 확인 | events confirm button |
| Market Intelligence | 시장 인텔리전스 | news page title |
| Today | 오늘 | news badge, article published today |
| Unknown date / Unknown source | 날짜 미상 / 출처 미상 | news article fallbacks |
| Load more articles | 기사 더 보기 | news button |
| Dev Monitor | 개발 모니터 | dev page title (eyebrow is Developer runtime) |
| Performance Analysis | 성능 분석 | dev page title |
| Latency | 지연 시간 | dev section titles |
| Waterfall | 워터폴 | dev performance section |
| Span | 구간 | dev performance; one timed operation in a request |
| Scope (dev) | 범위 | dev monitor and performance label; the subsystem a monitor event belongs to |
| Operation | 작업 | dev monitor label |
| Duration | 소요 시간 | dev monitor label |
| Threshold | 기준 시간 | dev monitor label (slow-event threshold) |
| Time | 시각 | dev monitor label (event time) |
| Level | 수준 | dev monitor label (event level) |
| Route | 라우트 | dev monitor filter and performance label |
| Timestamp | 타임스탬프 | dev monitor detail label |
| Request ID | 요청 ID | dev monitor detail label |
| Audit Link | 감사 링크 | dev monitor detail label |
| Slow Operations | 느린 작업 | dev monitor section title |
| Live Log Stream | 실시간 로그 스트림 | dev monitor section title |
| Data-Quality Warnings | 데이터 품질 경고 | dev monitor section title |
| Metric Timing | 지표 계산 시간 | dev monitor section title |
| Operation Latency | 작업 지연 시간 | dev monitor section title |
| Ticker Fetch Latency | 종목 데이터 조회 지연 시간 | dev monitor section title |
| Cache Hit Rate | 캐시 적중률 | dev monitor KPI |
| Pause / Resume / Clear | 일시 정지 / 재개 / 지우기 | dev monitor buttons |
| Export JSONL | JSONL 내보내기 | dev monitor button |
| Route / Total ms / Self ms / DB ms | 라우트 / 총 소요 시간 / 자체 소요 시간 / DB 소요 시간 | dev performance table headers; the field names (`total_ms`, `self_ms`, `db_ms`) stay in the data, not in the header |
| Per-stock cost | 종목별 비용 | dev performance section title |
| Cache effectiveness | 캐시 효율 | dev performance section title |
| Technicals | 기술적 지표 | detail card title |
| Price Trend & Matrix | 가격 추세 | detail chart title |
| Price Matrix Offline | 가격 차트 오프라인 | detail chart error title |
| Signal (MACD) | 시그널 | detail technicals row |
| MA 20 / MA 50 | 20일 이동평균 / 50일 이동평균 | detail technicals rows |
| As of {date} | {date} 기준 | detail page subtitle |
| Stock detail page: No data available for {ticker} | {ticker} 데이터가 없습니다. | detail empty state |
| Instruments | 종목 | market page tab |
| Spreads | 스프레드 | market page tab; a theme's relative strength against a benchmark |
| Risk-on / Mixed / Risk-off | 위험선호 / 혼조 / 위험회피 | market regime label |
| Regime unavailable | 국면 판단 불가 | market regime with too little data |
| Daily closes | 일별 종가 | market subtitle |
| Commodities / FX / Crypto | 원자재 / 환율 / 암호화폐 | market subtitle and instrument types |
| Instrument | 종목 | label (market table header) |
| Abs change | 등락폭 | label (market table header, change in instrument units) |
| Unavailable | 이용 불가 | a refused spread pair |
| Snapshot | 스냅샷 | market card period fallback |
| Themes vs benchmark | 테마 대비 기준 지수 | market spread-figure row caption |
| Quick market detail | 빠른 시장 상세 | market modal, top section title |
| View Full Detail | 전체 상세 보기 | market modal link to the detail route |
| Current Value | 현재 값 | market modal tile |
| Absolute Change | 등락폭 | market modal tile; same term as Abs change |
| Percent Change | 등락률 | market modal tile; same term as Change |
| Observed Trend | 관측된 추세 | market modal tile; Uptrend / Downtrend / Flat trend are 상승 추세 / 하락 추세 / 보합 추세 |
| Detail Warnings | 상세 경고 | market modal section title |
| Daily Volume | 일별 거래량 | market modal section title |
| Data Quality | 데이터 품질 | market modal section title |
| Daily / Monthly | 일별 / 월별 | market modal timeframe toggle and titles; bars are 일봉 / 월봉 |
| Regime | 국면 | market modal tile; the label values are Risk-on / Mixed / Risk-off |
| Breadth | 시장 폭 | market modal tile; the share of equity indices that rose |
| Cross-Asset Signals | 교차 자산 신호 | market modal tile |
| Moving average window (20D / 50M) | 20일 / 50개월 | market modal chart legend and indicator rows; the suffix is a catalog key |
| MA 20 / MA 50 / MA 200 (market indicators) | 이동평균 20 / 이동평균 50 / 이동평균 200 | market modal index indicators; the timeframe is the section's, so no 일 |
| Bollinger Upper / Mid / Lower | 볼린저 상단 / 중단 / 하단 | market modal index indicators |
| Themes and policy spreads | 테마 및 정책 스프레드 | market spreads section title |
| Reason (refused spread) | 거절 사유 | market spreads, refused pair |
