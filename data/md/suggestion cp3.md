**✅ Acknowledging the Issue + Table View Improvement Plan**

Yes, as you correctly pointed out, values like **Avg ROIC-WACC 1,542,384,497.50%** and **Avg Spread 4,035.62%** are completely meaningless due to **calculation errors / extreme outliers / data issues**.

The current portfolio-level aggregation approach completely breaks when individual stock metrics like **ROIC-WACC, DCF, and expected return spreads** become excessively large or small.

**So we are changing direction entirely.**

---

## Recommended Changes (Final Summary)

### 1. Remove or Strongly Demote Portfolio-Level Averages

- In the Latest Snapshot Summary card, completely remove or heavily downplay:
  - Avg ROIC-WACC
  - Avg Spread
  - Avg DCF

- If kept, place them optionally at the bottom under a “Portfolio Summary” section

**Reason**
- These averages are no longer meaningful
- They introduce confusion rather than insight

---

### 2. Add Key Per-Stock Metrics to Table View (Core Change)

Redesign the Table View (sector-based blocks) into a true  
**“at-a-glance stock comparison dashboard”**

**New Columns (based on persisted snapshot data)**

| Order | Column Name                     | Format             | Color Rule                                  | Notes |
|------|---------------------------------|--------------------|----------------------------------------------|------|
| 1    | Ticker                          | Text               | -                                            | Existing |
| 2    | Sector                          | Tag                | -                                            | Linked to sector block |
| 3    | Current Price                   | Number             | -                                            | Existing |
| 4    | ROIC - WACC                     | % (2 decimals)     | Positive = Green / Negative = Red / 0 = Gray | **New** |
| 5    | DCF Value                       | % (2 decimals)     | Positive = Green / Negative = Red            | **New** (DCF Upside %) |
| 6    | Expected Return vs Market       | % (2 decimals)     | Positive = Green / Negative = Red            | **New** |
| 7    | Volatility (1Y)                 | %                  | Higher = More Red                            | Existing |
| 8    | Allocation %                    | %                  | -                                            | Partial weights (incl. cash) |

---

### 3. Table View UI Improvements (with Sector Blocks)

- Keep **vertical sector-based blocks** (max 6 sectors per screen)
- Each block contains the table above
- If table grows:
  - Enable vertical scroll
  - Apply sticky header
- Auto column width adjustment
- Future: column show/hide toggle

**Responsive Behavior**
- On smaller screens:
  - Show only ROIC-WACC, DCF, Spread by default
  - Collapse other columns

---

### 4. Integration with Stock Modal (Reuse Existing Chart)

- Clicking a row → opens existing modal

**Inside Modal**
- Moving averages (5 / 20 / 60 / 120)
- Daily ↔ Monthly toggle (already planned)

**New Additions**
- Bottom section:
  - Large card UI displaying:
    - ROIC-WACC
    - DCF Value
    - Expected vs Market
- “Snapshot History” button:
  - Future: graph of ROIC-WACC over time

---

## Why This Approach Works

### Pros
- Completely eliminates meaningless averages
- Enables direct per-stock comparison
- Aligns perfectly with Portfolio tab goal:
  → “Volatility + Expected Return Comparison”
- Turns Table View into a true investment dashboard
- Fully compatible with persisted snapshots
- Naturally integrates allocation via Allocation %

---

### Cons & Mitigation

**Issue**
- Table becomes wider

**Solution**
- Responsive layout
- Column toggle system

---

**Issue**
- Data errors may still appear at stock level

**Solution**
- If value exceeds ±500%:
  - Display “N/A” or red “Check Data” warning
- Future: strengthen data validation pipeline

---

## Implementation Priority

### This Sprint
- Add 3 new columns:
  - ROIC-WACC
  - DCF Value
  - Expected vs Market
- Remove portfolio-level averages
- Apply color rules

### Next
- Add metric cards in modal
- Implement ±500% validation logic

### Later
- Add sparkline (mini graph) in table for ROIC-WACC trend

---

With this change:

- The **“nonsensical averages” problem is completely eliminated**
- Table View becomes the **true core interface of the Portfolio tab**

---

If you want, I can go further and define:
- Exact column IDs and DB schema
- Frontend type definitions (TypeScript)
- API response format
- Lightweight-charts integration strategy