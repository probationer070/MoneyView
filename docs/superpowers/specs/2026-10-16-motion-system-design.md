# 모션 시스템 설계

Oct 16, 2026 · 근거 코드는 `renewal` b833b21이다. 경로는 따로 적지 않으면 `apps/web/` 아래다.

## 배경과 목표

오너 요청(2026-10-16): "중요한 내용들을 표현하는 방식을 좀 애니메이션처럼 보여주고 싶어."
- 참고 자료는 `design-sample/img/`의 Heron AI 화면이다.
- 오너가 범위를 바로잡았다: 장식(격자 틀, 십자 표시, 거대한 제목)을 베끼는 일이 아니다. 부드럽고 세련된 움직임으로 핵심 수치를 보여 주는 일이다.

**시안:** https://claude.ai/artifact/VQTa4ALFoobTj4UCNZQTUa
- 오너 판정은 "좋은데"다.
- 첫 시안은 0.4초 숫자 트윈이었다. 오너는 "숫자 변화에 따른 애니메이션은 없는데?"라고 했다. 변동이 작으면 트윈은 보이지 않는다.
- 그래서 자릿수가 굴러가는 방식(오도미터)으로 바꿨고, 그것을 승인받았다.

**지금 상태**
- 앱에는 모션 규칙이 없다.
- `prefers-reduced-motion`을 처리하는 곳이 없다.
- Playwright도 움직임 줄이기 설정 없이 돈다. recharts는 기본 애니메이션을 켠 채로 돈다(`Sparkline`만 끔). ERROR-LOG의 recharts 오래된 좌표 문제가 그 결과다.
- 토큰에는 `duration`(fast 100, normal 200, slow 350ms)과 `easing`(default, enter, exit)만 있다.

**완료 상태**
- 여섯 가지 모션(§2)이 공용 컴포넌트와 토큰으로 존재한다.
- 시장 개요(`/`)가 그 컴포넌트로 움직인다. 시안과 같은 화면이다.
- 움직임 줄이기 설정에서는 값이 즉시 바뀌고 아무것도 이동하지 않는다.
- 기존 Playwright 스위트가 움직임 줄이기로 돌아 결과가 안정적이다. 모션 자체는 전용 스펙이 움직임을 켠 채로 검증한다.

**범위 밖**
- 샘플의 장식(격자 틀, `+` 표시, 눈금자, 종이 질감, 거대한 제목)
- 시장 개요 밖의 페이지 적용. 각 페이지의 한 화면 작업이 맡는다. Monte Carlo가 첫 사용처다.
- 차트 라이브러리 교체, 새 의존성(애니메이션 라이브러리 포함)

## 결정 사항

| # | 내용 | 결정한 사람 |
|---|---|---|
| MO-D1 | 장식이 아니라 움직임이다. | 오너 |
| MO-D2 | 시안의 여섯 모션을 채택한다. 숫자는 자릿수 굴러가기(오도미터)다. | 오너("좋은데") |
| MO-D3 | 새 라이브러리 없이 CSS와 Web Animations API로 만든다. | 내 판단(의존성과 번들을 늘리지 않음) |
| MO-D4 | 움직임은 의미 있는 변화에만 일어난다(§1). | 내 판단(시안 원칙 그대로) |
| MO-D5 | 기존 Playwright는 `reducedMotion: "reduce"`로 돈다. | 내 판단(테스트 안정성, recharts 좌표 문제 예방) |

## 1. 원칙

- **언제 움직이나:** 다음 네 경우뿐이다.
  - 패널의 첫 마운트
  - 탭 전환
  - 표시값이 실제로 바뀜. 같은 값으로 다시 불러온 경우는 움직이지 않는다.
  - 실행 완료
- **얼마나:** 0.15~0.7초. 시작은 빠르고 끝은 부드럽게 멈춘다.
- **값은 늘 읽을 수 있다:** 움직이는 중에도 숫자는 보이고, 스크린리더는 처음부터 최종값을 읽는다.
- **움직임 줄이기:** 운영체제 설정을 따른다. 값은 즉시 최종값이 되고, 이동·그리기·훑기·순차 지연은 모두 0이다.

## 2. 여섯 모션

| # | 모션 | 동작 | 첫 적용처(시장 개요) |
|---|---|---|---|
| 1 | 자릿수 굴러가기 | 표시 문자열을 오른쪽 정렬로 비교해 바뀐 글자만 굴린다. 오르면 위로, 내리면 아래로 굴린다. 오른쪽 끝 글자부터 45ms씩 늦게 시작한다. 굴러가는 동안 up/down 색을 띠고 끝나면 원래 색으로 돌아온다. 첫 진입은 같은 모양의 `0`들에서 출발하고 중립 색을 쓴다. | 카드 값, 1일·1개월 등락, 표 값, 스프레드 수치, 국면 줄의 개수 |
| 2 | 이전 → 이후 | 옛 값은 흐린 mono로 남고 취소선이 그어진다. 화살표가 들어오고 새 값은 #1로 굴러온다. 다음 변화나 탭 전환 때 지운다. | (시장 개요에는 없음. Monte Carlo 재실행이 첫 사용처) |
| 3 | 탭 표시 미끄러짐 | 선택 밑줄이 다음 탭의 위치와 폭으로 미끄러진다. | 공용 `Tabs`(모든 페이지) |
| 4 | 선으로 훑으며 드러내기 | 1px brand 선이 패널 위에서 아래로 지나간다. 그동안 패널 내용이 위에서부터 드러난다(clip). | 탭 전환 |
| 5 | 그려지기와 순차 등장 | 형제 요소가 8px 아래에서 올라오며 나타난다(순서당 지연). 스파크라인은 왼쪽에서 그려지고, 막대는 0에서 자란다. | 카드 14개, 스파크라인, 스프레드 막대 |
| 6 | 마우스 반응 | 카드 테두리가 진해지고 "상세 →"가 4px 밀려 나온다. 버튼의 `→`가 4px 움직인다. | 카드, `ActionButton` |

**값 갱신 강조(#1에 딸림):** 값이 바뀌면 그 칸의 바탕이 `up-soft`나 `down-soft`로 잠깐 물들었다가 0.6초에 걸쳐 사라진다.

## 3. 토큰

`tokens/moneyview.tokens.json`에 다음을 더한다(CLAUDE.md §10: 토큰을 먼저 제안한다). 기존 `duration.*`과 `easing.*`은 그대로 둔다.

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `duration.roll` | 600ms | #1 값 변화 |
| `duration.roll-enter` | 700ms | #1 첫 진입 |
| `duration.draw` | 700ms | #5 선 그리기 |
| `duration.scan` | 500ms | #4 |
| `duration.flash` | 600ms | 값 갱신 강조가 사라지는 시간 |
| `duration.stagger` | 40ms | #5 순서당 지연 |
| `duration.digit-stagger` | 45ms | #1 글자당 지연 |
| `easing.emphasized` | `cubic-bezier(0.2, 0, 0, 1)` | #1, #3, #5 |

## 4. 공용 단위

| 단위 | 계약 |
|---|---|
| `lib/motion.ts` `usePrefersReducedMotion(): boolean` | `matchMedia("(prefers-reduced-motion: reduce)")`를 구독한다. SSR과 첫 렌더에서는 `true`를 돌려 움직이지 않는다. |
| `lib/motion.ts` `odometerPlan(from: string \| null, to: string): Array<{ from: string; to: string; delayIndex: number }>` | 순수 함수. 오른쪽 정렬 비교 결과를 글자 단위로 낸다. 같은 글자는 `from === to`. `from === null`이면 `to`의 숫자를 `0`으로 바꾼 문자열에서 출발한다. `delayIndex`는 오른쪽 끝이 0이다. 예: `("7,744.1", "7,760.0")` → 바뀐 자리는 `4→6`(delay 3), `4→0`(delay 2), `1→0`(delay 0). |
| `components/ui/RollingNumber.tsx` | props `{ value: number \| null; format: (n: number) => string; direction?: "auto" \| "up" \| "down"; enter?: boolean; className?: string }`. `value`가 바뀔 때만 #1을 실행한다. `null`이면 `—`(`MISSING`)이다. 바깥 요소는 최종 문자열을 `aria-label`로 갖고, 움직이는 글자들은 `aria-hidden`이다. 움직임 줄이기에서는 최종 문자열만 렌더한다. |
| `components/ui/BeforeAfter.tsx` | props `{ previous: string \| null; current: ReactNode }`. `previous`가 있으면 #2를 그린다. |
| 공용 `Tabs` | 선택 밑줄을 한 요소로 두고 `transform`과 `width`로 옮긴다(#3). 화살표 키 탐색은 지금 그대로다. |
| `components/ui/ScanReveal.tsx` | props `{ trigger: string; children: ReactNode }`. `trigger`가 바뀌면 #4를 실행한다. |
| CSS 유틸리티 `mv-enter` | `--mv-i` 변수로 순서를 받는다. 쉬는 상태는 보이는 상태이고, 애니메이션은 거기서 출발만 한다(#5). |
| `Sparkline` | prop `draw?: boolean`. 마운트 때 선을 그린다. |
| `ActionButton`, 카드 | #6. CSS만 쓴다. |

**recharts:** 움직임 줄이기일 때 `isAnimationActive={false}`를 공용 설정(`lib/chartConfig.ts`)으로 넘긴다. 공유 표면이므로 전체 스위트를 돌린다.

## 5. 테스트

**전역 설정:** `playwright.config.ts`의 `use`에 `reducedMotion: "reduce"`를 넣는다. 기존 스펙은 이 설정에서 그대로 통과해야 한다. 바뀐 결과가 있으면 HARNESS 단계 3에 따라 목록을 만들어 승인받는다.

**새 테스트(변이 검증 필수)**

| 확인 내용 | 그 테스트를 실패시켜야 하는 변이 |
|---|---|
| `odometerPlan`(모델 스펙): 같은 글자 유지, 길이가 다른 문자열의 오른쪽 정렬, `null`이면 0에서 출발, `delayIndex`가 오른쪽부터 | 왼쪽 정렬, 지연 순서 뒤집기 |
| `motion.spec.ts`(`reducedMotion: "no-preference"`): 시장 카드 값이 바뀌는 동안 글자 창(`.dg` 등)이 존재하고, 끝나면 최종 문자열 하나만 남는다. | 굴리기를 끈다. 정리를 하지 않는다. |
| 같은 값으로 다시 렌더하면 굴리지 않는다. | 값 비교를 뺀다. |
| 움직임 줄이기에서는 첫 프레임부터 최종 문자열이고, 글자 창이 없다. | 설정 검사를 뺀다. |
| `aria-label`은 굴러가는 중에도 최종값이다. | 라벨을 중간값으로 바꾼다. |
| 탭 밑줄이 선택 탭의 `left`와 `width`에 맞는다(전환 뒤). | 위치 계산을 뺀다. |

## 6. 순서와 다른 작업과의 관계

1. **PR #70(시장 개요 확장)을 먼저 병합한다.** 이 작업의 첫 적용처가 #70이 고친 `SparklineCard`, `InstrumentsPanel`이다.
2. 토큰, `lib/motion.ts`, 공용 컴포넌트, Playwright 전역 설정을 만든다.
3. 시장 개요에 적용한다.
4. Monte Carlo 한 화면 작업(`docs/superpowers/specs/2026-10-16-monte-carlo-one-screen-design.md`, 브랜치 `feat/monte-carlo-one-screen`)이 이 컴포넌트를 쓴다. 특히 수치 줄에 #1, 재실행에 #2, 탭에 #3, 실행 완료에 #4를 쓴다. 그 스펙에 이 문서를 참조로 더한다.
