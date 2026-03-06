# Project Specification: Stock & News Data Analysis System

## 1. Directory & Data Structure
The system follows a hierarchical storage structure for efficient data retrieval.

### A. Individual Stock Folder (Parent)
* **Daily Stock Prices (Sub-folder 1):** Stores daily price data in `.csv` or `.json`.
    * **Fields:** `Stock Name`, `Open`, `Close`, `Low`, `High`, `Volume`
* **Scraped Articles (Sub-folder 2):** Stores news related to specific stocks.
    * **Fields:** `Headline`, `Scraped Date`, `Publication Date`, `Source`, `URL`, `Cleaned Content` (Parsed/No ads), `Importance` (Scale 1–5)

### B. Macro Events Folder (Parent)
* Stores significant global events (e.g., Presidential speeches, Fed/FOMC announcements).
* Follows the same data schema as the "Scraped Articles" sub-folder.

---

## 2. Key Functional Requirements
* **Event Correlation:** Track specific dates to see how news impacted stock prices.
* **Interactive Visualization:**
    * **Daily Price Chart:** Visualize stock trends with event indicators.
    * **Hover Effect:** Display `Headline` and `Source` via tooltips when hovering over markers.
    * **Click Action:** Open the original `URL` or display the `Cleaned Scraped Content` within the app.

---

## 3. Technical Feasibility (Streamlit Review)
Is Streamlit sufficient? **Yes**, with the following considerations:

* **Charting:** Standard Streamlit charts are limited. Use **Plotly** or **Altair** to implement interactive markers, hover effects, and click events.
* **Data Processing:** Use **Pandas** to handle `.csv`/`.json` files and filter data by date.
* **Web Scraping/Parsing:** Use Python libraries like **BeautifulSoup**, **Newspaper3k**, or **Selenium** to extract "Cleaned Content" (removing ads/noise).
* **UI/UX:** Streamlit's `st.session_state` can manage the view transition between the main chart and the detailed article view.