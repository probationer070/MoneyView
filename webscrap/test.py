import pandas as pd
import os

from typing import Dict, Optional
from WebScrap.nasdaq import single_snapshot
from favor import STOCK_LIST

def d_format(stock_kr, stock_code):
    """주식 한국명과 코드로 딕셔너리 생성"""
    return {stock_kr: stock_code}

# 선별한 종목들의 데이터를 저장
def save_selected_stocks_data(selected_stocks: list[Dict[str, str]] = None, file_path: Optional[str] = None):

    failed_stocks = []
    for stock, stock_code in selected_stocks.items():
        print(f"Processing stock: {stock}")
        if not single_snapshot(d_format(stock, stock_code), file_path):
            failed_stocks.append(stock)
        print(f"Processed data for {stock}")

    if failed_stocks:
        print("\n=== 데이터 저장 실패 종목 ===")
        for stock in failed_stocks:
            print(stock)


def test_code():
    # 예시: 선별된 종목 리스트 (최초 1회 실행 시에만 사용)
    # save_selected_stocks_data(STOCK_LIST)


    
    # 현재 파일 위치
    current_dir = os.path.dirname(os.path.abspath(__file__))
    stock_ratio = pd.read_csv("nasdaq_institutional_holdings.csv", encoding='utf-8')
    # # 기관소유비율 기준 상위 10개 종목 추출
    # stock_top10 = stock_ratio.sort_values(by='기관소유비율', ascending=False).head(10)
    # print(stock_top10)


    # TODO: 테스트 용 - 완료
     # 데이터 타입 확인
    # print(stock_ratio.dtypes)
    # 기관소유비율 컬럼을 숫자형으로 변환
    # stock_ratio['기관소유비율'] = pd.to_numeric(stock_ratio['기관소유비율'], errors='coerce')
    # print(stock_ratio.dtypes)
    # errors='coerce' 옵션은 변환 불가능한 값을 NaN으로 처리합니다. -> Error
    # --------------------------------


    # --- 필터링 조건 적용 ---
    # 1. float(실수형)으로 변환합니다. '%' 기호를 제거합니다.
    stock_ratio['기관소유비율'] = stock_ratio['기관소유비율'].str.replace('%', '').astype(float)

    # 2. 필터링 조건 적용: 50% 이상 90% 이하
    stock_filtered = stock_ratio[(stock_ratio['기관소유비율'] <= 90) & (stock_ratio['기관소유비율'] >= 50)]

    # 결과 확인
    print(stock_filtered)
    # 필터링된 종목들의 데이터 저장
    stock_filtered.sort_values(by='기관소유비율', ascending=False, inplace=True)
    stock_filtered.to_csv("filtered_stocks.csv", index=False, encoding='utf-8')
    print(f"[Save] Filtered data saved to {os.path.join(current_dir, 'filtered_stocks.csv')}")
    # -------------------------------- 



from WebScrap.Crawler import YoutubeCrawler
if __name__ == "__main__":
# --- 특정 종목 데이터 저장 테스트 ---
    # test_code()
# ------------------------------------

    # --- 사용 방법 ---
    # 단, 멤버쉽 영상의 자막은 불러올 수 없음
    # 1. 재생목록 URL 또는 단일 영상 URL 중 하나를 입력하세요.
    single_url = "https://www.youtube.com/watch?v=anhvdbjx5YQ&list=PLBNdLLaRx_rLUcipD2RgJjyh9K7CfWv7S&index=1" # 예: "https://www.youtube.com/watch?v=..."

    # 3. 스크립트를 실행하면 `output_folder`에 자막이 저장됩니다.
    YoutubeCrawler.download_subtitles(single_url)

# TODO: 각종 경제 지표 수집 테스트
