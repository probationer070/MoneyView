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
| Retry | 다시 시도 | |
| Loading… | 불러오는 중… | |
| Market | 시장 | label |
| Name | 종목 | label (table header for a security) |
| Price | 현재가 | label |
| Change | 등락률 | label (table header for a delta) |
| Case | 케이스 | label (eyebrow on a case) |
| Developer runtime | 개발 런타임 | label (eyebrow on the dev monitor) |
| Up / Down / Unchanged | 상승 / 하락 / 보합 | delta, screen-reader text |
| Language | 언어 | language toggle group label |
| Could not be loaded. | 불러오지 못했습니다. | error state body |
