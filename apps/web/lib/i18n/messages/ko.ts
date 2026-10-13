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
    verdict: {
      detail: "판정 상세", intrinsic: "내재가치", vs: "대비", current: "현재가",
      idle: "DCF 미계산 · 위의 DCF 새로고침을 누르십시오", streaming: "계산 중…",
      refused: "평가하지 않음: {reason}", ev: "기업가치(EV) {value}",
    },
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
  },
};
