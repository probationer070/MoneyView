# MoneyView 계산식 전수 정리 (E2E)

작성: 2026-11-02 · 대상 브랜치 `renewal` (커밋 `73e313f` 기준 + 미커밋 ① 변경)

이 문서는 MoneyView가 **지금 실제로 쓰는** 계산식을 데이터 입력 → 계산 → API → 화면 순서로 정리한다.
명세(설계 의도)는 `moneyview-quant-engine.md`에 있고, 이 문서는 코드에서 읽은 **현재 동작**이다.
둘이 다르면 코드가 현재 동작이다. 줄 번호는 작성 시점 기준이며 코드가 바뀌면 어긋난다.

표기: `g` 성장률, `t` 연도, `r`·`WACC` 할인율, `TV` 영구가치, `EV` 기업가치, `E` 자기자본가치.
비율은 소수(0.042 = 4.2%)가 기본이고, `%`로 저장되는 값은 따로 적는다.

---

## 0. 한눈에 보기

| # | 화면 | 계산 | 주 파일 |
|---|---|---|---|
| 1 | 기업분석·포트폴리오 | 재무제표 지표: 성장률(CAGR), 세율, NOPAT, ROIC, 부채비율, 베타, WACC | `apps/api/services/corporate_statement_metrics.py` |
| 2 | 기업분석 | 5년 FCFF DCF, 민감도 격자, 지분가치 브리지 | `apps/api/services/corporate_dcf.py`, `packages/core_finance/dcf.py` |
| 3 | 포트폴리오·의사결정 | 비교 DCF, 시장 암시 수익률, CAPM | `apps/api/services/corporate_comparison.py`, `packages/core_finance/expected_return.py` |
| 4 | 케이스·가치평가 | 다모다란 세그먼트 밸류에이션 엔진(10년) | `packages/core_finance/segment_valuation.py` |
| 5 | 가치평가·기업분석 헤더 | 다모다란식 적정가 케이스, 암시 성장률 | `apps/api/services/fair_value_case.py`, `fair_value.py` |
| 6 | 가치평가 | 보수적 케이스(하한선) | `apps/api/services/conservative_case.py`, `packages/core_finance/industry_benchmark.py` |
| 7 | 가치평가 | 판정 패널: 고점 대비 낙폭, 거래량 비율, PER, DCF 괴리 | `apps/api/services/valuation_verdict.py`, `packages/core_finance/price_signals.py` |
| 8 | 케이스 | EV/Sales 상대가격, 케이스 몬테카를로, Shapley 기여도 | `case_pricing.py`, `case_simulate.py`, `packages/core_finance/shapley.py` |
| 9 | 포트폴리오 리포트 | Brinson 성과 귀속, 베타, VaR/ES | `apps/api/core/maths.py`, `services/portfolio/*` |
| 10 | 포트폴리오 표 | 변동성 추정, 이상치 배제 | `apps/web/app/portfolio/*` |
| 11 | 시뮬레이션 랩 | GBM+점프 경로, 리스크 지표, EPS×PER 가치, 상관·프런티어 | `apps/web/app/monte-carlo/lib/*` |
| 12 | 거시 신호 | 규칙 판정, 베이즈 갱신(우도비), 경계 정규화 | `packages/core_finance/macro_signals/*`, `services/signals/rules.yaml` |
| 13 | 리스크 | 테마 지수, 경고 W1–W7, 하락 경보, 급등 감지, 카드 덱 | `packages/core_finance/risk_signals/*`, `services/risk/rules.yaml` |
| 14 | 시장 개요·상세 | 상대강도, 급등락 표시 | `packages/core_finance/relative_strength.py`, `apps/web/lib/detail/bigMoves.ts` |
| 15 | 의사결정 기록 | 결정 이후 가격 변화 | `apps/api/services/investment_decision.py` |

§16에 계산식을 읽으며 발견한 **불일치·주의점**을 모았다. 수정은 하지 않았고, 각각 오너 결정이 필요하다.

---

## 1. 재무제표 지표 (기업분석 탭의 Growth·ROIC·WACC)

**입력**: Yahoo 재무제표 번들(`get_yahoo_statement_bundle`, 연간 우선·분기 합산 보조), 2021–2025 회계연도.
**출력**: `CorporateMetrics`(값은 **% 단위**로 저장: growth 12.3 = 12.3%). 기업분석 KPI 타일, 포트폴리오 비교표, DCF 입력.
**함수**: `yahoo_statement_metrics` (`apps/api/services/corporate_statement_metrics.py:659`).

### 1.1 매출 성장률

```
연간 성장률_t = (매출_t / 매출_{t-1} − 1) × 100            (최근 5개)
CAGR       = ((매출_last / 매출_first)^(1 / (연도_last − 연도_first)) − 1) × 100
최근 평균   = 최근 3개 연간 성장률의 산술평균
```

- 유효 매출: 1,000,000 이상, 2021–2025년. 매출이 2년 미만이거나 0 이하면 성장률 없음.
- CAGR이 −90% ~ +200%를 벗어나면 `outlier_growth_cagr`로 무효.
- 기본(`growth_basis="cagr"`)은 CAGR. 무효면 **대체값(fallback)** 을 쓴다(§1.6).

### 1.2 세율

```
연도별 세율 = 법인세비용 / 세전이익          (세전이익 > 0, 0 < 세율 ≤ 50%만)
정상 세율   = clamp(유효 세율들의 중앙값, 15%, 30%)
유효값 없음 → 21% (fallback_default)
```

### 1.3 NOPAT·투하자본·ROIC

```
NOPAT_t         = 영업이익_t × (1 − 정상 세율)
투하자본_t       = 자기자본(장부) + 총부채          (≤ 0 이거나 1,000,000 미만이면 없음)
평균 투하자본_t   = (투하자본_t + 투하자본_{t-1}) / 2   (전년 없으면 당해 값)
ROIC_t (%)      = NOPAT_t / 평균 투하자본_t × 100
ROIC (기본)      = 최근 3개 ROIC의 평균  (roic_basis="recent_average")
```

- 총부채: `Total Debt`, 없으면 `Net Debt + 현금`으로 복원 (`_gross_debt_map`, :200).
- 품질 규칙: 평균 투하자본 < max(|NOPAT|×0.1, 1)이면 `suspicious`, |ROIC| > 300%면 `suspicious`.
  `ok`/`estimated`만 의사결정용(primary)이고, 나머지는 대체값.

### 1.4 재투자율·FCFF·혁신 점수

```
재투자율_t (%) = clamp(max(CapEx_t − 감가상각_t, 0) / NOPAT_t × 100, 0, 100)   → 연도 평균
FCFF (십억$)   = 최근 3개 회계연도 Free Cash Flow 평균 / 1e9
innovation    = 평균(clamp(R&D/매출 × 100 × 10, 0, 100))
```

FCFF는 Yahoo의 `Free Cash Flow`(영업현금흐름 − CapEx, 즉 **FCFE에 가까운 값**) 평균이다. §16-4 참고.

### 1.5 부채비율·베타·WACC

```
부채비율 (%)     = clamp(총부채 / (총부채 + 장부 자기자본) × 100, 0, 90)
D/E             = 총부채 / 장부 자기자본
레버드 베타 β_L  = Yahoo beta (없으면 β_U_fallback × (1 + (1−t)·D/E))
언레버드 베타    = clamp(β_L / (1 + (1−t)·D/E), 0.4, 3.0)          (하마다)
세전 부채비용 r_d = clamp(이자비용 / 총부채, 1%, 15%)   (부채 없으면 4.5%)
자기자본비용 r_e  = 4.2% + β_L × 5.5% + 0.8%                       (r_f + β·ERP + CRP)
WACC (%)        = [ (1 − D/V)·r_e + (D/V)·r_d·(1 − t) ] × 100,   D/V = 부채비율/100
```

- 상수: `DEFAULT_RISK_FREE_RATE = 0.042`, `DEFAULT_EQUITY_RISK_PREMIUM = 0.055`,
  `KOREA_COUNTRY_RISK_PREMIUM = 0.8`(%) (`corporate_statement_metrics.py:32-34`, 식은 :826-834).
- 가중치는 **장부가** 자기자본 기준이다. 감사(audit) 화면의 WACC는 **시가총액** 가중치를 쓴다(:1401). §16-2.

### 1.6 대체값(fallback) 지표

재무제표로 계산할 수 없으면 `load_fallback_metrics` → 저장된 행, 없으면 `default_metrics`
(`apps/api/services/corporate_metrics_service.py:81`). `default_metrics`는 **티커 문자열의 해시로 숫자를 만든다**:

```
seed = Σ ord(문자) for "TICKER:sector"
growth = 5 + seed mod 9,  roic = 10 + seed mod 18,  wacc = 8 + (seed mod 18)×0.25,  ...
(+ 업종 키워드별 가감, 하한/상한 적용)
```

이 값은 측정이 아니다. 다모다란 적정가는 이 경우 `default_metrics`로 거절하고, 의사결정 기록은
`metrics_are_real=false`로 표시한다. 기업분석 5년 DCF와 비교표는 이 값으로 계산한다. §16-5.

---

## 2. 기업분석 5년 DCF (기업분석 탭 "Intrinsic DCF")

**입력**: `valuation_params_from_metrics` (`corporate_metrics_service.py:500`):
`g = clamp(growth/100, −0.99, 2.0)`, `WACC = max(wacc/100, 0.001)`, `FCFF₀ = metrics.fcff`(십억$).
**함수**: `_build_dcf_outputs` (`apps/api/services/corporate_dcf.py:189`). **API**: `POST /api/v1/corporate/dcf/{ticker}`, 스트리밍, 전체 리포트.

```
FCFF_t      = FCFF₀ × (1 + g)^t                         t = 1..5
PV_t        = FCFF_t / (1 + WACC)^t
g_∞         = derive_terminal_growth(g, WACC, ceiling=3%)   (§2.1)
TV          = FCFF_5 × (1 + g_∞) / max(WACC − g_∞, 0.005)
EV          = Σ PV_t + TV / (1 + WACC)^5
TV 비중 (%)  = PV(TV) / EV × 100
```

- 하나라도 FCFF_t ≤ 0이면 `non_positive_fcff`로 거절(`require_admissible_fcff_path`, `dcf.py`).
- 사용자가 영구성장률을 직접 주면 `min(입력, WACC − 0.005)` 후 `max(·, −0.1)`.
- `agency_discount = 1 − clamp(ESG 패널티, 0, 80)/400`, `dcf_multiple = EV / FCFF₀`는 **표시만** 하고 가치에 곱하지 않는다.
- `operating_margin` 입력란에는 ROIC 값이 들어간다(:508). 계산에는 쓰이지 않는다. §16-3.

### 2.1 영구성장률 결정 (`packages/core_finance/terminal_growth.py`)

```
후보 = { 회사 성장률 g,  상한 3%,  WACC − 0.5%p }
g_∞  = min(후보);  g_∞ < −10% 이면 −10%
binding_constraint = 이긴 후보 이름 (company | ceiling | wacc_safety | floor)
```

### 2.2 지분가치 브리지 (`equity_bridge.py`, `dcf.py`)

```
순부채        = 총부채 − 현금성자산 (같은 결산일)       없으면 보고된 Net Debt (quality=estimated)
비영업자산     = Investments And Advances / Long Term Equity Investment
E            = EV − 순부채 + 비영업자산
주당가치       = E / 희석주식수 (Diluted Average Shares)
상승여력 (%)   = (주당가치 − 현재가) / 현재가 × 100
판정          = 주당가치 > 현재가 → Undervalued, 아니면 Overvalued, 브리지 없음 → Bridge Incomplete
```

모든 금액은 십억 단위(`/1e9`)로 맞춘다. 순부채·주식수가 없으면 주당가치는 비고(None), 화면은 EV만 보여 준다.

### 2.3 민감도 격자 (`dcf.py:sensitivity_grid`)

WACC와 g_∞를 각각 기준값 ±1%p, ±0.5%p로 5×5 격자. 같은 5년 FCFF를 셀마다 다시 할인한다.
`WACC ≤ 0` 또는 `WACC ≤ g`인 셀은 숫자 없이 사유(`wacc_not_positive`, `wacc_not_above_terminal_growth`)만.

---

## 3. 비교표 DCF와 기대수익률 (포트폴리오 탭, 의사결정 기록의 수치)

**함수**: `_dcf_snapshot` (`apps/api/services/corporate_comparison.py:393`). §2와 같은 5년 FCFF 경로를 쓰지만
TV 할인은 `enterprise_present_value` (`expected_return.py`)의 `max(r − g_∞, 0.005)`이다.

```
ROIC − WACC (%p)       = metrics.roic − metrics.wacc
DCF 암시 수익률          = 주당가치 / 현재가 − 1            (브리지 없으면 주당가치 := 현재가 → 0)
CAPM 기대수익률          = r_f + β_L × ERP                 (β_L = 하마다 재레버, 메트릭 세율)
시장 기대수익률          = r_f + ERP
시장 EV                 = 현재가 × 희석주식수 + 순부채 − 비영업자산
시장 암시 수익률 r*       : EV(FCFF 경로, g_∞, r*) = 시장 EV 를 r* ∈ [g_∞+0.5%, 1000%]에서 이분법(64회)
암시 수익률 − WACC (%p)  = (r* − WACC) × 100
```

- r* 거절 코드: `no_price`, `bridge_unresolved`, `non_positive_fcff`, `non_positive_market_ev`,
  `below_model_range`(가장 낮은 할인율로도 시장 EV에 못 미침), `above_model_range`.
- 포트폴리오 표는 |값| > 500(%)이면 `suspicious`로 표시하고 순위에서 뺀다(`portfolioMetrics.ts`, `METRIC_OUTLIER_ABS`).
- 의사결정 기록은 결정 순간 이 함수의 `current_price`, `estimated_value`, `dcf_implied_return`, ROIC, WACC를 저장한다
  (`investment_decision.py:76`).

---

## 4. 세그먼트 밸류에이션 엔진 (케이스 탭, 다모다란 적정가·보수적 케이스의 공통 엔진)

**함수**: `run_case(CaseSpec, [SegmentSpec])` (`packages/core_finance/segment_valuation.py:937`).
**API**: 케이스 실행 `/api/v1/valuation/cases/{id}/run`, 적정가·하한선이 내부에서 호출.

### 4.1 매출 경로 (세그먼트별, n = target_year − base_year)

목표 매출 `R*` = `revenue_target` 또는 `TAM × 점유율`. 네 가지 곡선 중 하나:

| 곡선 | 조건 | 식 |
|---|---|---|
| 감쇠 성장 | 기본 | `g_t = g₁ − (g₁ − g_∞)(t−1)/(n−1)`, `Π(1+g_t) = R*/R₀`이 되도록 g₁을 이분법(200회) |
| 앵커 곡선 | `initial_growth` 지정 | `g_t = g_init + (g_∞ − g_init)(t−1)/(n−1) + a·sin(π(t−1)/(n−1))`, a를 이분법 |
| 램프 | 매출 0 또는 늦은 시작 | 시작 전 0, 이후 `R* × step/steps` 선형 |
| 갭 축소 | `waypoint_gap_fraction` (n=10만) | 중간점 `R₀ + (R*−R₀)·f`, 블록 내 0.2/0.3/0.4/0.5씩 남은 갭을 닫음 |

### 4.2 이익·재투자·세금

```
마진_t     = 기초마진 + (목표마진 − 기초마진) × t/n                (선형 수렴)
EBIT_t     = 매출_t × 마진_t
재투자_t    = (매출_t − 매출_{t−1}) / (매출/자본)                 (1–5년 early, 6년~ late)
세율_t      = 유효세율에서 한계세율로 converge_from년부터 선형 (유효세율 지정 시)
세금_t      = max(EBIT_t − 이월결손 사용분, 0) × 세율_t             (EBIT ≤ 0이면 결손 누적)
FCFF_t     = EBIT_t − 세금_t − 재투자_t
```

### 4.3 할인과 영구가치

```
WACC_t     = wacc_initial (converge_from 전), 이후 wacc_stable까지 선형
할인계수_t  = Π_{k≤t} 1/(1 + WACC_k)                               (누적, 연도별 다른 WACC)
g_∞        = terminal_growth (없으면 무위험률)
재투자율_∞  = g_∞ / ROIC_stable
TV         = EBIT_n × (1 + g_∞) × (1 − 한계세율) × (1 − g_∞/ROIC_stable) / (WACC_stable − g_∞)
EV         = Σ FCFF_t × 할인계수_t + TV × 할인계수_n
E          = EV − (부채 − 현금) + IPO 조달액
주당가치(희석) = E / (기본주식수 + 신주)
```

- 거절: `WACC_stable ≤ g_∞`, `ROIC_stable ≤ 0`, `ROIC_stable ≤ |g_∞|`, `g_∞ > 0`인데 `ROIC_stable ≤ WACC_stable`,
  `ROIC_stable`이 목표연도 한계 ROIC(`Σ R*·목표마진·(1−t) / Σ R*/(S/C_late)`)보다 큼, `g_∞ > 무위험률`.
- 신주: `shares_new` 지정 > 공모가 지정 시 `조달액/공모가` > 그 외 `조달액/(E − 조달액) × 기본주식수`.
- 진단 값: TV 비중, `terminal_spread = WACC_stable − g_∞`, 목표연도 재투자율 등(`CaseResult`).

---

## 5. 다모다란식 적정가 (가치평가 탭, 기업분석 헤더의 한 줄)

**함수**: `build_fair_value_case` (`apps/api/services/fair_value_case.py:90`) → §4 엔진 → `fair_value_summary` (`fair_value.py`).
**입력**: 회사 기준값(`build_company_baseline`, 최신 회계연도), 다모다란 업종 행(`industry_row_for_ticker`, 회사 자신의 업종 1개).
**API**: `POST /api/v1/valuation/fair-value/{ticker}`.

```
기준값
  R₀        = 최신 매출 / 1e9,    기초마진 = 영업이익 / 매출
  현금·부채  = 순부채 < 0 이면 현금 = −순부채, 아니면 부채 = 순부채
  wacc_initial = metrics.wacc / 100

성장
  회사 g    = 최근 3년 매출 CAGR (company_revenue_cagr, 4개 연도)
  g         = clamp((회사 g + 업종 5년 매출성장률) / 2, −5%, 25%)
  성장 경로  = 1–5년 g, 6–10년 g에서 무위험률로 선형 하락
  R*        = R₀ × Π(1 + 경로_t)                                (10년)

마진        = 회사 마진 ≥ 업종 마진 ? 회사 마진 : (회사 + 업종) / 2
매출/자본    = 업종 Sales/Capital (early = late)
WACC_stable = 업종 Cost of capital (6년차부터 수렴)
유효세율     = 업종 평균 유효세율 → 한계세율 25%로 수렴
ROIC_stable = min(업종 세후 ROC, 목표마진 × (1 − 25%) × 업종 S/C)
g_∞         = 무위험률 4.2%;  단 ROIC_stable ≤ WACC_stable 이면 g_∞ = 0
```

요약(`fair_value_summary`):

```
적정가        = 케이스 주당가치(희석);  ≤ 0 이면 null + value_note "non_positive_value" (2026-11-02, ①)
괴리 (%)      = (적정가 − 최근 종가) / 최근 종가 × 100
모델 성장률    = growth_for_revenue_target: R*에 이르는 g를 이분법(200회)
암시 성장률    = 다른 입력을 고정하고 주당가치 = 현재가가 되는 g ∈ [−20%, 60%] (이분법 80회)
하한선        = 보수적 케이스(§6)의 주당가치 (같은 ≤ 0 규칙)
설명 가능성     = plausibility: 암시 EV/매출 = 케이스 기업가치 / 기준 매출 (segments[0].base_revenue);
                 비율 = 암시 EV/매출 / 업종 EV/매출;  비율 > k(=3, 초안)이면 flagged (값은 자르지 않음).
                 원인(최대 2개) = 마진목표·성장률(1–5년) 각각만 업종 값으로 바꿔 재실행한 뒤
                 share_of_value = (적정가 − 바꾼 값) / 적정가 > 0 인 것, share 큰 순. 업종 EV/매출이 없으면 null.
```

거절 코드와 비율은 `docs/reports/2026-11-fair-value-audit.md`(단계 0)에 있다.

---

## 6. 보수적 케이스 (가치평가 탭 "하한선")

**함수**: `build_conservative_case` (`apps/api/services/conservative_case.py:165`).
업종 집단은 회사 **섹터**에서 세후 ROC 상위 5개 업종 평균(`resolve_benchmark`, 최소 3개 업종, 업종당 10개 기업 이상).

```
fade(회사, 업종) = 회사가 더 보수적이면 회사 값, 아니면 회사 + (업종 − 회사) × 10/10 = 업종 값
  보수 방향: 성장률·마진·ROC·매출/자본은 낮을수록, 세율·자본비용은 높을수록
목표마진, ROC, S/C, 성장률, 세율, WACC = 각각 fade
ROIC_stable = min(fade된 ROC, 목표마진 × (1 − 25%) × S/C)
R*          = R₀ × (1 + fade된 성장률)^10                        (감쇠 없이 일정 성장)
WACC        = initial = stable = fade된 WACC
g_∞         = 무위험률
```

`year = horizon`으로 호출하므로 fade는 사실상 "회사와 업종 중 더 보수적인 값"이다.

---

## 7. 가치평가 판정 패널 (가치평가 탭의 네 줄)

**함수**: `build_verdict` (`apps/api/services/valuation_verdict.py:242`), 산식은 `packages/core_finance/price_signals.py`.

| 줄 | 식 | 비교 기준 |
|---|---|---|
| 고점 대비 낙폭 | `(최근 종가 − 252봉 최고가) / 최고가` | 같은 기간 비교기업 낙폭의 평균(기간의 80% 이상 종가가 있는 비교기업만) |
| 거래량 | `최근 90봉 평균 거래량 / 최근 252봉 평균` (부족하면 절반/전체) | 없음 |
| PER | `최근 종가 / 최근 양수 연간 희석 EPS` 다모다란 섹터 바스켓의 `aggregate_pe` 평균(업종 시가총액 ÷ 흑자 기업 순이익 집계 PER, 세후 ROC 상위 5개 업종) |
| DCF 괴리 | `(보수적 케이스 주당가치 − 종가) / 종가` | 없음 |

EPS ≤ 0, 데이터 부족, 고점 ≤ 0이면 숫자 대신 사유를 보여 준다.

---

## 8. 케이스 보조 계산 (케이스 탭)

- **EV/Sales 상대가격** (`case_pricing.py:26`): `암시 EV = 업종 EV/Sales × 기준연도 매출 합`, `DCF/암시 − 1`. 업종이 얇거나(기업 10개 미만) 값이 범위를 벗어나면 거절.
- **케이스 몬테카를로** (`case_simulate.py:197`): 입력별 분포(정규·균등·삼각, `distributions.py`)로 1,000–20,000회 표본 → 매번 §4 실행 → 주당가치 분포. 엔진이 거절한 표본 비율 ≥ 10%면 결과 억제. 입력별 영향은 스피어만 순위상관(`rank_correlation.py`, 동순위 평균 순위).
- **Shapley 기여도** (`shapley.py`): 부모 케이스와 달라진 입력 집합 N에 대해
  `φ_i = Σ_{S ⊆ N∖{i}} |S|!(|N|−|S|−1)!/|N|! × [v(S∪{i}) − v(S)]`, v = 주당가치. "왜 움직였나" 표.
- **케이스 차이** (`case_diff.py`): 같은 지표 `value_per_share_diluted`의 부모/자식 차이.

---

## 9. 포트폴리오 리포트 (성과 귀속·리스크)

**파일**: `apps/api/core/maths.py`, `apps/api/services/portfolio/*`.

```
종목 수익률 (기간)   = 종가_end / 종가_start − 1
포트폴리오 수익률     = Σ w_i × r_i;      초과수익 = 포트폴리오 − 벤치마크
일별 수익률          = 종가_t / 종가_{t−1} − 1
포트폴리오 일별       = w · (정렬된 일별 수익률 행렬)

Brinson-Fachler (섹터 s)
  배분  = (w_p,s − w_b,s) × (r_b,s − R_b)
  선택  = w_b,s × (r_p,s − r_b,s)
  상호작용 = (w_p,s − w_b,s) × (r_p,s − r_b,s)

베타  = Cov(r_p, r_b) / Var(r_b)          (최근 252일, 표본공분산; 2개 미만이면 0)
VaR   = max(0, −Quantile_{1−α}(r_p)) × √h          (역사적, α=95%)
ES    = max(0, −mean(r_p | r_p ≤ Quantile_{1−α})) × √h
```

- 벤치마크 섹터 비중이 없으면 섹터 균등 비중 대리값을 쓰고 경고를 붙인다.
- 가격이 없으면 `allow_synthetic_fallback=true`일 때 **시드 고정 정규난수**(평균 0.03%, 표준편차 1.2%)를 수익률로 쓰고 경고한다(`data_provider.py:37`). 기본값은 false(거절).

---

## 10. 포트폴리오 표 (화면 계산)

```
변동성 (%)  = std(ln(P_t / P_{t−1})) × √252 × 100      (최근 20개 종가 sparkline, 표본표준편차)
```

`apps/web/app/portfolio/page.tsx:653`. 나머지 칸(ROIC−WACC, DCF 상승여력, 암시수익률−WACC)은 §3 값을 그대로 쓴다.

---

## 11. 시뮬레이션 랩 (브라우저 계산)

화면은 **브라우저 워커**로 계산한다(`apps/web/app/monte-carlo/lib/*`). 서버의 `POST /api/v1/monte-carlo/analyze`는
같은 모델의 파이썬 판이지만 웹 코드에서 호출하는 곳은 없다(§16-9).

### 11.1 경로·수익률 분포·리스크 (`simulation-core.ts`)

```
dt = T / (252·T),   μ = 기대수익률,  σ = 변동성
점프 강도 λ = −12 × ln(1 − 월간 점프확률)
점프 크기 J ~ N(−σ × 강도배수, max(0.35σ, 2%))       (발생 확률 λ·dt)
S_{t+dt} = S_t × exp((μ − σ²/2)dt + σ√dt·Z + J·1{점프})   Z ~ N(0,1) (mulberry32 + Box-Muller)

말기 수익률 R = S_T / S_0 − 1
VaR95/99   = R 손실(−R)의 95/99 백분위
CVaR       = 그 이상 손실의 평균
하방편차    = √mean(R² | R < 0)
Sortino    = (mean R − r_f·T) / 하방편차
연환산 수익 = (1 + mean R)^(1/T) − 1,   연환산 변동성 = std(R)/√T
Sharpe     = (연환산 수익 − r_f) / 연환산 변동성
왜도·첨도   = 표준화 3·4차 적률 (첨도는 −3 한 초과첨도도 표시)
손실확률    = P(R < 0)
```

### 11.2 기업 가치평가 탭 (`valuation-core.ts`, 2026-11-02부터 달러)

```
기준 PER   = max(현재가 / max(EPS₀, 0.01), 1)
표본마다:
  g  = max(평균 성장률 + N(0,1)×불확실성, −80%)
  r  = max(할인율 + N(0,1)×불확실성, 3%)
  g_∞ = min(영구성장률, r − 0.5%)
  PER_exit = max(기준 PER + N(0,1)×PER 불확실성, 1)
  EPS_t = EPS_{t−1} × (1 + g)  (마지막 해만 1 + g_∞),   t = 1..N
  적정가 = Σ EPS_t/(1+r)^t + EPS_N × PER_exit / (1+r)^N
저평가 확률 = P(적정가 > 현재가)
```

### 11.3 상관 모델 (`correlation-core.ts`)

```
상관 충격  = L·Z,  L = Cholesky(상관행렬)
자산 수익률 = μ_i + σ_i × (L·Z)_i
무작위 비중 400개 (균등난수 정규화) → 수익 = w·μ,  위험 = √(Σ w_i w_j σ_i σ_j ρ_ij)
Sharpe = (수익 − 3%) / 위험  →  최대 Sharpe 비중을 "최적"으로 표시
분산효과 = 평균 단일 변동성 − 최적 포트폴리오 위험
스피어만 민감도 = 자산별 시나리오 수익률과 최적 포트폴리오 수익률의 순위상관
```

---

## 12. 거시 신호 (거시 신호 탭의 A 상승 / B 조정 / C 급락·약세장)

**설정**: `apps/api/services/signals/rules.yaml` (문턱과 우도비는 여기만). **엔진**: `packages/core_finance/macro_signals/`.

### 12.1 규칙 판정 (`rules.py`)

| 종류 | 값 | 예 |
|---|---|---|
| `level_streak` | 최근 연속으로 문턱을 만족한 일수 ≥ days → triggered; 최신값이 near 문턱 또는 연속 ≥ near_days → near | 10년물 ≥ 5.50%가 10일 |
| `rolling_mean` | 최근 window개 평균 vs 문턱 | 브렌트 5개 평균 ≥ $110 |
| `mom_pct` | `(이번 달 / 지난달 − 1) × 100` (연속 월만) | 근원 CPI 전월비 ≥ 0.25% |
| `mom_diff` | 이번 달 − 지난달 | 고용 증가 ≥ 10만 |
| `level_change` | 최신값 − lookback일 전 값 | 연준 상단금리 14일 변화 > 0 |
| `compound` | 조건 전부 만족 → triggered, 일부 → near | 고용 ≥ 10만 그리고 CPI < 0.25% |
| `manual` | 사용자가 켜고 끔 | 이란 공습 등 |

데이터가 `max_age_days`(일간 7, 브렌트 14, 월간 80)보다 오래되면 `stale`로 계산에서 빠진다.

### 12.2 확률 (`scenario.py`)

```
가중치: triggered = 1.0, near = 0.5
raw_s  = prior_s × Π_{활성 규칙 k} LR_{k,s}^{가중치_k}        prior = A .35, B .45, C .20
P_s    = bounded_normalize(raw, floor = 5%, cap = 85%)
         (합 1로 정규화 → cap 초과는 85%로 고정, floor 미만은 5%로 고정 → 나머지를 다시 정규화, 반복)
기여도_k,s = P_s(전체) − P_s(규칙 k 제외)
```

`rules_version = sha256(rules.yaml)`이라 주석 한 줄만 바꿔도 추이 차트에 "규칙 변경" 선이 생긴다.

---

## 13. 리스크 탭

**설정**: `apps/api/services/risk/rules.yaml`. **엔진**: `packages/core_finance/risk_signals/`.

### 13.1 테마 지수 (`indices.py`)

```
테마 일간 수익률 = Σ (전일 시가총액_i × r_i) / Σ 전일 시가총액_i     (발행주식수 × 종가, 구성 ≥ 3종목인 날만)
지수_t         = 100 시작, 지수_{t−1} × (1 + 일간 수익률)
테마 비중       = 테마 시가총액 / 워치리스트 전체 시가총액
낙폭           = 지수 / window일 최고 − 1;   연속 하락일;   신저가 = 지수 ≤ window일 최저
```

### 13.2 시장 경고 W1–W7 (`warnings.py`) — 발표 시점 기준(일간은 다음 영업일, CPI는 다음 달 15일, PCE는 2개월 뒤 말일)

| ID | 켜짐 조건 |
|---|---|
| W1 하이일드 | 스프레드 ≥ 3.50% 또는 10일 상승 ≥ 0.30%p (2023-11-06 이전은 BAA10Y 대리: 1.9095%, 0.10%p) |
| W2 금리 | 10년물 ≥ 5.00% 또는 20일 상승 ≥ 0.40%p |
| W3 유가 | 브렌트 20일 상승률 ≥ 15% |
| W4 연준 인상 | 마지막 인상 후 60일 이내 |
| W5 물가 | 근원 CPI 또는 근원 PCE 전월비 ≥ 0.30% |
| W7 폭 축소 | SOX/RSP 비율이 60일 고점보다 5% 넘게 낮고, SOX는 60일 고점 5% 이내 |

### 13.3 하락 경보 (`alerts.py`)

```
가격 확인 = 낙폭 ≤ −4% (20일 고점 대비) AND 연속 하락 ≥ 2일
경보 확인 = 가격 확인 AND 켜진 경고 수 ≥ 3
반도체 테마는 SOX 가격 확인으로도 확인 가능
경보 시작 = 확인된 테마 비중 합 ≥ 20% 또는 SOX 확인
테마 이탈 = 기준 대비 3% 이내 회복 후 5일 조용
```

### 13.4 급등 감지 (`surge.py`) — 네 조건 모두 켜지면 "on"

```
크기   z = (지수_t / 지수_{t−5} − 1) / (60일 일간수익률 표준편차(5일 전까지) × √5) ≥ 2.0
가속   slope = (EMA10_t / EMA10_{t−1} − 1) × 100,  accel = slope_t − slope_{t−3}
       최근 250개 accel 안에서의 백분위 순위 ≥ 0.95 (최소 120개)
폭     5일 수익률 > 0인 구성종목 비율 ≥ 60%
RSI    Wilder RSI(14)가 최근 5일 안에 60을 상향 돌파, 현재 60 ≤ RSI ≤ 80  (80 초과는 과열 표시)
이벤트 종료: EMA 아래로 이탈 또는 10일간 20일 신고가 없음(stall)
```

### 13.5 카드 덱 (`decks.py`, `movers.py`)

```
급락 카드  = 20일 고점 대비 −10% 이하 종목 (낙폭 순)
후보 카드  = 63일 고점 10% 이내 종목 중, SOX 또는 급락(−20%) 종목과의 63일 일간수익률 상관 ≥ 0.6 (쌍 ≥ 40)
상승 상위  = 당일 수익률 상위 5개 + 5일 수익률 + RSI(14)
사후 수익  = 경보 시작일 기준 5·10·20일 수익률, 10일 내 최대 낙폭; 최대 낙폭 ≤ −5%면 "유용한 경보"
```

---

## 14. 시장 개요·상세 차트

- **상대강도** (`relative_strength.py`): `(A_t / A_base) / (B_t / B_base) × 100`, 기준일 = 창(기본 90일) 안 첫 공통일.
  쌍: BOTZ·CIBR·SKYY·ITA vs S&P 500, ICLN vs XLE (`market_spreads.py`).
- **급등락 표시** (`apps/web/lib/detail/bigMoves.ts`): `|r_t| / std(직전 60일 수익률) ≥ 가격 문턱`이면 표시,
  `거래량 / 직전 20일 평균 ≥ 거래량 문턱`이면 채워서(strong) 표시.

## 15. 의사결정 기록

```
가격 변화 = (결정일 이후 마지막 종가 − 결정 시 가격) / 결정 시 가격       (매번 다시 계산, 저장 안 함)
```

결정 시점 수치는 §3 `_dcf_snapshot`이 만든 값을 그대로 저장한다(`investment_decision.py:76`).

---

## 16. 발견한 불일치·주의점 (수정 안 함, 결정 필요)

코드를 읽고 확인한 사실이다. 각 항목이 버그인지 의도인지는 오너가 정한다.

| # | 내용 | 위치 | 영향 |
|---|---|---|---|
| 1 | **한국 국가위험프리미엄 0.8%가 모든 종목의 자기자본비용에 더해진다.** 워치리스트는 대부분 미국 종목이다. | `corporate_statement_metrics.py:833`, `corporate_dcf.py:49` | 모든 WACC가 약 0.8%p×자기자본 비중만큼 높다 → 5년 DCF·비교표 가치가 낮아지고, 적정가의 wacc_initial(1–5년)도 높아진다. §10 과소 산출의 한 원인 후보. |
| 2 | **WACC 가중치가 두 가지다.** 사용하는 WACC는 장부 자기자본 기준 D/(D+E_book), 감사(audit) 화면의 WACC는 시가총액 기준. | `:802, :831` vs `:1401` | 시가총액이 장부가보다 훨씬 큰 기업(기술주)은 사용 WACC의 부채 비중이 과대 → 같은 화면 안에서 두 WACC가 다를 수 있다. 다모다란 방식은 시장가 가중이다. |
| 3 | 5년 DCF 입력의 `operating_margin`에 ROIC 값이 들어간다. | `corporate_metrics_service.py:508` | 계산에는 안 쓰이지만 화면·리포트에 "영업이익률"로 보이면 잘못된 숫자다. |
| 4 | 5년 DCF의 FCFF는 Yahoo `Free Cash Flow` 3년 평균(영업현금흐름 − CapEx, 이자 반영 후)이고, **매출 CAGR(최대 200%)로 5년 내내 복리** 성장한 뒤 바로 영구성장으로 넘어간다. | `corporate_dcf.py:225-247`, `:813` | 고성장주는 과대, FCF 음수는 거절(단계 0: 73개). 다모다란 케이스의 감쇠 성장과 다르다(계획서 단계 2 표의 마지막 행). |
| 5 | 재무제표가 없으면 **티커 해시로 만든 지표**(`default_metrics`)로 5년 DCF와 비교표를 계산한다. 같은 로직이 프런트에도 복제되어 있다. | `corporate_metrics_service.py:110`, `apps/web/app/corporate/corporateUtils.ts` (~150행) | 측정이 아닌 숫자가 가치처럼 보인다. 적정가는 거절하고 의사결정 기록은 표시하지만, 기업분석·포트폴리오 화면은 구분 표시 여부 확인 필요. |
| 6 | 시뮬레이션 랩의 점프 확산은 **점프 보정항(−λk) 없이** 드리프트를 쓴다. | `simulation-core.ts`, `routes/monte_carlo.py:277` | 점프 평균이 음수라 시뮬레이션 평균 수익률이 입력한 기대수익률보다 낮게 나온다. 의도(점프는 추가 위험)라면 화면에 그렇게 밝혀야 한다. |
| 7 | 시뮬레이션 랩 기업 가치평가의 출구 PER 기본값이 **현재 PER**이고, EPS를 전부 배당처럼 할인해 더한 뒤 출구가치를 또 더한다. 마지막 해만 영구성장률을 쓴다. | `valuation-core.ts` | 현재가가 사실상 자기 자신을 정당화하는 구조. 단순 교육용 모형이라면 설명이 필요하다. |
| 8 | 무위험률이 상수 4.2%(실제 10년물을 읽지 않음), 상관 모델 Sharpe는 3%를 따로 쓴다. | `corporate_statement_metrics.py:32`, `investment_decision.py:72`, `correlation-core.ts` | 거시 신호 탭은 실제 10년물(DGS10)을 받는데 가치평가는 고정값. 금리가 크게 움직이면 어긋난다. |
| 9 | `POST /api/v1/monte-carlo/analyze`는 웹 코드에서 호출하는 곳이 없다(grep 기준). | `apps/api/routes/monte_carlo.py` | 브라우저 엔진과 별도로 유지되는 중복 구현. 삭제 여부 결정 필요(정리 대상, 자동 삭제 안 함). |
| 10 | 숫자가 없을 때 0을 돌려주는 곳: `calculate_dcf_implied_return`(가격 ≤ 0 → 0), 포트폴리오 베타(데이터 부족 → 0), 브리지 없을 때 비교표 암시수익률(주당가치 := 현재가 → 0). | `expected_return.py`, `core/maths.py:88`, `corporate_comparison.py:470` | "0%"는 실제 값처럼 읽힌다. 비교표는 `bridge_quality`로 구분하지만 베타 0은 구분이 없다. |
| 11 | 다모다란 적정가: 업종 미달 기업은 마진 차이의 절반만 따라잡고, 성장률은 회사·업종 평균에 25% 상한. 경기순환 업종은 최근 5년 업종 성장률을 그대로 쓴다. | `fair_value_case.py:107-116` | 단계 0 결과: 과소 72개(기술주), 과대 17개(금광 10개). 계획서 ④⑤에서 다룸. |
| 12 | 보수적 케이스는 매출을 10년 **일정 성장** `(1+g)^10`, 적정가는 1–5년 유지 후 감쇠. 하한선과 적정가의 성장 경로 모양이 다르다. | `conservative_case.py:254` vs `fair_value_case.py:76` | 의도된 차이일 수 있으나 "하한선"이 적정가보다 높게 나오는 경우의 원인이 될 수 있다. |
| 13 | 포트폴리오 변동성은 최근 **20개 종가**로 연환산한다. | `portfolio/page.tsx:653` | 표본이 작아 흔들림이 크다. 라벨에 기간이 없으면 1년 변동성으로 오해할 수 있다. |

## 17. 관련 문서

- 설계 명세: `docs/architecture/moneyview-quant-engine.md`, 금융 로직 SOP: `guideline/sop/finance-logic.md`
- 적정가 개선 계획: `docs/superpowers/specs/2026-11-01-fair-value-refusal-outlier-plan.md`
- 단계 0 측정 리포트: `docs/reports/2026-11-fair-value-audit.md`
- 거시 신호 규칙: `apps/api/services/signals/rules.yaml`, 리스크 규칙: `apps/api/services/risk/rules.yaml`
