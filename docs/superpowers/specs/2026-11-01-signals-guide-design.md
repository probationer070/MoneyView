# Macro Signals: scenario names and a "how to read this screen" guide

Date: 2026-11-01 · Owner: probationer070 · Path: full (new shared component)

## 1. Intent

The owner opened Macro Signals and could not tell what A, B and C are. Nothing on the page
says it: the summary bar shows `A 35.0%`, the chart legend shows `A`, and the spec and
`docs/tabs/signals-tab.txt` leave C "not yet named". The table columns (direction, contribution
in %p), the four states and the eleven rules are not explained either.

This is phase 1 of "every tab explains itself". Phase 2 applies the same guide format to the
other ten tabs in a separate spec, after the owner has seen this one.

## 2. Decisions (owner, 2026-11-01)

| Decision | Choice |
|---|---|
| C's name | 급락·약세장 (en: Bear market). A 상승 (Upside), B 조정 (Correction). |
| Where explanations live | In the app (a collapsible guide under the page header) **and** in the docs |
| Order | Macro Signals first; the other tabs after the owner approves the format |

Why C is a bear market and not B's twin: its likelihood ratios grow most with high-yield spread
widening (1.8), a sticky 10Y (1.5) and "capex raised, stock fell" (1.5), and shrink most with
relief signals. That is a credit-stress decline that runs deeper and longer than B.

## 3. Goals / non-goals / anti-goals

- Goal: the owner can read every number on /signals without opening the docs.
- Goal: A, B and C carry their names wherever a probability is shown.
- Non-goal: changing any rule, threshold, likelihood ratio, prior or bound.
- Non-goal: per-rule descriptions in `rules.yaml` or the API. The text lives in i18n.
- Anti-goal: a guide that states a threshold number. Numbers already show in the "기준값" column,
  from the API. Prose numbers would drift the day `rules.yaml` changes. The guide may name the prior
  (35/45/20) and the bounds (5%–85%), because the probability section can't be read without them.
  A rules.yaml edit to those must update the guide; noted in the yaml header comment.
- Anti-goal: an open-by-default wall of text. The guide starts collapsed.

## 4. What changes

### 4.1 Shared component `PageGuide` (`apps/web/components/ui/PageGuide.tsx`)

A `<details>` panel, collapsed by default, placed directly under `PageHeader`.

```tsx
export function PageGuide({ children, testId = "page-guide" }: { children: ReactNode; testId?: string })
```

- `<details data-testid={testId} className="border border-[var(--line)] bg-[var(--surface-raised)]">`
- `<summary>` text `t("guide.summary")`: ko "이 화면 읽는 법", en "How to read this screen". `type-label`, `cursor-pointer`, `px-4 py-3`.
- Body: `border-t border-[var(--line)] p-4`, children as given.
- A `GuideSection({ title, children })` helper in the same file: `<h3 className="type-panel-title">` + body
  `type-body text-[var(--ink-secondary)]`, sections separated by `gap-4`.
- No state, no persistence, no motion. Tokens only (DESIGN.md).
- `PageGuide` is a new file under `components/ui/`, so the full suite runs (HARNESS test scope).

### 4.2 Scenario names

New i18n keys `signals.scenario.{a,b,c}`: ko `상승`, `조정`, `급락·약세장`; en `Upside`, `Correction`, `Bear market`.

| Place | Before | After |
|---|---|---|
| Summary bar, `prob-{s}` | `A 35.0% ▲ 5.0%p` | `A 상승 35.0% ▲ 5.0%p` (the name in `type-small`, the figure stays `type-mono`) |
| Summary bar, most likely | `가장 유력: B` | `가장 유력: B 조정`; the letter stays alone inside `data-testid="most-likely"`, the name is a sibling span |
| Trend chart legend and tooltip | `A` | `A 상승` (Line `name`) |
| Table contribution cell | `A +2.0 · B … · C …` | unchanged (space). The guide explains the letters. |
| Table direction cell | `A` / `B` | unchanged; the guide explains that a B-direction signal supports both B and C |

### 4.3 Guide content for /signals (Korean shown; English mirrors it)

Formal register (HARNESS). Final wording may be polished in implementation, but no claim may be added
that the code does not do.

1. **이 화면은** — 매주 미국 거시 지표(FRED) 8개 규칙과 직접 입력하는 3개 신호를 판정하고, 그 결과로
   S&P 500의 세 시나리오 확률을 계산합니다. 매매 신호가 아니라 거시 환경이 어느 쪽으로 기울었는지 보는 화면입니다.
2. **시나리오 A·B·C** —
   A 상승: 금리와 유가가 안정되고 고용이 버티며 S&P 500이 오르는 경우입니다.
   B 조정: 금리·물가 부담으로 S&P 500이 일시적으로 내렸다가 회복하는 경우입니다.
   C 급락·약세장: 신용 경색(하이일드 스프레드 확대)이 겹쳐 하락이 깊고 길어지는 경우입니다.
   세 확률의 합은 100%입니다.
3. **확률 계산** — 매주 기준 확률 A 35%, B 45%, C 20%에서 새로 계산하며 지난주 결과를 이어받지 않습니다.
   발동한 신호는 규칙에 정한 배율(우도비)만큼 각 시나리오를 키우거나 줄이고, 근접한 신호는 그 절반 강도로
   반영합니다. 어느 시나리오도 5% 아래나 85% 위로 가지 않습니다. 변화(%p)는 직전에 저장된 주와 비교한 값입니다.
4. **신호 표** — 방향: A는 상승을, B는 하락 쪽(조정과 급락)을 지지합니다. 상태: 발동(기준 충족, 전부 반영) ·
   근접(기준에 가까움, 절반 반영) · 미발동(반영 안 함) · 데이터 오래됨(최근 데이터가 없어 계산에서 뺌, 이유는
   이름 아래). 값·기준값: 이번 주 판정에 쓴 값과 발동 기준. 관측일: 값이 관측된 날짜이며 FRED는 며칠 늦게
   올라옵니다. 기여도: 이 신호를 빼고 계산했을 때와 비교해 A·B·C가 몇 %p 달라졌는지입니다.
5. **신호별 의미** — 11개 규칙 각각 한 줄, 숫자 없이. Keys `signals.guide.rules.<rule_id>`. Listed in
   `rules.yaml` order. Example: `b_hy_wide` — "투기등급 회사채의 국채 대비 금리 차가 벌어졌는지 봅니다.
   벌어지면 신용 위험이 커졌다는 뜻이라 급락(C) 쪽으로 가장 크게 움직입니다."
6. **추이 차트** — 최근 26주. 점선은 그 주에 규칙 파일이 바뀌었다는 표시이며, 앞뒤 주를 그대로 비교할 수 없습니다.
7. **수동 신호** — 자동으로 판정할 수 없는 세 신호를 직접 입력합니다. 입력하지 않은 주는 '미발동'이 아니라 계산에서
   빠집니다. 저장하면 이번 주 확률을 다시 계산하며, 이번 주 스냅샷이 아직 없으면 다음 실행에 반영됩니다.
   Each manual rule gets one line on when to mark it (capex: 빅테크가 설비투자 전망을 올렸는데 주가가 내린 경우 등).
8. **실행 시점** — 매주 토요일 08:51(KST) 이후 한 번 자동 실행되고, "지금 실행"으로 바로 돌릴 수 있습니다.

### 4.4 Docs

- `docs/tabs/signals-tab.txt`: replace "C (not yet named …)" with the three names; add a "How to read" section
  pointing at the guide. Also correct two stale lines it contains ("Korean labels are not shown yet",
  "The page's copy is English only (C11)"): the page has used `t()` with ko/en since the i18n work.
- `docs/USER-GUIDE.md`: a Macro Signals section with the same content as 4.3, shortened.
- `docs/design/MoneyView_Glossary.md`: rows for 상승 / 조정 / 급락·약세장 and 이 화면 읽는 법.
- ~~`rules.yaml` header comment~~ dropped at implementation: `rules_version` is the file's sha256, so even a comment
  would draw a false "rules changed" break on the trend chart. The reminder sits in `SignalsGuide.tsx` instead.

## 5. Output contract

| name | signature | returns | cases | example | side effects |
|---|---|---|---|---|---|
| `PageGuide` | `({ children, testId? }) => JSX` | `<details>` closed | normal: summary + children; empty children: summary + empty body (not used) | `<PageGuide><p>x</p></PageGuide>` → closed details, summary "이 화면 읽는 법" | DOM only, `data-testid="page-guide"` |
| `GuideSection` | `({ title: string, children }) => JSX` | `<section>` with h3 | n/a: static | title "시나리오 A·B·C" → h3 with that text | DOM only |
| `SummaryBar` (changed) | unchanged props | adds the scenario name next to each letter | snapshot null: unchanged "no snapshot" text | probs.b 0.5 → `prob-b` contains `B 조정` and `50.0%` | DOM only |
| `ProbabilityTrendChart` (changed) | unchanged props | legend `A 상승` / `B 조정` / `C 급락·약세장` | empty history: unchanged | — | DOM only |

## 6. Tests

New (`tests/e2e/signals-page.spec.ts`, new `test` blocks only):

| Test | Proves | Mutation that must make it fail |
|---|---|---|
| guide is closed by default and opens to the A/B/C definitions | the guide renders, starts closed, holds the scenario section | `open` set on `<details>`; scenario section removed |
| summary names each scenario (en and ko) | `prob-c` contains `C Bear market` / `C 급락·약세장` | name span removed from SummaryBar |
| most-likely letter stays alone | `most-likely` still `toHaveText("B")`, name beside it | name put inside the testid element |
| guide lists every rule in the snapshot | each `results[].rule_id` has a guide line | one `signals.guide.rules.*` key removed |

Existing-test change inventory: **none expected**. Current assertions use `toContainText` on `prob-*`
and `toHaveText("B")` on `most-likely`, which the design keeps. If implementation finds otherwise, stop
and bring the inventory to the owner.

Run: signals specs, `signals-model.spec.ts`, `readme-capture` (screenshot), then the full suite
(shared `components/ui/**` touched). `typecheck`, `lint`.

## 7. Left to the builder

- Exact one-line text for each rule and manual signal, within 4.3's rules (no thresholds, formal register).
- Whether `GuideSection` lists render as `<ul>` or paragraphs.

## 8. Phase 2 (not this spec)

The other ten tabs get a `PageGuide` with their own sections. One-screen routes (`/`, `/corporate`,
`/monte-carlo`, `/alerts`, `/detail`) must still fit 1280x720 with the guide closed; where the closed
summary row does not fit, the guide moves into the header's `actions` slot as a button. Decided per page then.

## Approval

Approved by the owner on 2026-11-02 ("1~3번 승인"), including the existing-test changes this spec lists.
