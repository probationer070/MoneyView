from dataclasses import dataclass, field
from typing import List

@dataclass
class EconomicIndicator:
    """
    경제 지표 데이터를 담는 클래스
    (ECOS, FRED, Yahoo Finance 등에서 수집된 정량 데이터)
    """
    category: str          # 예: "한국 내부 요인", "글로벌 매크로"
    name: str              # 지표명 (예: M2 통화량, 달러 인덱스)
    code: str              # API 코드 또는 티커 (예: 102Y004, DXY)
    value: float           # 지표 값
    unit: str              # 단위 (예: 십억원, %, pt)
    date: str              # 기준 일자 (YYYY-MM-DD)
    source: str            # 출처 (예: ECOS, Yahoo, FRED)
    description: str = ""  # 추가 설명

@dataclass
class RiskNews:
    """
    금융 규제 및 리스크 관련 뉴스/공지사항 데이터를 담는 클래스
    """
    source: str            # 출처 (예: 금융감독원, 금융위원회)
    title: str             # 제목
    url: str               # 링크
    date: str              # 게시 일자
    matched_keywords: List[str] = field(default_factory=list) # 매칭된 키워드