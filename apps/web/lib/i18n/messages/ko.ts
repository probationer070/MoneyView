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
};
