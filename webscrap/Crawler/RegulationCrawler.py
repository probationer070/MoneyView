from typing import List, Optional, Dict
import feedparser
import urllib.parse
from datetime import datetime
from ..DAO.Economic import RiskNews
import logging
import os
import csv

logger = logging.getLogger(__name__)

class RegulationCrawler:
    """
    3. 금융 억압 및 규제 감시: Google News RSS 크롤러
    """
    def __init__(self):
        self.log_file = "crawling_log.csv"
        self.keywords = ["해외 송금 제한", "서학개미 규제", "환전 증거금", "외화 스트레스 테스트", "자본 유출"]

    def crawl(self, query: Optional[str] = None, limit: int = 5) -> List[RiskNews]:
        results = []
        # 쿼리가 있으면 해당 쿼리만, 없으면 기본 키워드 리스트 사용
        search_targets = [query] if query else self.keywords
        
        for keyword in search_targets:
            try:
                # 검색어를 URL 인코딩 (한글 검색 대응)
                encoded_search = urllib.parse.quote(keyword)
                # 구글 뉴스 RSS URL (hl=ko: 한국어, gl=KR: 한국 지역)
                url = f"https://news.google.com/rss/search?q={encoded_search}&hl=ko&gl=KR&ceid=KR:ko"
                
                # RSS 피드 파싱
                feed = feedparser.parse(url)
                
                # 키워드별 상위 limit개만 수집
                for entry in feed.entries[:limit]:
                    title = entry.title
                    link = entry.link
                    pub_date = entry.published if hasattr(entry, 'published') else datetime.now().strftime('%Y-%m-%d')
                    
                    news = RiskNews(
                        source="Google News",
                        title=title,
                        url=link,
                        date=pub_date,
                        matched_keywords=[keyword]
                    )
                    results.append(news)
                    self._save_log(news, keyword)
                    
            except Exception as e:
                logger.error(f"RSS 크롤링 오류 ({keyword}): {e}")
        
        return results

    def _save_log(self, news: RiskNews, keyword: str):
        """크롤링 로그를 CSV 파일에 저장"""
        file_exists = os.path.exists(self.log_file)
        try:
            with open(self.log_file, 'a', newline='', encoding='utf-8-sig') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(['Timestamp', 'Keyword', 'Title', 'URL', 'Date'])
                
                writer.writerow([
                    datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    keyword,
                    news.title,
                    news.url,
                    news.date
                ])
        except Exception as e:
            logger.error(f"로그 저장 실패: {e}")
