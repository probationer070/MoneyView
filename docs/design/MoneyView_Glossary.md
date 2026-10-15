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
| Market Overview | 시장 개요 | nav |
| Portfolio | 포트폴리오 | nav |
| News Feed | 뉴스 | nav |
| Corporate Analysis | 기업 분석 | nav |
| Decision Log | 의사결정 기록 | nav |
| Valuation | 가치평가 | nav |
| Cases | 케이스 | nav |
| Events | 이벤트 | nav |
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
| Stale source | 원천 자료 오래됨 | verdict strip warning |
| Audit uncertain | 감사 불확실 | assumption table badge title; the audit is invalid, missing or estimated |
