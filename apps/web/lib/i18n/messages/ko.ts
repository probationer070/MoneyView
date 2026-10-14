import type { Messages } from "./en";

// Terms follow docs/design/MoneyView_Glossary.md exactly.
export const ko: Messages = {
  nav: {
    market: "시장 개요", portfolio: "포트폴리오", news: "뉴스", corporate: "기업 분석",
    monteCarlo: "몬테카를로 시뮬레이션", decisions: "의사결정 기록", valuation: "가치평가", cases: "케이스", events: "이벤트",
  },
  navShort: {
    market: "시장", portfolio: "포트폴리오", news: "뉴스", corporate: "기업 분석", monteCarlo: "몬테카를로",
    decisions: "의사결정", valuation: "가치평가", cases: "케이스", events: "이벤트",
  },
  topnav: { primary: "주 메뉴", full: "전체 페이지", menu: "메뉴", poweredBy: "Powered by FastAPI & Next.js" },
  common: {
    loading: "불러오는 중…", retry: "다시 시도", unavailable: "불러오지 못했습니다.",
    updatedAgo: "{minutes}분 전 갱신", language: "언어",
    errorTitle: "문제가 발생했습니다", tryAgain: "다시 시도", noData: "데이터가 없습니다", noDataHint: "분석을 실행하거나 데이터를 새로 고치면 결과가 여기에 표시됩니다.", renderFailureTitle: "화면 구성 요소 오류", renderFailureBody: "예기치 않은 오류로 이 그래프를 표시하지 못했습니다. 로그는 로컬에 기록되었습니다.", exportDisabled: "내보내기 사용 불가", exportJson: "JSON 내보내기", exportCsv: "CSV 내보내기", exportMarkdown: "Markdown 내보내기", printPdf: "PDF 인쇄", tickerPlaceholder: "종목 코드 또는 기업명", other: "기타", chartUnavailable: "차트를 표시할 수 없습니다",
  },
  delta: { up: "상승", down: "하락", flat: "보합" },
  portfolio: { title: "포트폴리오" },
  corporate: {
    title: "기업 분석",
    search: { label: "기업 검색", placeholder: "회사명을 입력하십시오", notListed: "목록에 없음 → 추가" },
    add: { name: "회사명", symbol: "심볼", submit: "분석에 추가", cancel: "취소", failed: "{ticker}을(를) 추가하지 못했습니다." },
    header: { refreshDcf: "DCF 새로고침", notCalculated: "아직 계산하지 않았습니다" },
    verdict: {
      detail: "판정 상세", intrinsic: "내재가치", vs: "대비", current: "현재가",
      idle: "DCF 미계산 · 위의 DCF 새로고침을 누르십시오", streaming: "계산 중…",
      refused: "평가하지 않음: {reason}", ev: "기업가치(EV) {value}",
    },
    verdictStrip: { idle: "DCF 미계산", refused: "평가하지 않음", staleSource: "원천 자료 오래됨" },
    kpi: {
      spread: "ROIC - WACC", ke: "상향식 Ke", wacc: "WACC", beta: "레버리지 베타",
      spreadUp: "가치 창출", spreadDown: "가치 훼손",
      keCaption: "무위험수익률 + 베타 × 내재 ERP + CRP", waccCaption: "DCF 할인율", betaCaption: "하마다 조정",
    },
    assumptions: {
      detail: "가정 상세", menu: "가정 옵션", edit: "{label} 편집", info: "{label} 상세", actions: "동작",
      refreshSource: "원천 데이터 새로고침", roicBasis: "ROIC 기준", roicYear: "ROIC 연도",
      basisRecent: "최근 다년 평균", basisAll: "전체 연도 평균", basisAnnual: "연도별 값 선택",
      yearUnavailable: "없음", growthBasis: "성장 기준",
      growthDefault: "성장률은 안정 CAGR 기준을 씁니다. 연도별 성장률은 상세 보기에서 볼 수 있습니다.",
      updated: "갱신 {time}", notLoaded: "아직 불러오지 않았습니다",
      sourceIdle: "원천 데이터는 새로고침할 때까지 불러오지 않습니다.",
      staleSource: "저장된 원천 데이터는 {cached} 기준입니다. {ticker}로 새로고침하십시오.",
      fixed: "고정",
    },
    assumption: {
      growth: "성장률", roic: "ROIC", wacc: "WACC", debtRatio: "부채비율", unleveredBeta: "비레버리지 베타",
      crp: "국가위험프리미엄", reinvestment: "재투자율", innovation: "혁신지수",
      governance: "지배구조 품질", esgPenalty: "ESG/대리인 페널티",
    },
    tabs: {
      aria: "기업 분석 구역", summary: "요약", diagnostics: "진단 차트", dcf: "DCF", comparison: "종목 비교",
      about: "이 탭 설명",
      diagnosticsAbout: "허들레이트 분해, 상향식 베타와 WACC U-커브, 4분면 가치동인 매트릭스입니다. 차트 제목이나 막대를 누르면 계산 상세가 열립니다.",
      dcfAbout: "왼쪽은 DCF 핵심값 네 가지, 오른쪽은 전체 DCF 리포트의 WACC × 영구성장률 민감도표입니다. 예측 행과 CSV 내보내기는 계산 상세의 원천 데이터 탭에 있습니다.",
    },
    dcfTab: {
      loadReport: "리포트 불러오기", loading: "전체 DCF 리포트를 불러오는 중…", unavailable: "전체 DCF 리포트를 불러오지 못했습니다",
      empty: "전체 리포트를 불러오면 민감도표가 보입니다.",
    },
    comparison: {
      universe: "유니버스", universeAria: "비교 유니버스", benchmarkLabel: "벤치마크", benchmarkAria: "비교 벤치마크",
      customLabel: "사용자 지정 티커", customAria: "사용자 지정 티커", sortLabel: "정렬", sortAria: "정렬 기준",
      directionLabel: "방향", directionAria: "정렬 방향",
      sortImplied: "내재수익률 대비 WACC", sortSpread: "ROIC - WACC", sortDcf: "DCF 가치", desc: "높은 순", asc: "낮은 순",
      universeLabel: { portfolio_plus_benchmark: "포트폴리오 + 벤치마크", watchlist_plus_benchmark: "관심종목 + 벤치마크", custom: "사용자 지정 유니버스" },
      refresh: "비교 새로고침", calculateAll: "전체 DCF 계산", calculatingAll: "전체 DCF 계산 중…",
      verifySync: "관심종목 동기화 확인", verifying: "관심종목을 확인하는 중…",
      synced: "관심종목 {n}/{m} 동기화", missing: "기업 분석에 없는 종목: {tickers}.",
      benchmark: "벤치마크: {ticker}.", preset: "선택한 벤치마크: {label} ({ticker}).",
      custom: "사용자 지정 티커: {tickers}.", none: "없음", notCalculated: "아직 계산하지 않았습니다", stale: "오래됨",
      openPortfolio: "포트폴리오에서 테스트", loading: "비교 행을 불러오는 중…",
      errorTitle: "종목 비교를 불러오지 못했습니다", errorBody: "지금은 종목 비교를 쓸 수 없습니다.",
      idleTitle: "종목 비교는 처음 열 때 계산하지 않습니다.", idleBody: "유니버스를 고른 뒤 비교 새로고침을 누르십시오.",
      about: "추적 중인 종목과 임시 사용자 지정 유니버스를 가볍게 비교합니다. 이 탭은 실시간 비교만 합니다. 시장 기대수익률 = 무위험수익률 {riskFree} + 주식위험프리미엄 {erp} = {marketReturn}. 종목 수익률 방식: {stockMethod}. 기준 방식: {referenceMethod}. 계산 시각: {generatedAt}. 새로고침할 때마다 관심종목과 기업 목록을 대조하므로, 비교 전에 빠진 종목이 보입니다. 비중 테스트, 현금, 스냅샷과 저장 이력은 포트폴리오 화면에서 관리합니다.",
    },
  },
};
