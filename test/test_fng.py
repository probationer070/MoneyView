import requests
import json

def get_crypto_fng():
    try:
        r = requests.get('https://api.alternative.me/fng/?limit=1', timeout=5)
        data = r.json()
        return data['data'][0]
    except Exception as e:
        return str(e)

def get_cnn_fng():
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
        # Attempt older typical endpoint or new one
        url = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata'
        r = requests.get(url, headers=headers, timeout=5)
        return r.json()
    except Exception as e:
        return str(e)

print("Crypto:", get_crypto_fng())
print("CNN:", list(get_cnn_fng().keys()) if isinstance(get_cnn_fng(), dict) else get_cnn_fng())
