# 마켓 개요 한 화면 재구성 설계

Oct 16, 2026 · 브레인스토밍 결과, 오너가 설계 섹션 1~5를 승인. 근거 자료는 2026-10-15 제안서(커밋 f56e706 기준)이며, 7abbf74에서 다시 확인했다. 그 사이 바뀐 것은 `SparklineCard` 색 수정 하나다. 경로는 따로 적지 않으면 `apps/web/` 아래다.

## 배경과 목표

`/`(마켓 개요)는 1280×720에서 높이가 약 1,470px이다. 스프레드 5개가 실제로 그려지면 약 1,870px가 된다. 카드 10개(3열 × 4행, 932px)만으로도 쓸 수 있는 높이 632px를 넘기 때문에, 스타일 조정으로는 맞출 수 없고 배치를 바꿔야 한다.

모든 페이지 원칙(2026-10-14): 1280×720에서 페이지 스크롤이 없어야 하고, 작업 화면은 핵심 수치를 먼저 보이고 나머지는 탭으로 보낸다. 참조 구현은 `/corporate`(`CorporatePageTabs`, `useTabState`, 활성 패널만 마운트)다.

**완료 상태**

- 1280×720과 390×844에서 페이지 스크롤이 없다. 탭을 바꾼 뒤에도 같다.
- 첫 화면이 **"오늘 시장 어때?"** 에 답한다. 다음이 모두 첫 화면 안에 있다:
  - 한 줄 국면 판단
  - 종목 10개의 종가, 하루 등락, 30일 흐름
  - 테마 스프레드 최신 수치
- 스프레드 차트 5개는 별도 탭에서 전체 폭으로 보인다.
- 마켓 페이지와 상세 모달이 paper 토큰과 ko/en 카탈로그를 쓴다. 마켓 파일에서 lint 경고가 0개가 된다.

**범위 밖**

- 상세를 우측 서랍(drawer)으로 바꾸는 일. 이는 UI 정리 계획 Task 7이 맡고, 이번에는 모달을 유지한다.
- 카드에 데이터 날짜(`as_of`)를 표시하는 일. `MarketIndexQuote`에 그 필드가 없다.
- 관심종목이나 이벤트를 "/"로 가져오는 일. 이들은 `/portfolio`와 `/events`에 이미 자리가 있다.
- 국면 판단 규칙(문턱값, 신호 구성)을 바꾸는 일.

## 결정 사항(오너 답변, 2026-10-16)

| # | 질문 | 결정 |
|---|---|---|
| M-D1 | 첫 화면이 답할 질문 | 오늘 시장 어때? 종목 10개와 스프레드 수치, 국면 한 줄 |
| M-D2 | 스프레드 위치 | 페이지 탭 2개(종목 \| 스프레드). 첫 화면에 스프레드 수치 한 줄 |
| M-D3 | 헤더 국면 줄 | 넣는다. 백엔드에 `GET /api/market/regime`을 추가하고, 새 공식은 만들지 않는다. |
| M-D4 | 상세 | 모달 유지(서랍 전환은 UI 정리 Task 7) |
| M-D5 | 문구 | 3개 삭제(§3), 부제 수정. 부제를 확인하는 기존 테스트 2곳은 승인 편집으로 고친다. |

## 1. 배치(1280×720)

높이 예산:

| 항목 | 높이 |
|---|---|
| 뷰포트 | 720 |
| TopNav와 간격(`--main-pad-top`) | 64 |
| 아래 여백(`ONE_SCREEN_ROUTES`의 lg 24px) | 24 |
| **페이지 열** | **632** |
| 헤더(제목, 부제, 국면 줄) | 76 |
| 탭 바 | 53 |
| **탭 패널** | **503** |

- 콘텐츠 폭은 1216이다.
- `app/page.tsx`의 `py-6`은 없앤다.
- 페이지 열은 corporate와 같은 `h-[calc(100dvh - var(--main-pad-top) - var(--main-pad-bottom))] flex flex-col`을 쓴다. 탭 패널은 `min-h-0 flex-1`이고, 넘치는 내용은 패널 안에서 스크롤한다.

```
┌ TopNav 48 ─────────────────────────────────────────────────── EN|한 ┐
│ 마켓 개요 MARKET                 [위험선호 · 지수 3/4 상승 · 선호 4 / 회피 1] │ 76
│ 일별 종가 · 지수, 원자재, 환율, 암호화폐                                    │
├ [종목 INSTRUMENTS] [스프레드 SPREADS] ──────────────────────────────┤ 53
│ 종목 10개                                          [그래프|표]      │ 44
│ 카드 5열 × 2행 (각 약 233×150)                                      │ 312
│                                                                     │ 16
│ 테마 vs 기준 (90일)  AI 103.4 BOTZ/^GSPC · 사이버 98.1 CIBR/^GSPC · … │ 64
└─────────────────────────────────────────────────────────────────────┘
```

**탭 패널별 높이**

| 패널 | 높이 | 503 안에 드는가 |
|---|---|---|
| 종목, 그래프 보기 | 44 + 312 + 16 + 64 = 436 | 든다 |
| 종목, 표 보기 | 44 + 36 + 10 × 36 = 440 | 든다 |
| 스프레드 | 32 + 20 + 12 + 218 = 282 (5개가 1행) | 든다. 4열로 내려가면 512가 되며, 넘친 9px는 패널 안에서 스크롤한다. |

**390×844:** 구조는 같다. 탭 바는 가로로 스크롤하고, 카드는 1열이 되어 패널 안에서 스크롤한다. 페이지 자체는 스크롤하지 않는다.

## 2. 구성 요소

### 2.1 페이지 프레임

- `components/ui/oneScreenRoutes.ts`의 `ONE_SCREEN_ROUTES`에 `"/"`를 추가한다.
  - `isOneScreenRoute("/")`는 `"/"`일 때만 true여야 한다. 이 함수는 `startsWith("${route}/")`로 비교하므로, `"/"`의 접두사는 `"//"`가 되어 다른 경로와 맞지 않는다.
  - 단위 테스트에 두 경우를 넣는다: `"/"` → true, `"/portfolio"` → false.
- 새 `components/market/MarketPageTabs.tsx`를 만든다.
  - `useTabState("market.pageTab", "instruments")`를 쓴다.
  - 값은 `"instruments" | "spreads"`다. 저장된 값이 이 둘이 아니면 `"instruments"`로 돌아간다.
  - 활성 패널만 마운트한다.
  - 공용 `Tabs` 컴포넌트를 써서 화살표 키 탐색을 그대로 얻는다.

### 2.2 종목 탭

- 툴바 한 줄: 왼쪽에 "종목 10개"(실제 개수), 오른쪽에 `ViewToggle`(그래프 \| 표).
- 그래프 보기
  - `SparklineCard`를 5열 그리드에 높이 약 150으로 둔다.
  - 카드에서 "Detail available" 푸터를 뺀다. 기간 라벨은 남긴다.
  - 카드는 `article`이고 "Open detail for …" 버튼을 유지한다. 디자인 캡처의 마스크가 이 요소를 쓴다.
- 표 보기: "Source" 열을 뺀다. 이름, 티커, 현재가, 절대 등락, 등락%는 그대로 둔다.
- 수치 줄(§2.3)은 두 보기 모두에서 카드나 표 아래에 있다.

### 2.3 스프레드 수치 줄

**데이터와 표시**

- 데이터는 기존 `useMarketSpreads`(`GET /api/market/spreads`)다. 새 API는 없다.
- 쌍마다 이름, 최신값, 비교 대상 티커(`BOTZ/^GSPC` 형식), 창 길이(예: 90일)를 보인다. **티커는 항상 함께 적는다.**

**상태별 문구**(기존 `SpreadsSection`과 같은 기준)

| 상태 | 표시 |
|---|---|
| 불러오는 중 | 불러오는 중 문구 |
| 실패 | 실패 문구 |
| 쌍이 0개 | 빈 상태 문구 |
| 계산이 거부된 쌍 | 그 쌍 자리에 "이용 불가" |

**동작과 테스트 id**

- 수치(또는 그 줄)를 누르면 스프레드 탭으로 바뀐다.
- 테스트 id는 `spread-card-`로 시작하면 안 된다. `market-spreads.spec.ts`가 그 접두사로 차트 카드 수를 센다. `spread-figure-<id>`를 쓴다.

### 2.4 스프레드 탭

- 기존 `SpreadsSection`을 내용 변경 없이 옮긴다: 비교 대상 캡션, `EventFilter`, 140px 차트와 이벤트 선.
- 그리드의 최소 폭을 `minmax(240px, 1fr)`에서 `minmax(220px, 1fr)`로 줄여, 1216 폭에서 5개가 1행에 들어가게 한다.

### 2.5 국면 줄(헤더 오른쪽)

**백엔드:** `GET /api/market/regime`

- 응답은 기존 `MarketRegimeContext`(`apps/api/models/schema_parts/market.py:151`) 그대로다. 필드:

| 필드 | 형식 |
|---|---|
| `regime_label` | `"risk_on" \| "mixed" \| "risk_off" \| "unknown"` |
| `regime_summary` | str(영어) |
| `equity_advancers` | int |
| `equity_decliners` | int |
| `breadth_ratio` | float \| null |
| `equity_index_count` | int |
| `risk_on_signals` | int |
| `risk_off_signals` | int |
| `signal_count` | int |

- 값은 `MarketDataService._build_market_regime_context()`(`market_data.py:975`)가 만든다. 이 메서드는 private이므로 public 래퍼 `get_market_regime()`를 하나 두고 라우트는 래퍼를 부른다. 계산 로직은 바꾸지 않는다.
- 데이터가 부족하면 기존 규칙대로 `regime_label="unknown"`이 돌아온다. 이것은 오류가 아니라 200 응답이다.
- 이 메서드는 지수 10개 각각에 `get_stock_ohlcv(…, period="1mo", table="indices")`를 부른다. 캐시가 오래됐으면 그 자리에서 Yahoo로 다시 불러와 캐시에 쓴다(상세 모달과 같은 경로). 첫 화면은 SSR에서 `/market/indices`를 먼저 불러 캐시를 데우므로, 보통은 캐시에서 바로 응답한다.
- 예시:

```json
{"regime_label": "mixed", "regime_summary": "Breadth and cross-asset signals are mixed, …", "equity_advancers": 3, "equity_decliners": 1, "breadth_ratio": 0.75, "equity_index_count": 4, "risk_on_signals": 3, "risk_off_signals": 2, "signal_count": 5}
```

**프론트엔드**

- 새 훅 `lib/useMarketRegime.ts`를 둔다. 클라이언트에서 불러와야 테스트가 `page.route`로 응답을 바꿀 수 있다.
- 반환 형식: `{ status: "loading" | "ready" | "error"; regime: MarketRegimeContext | null }`

**화면 표시(ko/en 카탈로그)**

| 상태 | 표시 |
|---|---|
| `ready`, 라벨이 `unknown`이 아님 | 국면 라벨(위험선호 / 혼조 / 위험회피) · "지수 {equity_advancers}/{equity_index_count} 상승" · "선호 {risk_on_signals} / 회피 {risk_off_signals}" |
| `ready`, 라벨이 `unknown` 또는 `equity_index_count`가 0 | "국면 판단 불가" 한 문구만 |
| `loading` | 자리만 잡은 빈 줄. 높이가 변하지 않아야 한다. |
| `error` | "국면 불러오기 실패" |

- `regime_summary`(영어 문장)는 화면에도 툴팁에도 넣지 않는다.
- 라벨 색은 토큰 규칙을 따른다: 위험선호는 up, 위험회피는 down, 혼조와 판단 불가는 중립 잉크. 숫자는 mono 스타일이다.
- 지수 개수나 상승 수를 프론트엔드에서 계산하지 않는다. VIX를 지수 수에서 빼는 규칙(`EQUITY_INDEX_TICKERS`)은 백엔드에만 있다.

### 2.6 상세 모달

- 구조는 그대로 둔다(`ModalShell`). 모달은 오버레이라서 페이지 높이와 상관없다.
- §3에 따라 토큰과 카탈로그만 옮긴다.

## 3. 문구, 토큰, i18n

- **삭제:**
  - "Market Dashboard" 카드와 그 안내문(`MarketOverviewClient.tsx` 705–711)
  - 카드의 "Detail available"
  - 표의 "Source: Market snapshot API" 열
  - 그래프/표 토글은 없어지지 않고 툴바로 옮겨진다.
- **부제:** "Real-time snapshot of major global and domestic indices"를 "Daily closes · indices, commodities, FX, crypto" / "일별 종가 · 지수, 원자재, 환율, 암호화폐"로 바꾼다.
- **헤더 i18n:** `app/page.tsx`는 서버 컴포넌트이므로, `PageHeader`는 메시지 키를 받거나 클라이언트 래퍼에서 문구를 고른다. 어느 쪽인지는 계획에서 정하고, 기존 페이지들이 쓰는 방식을 따른다.
- **paper 전환:** `app/page.tsx`, `components/market/**`, `components/data/SparklineCard.tsx`(마켓 전용)를 paper 토큰과 en/ko 카탈로그로 옮긴다. 상세 모달의 문구도 포함한다. 이 작업으로 DS Task 13의 마켓 부분을 이 계획이 맡는다. DS 계획과 `guideline/sop/todo.md`에 그렇게 기록한다(corporate 때 f4fb3d5와 같은 방식).
- **완료 기준:** `npm run lint`에서 마켓 파일의 경고가 0이고, `design:baseline`의 마켓 경고 상한(295)이 0이 된다. 그러면 14b(마켓 오류 수준 전환, 폐기 별칭 제거)가 이 계획 바로 뒤에 진행될 수 있다.

## 4. 테스트

### 4.1 새 테스트

각 테스트는 CLAUDE.md §8에 따라 변이로 검증한다.

**`tests/e2e/market-one-screen.spec.ts`**

| 확인 내용 | 그 테스트를 실패시켜야 하는 변이 |
|---|---|
| 1280×720과 390×844에서 `scrollHeight ≤ innerHeight`. 두 탭 모두, 그래프와 표 보기 모두 | 패널에서 `min-h-0`을 뺀다. |
| 1280×720에서 헤더, 탭 바, 마지막 카드, 수치 줄의 아래 끝이 y ≤ 720. 마지막 카드는 개수 10을 가정하지 않고 요소로 찾는다(카드는 SSR이라 `page.route`로 바꿀 수 없다). | 그리드를 3열로 되돌린다. |
| 새로고침 뒤에도 탭이 기억된다. | 키를 바꾼다. |
| 수치 줄: 각 쌍에 비교 대상 티커가 보인다. 거부된 쌍은 "이용 불가", 불러오는 중·실패·빈 상태는 각 문구가 보인다(`page.route`로 응답을 바꾼다). | 티커를 빼고 그린다. 거부된 쌍을 숫자로 그린다. |
| 수치를 누르면 스프레드 탭이 열린다. | 클릭 핸들러를 제거한다. |
| 국면 줄: `ready`, `unknown`, `error`, `loading`(높이 불변) | `unknown`을 혼조로 그린다. 오류를 빈 줄로 그린다. |
| ko/en 전환에서 국면 라벨과 부제가 바뀐다. | 영어 문구를 직접 쓴다. |

**단위 테스트:** `isOneScreenRoute`에서 `"/"`는 true, `"/portfolio"`는 false

**pytest(`GET /api/market/regime`)**
- 응답 형식과 필드 타입이 맞다.
- 지수 bar가 없으면 `regime_label="unknown"`과 200을 돌려준다.
- `^VIX`의 bar가 있어도 `equity_index_count`에 들어가지 않는다.
- 테스트는 임시 DB와 가짜 bar 공급(네트워크 차단)으로 돌린다. 실제 DB `data/processed/moneyview.db`에 쓰지 않는다.

### 4.2 기존 테스트 편집(오너 승인 목록)

판정 조건은 바꾸지 않는다. 아래는 제안서 §4의 예상이다. 줄 번호는 계획의 첫 작업에서 HEAD 기준으로 다시 확인하고, 그 목록을 오너에게 보인 뒤 편집한다.

| 스펙 | 편집 |
|---|---|
| `market-spreads.spec.ts` | 8곳에 "스프레드 탭 열기" 한 줄을 넣는다. 모달만 쓰는 테스트 2개는 편집하지 않는다. |
| `event-filter.spec.ts` | 2곳. 헬퍼에서 스프레드 탭을 열고, 모달을 열기 전에 종목 탭으로 돌아간다. |
| `events-page.spec.ts` | 1곳. 스프레드 탭을 연다. |
| `market-overview.spec.ts`, `market-overview.live.spec.ts` | 부제 확인 문자열 2곳을 새 부제로 바꾼다. |
| 그 외 "/"를 방문하는 스펙 | 편집 없음. 계획에서 HEAD 기준으로 다시 확인한다. |

삭제된 "Source" 열이나 "Detail available"을 확인하는 기존 테스트가 있으면, 그것도 승인 목록에 넣는다.

### 4.3 게이트

- 작업마다 영향받는 테스트만 돌린다.
- 계획이 끝나면 Playwright 전체, `typecheck`, `test:unit`, `lint`, `design:baseline`, pytest 전체를 돌린다.
- 1280×720 디자인 캡처를 비교 검토한다.
- Playwright는 한 번에 하나만 돌린다(3101/8110 포트). 백엔드 작업은 pytest만 쓰므로 병렬로 진행할 수 있다.

## 5. 다른 계획과의 관계

- **DS Task 13:** 마켓 부분은 이 계획이 흡수한다(§3). Task 13에는 detail, news, events, dev가 남는다.
- **DS Task 14b:** 이 계획이 끝난 뒤 진행한다.
- **UI 정리 계획**(`docs/superpowers/plans/2026-10-13-ui-consolidation-tabs.md`): 이 계획의 첫 작업에서 문서만 고친다.
  - **Task 5:** 서랍의 aside는 `lg:sticky … lg:max-h-[calc(100vh - pads)]`를 쓴다. 이것은 페이지가 스크롤된다는 전제라서, 한 화면 페이지에서는 열 높이를 넘는다. 부모 높이가 정해져 있을 때는 `lg:self-stretch lg:max-h-full`을 쓰도록 바꾼다.
  - **Task 7:** "/"에서는 서랍이 페이지 전체가 아니라 탭 영역(탭 바와 패널)을 감싼다. 컨테이너 쿼리 열 수는 5열 그리드를 기준으로 다시 정한다. 탭을 바꾸면 서랍을 닫는다.
- **PR #67(시그널):** 이 브랜치와 겹치는 파일이 없다. 병합 순서는 #68 → #69 → #67이고, 이 브랜치는 #69 위에서 진행한다.

## 6. 산출물 계약(계획이 지켜야 할 것)

| 단위 | 계약 |
|---|---|
| `GET /api/market/regime` | 200, `MarketRegimeContext` JSON(§2.5). 데이터가 부족해도 200에 `"unknown"`. 부작용은 기존 상세 경로와 같다: 지수 bar 캐시가 오래됐으면 `get_stock_ohlcv`가 불러와 `indices` 캐시를 갱신한다. 새로 쓰는 테이블은 없다. |
| `MarketDataService.get_market_regime()` | `-> MarketRegimeContext`. `_build_market_regime_context()`를 그대로 부른다. 부작용은 위 행과 같다. |
| `useMarketRegime()` | `{ status: "loading" \| "ready" \| "error"; regime: MarketRegimeContext \| null }`. 마운트할 때 한 번 불러온다. |
| `MarketPageTabs` | props `{ instruments: ReactNode; spreads: ReactNode }`(계획에서 확정). `"market.pageTab"` 상태를 쓰고 활성 패널만 렌더링한다. |
| `SpreadFigureRow` | props `{ onOpenSpreads: () => void }`. 상태별 문구는 §2.3의 표. `data-testid="spread-figure-<id>"`. |
| `isOneScreenRoute("/")` | `true`. `"/x"` 형태에는 `false`. |
