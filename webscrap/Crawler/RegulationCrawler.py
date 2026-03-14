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
    Google News RSS 크롤러
    """
    def __init__(self):
        self.log_file = "src/crawling_log.csv"
        self.crawled_urls = self._load_crawled_urls()
        self.keywords = ["해외 송금 제한", "서학개미 규제", "환전 증거금", "외화 스트레스 테스트", "자본 유출"]

    def _load_crawled_urls(self) -> set:
        """로그 파일에서 이미 크롤링된 URL을 로드합니다."""
        crawled = set()
        log_path = self.log_file
        if not os.path.exists(log_path):
            return crawled
        
        try:
            with open(log_path, 'r', newline='', encoding='utf-8-sig') as f:
                reader = csv.reader(f)
                try:
                    header = [h.strip() for h in next(reader)]
                    url_index = -1
                    if 'URL' in header:
                        url_index = header.index('URL')
                    elif 'url' in header:
                        url_index = header.index('url')
                    
                    if url_index != -1:
                        for row in reader:
                            if len(row) > url_index and row[url_index]:
                                crawled.add(row[url_index])
                except StopIteration: # 파일이 비어있는 경우
                    pass
        except Exception as e:
            logger.error(f"크롤링 로그 로드 실패 ({log_path}): {e}")
        return crawled
    
    def load_csv_log(self, filepath: Optional[str] = None) -> List[RiskNews]:
        """CSV 로그 파일에서 크롤링된 뉴스를 로드하여 반환합니다."""
        log_path = filepath if filepath else self.log_file
        news_list = []
        if os.path.exists(log_path):
            try:
                with open(log_path, 'r', newline='', encoding='utf-8-sig') as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        news_list.append(RiskNews(
                            source=row.get('Source', 'Unknown'),
                            title=row.get('Title', 'No Title'),
                            url=row.get('URL', ''),
                            date=row.get('Date', ''),
                            matched_keywords=[row.get('Keyword', '')]
                        ))
            except Exception as e:
                logger.error(f"로그 파일에서 뉴스 로드 실패 ({log_path}): {e}")
        return news_list

    def crawl(self, query: Optional[str] = None, limit: int = 5, filepath: Optional[str] = None, save_log: bool = True) -> List[RiskNews]:
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

                    # 이미 크롤링된 URL인지 확인
                    if link in self.crawled_urls:
                        # logger.info(f"중복 URL 발견: {link}")
                        continue
                    
                    news = RiskNews(
                        source="Google News",
                        title=title,
                        url=link,
                        date=pub_date,
                        matched_keywords=[keyword]
                    )
                    results.append(news)
                    self.crawled_urls.add(link)  # Add URL to the set
                    if save_log:
                        self._save_log(news, keyword, filepath)
                    
            except Exception as e:
                logger.error(f"RSS 크롤링 오류 ({keyword}): {e}")
        
        # 만약 크롤링한 데이터가 없는 경우 csv에서 가장 최신 데이터 5개를 로드하여 반환
        if not results:
            logger.info("새로운 뉴스가 없습니다. 기존 로그에서 최신 뉴스 5개를 로드합니다.")
            log_path = filepath if filepath else self.log_file
            if os.path.exists(log_path):
                try:
                    results = self.load_csv_log(log_path)[:5]
                except Exception as e:
                    logger.error(f"로그 파일에서 뉴스 로드 실패 ({log_path}): {e}")
        
        return results

    def _save_log(self, news: RiskNews, keyword: str, filepath: Optional[str] = None):
        """크롤링 로그 또는 수집된 기사를 CSV 파일에 저장합니다."""
        log_path = filepath if filepath else self.log_file
        try:
            # 파일이 저장될 디렉토리가 없으면 생성합니다.
            log_dir = os.path.dirname(log_path)
            if log_dir:
                os.makedirs(log_dir, exist_ok=True)

            file_exists = os.path.exists(log_path)

            # 종목별 기사 파일인지, 일반 로그 파일인지 구분하여 처리합니다.
            is_article_file = 'articles.csv' in os.path.basename(log_path)

            with open(log_path, 'a', newline='', encoding='utf-8-sig') as f:
                if is_article_file:
                    # 종목 뉴스용 포맷 (DictWriter 사용)
                    fieldnames = ['publication_date', 'headline', 'url', 'importance', 'keyword']
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    if not file_exists:
                        writer.writeheader()
                    writer.writerow({
                        'publication_date': news.date,
                        'headline': news.title,
                        'url': news.url,
                        'importance': 1,  # 자동 수집에서는 중요도 기본값 1로 저장
                        'keyword': keyword
                    })
                else:
                    # 일반 크롤링 로그용 포맷
                    writer = csv.writer(f)
                    if not file_exists:
                        writer.writerow(['Timestamp', 'Keyword', 'Title', 'URL', 'Date'])
                    writer.writerow([datetime.now().strftime('%Y-%m-%d %H:%M:%S'), keyword, news.title, news.url, news.date])
        except Exception as e:
            logger.error(f"로그 저장 실패 ({log_path}): {e}")
