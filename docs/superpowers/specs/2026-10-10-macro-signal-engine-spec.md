# MoneyView 신호 엔진 구현 명세

Oct 10, 2026 · @cl\_victor

## 목적과 범위

MoneyView에 주간 거시 신호 엔진을 추가한다. 이 엔진은 매주 FRED 데이터로 신호를 판정하고, S&P 500 시나리오 A/B/C 확률을 갱신해 SQLite에 스냅샷으로 남긴다. 이 문서는 Claude Code가 그대로 따라 구현할 수 있도록 작성한 작업 명세다.

**만들 것**

- 신호 규칙을 코드가 아닌 설정 파일(`rules.yaml`)로 정의하는 구조
- FRED 시계열을 받아 신호를 `triggered / near / not_triggered`로 판정하는 엔진
- 정성 신호(이란, capex 반응 등)를 사용자가 직접 입력하는 수동 입력 경로
- 발동된 신호로 A/B/C 확률을 갱신하는 휴리스틱 업데이터
- 주간 스냅샷 저장, 조회 API, Next.js 대시보드 페이지

**만들지 않을 것**

- 뉴스 자동 수집과 LLM 판정 (1차 범위 밖, 후속 과제)
- 매매 신호, 주문, 포트폴리오 자동 조정

**완료 기준**

- `POST /api/signals/run` 한 번으로 모든 자동 신호가 판정되고, 스냅샷 1건이 저장된다.
- 대시보드에서 신호 표, 시나리오 확률 추이, 수동 입력 패널이 동작한다.
- 신규 테스트가 모두 통과하고, 기존 엔진(DCF, Monte Carlo, Brinson-Fachler, VaR/ES) 테스트가 깨지지 않는다.
- 네트워크 없이 테스트가 돈다(FRED 응답은 fixture로 대체).

## 착수 전 확인 (Claude Code가 먼저 할 일)

코드를 쓰기 전에 저장소를 읽고 아래 항목을 확인한 뒤, 결과를 짧게 보고하고 시작한다. 명세와 실제 구조가 다르면 실제 구조를 따르고, 차이를 보고에 적는다.

1. **기존 FRED 클라이언트 위치와 인터페이스.** 재산업화 레짐 게이지가 쓰는 FRED 연동 코드를 찾아 재사용한다. 새 클라이언트를 만들지 않는다. API 키를 어디서 읽는지(환경변수, 설정 파일)도 확인한다.
2. **기존 시나리오 판별 모듈.** 복합 시나리오 식별 코드가 있으면 새 엔진이 그 옆에 들어갈지, 그 안으로 합쳐질지 판단해 제안한다.
3. **Damodaran vintage 파이프라인 패턴.** `parse_workbook` / `store_vintage`의 저장 방식(테이블 구조, vintage 키)을 확인하고 스냅샷 저장에 같은 패턴을 쓴다.
4. **DB 마이그레이션 방식.** Alembic 같은 도구를 쓰는지, 직접 스키마를 만드는지 확인하고 그 방식을 따른다.
5. **Python 버전 불일치.** `pyproject.toml`과 실제 런타임 버전이 다르다는 알려진 문제가 있다. 어느 쪽 기준으로 작업할지 먼저 확인하고, 새 코드는 두 버전 모두에서 돌도록 문법을 제한한다.
6. **Next.js `force-dynamic` 문제.** 정적 export와 충돌하는 기존 라우트를 확인한다. 새 대시보드는 서버 렌더링에 의존하지 않고, 클라이언트에서 FastAPI를 호출하는 방식으로 만든다.
7. **테스트 실행 명령.** 기존 테스트를 한 번 돌려 현재 상태(통과 개수)를 기록한다. 이후 회귀 확인의 기준이 된다.

## 신호 정의

자동 신호 8개, 수동 신호 3개로 시작한다. 아래 표가 `rules.yaml` 초기값이며, 임계값은 설정 파일에서만 바꾼다. 방향 B는 조정 시나리오를, A는 상승 시나리오를 지지한다.

| ID | 신호 | 방향 | 데이터 | 계산 | 발동 | 근접 |
| --- | --- | --- | --- | --- | --- | --- |
| `b_tnx_sticky` | 10년물 고착 | B | FRED `DGS10` | 최근 영업일 연속 일수 | 5.50% 이상 10영업일 연속 | 5.35% 이상, 또는 5.50% 이상 5영업일 |
| `b_core_cpi_hot` | 근원 CPI 과열 | B | FRED `CPILFESL` | 전월비 % (비반올림) | 0.25 이상 (발표 기준 0.3 이상) | 0.20 이상 |
| `b_hy_wide` | 하이일드 스프레드 확대 | B | FRED `BAMLH0A0HYM2` | 최근값 (단위 %) | 3.50 이상 | 3.20 이상 |
| `b_brent_spike` | 유가 급등 | B | FRED `DCOILBRENTEU` | 5영업일 평균 | 110 이상 | 105 이상 |
| `b_fed_hike` | 연준 추가 인상 | B | FRED `DFEDTARU` | 직전 스냅샷 대비 변화 | 상단 인상 | 해당 없음 (수동 보완) |
| `a_tnx_relief` | 10년물 안정 | A | FRED `DGS10` | 최근 영업일 연속 일수 | 5.00% 미만 5영업일 연속 | 5.15% 미만 |
| `a_brent_relief` | 유가 안정 | A | FRED `DCOILBRENTEU` | 5영업일 평균 | 90 미만 | 95 미만 |
| `a_labor_core` | 고용 반등 + 근원 둔화 | A | FRED `PAYEMS`, `CPILFESL` | 전월 증가 수(천 명), 근원 전월비 | 증가 100 이상 그리고 근원 0.25 미만 | 둘 중 하나만 충족 |
| `m_capex_reaction` | capex 상향인데 주가 하락 | B | 수동 | 사용자 입력 | 사용자가 발동 표시 | 사용자가 근접 표시 |
| `m_iran_strike` | 이란 공습 재개 | B | 수동 | 사용자 입력 | 사용자가 발동 표시 | 사용자가 근접 표시 |
| `m_breadth` | 시장 폭 개선 | A | 수동 (2차에 시세 API) | 사용자 입력 | 사용자가 발동 표시 | 사용자가 근접 표시 |

**판정 규칙 공통**

- 각 규칙은 `triggered`, `near`, `not_triggered`, `stale` 중 하나를 반환한다.
- 시계열의 최신 관측일이 허용 지연보다 오래되면 `stale`로 판정하고 확률 계산에서 뺀다. 허용 지연은 일간 시리즈 7일, 월간 시리즈 45일로 시작한다.
- 판정마다 사용한 값, 관측일, 임계값을 함께 반환한다. 대시보드에서 근거로 보여주기 위해서다.
- FRED는 결측일을 `.`로 돌려준다. 파싱 단계에서 제거하고, 연속 일수 계산은 실제 관측된 영업일만 센다.
- 브렌트 FRED 시리즈는 며칠 늦게 갱신된다. 관측일을 화면에 반드시 노출한다.

## 백엔드 구현 작업

새 코드는 백엔드 아래 `signals/` 패키지 하나에 모은다. 경로는 저장소 구조에 맞춰 조정한다.

```
signals/
  rules.yaml        # 신호 정의 (위 표)
  models.py         # pydantic 모델
  fetch.py          # 기존 FRED 클라이언트 래퍼
  rules.py          # 규칙 평가 함수
  engine.py         # 실행 흐름 조립
  scenario.py       # 확률 갱신
  store.py          # SQLite 읽기/쓰기
  api.py            # FastAPI 라우터
```

&#91;embedded content: 신호 엔진 데이터 흐름 · 구성 요소 11개\]

`engine.py`가 중심이다. 판정 결과와 수동 입력을 모아 `scenario.py`에 넘기고, `scenario.py`는 `rules.yaml`의 우도비로 확률을 계산한다.

- [ ] **`models.py`** — `Rule`, `Observation`(series\_id, date, value), `SignalResult`(rule\_id, state, value, observed\_at, threshold, note), `ScenarioProbs`(a, b, c), `Snapshot`을 정의한다. `rules.yaml`은 로드 시 pydantic으로 검증해, 오타 난 키나 없는 시리즈 ID는 시작 단계에서 실패시킨다.
- [ ] **`fetch.py`** — 기존 FRED 클라이언트를 감싸 `get_series(series_id, start) -> list[Observation]`을 제공한다. 같은 실행 안에서는 시리즈별로 한 번만 호출하도록 캐시한다. 원본 응답은 `fred_cache` 테이블에 저장해, 오프라인일 때 마지막 값으로 판정할 수 있게 한다.
- [ ] **`rules.py`** — 규칙 유형별 순수 함수를 만든다. 최소 유형은 `level_streak`(임계값 이상/미만 연속 일수), `rolling_mean`(N일 평균 비교), `mom_pct`(월간 전월비), `level_change`(직전 스냅샷 대비 변화), `compound`(두 조건의 AND/OR), `manual`이다. 함수는 DB나 네트워크를 건드리지 않는다.
- [ ] **`engine.py`** — `run(as_of: date) -> Snapshot`이 규칙 로드 → 필요한 시리즈 조회 → 규칙 평가 → 수동 입력 병합 → 확률 갱신 → 저장 순서로 실행한다. 한 시리즈 조회가 실패해도 전체를 멈추지 않고, 해당 규칙만 `stale`로 표시한다.
- [ ] **`scenario.py`** — 아래 '시나리오 확률 갱신 로직' 섹션대로 구현한다.
- [ ] **`store.py`** — 아래 스키마로 스냅샷과 수동 입력을 읽고 쓴다. 같은 주(ISO week)에 다시 실행하면 새 행을 만들지 않고 덮어쓴다.
- [ ] **`api.py`** — 아래 엔드포인트를 기존 FastAPI 앱에 라우터로 붙인다.

## 데이터 저장

테이블 4개를 추가한다. 스냅샷은 주 단위로 쌓아 확률 추이를 그릴 수 있게 하고, 각 판정에는 사용한 관측일을 남긴다.

```sql
CREATE TABLE signal_snapshots (
  id            INTEGER PRIMARY KEY,
  iso_week      TEXT NOT NULL UNIQUE,   -- 예: '2026-W42'
  run_at        TEXT NOT NULL,          -- ISO 8601, UTC
  rules_version TEXT NOT NULL,          -- rules.yaml 해시
  prob_a        REAL NOT NULL,
  prob_b        REAL NOT NULL,
  prob_c        REAL NOT NULL
);

CREATE TABLE signal_results (
  snapshot_id   INTEGER NOT NULL REFERENCES signal_snapshots(id) ON DELETE CASCADE,
  rule_id       TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('triggered','near','not_triggered','stale')),
  value         REAL,
  observed_at   TEXT,                   -- 판정에 쓴 최신 관측일
  threshold     REAL,
  note          TEXT,
  PRIMARY KEY (snapshot_id, rule_id)
);

CREATE TABLE signal_manual_inputs (
  rule_id       TEXT NOT NULL,
  iso_week      TEXT NOT NULL,
  state         TEXT NOT NULL CHECK (state IN ('triggered','near','not_triggered')),
  note          TEXT,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (rule_id, iso_week)
);

CREATE TABLE fred_cache (
  series_id     TEXT NOT NULL,
  obs_date      TEXT NOT NULL,
  value         REAL NOT NULL,
  fetched_at    TEXT NOT NULL,
  PRIMARY KEY (series_id, obs_date)
);
```

- `rules_version`은 `rules.yaml` 내용의 해시다. 임계값을 바꾼 주와 안 바꾼 주를 추이 그래프에서 구분하기 위해 남긴다.
- 수동 입력이 없는 주에는 수동 신호를 `not_triggered`로 보지 않고 결과에서 뺀다. 입력하지 않은 것을 '아님'으로 처리하면 확률이 조용히 왜곡된다.

## 시나리오 확률 갱신 로직

매주 고정된 기준 확률(A 35%, B 45%, C 20%)에서 다시 계산한다. 지난주 결과에 이어 곱하지 않는다. 이어 곱하면 같은 신호가 몇 주째 켜져 있을 때 그 신호가 매주 중복으로 반영돼 확률이 한쪽으로 끝없이 쏠린다.

```latex
P(s \mid \text{signals}) \propto P_0(s) \times \prod_{i \in \text{active}} LR_i(s)^{w_i}
```

- s는 A, B, C 중 하나, P₀는 기준 확률이다.
- LRᵢ(s)는 신호 i가 발동했을 때 시나리오 s의 우도비다. `rules.yaml`의 각 규칙에 `lr: {a, b, c}`로 둔다.
- wᵢ는 발동이면 1, 근접이면 0.5, 미발동·stale이면 0이다.
- 계산 후 정규화하고, 각 확률을 5%\~85%로 자른 뒤 다시 정규화한다. 신호 몇 개로 한 시나리오가 0%나 100%가 되는 것을 막기 위해서다.

**우도비 초기값** (주관적 값이며 설정 파일에서 조정)

| 규칙 | A | B | C |
| --- | --- | --- | --- |
| `b_tnx_sticky` | 0.7 | 1.2 | 1.5 |
| `b_core_cpi_hot` | 0.8 | 1.2 | 1.2 |
| `b_hy_wide` | 0.6 | 1.1 | 1.8 |
| `b_brent_spike` | 0.7 | 1.2 | 1.4 |
| `b_fed_hike` | 0.8 | 1.2 | 1.2 |
| `m_capex_reaction` | 0.7 | 1.2 | 1.5 |
| `m_iran_strike` | 0.7 | 1.3 | 1.3 |
| `a_tnx_relief` | 1.5 | 0.9 | 0.6 |
| `a_brent_relief` | 1.4 | 0.9 | 0.7 |
| `a_labor_core` | 1.3 | 0.9 | 0.7 |
| `m_breadth` | 1.4 | 0.9 | 0.7 |

**함께 반환할 것**

- 시나리오별 최종 확률
- 신호별 기여도: 해당 신호를 뺐을 때 확률이 얼마나 달라지는지. 대시보드에서 "이번 주 B가 오른 이유"를 보여주는 데 쓴다.

**UI에 명시할 문구**: 이 확률은 통계 모델의 추정치가 아니라, 주관적 우도비로 만든 휴리스틱이다.

## 스케줄링과 API 엔드포인트

데스크톱 앱은 항상 켜져 있지 않으므로, 정해진 시각 실행보다 "앱을 열었을 때 밀린 주를 따라잡는" 방식을 기본으로 한다.

**실행 방식**

1. 백엔드 시작 시, 이번 ISO 주의 스냅샷이 없으면 자동으로 `run()`을 실행한다.
2. 앱이 켜져 있는 동안에는 APScheduler로 매주 토요일 08:51(Asia/Seoul)에 실행한다. 미국 금요일 장 마감 뒤라 한 주 데이터가 반영된다.
3. 사용자는 언제든 대시보드의 "지금 실행" 버튼으로 수동 실행할 수 있다.
4. 같은 주에 여러 번 실행해도 스냅샷은 한 건만 남는다(덮어쓰기).

**엔드포인트**

| 메서드 | 경로 | 하는 일 |
| --- | --- | --- |
| `POST` | `/api/signals/run` | 이번 주 판정을 실행하고 스냅샷을 반환 |
| `GET` | `/api/signals/latest` | 최신 스냅샷(신호 결과 + 확률 + 기여도) |
| `GET` | `/api/signals/history?weeks=26` | 주차별 확률 추이 |
| `GET` | `/api/signals/rules` | 현재 규칙과 임계값, 우도비 |
| `PUT` | `/api/signals/manual/{rule_id}` | 이번 주 수동 신호 입력 (`state`, `note`) |

- FRED API 키가 없거나 호출이 실패하면 `run`은 500이 아니라 200으로 응답하고, 실패한 규칙을 `stale`로 표시한다. 응답에 실패 사유 목록을 담는다.
- 응답 시각은 모두 UTC ISO 8601로 주고, 표시는 프론트에서 현지 시각으로 바꾼다.

## 프론트엔드 화면

Next.js에 `/signals` 페이지 하나를 추가한다. 데이터는 모두 클라이언트 컴포넌트에서 FastAPI를 호출해 가져온다. `force-dynamic`이나 서버 전용 데이터 함수는 쓰지 않는다.

화면은 위에서 아래로 네 구역이다.

1. **요약 줄** — 이번 주 가장 유력한 시나리오, A/B/C 확률, 지난주 대비 변화(▲▼ %p), 마지막 실행 시각, "지금 실행" 버튼.
2. **신호 판정 표** — 신호, 방향(A/B), 상태, 현재값, 임계값, 관측일, 기여도. 상태는 색 대신 텍스트 라벨을 함께 표시한다(발동 / 근접 / 미발동 / 데이터 지연). 관측일이 오래된 행은 흐리게 표시한다.
3. **확률 추이 차트** — 최근 26주 A/B/C 확률 선 차트. `rules_version`이 바뀐 주에 세로 점선을 그어, 확률 변화가 시장 때문인지 규칙 변경 때문인지 구분되게 한다. 차트 라이브러리는 저장소에 이미 있는 것을 쓴다.
4. **수동 입력 패널** — 수동 신호 3개에 대해 상태 선택(발동 / 근접 / 미발동)과 메모 입력. 저장하면 `PUT` 후 확률을 다시 계산해 요약 줄을 갱신한다.

페이지 하단에 "이 확률은 주관적 우도비로 만든 휴리스틱이며 투자 권유가 아니다"라는 문구를 고정으로 둔다.

## 테스트 계획과 수용 기준

테스트는 네트워크 없이 돈다. FRED 응답은 `tests/fixtures/fred/<series_id>.json`에 실제 응답 형식 그대로 저장해 쓴다.

**규칙 단위 테스트** (`rules.py`)

- [ ] `level_streak`: 5.51%가 10영업일 연속이면 발동, 9영업일이면 근접, 중간에 결측 `.`이 끼어도 연속 일수가 끊기지 않는다.
- [ ] `mom_pct`: 근원 CPI 전월비 0.249는 미발동·근접, 0.250은 발동(경계값).
- [ ] `rolling_mean`: 5영업일 평균이 정확히 110.0이면 발동, 109.99면 근접.
- [ ] `compound`: 고용·근원 조건이 둘 다 맞으면 발동, 하나만 맞으면 근접, 둘 다 아니면 미발동.
- [ ] 최신 관측일이 허용 지연을 넘으면 `stale`.

**확률 테스트** (`scenario.py`)

- [ ] 발동 신호가 없으면 결과가 기준 확률(35/45/20)과 같다.
- [ ] 결과의 합은 항상 1.0(허용 오차 1e-9)이다.
- [ ] 모든 B 신호를 발동시켜도 어떤 시나리오도 85%를 넘거나 5% 아래로 가지 않는다.
- [ ] 근접(w=0.5)의 효과가 발동(w=1)보다 작다.
- [ ] 같은 신호 상태로 두 주 연속 실행해도 확률이 같다(이어 곱하지 않음을 확인).

**통합 테스트** (`engine.py`, `api.py`)

- [ ] fixture로 `POST /api/signals/run` 실행 → 스냅샷 1건, 신호 결과 11건 저장.
- [ ] 같은 주에 두 번 실행해도 스냅샷은 1건.
- [ ] 한 시리즈 fixture를 빼면 해당 규칙만 `stale`이고 응답은 200.
- [ ] 수동 입력이 없는 주에는 수동 신호가 확률 계산에서 빠진다.
- [ ] `rules.yaml`에 없는 시리즈 ID를 넣으면 앱 시작 단계에서 검증 오류가 난다.

**회귀**

- [ ] 착수 전 기록한 기존 테스트 통과 개수가 그대로 유지된다.

## 작업 순서와 주의점

단계마다 멈추고 결과를 보고한 뒤 다음 단계로 간다. 한 번에 전부 만들지 않는다.

1. **조사 보고** — '착수 전 확인' 7개 항목의 결과와, 명세와 다른 점을 보고한다. 코드는 아직 쓰지 않는다.
2. **규칙과 모델** — `rules.yaml`, `models.py`, `rules.py`와 규칙 단위 테스트. 테스트 통과를 확인한다.
3. **확률** — `scenario.py`와 확률 테스트.
4. **저장과 실행** — 스키마 추가, `store.py`, `fetch.py`, `engine.py`와 통합 테스트.
5. **API와 스케줄** — `api.py`, 시작 시 따라잡기 실행, APScheduler 등록.
6. **대시보드** — `/signals` 페이지. 실제 FRED 키로 한 번 실행해 화면을 확인한다.
7. **마무리** — 전체 테스트, 회귀 확인, 변경 파일 목록과 남은 과제 보고.

**주의점**

- 기존 DCF 엔진의 "시장가 앵커 스칼라" 문제처럼, 결과를 그럴듯하게 맞추려고 값을 하드코딩하지 않는다. 임계값과 우도비는 전부 `rules.yaml`에서만 온다.
- FRED API 키를 코드나 저장소에 넣지 않는다. 기존 방식대로 환경변수나 설정에서 읽는다.
- 이번 범위에 뉴스 수집, LLM 호출, 외부 시세 API는 넣지 않는다. 필요해 보이면 구현하지 말고 후속 과제로 제안한다.
- 기존 테스트를 고쳐서 통과시키지 않는다. 기존 테스트가 깨지면 멈추고 보고한다.

**Claude Code에 붙여넣을 시작 지시문**

```markdown
첨부한 "MoneyView 신호 엔진 구현 명세"대로 작업해줘.
먼저 '착수 전 확인' 7개 항목만 조사해서 보고하고, 코드는 내가 확인한 다음에 시작해.
이후에도 '작업 순서'의 단계마다 멈추고 결과를 보고해줘.
명세와 저장소 구조가 다르면 저장소를 따르고, 다른 점을 알려줘.
```

## 구현 계획에서 확정한 수정 사항 (2026-10-12)

| # | Spec says | Problem (how verified) | This plan does |
|---|---|---|---|
| C1 | Clip each probability to 5–85%, then renormalize | Renormalizing after the clip pushes values back out of bounds. When all 7 B signals fire, the result is A = 4.8%, which fails the spec's own "never below 5%" test (computed with the spec's LRs). | `bounded_normalize`: pin the out-of-bound values at the bound and spread the remaining mass over the rest in proportion, repeating until every value is in bounds. |
| C2 | Monthly staleness 45 days, daily 7 days | FRED dates a monthly observation on the 1st, and CPI is published about 6 weeks later. On 2026-10-12 the newest CPI observation is 2026-08-01, 72 days old. Brent (`DCOILBRENTEU`) is updated weekly, so it is often more than 7 days old on a Saturday. | Each rule sets its own `max_age_days`: daily 7, Brent 14, monthly 80. |
| C3 | `b_fed_hike` compares against the previous snapshot | The first run has no previous snapshot, and comparing against one makes the rule read the DB, so it is no longer pure. | `level_change` compares the latest value with the series' own value `lookback_days: 7` before `as_of`. |
| C4 | Integration tests say both "11 results stored" and "a week without manual input leaves manual signals out" | Both cannot hold for the same fixture. | Two tests: with 3 manual inputs, 11 results; with none, 8 results. |
| C5 | `mom_pct` boundary: 0.250 must trigger | `(100.25/100 - 1) * 100 == 0.24999999999999467` in float. The boundary test fails without rounding (checked in Python). | Percent changes and means are rounded to 9 places before comparison. |
| C6 | Endpoints at `/api/signals/*` | Every router in this repo is mounted at `/api/v1/*`. | `/api/v1/signals/*`. |
| C7 | APScheduler | It is not installed. The app already runs background loops in `lifespan` with asyncio. | An asyncio loop checks once an hour whether a run is due. One function covers both the catch-up at startup and the Saturday 08:51 KST run. No new dependency. |
| C8 | Reuse the FRED client as-is | `FREDCollector.fetch_indicator` returns `[]` on every error (so the caller cannot tell a failure from no data), has no timeout, and logs the raw exception. A requests exception message contains the full URL, API key included. | Add `fetch_observations()` and `FredFetchError` to the same class. The new method raises, uses a timeout and redacts the key. `fetch_indicator` is left alone. |
| C9 | `signal_results` has no contribution columns | `GET /latest` must return the per-signal contributions from the run. Recomputing them later with a since-edited `rules.yaml` would show numbers the run never produced. | `signal_results` gains `contrib_a`, `contrib_b`, `contrib_c`. |
| C10 | `compound` supports AND/OR | Only AND is used, by `a_labor_core`. | Only "all conditions" is implemented. OR waits until a rule needs it (YAGNI). |
| C11 | Status labels in Korean (발동 / 근접 / 미발동 / 데이터 지연) | The app's UI is English today. The owner decided on a bilingual UI, delivered by the design-system plan. | `rules.yaml` labels carry both `ko` and `en`, and the API returns both. The page's own strings sit in one `copy.ts` in English, which the design-system plan's i18n task moves into the message catalogs. |
