# 뉴스 크롤링 참고 노트

조사일: 2026-10-25. 종목 뉴스와 과거 날짜 뉴스 검색을 설계하면서 정리한 사실과 원칙이다(급락 경보 ④의 뉴스 쪽).
새 크롤러를 만들거나 수집 간격과 양을 바꾸기 전에 이 문서를 읽는다.

이 문서는 조사 시점의 사실을 적는다. 구글 뉴스 RSS는 공식 문서가 없는 엔드포인트라 동작이 예고 없이 바뀔 수 있다.
숫자에 기대기 전에 요청 한두 번으로 다시 확인한다.

## 1. 원칙

차단을 위장으로 피하지 않는다. 요청 수를 줄이고, 간격을 무작위로 두고, 막히면 멈춘다.

1. **받은 것은 다 저장한다.** 같은 요청을 다시 보내지 않는 것이 가장 확실한 보호다.
2. **간격은 고정하지 않는다.** 정기 수집은 요청 사이에 무작위 20~60초를 둔다. 같은 간격의 연속 요청은 자동화로 분류되기 쉬운 모양이다.
3. **막히면 그날은 멈춘다.** 429나 503(또는 "자동화된 쿼리" 페이지)을 받으면 그날 수집을 중단하고 기록한다. 다음 날 다시 시도한다. 같은 날 재시도로 밀어붙이지 않는다.
4. **과거 검색은 사람이 요청할 때만 1회 보낸다.** 결과는 저장하고, 같은 종목과 기간은 다시 묻지 않는다. 여러 기간을 한꺼번에 요청하면 순서대로, 위 간격으로 보낸다.
5. **10년치를 자동으로 한꺼번에 긁지 않는다.**
6. **브라우저 자동화나 지문 위장 도구를 쓰지 않는다.** 아래 §4 참고.

## 2. 구글 뉴스 RSS 실측 (2026-10-25, 요청 3번)

엔드포인트: `https://news.google.com/rss/search?q=<검색어>&hl=en-US&gl=US&ceid=US:en`
(한국어는 `hl=ko&gl=KR&ceid=KR:ko`). 검색어는 URL 인코딩해야 한다. 인코딩하지 않으면 연산자가 무시되거나 빈 결과가 온다.

| 항목 | 측정값 |
| --- | --- |
| 요청 1번에 받는 양 | **최대 100건**("Apple AAPL stock"으로 100건, 124KB). 쪽 넘기기나 offset 파라미터가 없어서 100건이 끝이다. |
| 기간 분포 | 날짜 없이 검색하면 100건이 약 4개월에 걸친다(6/25~10/24). 그중 최근 7일치는 39건이다. |
| 과거 날짜 검색 | `after:YYYY-MM-DD before:YYYY-MM-DD`가 영어에서 동작한다. "Apple AAPL"을 2016-01-25~29로 검색하면 실적 주간 기사 10건(CNBC, BBC, Fortune 등)이 나온다. 날짜 단위까지만 되고 시각 단위는 안 된다. |
| 한국어 과거 검색 | "애플 주가"를 같은 2016년 기간으로 검색하면 **0건**이다. 오래된 한국어 기사는 기대하기 어렵다. |
| 잘림 | 한 기간에서도 100건이 넘으면 나머지는 말없이 잘린다(제3자 보고). 바쁜 종목은 기간을 짧게 나눈다. |

**당시 코드의 낭비:** `StockNewsCrawler.crawl(limit=10)`은 100건을 받아서 10건만 남겼다. 같은 요청 1번으로 10배를 저장할 수 있다.

## 3. 필드와 정규화

기사 한 건(`<item>`)의 필드:

| 필드 | 내용 | 정규화 |
| --- | --- | --- |
| `title` | 100건 모두 끝에 `" - 출처명"`이 붙는다 | 붙은 출처명을 떼어 저장한다 |
| `source` (+ `url` 속성) | 매체 이름과 도메인(예: `Yahoo Finance`, `https://stocksdownunder.com`) | 그대로 저장한다 |
| `pubDate` | RFC 822 형식 GMT(예: `Fri, 23 Oct 2026 17:39:50 GMT`) | UTC 시각으로 변환한다 |
| `guid` | 기사마다 고유한 값 | 중복 제거 키로 쓴다 |
| `link` | `news.google.com/rss/articles/...` 경유 주소 | 원문 주소를 얻으려면 기사마다 추가 요청이 필요하다. 요청 수가 늘어나므로 하지 않는다 |
| `description` | `link`와 같은 주소를 담은 HTML | 저장하지 않아도 된다 |

**시각의 61%는 자리표시값이다.** 100건 중 61건이 `07:00:00` 또는 `08:00:00` GMT(미국 서부 자정, 서머타임에 따라 다름)로 왔다.
최근 기사(10/16)도 그랬다. 이런 기사는 날짜만 믿을 수 있으므로 "시각 미상"으로 저장하고 화면에도 시각을 보이지 않는다.
2016년 기사는 모두 `08:00:00 GMT`였다.

**출처 분포:** 100건 중 Yahoo Finance가 40건이다. 그다음은 MarketBeat 9, Investor's Business Daily 7, Seeking Alpha 5건이다.

**같은 기사의 중복:** 한 기사가 여러 매체에 실리기도 한다. 떼어 낸 제목과 날짜가 같으면 한 건으로 묶는다.

**당시 코드의 결함 두 가지(2026-10-25 확인):**

- `StockNewsCrawler._normalize_date`는 시각을 버리고 날짜만 남겼다.
- `pubDate`가 비면 **오늘 날짜**를 채웠다. 틀린 날짜가 조용히 들어간다. 날짜 미상으로 두어야 한다.

## 4. 봇 탐지 사례 조사

| 방식 | 판단 |
| --- | --- |
| RSS 직접 요청 | 가볍다. 차단 보고는 **같은 IP의 요청 빈도** 때문이고, 정해진 하루 할당량은 확인되지 않았다. 막히면 503 페이지("your computer or network may be sending automated queries")나 429가 온다. 공식 기준은 없다. 1분마다 부르면 막히고 15~30분 간격과 캐시가 안전하다는 경험담뿐이다. GNews 라이브러리는 429에 지수 백오프와 지터로 재시도한다. |
| Selenium·헤드리스 크롬 | RSS에는 이득이 없다. RSS는 렌더링이 필요 없는 텍스트다. 무겁고 `navigator.webdriver` 같은 자동화 흔적이 남아 더 잘 걸린다. 일반 구글 뉴스 페이지를 열면 CAPTCHA를 만난다. |
| Obscura 등 위장 브라우저 | Rust 기반 헤드리스 엔진으로, `--stealth`가 TLS와 브라우저 지문을 위장한다고 홍보한다. 독립 검증 자료는 없다. 사이트가 의도적으로 막은 것을 위장해 피하는 방식이라 약관에 어긋나고, 빈도 문제도 그대로다. **쓰지 않는다.** |

## 5. 다른 출처 (과거 뉴스 보조용)

| 출처 | 범위와 한도 | 쓸모 |
| --- | --- | --- |
| 구글 뉴스 RSS | 무료, 키 없음, 1요청 100건, 2016년 기사도 나옴(영어) | **주 출처.** 2017년 이전은 무료로는 이것뿐이다 |
| GDELT DOC 2.0 API | 무료, 키 없음, 2017-01-01부터 검색. 기사 목록 모드는 지정 기간 중 최근 3개월만 본다. 제3자 문서 기준 5초에 1요청 | 2017년 이후 보조 출처. 기간을 3개월 이하로 나눠 묻는다 |
| Finnhub company-news | 무료 키, 분당 약 60회, 회사 뉴스 1년치 | 최근 1년 보강용 |
| Alpha Vantage NEWS_SENTIMENT | 무료 하루 약 25회(경쟁사 페이지 기준, 미확인) | 한도가 작아 맞지 않는다 |
| NewsAPI | 무료는 30일치 | 맞지 않는다 |

Finnhub, Alpha Vantage, GDELT의 수치는 제3자 자료다. 쓰기 전에 공식 문서로 확인한다.

## 6. 요청 수 어림

- **정기 수집:** 관심종목 250개 × 하루 1요청 = 하루 약 250요청. 무작위 20~60초 간격이면 2~3시간에 걸쳐 백그라운드에서 돈다.
- **과거 검색:** 사람이 누를 때 1요청. 결과를 저장하므로 같은 기간은 다시 요청하지 않는다.

## 출처

- [Make Community: Google RSS feed blocked (503 / automated access)](https://community.make.com/t/google-rss-feed-blocked-503-error-automated-access-blocked-any-workarounds/110931)
- [GNews library exceptions (RateLimitError on 429)](https://gnews.readthedocs.io/en/latest/reference/exceptions.html)
- [Google News RSS search parameters (newscatcherapi)](https://newscatcherapi.com/blog/google-news-rss-search-parameters-the-missing-documentaiton)
- [Google News RSS (cloro.dev)](https://cloro.dev/blog/google-news-rss/)
- [Apify Google News Scraper (100-item truncation)](https://apify.com/devilscrapes/google-news-scraper)
- [GDELT DOC 2.0: searching from Jan 1, 2017](https://blog.gdeltproject.org/doc-geo-2-0-api-updates-full-year-searching-and-more/)
- [GDELT DOC 2.0 timespan updates](https://blog.gdeltproject.org/doc-2-0-updates-1-5-year-searching-and-updated-mobile-interface/)
- [gdeltdoc on PyPI](https://pypi.org/project/gdeltdoc/)
- [Obscura (x-cmd)](https://x-cmd.com/install/obscura/)
- [Obscura listing (glama.ai)](https://glama.ai/mcp/servers/fegrpzpucf)
- [DataDome on headless browser signals](https://datadome.co/headless-browsers/headlessbrowser-clubajax/)
- [Finnhub free tier limits (GitHub issue)](https://github.com/Finnhub-Stock-API/finnhub-js/issues/2)
- [Robot Wealth on Finnhub](https://robotwealth.com/finnhub-api/)
- [APILayer: Marketstack vs Alpha Vantage](https://apilayer.com/marketstack-vs-alphavantage)
