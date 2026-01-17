from typing import List, Optional, Dict
from DAO import EconomicIndicator, RiskNews
import requests
from bs4 import BeautifulSoup
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class RegulationCrawler:
    """
    3. 금융 억압 및 규제 감시: 금융감독원/금융위원회 크롤러
    """
    def __init__(self):
        self.targets = [
            {
                "name": "금융감독원 보도자료",
                "url": "https://www.fss.or.kr/fss/bbs/B0000188/list.do?menuNo=200218",
                "base_url": "https://www.fss.or.kr"
            },
            # 금융위원회 등 추가 가능
        ]
        self.keywords = ["해외 송금 제한", "서학개미 규제", "환전 증거금", "외화 스트레스 테스트", "자본 유출"]

    def crawl(self) -> List[RiskNews]:
        results = []
        for target in self.targets:
            try:
                response = requests.get(target['url'], timeout=10)
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # FSS 보도자료 게시판 구조에 맞춘 파싱 (구조 변경 시 수정 필요)
                # 통상적으로 게시판은 table > tbody > tr 구조를 가짐
                rows = soup.select('table tbody tr')
                
                for row in rows:
                    title_tag = row.select_one('.subject a') # 제목 태그
                    date_tag = row.select_one('td:nth-child(4)') # 날짜 태그 (인덱스 확인 필요)
                    
                    if title_tag:
                        title = title_tag.text.strip()
                        link = target['base_url'] + title_tag['href'] if title_tag['href'].startswith('/') else title_tag['href']
                        date = date_tag.text.strip() if date_tag else datetime.now().strftime('%Y-%m-%d')
                        
                        # 키워드 매칭 확인
                        matched = [k for k in self.keywords if k in title]
                        
                        if matched:
                            results.append(RiskNews(
                                source=target['name'],
                                title=title,
                                url=link,
                                date=date,
                                matched_keywords=matched
                            ))
            except Exception as e:
                logger.error(f"크롤링 오류 ({target['name']}): {e}")
        
        return results
