"""investiny 동작 테스트 스크립트"""

# 1. investiny 설치 확인
try:
    from investiny import historical_data, search_assets
    print("[OK] investiny 라이브러리 로드 성공")
except ImportError:
    print("[FAIL] investiny가 설치되지 않았습니다.")
    print("       실행: pip install investiny")
    exit(1)

# 2. South Korea CDS 검색
print("\n--- South Korea CDS 검색 ---")
try:
    results = search_assets(query="south korea cds", limit=5, type="Bond")
    for r in results:
        print(f"  ID: {r.get('ticker', '?')}, Name: {r.get('name', '?')}, Exchange: {r.get('exchange', '?')}")
    if results:
        cds_id = int(results[0]["ticker"])
        print(f"\n  → 사용할 ID: {cds_id}")
    else:
        print("  검색 결과 없음, 기본 ID 사용 시도")
        cds_id = 1159098
except Exception as e:
    print(f"  검색 실패: {e}")
    cds_id = 1159098

# 3. 히스토리컬 데이터 가져오기
print(f"\n--- 히스토리컬 데이터 조회 (ID={cds_id}) ---")
try:
    data = historical_data(investing_id=cds_id, from_date="01/01/2025", to_date="03/01/2026")
    if data and "close" in data:
        print(f"  [OK] 데이터 포인트: {len(data['close'])}건")
        print(f"  키: {list(data.keys())}")
        print(f"  최근 5개 close: {data['close'][-5:]}")
    else:
        print(f"  [WARN] 데이터가 비어있음: {data}")
except Exception as e:
    print(f"  [FAIL] 데이터 조회 실패: {e}")

print("\n--- 테스트 완료 ---")
