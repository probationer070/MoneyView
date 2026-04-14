import os
import re
from pathlib import Path
import yt_dlp


COOKIE_FILE = "youtube_cookies.txt"
OUTPUT_DIR = "youtube_subtitles"
URL = "https://www.youtube.com/watch?v=4vrPB54mx3g"


"""
YT-dlp로 자막 다운로드 + VTT/SRT -> TXT 변환
- 자막 줄 정리: 타임코드, 메타정보, HTML 태그
- 중복 줄 제거

멤버쉽 영상도 가능
- 쿠키 필요 (멤버쉽 권한 포함)
    - Get cookies.txt browser extension 등으로 쿠키 추출 후 COOKIE_FILE 경로에 저장
    - Get cookies.txt 에선 Export 만 실행해도 됨
- yt-dlp challenge 문제로 인해 실패할 수 있음 (특히 자막이 있는 영상에서)
"""

"""
성공시 에시:

WARNING: [youtube] aCnK3V9b-nA: n challenge solving failed: Some formats may be missing. Ensure you have a supported JavaScript runtime and challenge solver script distribution installed. Review any warnings presented before this message. For more details, refer to  https://github.com/yt-dlp/yt-dlp/wiki/EJS
WARNING: Only images are available for download. use --list-formats to see them 
WARNING: Requested format is not available 
[영상 제목] 002. Player와 실존주의적 관점으로 해법찾기
[수동 자막 언어] []
[자동 자막 언어] ['ab', 'aa', 'af', 'ak', 'sq', 'am', 'ar', 'hy', 'as', 'ay', 'az', 'bn', 'ba', 'eu', 'be', 'bho', 'bs', 'br', 'bg', 'my', 'ca', 'ceb', 'zh-Hans', 'zh-Hant', 'co', 'hr', 'cs', 'da', 'dv', 'nl', 'dz', 'en', 'eo', 'et', 'ee', 'fo', 'fj', 'fil', 'fi', 'fr', 'gaa', 'gl', 'lg', 'ka', 'de', 'el', 'gn', 'gu', 'ht', 'ha', 'haw', 'iw', 'hi', 'hmn', 'hu', 'is', 'ig', 'id', 'iu', 'ga', 'it', 'ja', 'jv', 'kl', 'kn', 'kk', 'kha', 'km', 'rw', 'ko-orig', 'ko', 'kri', 'ku', 'ky', 'lo', 'la', 'lv', 'ln', 'lt', 'lua', 'luo', 'lb', 'mk', 'mg', 'ms', 'ml', 'mt', 'gv', 'mi', 'mr', 'mn', 'mfe', 'ne', 'new', 'nso', 'no', 'ny', 'oc', 'or', 'om', 'os', 'pam', 'ps', 'fa', 'pl', 'pt', 'pt-PT', 'pa', 'qu', 'ro', 'rn', 'ru', 'sm', 'sg', 'sa', 'gd', 'sr', 'crs', 'sn', 'sd', 'si', 'sk', 'sl', 'so', 'st', 'es', 'su', 'sw', 'ss', 'sv', 'tg', 'ta', 'tt', 'te', 'th', 'bo', 'ti', 'to', 'ts', 'tn', 'tum', 'tr', 'tk', 'uk', 'ur', 'ug', 'uz', 've', 'vi', 'war', 'cy', 'fy', 'wo', 'xh', 'yi', 'yo', 'zu']
[다운로드 대상 언어] ['ko']
[youtube] Extracting URL: https://www.youtube.com/watch?v=aCnK3V9b-nA 
[youtube] aCnK3V9b-nA: Downloading webpage 
[youtube] aCnK3V9b-nA: Downloading tv downgraded player API JSON 
WARNING: [youtube] aCnK3V9b-nA: n challenge solving failed: Some formats may be missing. Ensure you have a supported JavaScript runtime and challenge solver script distribution installed. Review any warnings presented before this message. For more details, refer to  https://github.com/yt-dlp/yt-dlp/wiki/EJS
[info] aCnK3V9b-nA: Downloading subtitles: ko 
WARNING: Only images are available for download. use --list-formats to see them 
WARNING: Requested format is not available
[info] Writing video subtitles to: youtube_subtitles\002. Player와 실존주의적 관점으로 해법찾기 [aCnK3V9b-nA].NA.ko.vtt
[download] Destination: youtube_subtitles\002. Player와 실존주의적 관점으로 해법찾기 [aCnK3V9b-nA].NA.ko.vtt 
[download] 100% of   88.41KiB in 00:00:00 at 185.41KiB/s
[변환 완료] youtube_subtitles\002. Player와 실존주의적 관점으로 해법찾기 [aCnK3V9b-nA].NA.ko.txt
"""

"""
실패시 예시:

[youtube] Extracting URL: https://www.youtube.com/watch?v=nNTnWo7FvSI 
[youtube] nNTnWo7FvSI: Downloading webpage 
WARNING: [youtube] No supported JavaScript runtime could be found. Only deno is enabled by default; to use another runtime add  --js-runtimes RUNTIME[:PATH]  to your command/config. YouTube extraction without a JS runtime has been deprecated, and some formats may be missing. See  https://github.com/yt-dlp/yt-dlp/wiki/EJS  for details on installing one
[youtube] nNTnWo7FvSI: Downloading android vr player API JSON 
WARNING: [youtube] This video is available to this channel's members on level: Player(선수들) (or any higher level). Join this channel to get access to members-only content and other exclusive perks. 
WARNING: No video formats found! 
WARNING: Requested format is not available 
[영상 제목] [멤버쉽] 001: Player는 Maximalist다. #니체
[수동 자막 언어] []
[자동 자막 언어] []
[종료] ko/en 자막이 없습니다.
"""

def clean_filename(name: str) -> str:
    if not name:
        return "untitled"
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    return name.strip() or "untitled"


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)

def normalize_caption_text(line: str) -> str:
    """
    VTT/SRT 한 줄 정리
    """
    # <00:00:01.234> 같은 timestamp 태그 제거
    line = re.sub(r"<\d{2}:\d{2}:\d{2}\.\d{3}>", "", line)

    # <c>, </c> 제거
    line = re.sub(r"</?c>", "", line)

    # 기타 HTML 유사 태그 제거
    line = re.sub(r"<[^>]+>", "", line)

    # HTML escape 비슷한 것 최소 정리
    line = line.replace("&nbsp;", " ")
    line = line.replace("&amp;", "&")
    line = line.replace("&lt;", "<")
    line = line.replace("&gt;", ">")

    # 공백 정리
    line = re.sub(r"\s+", " ", line).strip()
    return line


def is_metadata_line(line: str) -> bool:
    """
    본문이 아닌 라인 판별
    """
    if not line:
        return True
    if line.upper() == "WEBVTT":
        return True
    if line.startswith("Kind:"):
        return True
    if line.startswith("Language:"):
        return True
    if "-->" in line:
        return True
    if line.isdigit():
        return True
    if line.startswith("NOTE"):
        return True
    return False


def merge_overlap(prev_line: str, curr_line: str, min_overlap_len: int = 2) -> str | None:
    """
    prev_line의 끝부분과 curr_line의 시작부분이 겹치면 병합
    예:
      prev = "인생은 무의미합니다"
      curr = "무의미합니다 이건 허무주의"
      -> "인생은 무의미합니다 이건 허무주의"

    min_overlap_len:
      최소 몇 글자 이상 겹쳐야 병합할지
    """
    if not prev_line or not curr_line:
        return None

    if prev_line == curr_line:
        return prev_line

    max_len = min(len(prev_line), len(curr_line))

    # 가장 긴 overlap부터 찾음
    for overlap_len in range(max_len, min_overlap_len - 1, -1):
        prev_suffix = prev_line[-overlap_len:]
        curr_prefix = curr_line[:overlap_len]

        if prev_suffix == curr_prefix:
            merged = prev_line + curr_line[overlap_len:]
            merged = re.sub(r"\s+", " ", merged).strip()
            return merged

    return None


def should_replace_previous(prev_line: str, curr_line: str) -> bool:
    """
    curr이 prev의 확장판이면 True
    """
    if not prev_line or not curr_line:
        return False
    if prev_line == curr_line:
        return False
    return curr_line.startswith(prev_line)


def vtt_or_srt_to_txt_smart_merge(sub_path: str) -> str:
    """
    VTT/SRT -> 중복 제거 + 확장 교체 + overlap 병합 버전
    """
    sub_path = Path(sub_path)
    txt_path = sub_path.with_suffix(".txt")

    with open(sub_path, "r", encoding="utf-8-sig") as f:
        raw_lines = f.readlines()

    result_lines: list[str] = []

    for raw in raw_lines:
        line = raw.strip()

        if is_metadata_line(line):
            continue

        line = normalize_caption_text(line)
        if not line:
            continue

        if not result_lines:
            result_lines.append(line)
            continue

        prev = result_lines[-1]

        # 1) 완전 동일
        if line == prev:
            continue

        # 2) 현재 줄이 이전 줄의 확장판이면 교체
        if should_replace_previous(prev, line):
            result_lines[-1] = line
            continue

        # 3) 이전 줄이 현재 줄의 확장판이면 현재 줄 버림
        if prev.startswith(line):
            continue

        # 4) overlap 병합 시도
        merged = merge_overlap(prev, line, min_overlap_len=2)
        if merged:
            result_lines[-1] = merged
            continue

        # 5) 그 외에는 새 줄 추가
        result_lines.append(line)

    # 선택: 멀리 떨어진 중복도 한 번 더 제거
    final_lines: list[str] = []
    seen = set()

    for line in result_lines:
        if line not in seen:
            final_lines.append(line)
            seen.add(line)

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(final_lines))

    return str(txt_path)

def list_subtitles(url: str) -> dict | None:
    """
    자막/자동자막 목록 확인
    """
    ydl_opts = {
        "cookiefile": COOKIE_FILE,
        "skip_download": True,
        "quiet": False,
        "ignoreerrors": True,
        "ignore_no_formats_error": True,
        "no_warnings": False,
        "extract_flat": False,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return info
    except Exception as e:
        print(f"[실패] 자막 정보 조회 실패: {e}")
        return None


def pick_languages(info: dict) -> list[str]:
    """
    수동 자막 > 자동 자막 순서로 ko/en 우선 선택
    """
    # wanted = ["ko", "ko-KR", "en", "en-US"]
    wanted = ["ko"]

    subtitles = info.get("subtitles") or {}
    auto_captions = info.get("automatic_captions") or {}

    available = []

    for lang in wanted:
        if lang in subtitles:
            available.append(lang)

    for lang in wanted:
        if lang in auto_captions and lang not in available:
            available.append(lang)

    return available


def download_subtitles(url: str, langs: list[str], title: str) -> list[str]:
    """
    자막만 다운로드
    """
    ensure_dir(OUTPUT_DIR)

    outtmpl = os.path.join(
        OUTPUT_DIR,
        f"{clean_filename(title)} [%(id)s].%(language)s.%(ext)s"
    )

    ydl_opts = {
        "cookiefile": COOKIE_FILE,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": langs,
        "subtitlesformat": "vtt/srt/best",
        "outtmpl": outtmpl,
        "quiet": False,
        "ignoreerrors": True,
        "ignore_no_formats_error": True,
        "no_warnings": False,
        "format": None,   # 기본 포맷 선택 강제 최소화
    }

    before_files = set(Path(OUTPUT_DIR).glob("*"))

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
    except Exception as e:
        print(f"[실패] 자막 다운로드 실패: {e}")

    after_files = set(Path(OUTPUT_DIR).glob("*"))
    new_files = [str(p) for p in (after_files - before_files) if p.suffix.lower() in [".vtt", ".srt"]]

    return new_files


def main():
    ensure_dir(OUTPUT_DIR)

    info = list_subtitles(URL)
    if not info:
        print("[종료] 영상 정보 자체를 가져오지 못했습니다.")
        return

    title = info.get("title") or info.get("id") or "untitled"
    print(f"[영상 제목] {title}")

    subtitles = info.get("subtitles") or {}
    auto_captions = info.get("automatic_captions") or {}

    print(f"[수동 자막 언어] {list(subtitles.keys())}")
    print(f"[자동 자막 언어] {list(auto_captions.keys())}")

    langs = pick_languages(info)
    if not langs:
        print("[종료] ko/en 자막이 없습니다.")
        return

    print(f"[다운로드 대상 언어] {langs}")

    sub_files = download_subtitles(URL, langs, title)

    if not sub_files:
        print("[경고] 자막 파일이 실제로 저장되지 않았습니다.")
        print("       쿠키 만료, 멤버십 권한 부족, 또는 yt-dlp challenge 문제일 가능성이 큽니다.")
        return

    for sub_file in sub_files:
        try:
            txt_file = vtt_or_srt_to_txt_smart_merge(sub_file)
            print(f"[변환 완료] {txt_file}")
        except Exception as e:
            print(f"[변환 실패] {sub_file} -> {e}")


if __name__ == "__main__":
    main()