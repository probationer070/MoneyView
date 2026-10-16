# MoneyView 디자인 시스템 정형화 계획서

Oct 12, 2026 · @cl\_victor

## 배경과 목표

MoneyView의 색·글자 크기·간격·컴포넌트 규격을 하나의 토큰 소스로 고정해, Claude Code나 Claude Design이 화면을 만들 때 임의로 값을 고르는 여지를 없앤다. 가이드의 핵심 원칙(AI가 결정할 영역을 최소화)을 그대로 따르되, MoneyView가 마케팅 웹사이트가 아니라 데이터 밀도가 높은 데스크톱 금융 분석 앱이라는 점에 맞춰 보정한다.

완료되면 다음 상태가 된다.

- 토큰 원본은 리포 안의 파일 하나(`tokens/*.tokens.json`, W3C DTCG 형식)뿐이다.
- CSS 변수, Tailwind 테마, Recharts 차트 색이 모두 이 원본에서 생성된다.
- 화면 코드에 하드코딩된 HEX·px 값이 없다(린트로 검사).
- 리포 루트의 `DESIGN.md`를 Claude Code가 읽고, 새 화면도 토큰만 써서 만든다.

범위 밖: 기능 변경, 화면 정보구조(IA) 전면 개편. 이번 작업은 시각 규칙의 정형화에 한정한다.

## 가이드 요약과 MoneyView 보정

가이드의 3단계 순서(레퍼런스 → 토큰·디자인 시스템 → 한글 카피)는 그대로 쓴다. 다만 가이드는 마케팅 웹사이트를 전제로 쓰였기 때문에, 단계마다 아래처럼 보정한다. 그리고 가이드에 없는 0단계(현재 상태 진단)를 앞에 붙인다.

| 단계 | 가이드 내용 | MoneyView 보정 |
| --- | --- | --- |
| 0. 현황 진단 | (없음) | 지금 앱에 흩어진 색·크기·간격 값을 먼저 세어 기준선을 만든다. 개선 여부를 숫자로 확인하기 위해서다. |
| 1. 레퍼런스 | Awwwards 등에서 목적에 맞는 사이트 선정. 스크린샷 업로드 금지 | 랜딩 페이지가 아니라 **제품 내부 화면**(대시보드, 표, 차트)이 좋은 곳을 고른다. 마케팅 사이트의 토큰은 큰 히어로 문구 위주라 표·차트 규칙이 거의 안 나온다. |
| 2. 토큰·시스템 | Dembrandt로 토큰 추출 → Claude Design에서 디자인 시스템 생성 | 추출본은 출발점일 뿐이다. 금융 앱에 필요한 의미 토큰(상승/하락, 차트 팔레트, 숫자 표기)을 직접 추가하고, 원본은 리포의 토큰 파일로 둔다. |
| 3. 한글 카피 | 텍스트를 익스포트해 GPT로 다듬고 재반영 | 마케팅 카피보다 **용어 정확성과 일관성**이 우선이다. 금융 용어집을 먼저 만들고, LLM 교정은 그 용어집을 기준으로 돌린다. |

가이드 내용 중 고쳐 둘 사실 두 가지:

- 영상의 "댐브란트(Dambrandt)"는 실제로는 **Dembrandt**(npm 패키지 `dembrandt`, MIT 라이선스)다.
- 설치 명령도 `dambrandt install`이 아니다. `npm install -g dembrandt` 후 `dembrandt install-browser`로 Chromium을 한 번 받아야 하며, Node.js 18 이상이 필요하다. 자세한 명령은 2단계에 정리했다.

## 0단계: 현황 진단

토큰을 만들기 전에 지금 앱에 고유한 값이 몇 개 쓰이는지 센다. 이 숫자가 정형화 전후를 비교하는 기준선이 된다.

1. **스타일링 방식 확인**: Tailwind 사용 여부와 버전, `globals.css`, CSS Modules, shadcn/ui 같은 컴포넌트 라이브러리 사용 여부를 정리한다. 토큰을 어디에 연결할지가 여기서 정해진다.
2. **하드코딩 값 수집**: 프론트엔드 코드에서 HEX/rgb 색, px 글자 크기, 임의 간격(Tailwind라면 `p-[13px]` 같은 대괄호 값), Recharts의 `stroke`/`fill` 색 문자열을 검색해 목록으로 만든다.
3. **실행 중인 앱에 Dembrandt 돌려보기**: 개발 서버를 띄운 뒤 `dembrandt http://localhost:3000 --save-output --crawl 5`로 현재 상태를 추출한다. 공식 문서에 localhost 지원은 명시돼 있지 않으니 먼저 시도해 보고, 안 되면 2번 결과만 쓴다.
4. **주요 화면 캡처**: 포트폴리오, DCF/몬테카를로, 매크로 지표 화면을 캡처해 둔다. 레퍼런스로 쓰는 것이 아니라 전후 비교용이다.

기준선 표(진단 후 채움):

| 항목 | 현재 고유 값 개수 | 목표 |
| --- | --- | --- |
| 색상 |  | 의미 토큰으로만 참조 |
| 글자 크기 |  | 6\~8단계 스케일 |
| 간격 |  | 4px 기반 8\~10단계 |
| 모서리 반경 |  | 3\~4단계 |
| 그림자 |  | 2\~3단계 |

## 1단계: 레퍼런스 선정

주 레퍼런스 1개와 보조 레퍼런스 최대 1개만 고른다. 여러 곳의 토큰을 섞으면 무엇을 따를지 다시 AI가 판단하게 되어, 가이드가 피하려던 문제가 되돌아온다.

**선정 기준** (후보마다 1\~5점):

| 기준 | 확인 방법 | 비중 |
| --- | --- | --- |
| 데이터 밀도 | 한 화면에 표·차트·수치가 많아도 읽히는가 | 높음 |
| 숫자 가독성 | 표의 숫자 자릿수가 세로로 정렬되는가(고정폭 숫자) | 높음 |
| 차트 색 체계 | 여러 계열을 구분하는 색이 일관되게 정의돼 있는가 | 높음 |
| 다크 모드 | 라이트/다크 둘 다 완성도가 있는가 | 중간 |
| 한글 표시 | 한글 폰트와 줄간격이 자연스러운가 | 중간 |
| 추출 가능성 | 공개 페이지에서 제품 화면이 보이는가 | 중간 |

**후보 유형**: 투자·리서치 터미널, 핀테크 대시보드, 데이터 분석 SaaS의 제품 화면. 랜딩 페이지만 화려하고 실제 앱 화면이 공개되지 않은 곳은 제외한다.

**주의할 점**

- 많은 제품 화면은 로그인 뒤에 있다. 본인 계정으로 볼 수 있는 화면이면 `--login`으로 로그인한 뒤 `--save-storage-state`로 세션을 저장해 재사용할 수 있다. 추출 전에 해당 사이트 약관을 확인한다.
- 가져오는 것은 간격·크기·대비 같은 **구조 규칙**이다. 레퍼런스의 브랜드 색과 로고는 그대로 쓰지 않고 MoneyView 고유 색으로 바꾼다.

## 2단계: 토큰 추출과 디자인 시스템 구축

토큰 원본은 리포 안의 DTCG 파일 하나로 두고, 나머지(CSS 변수, Tailwind, 차트 색, DESIGN.md, Claude 디자인 시스템)는 모두 여기서 파생시킨다. 원본이 둘이 되면 어느 쪽이 맞는지 다시 판단해야 하기 때문이다.

&#91;embedded content: 토큰 파이프라인 · 입력 3개, 원본 1개, 파생물 4개\]

레퍼런스 추출본과 직접 정의한 금융 토큰이 원본 하나로 합쳐지고, 코드·문서·Claude 디자인 시스템·검사는 모두 그 원본에서 생성한다.

### 추출 명령

```bash
npm install -g dembrandt
dembrandt install-browser          # 최초 1회, Chromium 설치

# 주 레퍼런스: 여러 페이지 병합 + DTCG + DESIGN.md
dembrandt <레퍼런스 URL> --crawl 5 --save-output --dtcg --design-md

# 다크 모드와 대비 점검
dembrandt <레퍼런스 URL> --dark-mode --save-output
dembrandt <레퍼런스 URL> --wcag
```

결과 JSON은 `output/<도메인>/`에 저장된다. Tailwind v4를 쓴다면 `--tailwind`로 `@theme` CSS를, shadcn/ui를 쓴다면 `--shadcn`으로 테마를 바로 뽑을 수 있다.

### 토큰 3계층

추출본은 그대로 쓰지 않고 3계층으로 다시 정리한다. 화면 코드는 2·3계층만 참조한다.

1. **원시 토큰**: 회색 단계, 파랑 단계, 글자 크기 단계, 4px 간격 단계 등 값 자체. 레퍼런스 추출본에서 가져온다.
2. **의미 토큰**: `bg.surface`, `text.primary`, `border.subtle`, `accent`처럼 용도로 이름 붙인 토큰. 금융 앱용 `value.gain`, `value.loss`, `chart.series.1~8`, `chart.band`(몬테카를로 구간)를 여기 추가한다.
3. **컴포넌트 토큰**: `table.row-height`, `card.radius`, `button.height` 등 컴포넌트 규격.

```json
{
  "value": {
    "gain": { "$type": "color", "$value": "{color.red.600}" },
    "loss": { "$type": "color", "$value": "{color.blue.600}" }
  },
  "chart": {
    "series": {
      "1": { "$type": "color", "$value": "{color.blue.500}" },
      "2": { "$type": "color", "$value": "{color.amber.500}" }
    },
    "band": { "$type": "color", "$value": "{color.blue.500}", "$description": "몬테카를로 신뢰구간, 투명도 0.15로 사용" }
  },
  "table": {
    "row-height": { "$type": "dimension", "$value": "32px" }
  }
}
```

(값은 예시. 상승/하락 색은 7장에서 정한다.)

### 코드 연결

- **빌드**: Style Dictionary로 토큰 파일 → `tokens.css`(라이트/다크 CSS 변수) + Tailwind 테마 + `tokens.ts`(타입 있는 상수)를 생성한다.
- **차트**: Recharts는 SVG로 그리므로 `fill`/`stroke`에 `var(--chart-series-1)` 문자열을 그대로 넣을 수 있다. 차트마다 색을 하드코딩하던 부분을 이걸로 바꾼다.
- **폰트**: Tauri 앱은 오프라인에서도 동작해야 하므로 웹폰트 CDN 대신 폰트 파일을 프로젝트에 넣어 로컬로 불러온다. 표의 숫자 정렬을 위해 고정폭 숫자(`font-variant-numeric: tabular-nums`)를 지원하는 한글 폰트인지 확인한다.

### Claude 쪽 연결

- **Claude 디자인 시스템**: 정리된 토큰으로 Claude의 Design System 아티팩트를 만들고 기본값으로 지정한다. 이후 화면 시안을 Claude에서 만들 때 자동으로 이 기준을 쓴다. 지금 계정에는 아직 만든 디자인 시스템이 없다.
- **DESIGN.md**: `--design-md` 결과를 출발점으로, 레퍼런스 고유 내용을 MoneyView 토큰으로 바꿔 리포 루트에 둔다.
- **CLAUDE.md 규칙**: "색·간격·글자 크기는 토큰에 정의된 값만 쓴다. 새 값이 필요하면 코드를 고치기 전에 토큰 추가를 먼저 제안한다."
- **Dembrandt MCP**: Claude Code에서 직접 추출·비교를 하려면 `claude mcp add --transport stdio dembrandt -- npx -y dembrandt mcp`로 연결한다.

## 3단계: 한글 UX 라이팅 정제

MoneyView의 텍스트는 대부분 지표 이름, 표 헤더, 툴팁, 판정 문구(`build_verdict()` 결과), 오류·빈 화면 안내다. 그래서 문장을 매끄럽게 다듬기보다 같은 개념을 항상 같은 말로 부르는 것이 먼저다.

1. **문자열 분리**: 화면 텍스트를 컴포넌트에서 빼서 `ko.json` 같은 파일 하나로 모은다. 이 파일이 가이드의 "텍스트 익스포트"에 해당하고, 교정 결과를 다시 넣는 곳도 이 파일이다. 레이아웃 코드는 건드리지 않는다.
2. **용어집 작성**: 화면에 나오는 금융 용어마다 표기 하나를 정한다. 아래 표를 채워 나간다.
3. **LLM 교정**: `ko.json`과 용어집, 문체 규칙을 함께 넘겨 교정을 요청한다. GPT든 Claude든 상관없고, 핵심은 "용어집에 있는 단어는 바꾸지 말 것"을 조건으로 거는 것이다.
4. **검수와 반영**: 바뀐 줄만 diff로 확인한 뒤 `ko.json`에 반영한다. 숫자·단위·부호가 바뀐 줄은 반드시 눈으로 본다.

**용어집 시작점** (표기는 결정 필요):

| 원어 | 화면 표기 후보 | 비고 |
| --- | --- | --- |
| DCF | 현금흐름할인(DCF) | 첫 등장만 풀어 쓰고 이후 DCF |
| WACC | 가중평균자본비용(WACC) |  |
| ROIC | 투하자본이익률(ROIC) |  |
| VaR / ES | VaR / 기대손실(ES) |  |
| Intrinsic value | 내재가치 | 시장가와 항상 짝지어 표시 |
| Terminal value | 잔존가치 | 영구가치와 혼용 금지 |
| Monte Carlo | 몬테카를로 시뮬레이션 |  |

**문체 규칙 후보**: 버튼은 동사로 끝낸다("계산하기", "저장"). 안내 문장은 해요체 또는 합니다체 중 하나로 통일한다. 판정 문구는 근거 수치를 함께 쓴다(예: "ROIC 12.4%가 WACC 8.1%보다 높아요").

## 가이드에 없는 추가 항목

가이드는 웹사이트 기준이라 아래 항목을 다루지 않는다. 금융 분석 앱에서는 이쪽이 일관성에 더 큰 영향을 준다.

| 항목 | 왜 필요한가 | 정할 것 |
| --- | --- | --- |
| 상승/하락 색 | 한국 시장은 상승=빨강, 하락=파랑으로 서구와 반대다. 레퍼런스에서 추출한 색을 그대로 쓰면 의미가 뒤집힐 수 있다. | `value.gain`/`value.loss` 의미 토큰으로 분리하고 기본값을 정한다. 설정에서 바꿀 수 있게 할지도 정한다. |
| 숫자 표기 | 표와 카드의 숫자가 화면마다 다르게 보이면 같은 값도 다르게 읽힌다. | 고정폭 숫자, 천 단위 구분, 소수 자릿수(가격·비율·배수별), 음수 표기(−, 괄호), 통화·% 단위 위치. 포맷 함수 하나로 통일한다. |
| 차트 팔레트 | 계열 구분, 순서형(히트맵), 발산형(±편차) 색이 따로 필요하다. | 계열 8색, 순서형 1종, 발산형 1종. 몬테카를로 구간·시나리오 확률 표시 규칙. |
| 다크 모드 | 장시간 분석 화면이라 다크 모드 수요가 크다. 차트 색은 다크에서 별도 보정이 필요하다. | 기본 테마와 다크 전용 토큰 값. |
| 밀도 | 표가 많은 화면은 행 높이·여백을 줄인 조밀 모드가 필요할 수 있다. | 기본/조밀 2단계 여부. |
| 접근성 | 색만으로 상승/하락을 구분하면 색각 이상 사용자가 읽지 못한다. | 본문 대비 4.5:1 이상. 상승/하락에 ▲▼ 또는 +/− 부호를 함께 표시. `--wcag`로 점검. |
| 드리프트 방지 | 정형화 후에도 새 화면에서 임의 값이 다시 들어온다. | 아래 두 가지 검사를 CI나 커밋 전 단계에 넣는다. |

드리프트 검사:

- **토큰 준수 검사**: `dembrandt <앱 URL> --tokens tokens/moneyview.tokens.json --tokens-report report.md`로 화면 값이 토큰 파일에서 벗어나는지 확인한다. `--max-off-token`으로 허용 개수를 정할 수 있다.
- **코드 린트**: Stylelint 등으로 컴포넌트 코드의 HEX·px 직접 입력을 막는다. 앱이 로컬 전용이라 URL 기반 검사가 어려우면 이쪽을 주 검사로 쓴다.

## 실행 로드맵

각 단계는 앞 단계의 완료 기준을 통과해야 시작한다. 기존 화면 교체(5단계)는 한 번에 하지 않고 화면 단위로 나눠 커밋한다.

**0. 현황 진단**

- [ ] 스타일링 방식과 컴포넌트 라이브러리 정리
- [ ] 하드코딩 색·크기·간격 목록 작성
- [ ] 기준선 표 채우기, 주요 화면 캡처

완료 기준: 기준선 표의 숫자가 채워져 있다.

**1. 레퍼런스 확정**

- [ ] 후보 3\~5곳을 선정 기준표로 채점
- [ ] 주 레퍼런스 1곳(+보조 1곳) 확정, 약관 확인

완료 기준: 선택 이유가 기준표 점수로 설명된다.

**2. 토큰 정의**

- [ ] Dembrandt로 라이트·다크 추출, DESIGN.md 생성
- [ ] 원시 → 의미 → 컴포넌트 3계층으로 정리
- [ ] 상승/하락, 숫자 표기, 차트 팔레트 토큰 추가
- [ ] `--wcag`로 대비 점검

완료 기준: 토큰 파일 하나에 모든 값이 있고, 대비 기준을 통과한다.

**3. 빌드 파이프라인**

- [ ] Style Dictionary로 CSS 변수·Tailwind 테마·`tokens.ts` 생성
- [ ] 로컬 폰트 번들, 숫자 포맷 함수 작성

완료 기준: 토큰 값을 바꾸면 빌드 한 번으로 앱 전체에 반영된다.

**4. Claude 연결**

- [ ] Claude Design System 아티팩트 생성, 기본값 지정
- [ ] DESIGN.md·CLAUDE.md 규칙 커밋, Dembrandt MCP 연결

완료 기준: Claude Code에 새 화면을 요청했을 때 토큰 밖의 값을 쓰지 않는다.

**5. 화면 교체**

- [ ] 공통 컴포넌트(버튼, 카드, 표) → 포트폴리오 → 가치평가 → 매크로 지표 순서로 교체
- [ ] Recharts 색을 차트 토큰으로 교체

완료 기준: 린트 기준 하드코딩 값 0건.

**6. 한글 카피 정제**

- [ ] 문자열을 `ko.json`으로 분리
- [ ] 용어집·문체 규칙 확정 후 LLM 교정, diff 검수

완료 기준: 용어집의 모든 용어가 화면 전체에서 같은 표기로 쓰인다.

**7. 드리프트 방지**

- [ ] 토큰 준수 검사와 린트를 커밋 전 단계 또는 CI에 추가

완료 기준: 토큰 밖의 값이 들어오면 검사가 실패한다.

## 결정이 필요한 사항

- [ ] 현재 프론트엔드 스타일링 방식: Tailwind(버전), shadcn/ui, CSS Modules 중 무엇인가? 토큰 연결 방식이 이것으로 정해진다.
- [ ] 주 레퍼런스 후보 3\~5곳
- [ ] 상승/하락 색 기본값: 한국식(상승 빨강) / 서구식(상승 초록) / 설정에서 선택
- [ ] 기본 테마: 라이트 / 다크 / 시스템 설정 따름
- [ ] 한글 폰트 선택(고정폭 숫자 지원 여부 확인 포함)
- [ ] 안내 문장 문체: 해요체 / 합니다체
- [ ] 조밀 모드 지원 여부
- [ ] 드리프트 검사 위치: 커밋 전 훅 / GitHub Actions

## 출처

- 첨부 문서: AI 기반 웹 디자인 품질 및 일관성 향상을 위한 표준 가이드라인(유튜브 영상 정리본)
- [Dembrandt GitHub README](https://github.com/dembrandt/dembrandt): 설치, CLI 옵션, 로그인 페이지 추출, MCP 설정, 라이선스

## 구현 계획에서 확정한 사항 (2026-10-13)

## Owner decisions

**2026-10-12 (still in force):**
- **Korean font:** must allow commercial use. All three fonts the redesign names are SIL Open Font License 1.1: Host Grotesk, Pretendard and Geist Mono. OFL allows commercial use, embedding and redistribution, and the licence texts ship beside the files (Task 4).
- **Korean copy:** 합니다체 by default. This is now binding, no longer "confirm before Task 9".
- **Dark mode:** none. See decision 1 below.

**2026-10-13 (binding):**
1. **Theme:** ship only the light `paper` theme. The `void` (dark) values are dropped entirely and are not carried in the token file. A test enforces this (Task 5, `no value that exists only in the void theme is carried`).
2. **Language:** keep the ko/en toggle (i18n) for body text and controls. Also adopt the redesign's always-bilingual small labels (eyebrows, table headers) in the "시장 MARKET" style: Korean first, English second, both always visible (Task 7). Nav items stay toggle-translated, because they are controls.
3. **Landing page:** out of scope. That covers `Main.dc.html`'s sections, including the illustrative fear/greed, foreign-flow and regime panels, and the `mv-ticker`/`mv-live-dot` pieces that only it uses. They are listed under Follow-ups.

> **Owner-visible note: provenance of the palette and type scale.** The redesign's `tokens.json` carries
> `"meta": {"source": "Derived from a Heron AI brand extraction (heronaiapp.com: home, chat widget, resources, insights)."}`.
> Its `usage` notes cite "the reference's" colours: the background #FFFFFF, warm surface #F5F5ED, border #B3B3AF, mono, and the orange #FA3600. They also cite its "BT Grotesk scale (62/53/44/36/31/27)" and its 4.44 px spacing step.
> So MoneyView's colours and type sizes are lifted from another company's site, not just inspired by it. That does not matter for a local, single-user tool. **It matters if MoneyView is ever made public**: get a trade-dress/brand review before release, and consider re-deriving the orange and the scale.
> The design is not changed because of this. Task 1 records the note in the copied README, and Follow-ups keep the review item.

**Pre-approvals needed before Task 5.** Two existing e2e assertions encode today's colours. Under `.claude/CLAUDE.md`'s rule they are listed here, before anyone edits them:
- `tests/e2e/candle-colour.spec.ts`: `DELTA_UP` `#E54545` → `#D21F3C`, `DELTA_DOWN` `#4589E5` → `#1E5BD8`. The pixel tolerance of 24 does not cover the move: the green channel shifts by 38.
- `tests/e2e/sidebar-contrast.spec.ts`: `BLACK = rgb(0, 0, 0)` → the ink `rgb(40, 40, 40)`. The test's intent stays: bold, the same colour in every state, and the active item still marked.

## Conflicts between the redesign, the spec and the 2026-10-12 plan

| # | Before (spec or 2026-10-12 plan) | Redesign says | Resolution |
|---|---|---|---|
| R1 | Keep today's identity: mint/sage, `#FBFBFB` canvas, Rams-inspired (old D7) | Paper: `#FFFFFF` ground, `#F5F5ED`/`#F0F0F0` surfaces, ink `#282828`, brand `#FA3600` | Redesign wins (owner). Task 5 switches all values. |
| R2 | No dark mode | Two themes; `void` is the default (`Main.dc.html` `theme ?? 'void'`) | Paper only; void values never enter the token file (decision 1, tested). |
| R3 | Pretendard replaces Inter, one family | Host Grotesk (Latin) + Pretendard (Hangul) + Geist Mono (figures). The woff2 files are referenced but missing from the export. | Three OFL families, fetched as npm tarballs into a scratch directory (no dependency added), vendored to `app/fonts/` with their licences, loaded by `next/font/local` (Task 4). |
| R4 | 8 sizes (11–28 px); spec: 6–8 steps | 13 styles, `display` 62/64 down to `caption` 11/14, plus `figure`/`mono` | All 13 go into the token file, plus 4 from the redesign's own files: `panel-title` (bundle.css `.mv-panel-title`), `small` (`.mv-field-help`), `caption-ko` ("Korean captions at 12px"), `figure-md` (Main.dc.html's 32 px panel figure). **10 are app utilities.** The 6 landing-only styles (`display`, `heading-1…4`, `body-lg`) are tokens without utilities. That is two steps over the spec's 8. Dense data screens need two figure sizes and two title sizes. |
| R5 | Type is used as `text-<token>` theme utilities | `tokens.css` defines style classes that also set the family | Generated `@utility type-<style>` (family, size, line height, weight, tracking). Tailwind's `--text-*` theme keys cannot carry a font family. |
| R6 | Spec: `chart.series.1–8`; old plan: 8 colours via the dataviz skill, ≥ 0.1 apart in OKLab | `chart-1…5`; chart-1 = brand = the subject series | 5 series, as designed. Six or more categories fold the tail into "Other" in `chart-4`. The distinctness gate becomes **0.08**: the redesign's chart-3/4/5 are 0.085–0.097 apart (computed 2026-10-13). |
| R7 | Spec `value.gain/loss`; old D9 kept `state.positive/negative` canonical | `up` / `up-soft` / `down` / `down-soft` / `flat`; up `#D21F3C`, down `#1E5BD8` | Redesign names are canonical. `state-positive/negative`, `delta-up/down` and `chart-positive/negative` become deprecated aliases. |
| R8 | Status tones copied verbatim from Tailwind's amber/red/emerald so the swap is invisible | No status tones. bundle.css shows input errors in the `up` tone. | `status.error` = the up family, as bundle.css does. Warning and success derive from chart-5 and chart-2, darkened to ≥ 4.5:1 (`#7A6A00`, `#0B6E62`), with tinted surfaces. Each tone has `ink`/`surface`/`border` and nothing more. **Owner: see open question 2.** |
| R9 | Radius sm/md/lg = 4/8/12 px | `radius-0/1/2/pill` = 0/2/4/999 px | By role. Panels, tables, charts and modals take 0. Buttons, inputs and segmented controls take 1. Tooltips, menus and chips take 2. Dots take pill (M3). |
| R10 | 4 shadow tokens plus 14 raw Tailwind shadows | No shadows; 1 px hairlines | Every shadow is removed. Elevation becomes `border border-[var(--line)]`. The shadow tokens are deprecated as `none`. |
| R11 | `--space-5…8` = 24/32/48/64 px | `space-1…6, 8, 16, 32` = n × 4 px | Redesign values. `--space-5…8` have 0 references (counted 2026-10-13), so nothing moves. `--space-7` is removed. Tailwind's numeric scale already is n × 4 px (`p-6` = `--space-6`). |
| R12 | Tailwind breakpoints sm 640 / md 768 / lg 1024 | 992 / 768 / 480 | `--breakpoint-lg: 992px`, `md: 768px`, `sm: 480px` (literal `@theme` values). `xl`/`2xl` stay. The two JS `1024` checks (`AppShell.tsx:12`, `app/portfolio/page.tsx:1019`) read `tokens.bp.desktop`. No e2e viewport falls between the old and new points (widths used: 375, 390, 768, 1024, 1366, 1440, 1600). |
| R13 | Negative sign: ASCII `-` | `Delta` prints U+2212 `−` | **Keep ASCII `-`**: pasted figures stay numbers in spreadsheets, and existing assertions stay valid. If wrong, it costs one line in `formatNumber` plus the tests that pin `-`. |
| R14 | — | `Delta` shows 2 decimals and `■` for flat | Glyph `■` adopted. Percent deltas keep today's 1 decimal: 2 would change every delta assertion for no reading gain. |
| R15 | — | `Eyebrow` renders `[01] 시장 관측소 / MARKET OBSERVATORY` (slash) | Owner's style: `[01] 시장 MARKET` with no slash. The index is optional. |
| R16 | Old Task 8: pick an outside reference and extract its structure with Dembrandt | The redesign is the reference | Reference review dropped. Dembrandt stays a follow-up drift check only (old D10). |
| R17 | — | `bundle.css`: about 15 global `mv-*` classes with raw px values; `bundle.js`: demo React components | **Not imported.** The app already has the same components (`Card`, `DeltaBadge`, `DenseTable`, `KPIBlock`, `Sparkline`, `ToggleGroup`, `ActionButton`, `InlineField`), and tests depend on them. Global classes would be a second styling language that the lint rule cannot see and the theme reset cannot reach, and their px values would reintroduce raw values. The components are restyled with token utilities to match the classes (Task 8 mapping). `.mv-sr` → Tailwind `sr-only`. `.mv-row`/`.mv-stack` are demo layout and are not ported. |
| R18 | Spec: sequential palette | none | No consumer today, so it is not added (Follow-ups). |
| R19 | Heatmap: 7-step scale through mint-grey | Only `up`/`down` and their soft tints | 7 diverging steps: down, mid, down-soft, `surface`, up-soft, mid, up. The two midpoints are sRGB averages (`#81A4EB`, `#E88796`), marked "not in the redesign". |
| R20 | Spec: Monte Carlo `chart.band` | `Main.dc.html` fills under lines at opacity 0.12 | Token `chart.area-opacity` = 0.12. Bands use `chart-1` with that opacity. |
| R21 | `--text-inverse` (white) | no counterpart | `--bg` on an ink fill, `--on-brand` on a brand fill. White on `#FA3600` is only 3.8:1. |
| R22 | Motion tokens (duration/easing) | bundle.css uses 0.2–0.48 s `ease-in` inline, with no tokens | Today's motion tokens stay. Components use them. |
| R23 | — | `word-break: keep-all` on the page root | Adopted on `body`, so Hangul breaks between words. |
| R24 | — | Focus ring: 2 px brand, 2 px offset | One global `:focus-visible` rule. The per-component `focus-visible:ring-*` classes are deleted (M3). |
| R25 | — | `--surface` means warm surface `#F5F5ED`. Today `--surface` is the mint brand fill (52 uses), and `--chart-1…6` and `--type-label` also collide in name. | Task 3 first renames the colliding uses to their role (`--brand`, `--chart-primary…`, `--type-small`) while values stay put, proven by byte-identical screenshots. Only then does Task 5 change values. |
| R26 | Old plan saved captures in `test-results/` | — | Playwright empties `test-results/` at the start of every run, so `before/` would vanish on the next capture. Captures go to `apps/web/design-capture/` instead (git-ignored, Task 1). |

## Spec corrections (verified against the repo)

| # | Spec says | Repo fact | This plan does |
|---|---|---|---|
| D1 | Build the tokens | `globals.css` defines about 100 variables, used through `var(--…)` 2,429 times | Token file v1 is a 1:1 migration, proven equal (Task 2). It is kept only as the safety net before the paper switch (Task 5). |
| D2 | Tauri app, bundle fonts locally | Not Tauri. `next/font/google` self-hosts Inter, which has no Hangul. | Three vendored OFL families via `next/font/local` (R3) |
| D3 | Style Dictionary | Generated names must equal the existing `var(--x)` names; the outputs are custom | A small generator with tests, no new dependency |
| D4 | Stylelint | The values live in TSX class strings | A local ESLint rule |
| D5 | Korean copy: export → LLM → reimport | The UI is English (`<html lang="en">`) | Typed `en`/`ko` catalogs, glossary first, owner reviews the diff |
| D6 | Dark-mode tokens | Removed by the owner | None (R2) |
| D7 | Reference site first | — | Superseded by R16 |
| D8 | Put `var(--chart-series-1)` into Recharts | `TVChart.tsx` draws on a canvas, which cannot read `var()` | Canvas colours go through `resolveCssColor` with a token fallback |
| D9 | New `value.gain/loss` | — | Superseded by R7 |
| D10 | `claude mcp add … dembrandt mcp` | — | Follow-up only (R16) |
| D11 | Claude Design System artifact | It lives in claude.ai | The owner sets it from `DESIGN.md` and the paper token table (Task 14) |
| D12 | Tokens at repo-root `tokens/` | Only `apps/web` consumes them | `apps/web/tokens/` |
| D13 | 6–8 type steps | — | Superseded by R4 |
| D14 | Spec at the repo root (old plan) | The spec is at `docs/MoneyView 디자인 시스템 정형화 계획서.md` | Task 1 moves it from there |
| D15 | — | `lib/chartConfig.ts:63` uses `var(--bg-muted)`, which is never defined. The cursor fill silently renders nothing. | Fixed in Task 3 with an `ERROR-LOG.md` record. The new `unknownVar` lint check guards the class of bug. |

**Baseline (stage 0), measured 2026-10-12** over the 147 git-tracked `ts/tsx` files in `app/`, `components/`, `lib/`, `hooks/`. Task 1 re-measures it with the lint rule, and that number becomes the official baseline.

| Item | Now | Target | After (2026-10-16, DS 14b) |
|---|---|---|---|
| Hex / `rgb()` literals | 60 (27 unique, 17 files) | 0 outside the token file | 0 (lint; the generated files hold the only literals, `lib/transformers.ts` builds one `rgba()` from a token at runtime) |
| Tailwind default-palette classes (`bg-amber-50` …) | 119, plus 22 black/white | 0 | 0 (lint `paletteClass`; the Tailwind `--color-*` theme is also reset) |
| Type: Tailwind scale / `text-[Npx]` / `--type-*` | ~650 / 13 / 115 | 10 `type-*` utilities | 10 (lint `typeScale`, `arbitraryPx`, `lengthTypeVar` at 0) |
| Radius outside tokens (`rounded`, `-md`, `-lg`) | 48 (token uses: ~380, mostly `--radius`) | 0; three radius roles plus `rounded-full` | 0 (lint `rawRadius`; `--radius-*` reset; paper-sweep checks computed radii) |
| Shadows | 14 raw + 5 token uses | 0 of either | 0 (lint `rawShadow`; `--shadow-*` reset; paper-sweep checks computed shadows) |
| Undefined `var(--x)` references | 1 (`--bg-muted`) | 0 | 0 (`unknownVar`; the deprecated aliases are deleted) |
| Number formatting | `toFixed(` 182, `toLocaleString(` 45, 15+ `format*` helpers | one `formatNumber` | Not reached: `toFixed(` 135 and `toLocaleString(` 19 remain (calculation cores and the M5 residue), tracked as M5 |

