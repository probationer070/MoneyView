import pandas as pd
import os
import re

# --- 설정 ---
RAW_DATA_DIR = "saved_data_raw"  # 원본 파일을 저장할 디렉토리 (새로 생성 권장)
PROCESSED_DATA_DIR = "saved_data" # 처리된 파일을 저장할 디렉토리

# --- 도우미 함수 ---
def ensure_dir(directory):
    """디렉토리가 없으면 생성합니다."""
    if not os.path.exists(directory):
        os.makedirs(directory)

def save_tidy_data(df, category, name):
    """표준 형식의 데이터프레임을 지정된 카테고리와 이름으로 저장합니다."""
    if df.empty:
        return

    cat_dir = os.path.join(PROCESSED_DATA_DIR, category.replace('/', '_'))
    ensure_dir(cat_dir)

    file_path = os.path.join(cat_dir, f"{name}.csv")

    # 표준 컬럼 순서 정의
    standard_columns = ["category", "name", "code", "value", "unit", "date", "source", "cycle"]
    for col in standard_columns:
        if col not in df.columns:
            df[col] = None

    df = df[standard_columns]  # 컬럼 순서 맞추기

    df.to_csv(file_path, index=False, encoding='utf-8-sig')
    print(f"✅ '{name}' 데이터를 다음 경로에 저장했습니다: {file_path}")

# --- 변환 함수 ---

def process_minimum_wage():
    """최저임금.csv 파일을 표준 형식으로 변환합니다."""
    print("\n[처리 시작] 최저임금.csv")
    try:
        raw_path = os.path.join(PROCESSED_DATA_DIR, '최저임금.csv')
        if not os.path.exists(raw_path):
            print("⚠️ '최저임금.csv' 파일을 찾을 수 없어 건너뜁니다.")
            return

        # 헤더가 복잡하고 첫 줄이 비어있을 수 있으므로, 헤더 없이 불러와 수동 처리
        try:
            df = pd.read_csv(raw_path, encoding='utf-8', header=None, on_bad_lines='skip')
        except UnicodeDecodeError:
            df = pd.read_csv(raw_path, encoding='cp949', header=None, on_bad_lines='skip')

        if df.empty:
            return

        if df.shape[1] > 7:
            df = df.iloc[:, :7]

        df.columns = ['적용연도', '시간급', '일급', '월급', '인상률', '심의의결일', '결정고시일']

        tidy_rows = []
        for _, row in df.iterrows():
            year_match = re.search(r"\'(\d{2})", str(row['적용연도']))
            if not year_match: continue
            year = int(year_match.group(1))
            year_full = 2000 + year if year < 50 else 1900 + year

            value = float(str(row['시간급']).replace('"', '').replace(',', ''))

            tidy_rows.append({
                "category": "사회/구조", "name": "최저임금(시간급)", "code": "MINIMUM_WAGE_HOURLY",
                "value": value, "unit": "원", "date": str(year_full), "source": "최저임금위원회", "cycle": "A"
            })

        if tidy_rows:
            save_tidy_data(pd.DataFrame(tidy_rows), "사회_구조", "최저임금")
    except Exception as e:
        print(f"❌ '최저임금.csv' 처리 중 오류 발생: {e}")

def process_wage_by_age():
    """연령별_임금_및_근로시간.csv 파일을 표준 형식으로 변환합니다."""
    print("\n[처리 시작] 연령별_임금_및_근로시간.csv")
    try:
        raw_path = os.path.join(PROCESSED_DATA_DIR, '연령별_임금_및_근로시간.csv')
        if not os.path.exists(raw_path):
            print("⚠️ '연령별_임금_및_근로시간.csv' 파일을 찾을 수 없어 건너뜁니다.")
            return

        df = pd.read_csv(raw_path, encoding='utf-8', header=[0, 1])
        df.columns = ['_'.join(col).strip() for col in df.columns.values]
        df.rename(columns={'고용형태_고용형태': '고용형태', '연령_연령': '연령'}, inplace=True)

        df_melted = pd.melt(df, id_vars=['고용형태', '연령'], var_name='연도_지표', value_name='값')
        df_melted[['연도', '지표']] = df_melted['연도_지표'].str.split('_', n=1, expand=True)
        df_melted.drop(columns='연도_지표', inplace=True)

        df_melted['값'] = pd.to_numeric(df_melted['값'], errors='coerce')
        df_melted.dropna(subset=['값'], inplace=True)

        tidy_rows = []
        for _, row in df_melted.iterrows():
            metric_name, unit = (row['지표'].split(' (') + [''])[:2]
            unit = unit.replace(')', '')

            tidy_rows.append({
                "category": "임금", "name": f"{metric_name}({row['고용형태']}, {row['연령']})",
                "code": f"WAGE_{row['고용형태']}_{row['연령']}", "value": row['값'], "unit": unit,
                "date": str(row['연도']), "source": "고용노동부", "cycle": "A"
            })

        if tidy_rows:
            save_tidy_data(pd.DataFrame(tidy_rows), "임금", "연령별_임금_및_근로시간")
    except Exception as e:
        print(f"❌ '연령별_임금_및_근로시간.csv' 처리 중 오류 발생: {e}")

def process_social_insurance():
    """사회보험료.csv 파일을 표준 형식으로 변환합니다."""
    print("\n[처리 시작] 사회보험료.csv")
    try:
        # 이 파일은 사용자가 직접 생성해야 합니다.
        raw_path = os.path.join(PROCESSED_DATA_DIR, '사회보험료.csv')
        if not os.path.exists(raw_path):
            print("⚠️ '사회보험료.csv' 파일을 찾을 수 없어 건너뜁니다. 아래 형식으로 파일을 생성해주세요:")
            print("year,health_insurance_rate,national_pension_rate")
            print("2024,7.09,9.0")
            return

        df = pd.read_csv(raw_path)
        
        tidy_rows = []
        # 건강보험료
        health_df = df[['year', 'health_insurance_rate']].dropna()
        for _, row in health_df.iterrows():
            tidy_rows.append({
                "category": "사회/구조", "name": "건강보험료율", "code": "HEALTH_INSURANCE_RATE",
                "value": row['health_insurance_rate'], "unit": "%", "date": str(int(row['year'])), 
                "source": "국민건강보험공단", "cycle": "A"
            })
            
        # 국민연금
        pension_df = df[['year', 'national_pension_rate']].dropna()
        for _, row in pension_df.iterrows():
            tidy_rows.append({
                "category": "사회/구조", "name": "국민연금보험료율", "code": "NATIONAL_PENSION_RATE",
                "value": row['national_pension_rate'], "unit": "%", "date": str(int(row['year'])), 
                "source": "국민연금공단", "cycle": "A"
            })

        if tidy_rows:
            save_tidy_data(pd.DataFrame(tidy_rows), "사회_구조", "사회보험료")
            
    except Exception as e:
        print(f"❌ '사회보험료.csv' 처리 중 오류 발생: {e}")

# --- 메인 실행 ---
if __name__ == "__main__":
    print("--- 데이터 표준화 전처리 시작 ---")
    ensure_dir(PROCESSED_DATA_DIR)

    # 각 파일 처리 함수 호출
    process_minimum_wage()
    process_wage_by_age()
    process_social_insurance()
    # 참고: '시군구_연령별_취업자_및_고용률_전체.csv' 파일도 위와 유사한 방식으로 전처리 함수를 추가할 수 있습니다.

    print("\n--- 데이터 표준화 완료 ---")
    print("이제 Streamlit 앱을 실행하면 변환된 데이터가 대시보드에 표시됩니다.")