import requests
import re

url = "https://pypi.org/search/?q=google+news+decoder"
res = requests.get(url)
matches = re.findall(r'<span class="package-snippet__name">([^<]+)</span>', res.text)
print("Matches for 'google news decoder':", matches)

url2 = "https://pypi.org/search/?q=googlenewsdecoder"
res2 = requests.get(url2)
matches2 = re.findall(r'<span class="package-snippet__name">([^<]+)</span>', res2.text)
print("Matches for 'googlenewsdecoder':", matches2)
