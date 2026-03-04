# # import pandas as pd

# # # 1. 데이터 불러오기 (보유하신 CSV 파일명)
# # df = pd.read_csv('saved_data/시군구_연령별_취업자_및_고용률_전체.csv')

# # # 2. '취업자 (천명)' 컬럼만 추출하여 합계 계산
# # # 데이터 구조상 숫자에 콤마(,)가 있을 수 있으므로 처리 필요
# # target_age_groups = ["계", "15 - 29세", "15 - 64세", "55세이상", "65세이상"]

# # summary = []
# # for age in target_age_groups:
# #     age_df = df[df['연령별'] == age]
# #     # 숫자로 변환 후 합계 (천명 단위)
# #     total_workers = age_df.iloc[:, 1].str.replace(',', '').astype(float).sum()
# #     summary.append({'연령대': age, '전국취업자합계(천명)': total_workers})

# # summary_df = pd.DataFrame(summary)
# # print(summary_df)



# import pandas as pd
# import numpy as np

# # 1. CSV 로드 (숫자 데이터의 콤마 제거)
# # 실제 파일명으로 수정하세요.
# df_raw = pd.read_csv('saved_data/시군구_연령별_취업자_및_고용률_전체.csv', header=None)

# # 2. 헤더 정보 추출 (행 위치에 주의!)
# # 행 0: 연도 (2021.1/2, NaN, NaN...) -> ffill로 채움
# years = df_raw.iloc[0, 1:].ffill().values 
# # 행 1: 지표 (취업자 (천명)...)
# metrics = df_raw.iloc[1, 1:].values
# # 행 2: 지역 (서울 종로구, 서울 중구...) -> 여기서는 합치기 위해 무시

# # 3. 데이터 본문 정제
# data_body = df_raw.iloc[3:].copy() # "계", "15-64세" 등이 시작되는 행
# data_body.set_index(0, inplace=True)
# data_body.index = data_body.index.str.strip() # 인덱스 공백 제거

# # 숫자로 강제 변환 (문자열 등이 섞여있을 경우 대비)
# data_numeric = data_body.apply(pd.to_numeric, errors='coerce').fillna(0)

# # 4. 연도별 통합 (모든 지역 합치기)
# unique_years = pd.unique(years)
# final_result = pd.DataFrame(index=data_numeric.index)

# for year in unique_years:
#     # 1) 해당 연도에 해당하는 모든 열의 위치(index)를 찾음
#     year_indices = np.where(years == year)[0]
    
#     # 2) 그 중에서 '취업자' 지표인 열만 필터링
#     # (고용률이 섞여있을 경우를 대비해 필터링 로직 추가)
#     emp_sub_indices = [i for i in year_indices if '취업자' in str(metrics[i])]
    
#     # 3) 해당 열들을 모두 더함 (지역 통합)
#     if emp_sub_indices:
#         final_result[year] = data_numeric.iloc[:, emp_sub_indices].sum(axis=1)

# print("--- 연도별 전지역 취업자 통합 결과 (단위: 천명) ---")
# print(final_result)

# # 필요시 엑셀이나 CSV로 저장
# # final_result.to_csv('yearly_total_employment.csv')



from WebScrap.Crawler import YoutubeCrawler
if __name__ == "__main__":
# --- 특정 종목 데이터 저장 테스트 ---
    # test_code()
# ------------------------------------

    # --- 사용 방법 ---
    # 단, 멤버쉽 영상의 자막은 불러올 수 없음
    # 1. 재생목록 URL 또는 단일 영상 URL 중 하나를 입력하세요.
    single_url = "https://www.youtube.com/watch?v=3dGUygjybno" # 예: "https://www.youtube.com/watch?v=..."

    # 3. 스크립트를 실행하면 `output_folder`에 자막이 저장됩니다.
    YoutubeCrawler.download_subtitles(single_url)