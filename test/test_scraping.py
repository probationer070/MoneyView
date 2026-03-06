import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from views.stocks_news import scrape_and_save_article, get_importance

# 1. Test Tagging
text_high = "The Federal Reserve (Fed) announced a new interest rate decision."
text_low = "Apple releases new iPhone."
print("High Importance Test:", get_importance(text_high) == 5)
print("Low Importance Test:", get_importance(text_low) == 1)

# 2. Test Scraping & Dedup
test_url = "https://www.cnbc.com/2023/10/31/fed-rate-decision-november-2023.html"
# First scrape
success1, msg1, entry1 = scrape_and_save_article(test_url, is_macro=True)
print("Scrape 1 Success:", success1)

# Second scrape (should be duplicate)
success2, msg2, entry2 = scrape_and_save_article(test_url, is_macro=True)
print("Scrape 2 Success (Expected False):", not success2, "| Msg:", msg2)

# Ensure file contains exactly one copy of this article
import json
with open("saved_data/macro/events.json", "r", encoding="utf-8") as f:
    data = json.load(f)
    count = sum(1 for item in data if item.get('url') == test_url)
    print("Deduplication count (Expected 1):", count)
