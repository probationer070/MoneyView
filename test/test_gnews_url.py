import requests
from bs4 import BeautifulSoup
import re

url = "https://news.google.com/rss/articles/CBMisAFBVV95cUxNRVhwekc3ekV3bEFtUFNXYjFtejJxS25CRnlydDcyUGF4RlVQakxsNmJ0SnVwMVY0R2MzWjZrM2JteFdSMEpiSFRNdjlDb3dVd3pKU0poQXpwV3BMa0FXWlkzRGRRSUowdTIwZGp0WTl0aUFjaTdGcFVmZE9WVkFsRXlKWDdFZ18wZjBSLWVoYjZ5UWxuTDJLVm5EdktpZ2JiSFZUTnN6ZzdYX2YtTUd4aQ?oc=5"

try:
    response = requests.get(url, allow_redirects=True, timeout=10)
    with open("gnews_response.html", "w", encoding="utf-8") as f:
        f.write(response.text)
    print("Saved response to gnews_response.html")
except Exception as e:
    print("Error:", e)
