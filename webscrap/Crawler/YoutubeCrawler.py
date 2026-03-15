import os
import re
import time
import json
import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled
from youtube_transcript_api.proxies import WebshareProxyConfig

def clean_filename(title):
    """
    문자열을 유효한 파일명으로 사용하기 위해 정리합니다.
    파일명에 사용할 수 없는 특수문자를 제거합니다.
    """
    # Windows 파일명 금지 문자: < > : " / \ | ? *
    return re.sub(r'[\\/*?:"<>|]', "", title)
def get_data_proxy():
    with open("./pest.json", "r", encoding="utf-8") as f:
        data = json.load(f)
    return WebshareProxyConfig(
        proxy_username=data.get("user"),
        proxy_password=data.get("password")
    )

def text_reform(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            new_content = content.replace('.', '.\n')
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
    except Exception as e:
        print(f"file : {e}")


def _download_and_save_transcript(video_id, video_title, output_dir):
    """
    내부 함수: 자막 다운로드 및 저장 로직 (중복 제거)
    """
    max_retries = 10
    for attempt in range(max_retries):
        try:
            # 3. 자막을 가져옵니다.
            # 한국어 자막을 우선으로 시도하고, 없으면 영어 자막을 가져옵니다.
            ytt_api = YouTubeTranscriptApi(
                proxy_config=get_data_proxy()
            )
            transcript_data = ytt_api.fetch(video_id, languages=['ko', 'en'])
            
            # 4. 자막 조각들을 하나의 문자열로 합칩니다.
            # 반환값은 딕셔너리 리스트입니다.
            full_transcript = " ".join([item['text'] for item in transcript_data])
            full_transcript = full_transcript.replace('. ', '.\n')

            # 5. .txt 파일로 저장합니다.
            safe_title = clean_filename(video_title)
            # 파일명을 '영상제목_영상ID.txt' 형식으로 하여 고유성을 보장합니다.
            file_path = os.path.join(output_dir, f"{safe_title}.txt")
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(full_transcript)
            
            print(f"  -> 자막을 '{file_path}' 파일로 저장했습니다.")
            return

        except (NoTranscriptFound, TranscriptsDisabled):
            print(f"  -> 오류: 이 영상에는 자막이 없거나 비활성화되어 있습니다.")
            return
        except Exception as e:
            if attempt < max_retries - 1:
                if "429" in str(e):
                    print(f"  -> YouTube IP 차단(429) 감지. 새 IP 할당을 위해 대기 및 재시도합니다.")
                wait_time = 10 * (attempt + 1)
                print(f"  -> 오류 발생 (재시도 {attempt+1}/{max_retries}, {wait_time}초 대기): {e}")
                time.sleep(wait_time)
            else:
                print(f"  -> 실패: {e}")

def download_subtitles(url):
    """
    유튜브 URL(단일 영상 또는 재생목록)을 받아 자막을 다운로드합니다.
    URL의 종류를 자동으로 감지하여 처리합니다.
    """
    print(f"URL 처리 시작: {url}")

    # 'extract_flat': 'in_playlist'는 재생목록일 경우 전체 영상 정보를 한 번에 가져오고,
    # 단일 영상일 경우 해당 영상 정보만 가져오는 효율적인 옵션입니다.
    ydl_opts = {
        'extract_flat': 'in_playlist',
        'quiet': True,
        'ignoreerrors': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

            # Case 1: 재생목록 또는 'list' 파라미터가 포함된 URL
            if 'entries' in info and info['entries']:
                video_entries = info['entries']
                playlist_title = info.get('title', 'Playlist')
                if not os.path.exists(playlist_title):
                    os.makedirs(playlist_title)
                    print(f"'{playlist_title}' 폴더를 생성했습니다.")
                print(f"재생목록 '{playlist_title}'에서 동영상을 가져오는 중... (총 {len(video_entries)}개)")
                
                for i, entry in enumerate(video_entries, 1):
                    if not entry:
                        print(f"\n[{i}/{len(video_entries)}] 항목을 건너뜁니다 (정보 없음).")
                        continue
                    
                    video_id = entry.get('id')
                    video_title = entry.get('title', video_id)
                    
                    if not video_id:
                        print(f"\n[{i}/{len(video_entries)}] '{video_title}' 영상의 ID를 찾을 수 없어 건너뜁니다.")
                        continue
                        
                    print(f"\n[{i}/{len(video_entries)}] 처리 중: '{video_title}' (ID: {video_id})")
                    _download_and_save_transcript(video_id, video_title, playlist_title)
                    time.sleep(30) # 서버에 부담을 주지 않도록 잠시 대기

            # Case 2: 단일 영상 URL
            elif 'id' in info:
                video_id = info.get('id')
                video_title = info.get('fulltitle') or info.get('title') or video_id
                print(f"단일 영상 처리 중: '{video_title}' (ID: {video_id})")
                
                # 단일 영상인 경우 저장할 폴더 지정
                single_output_dir = "Single_Videos"
                if not os.path.exists(single_output_dir):
                    os.makedirs(single_output_dir)
                _download_and_save_transcript(video_id, video_title, single_output_dir)
            
            else:
                print("오류: 제공된 URL에서 영상 정보를 추출할 수 없습니다.")

    except Exception as e:
        print(f"오류 발생: {e}")

if __name__ == '__main__':
    # --- 사용 방법 ---
    # 1. 재생목록 URL 또는 단일 영상 URL 중 하나를 입력하세요.
    single_url = "https://www.youtube.com/watch?v=70uORDj3Lzc" # 예: "https://www.youtube.com/watch?v=..."

    # 3. 스크립트를 실행하면 `output_folder`에 자막이 저장됩니다.
    download_subtitles(single_url)
