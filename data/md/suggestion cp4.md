**✅ Issue Acknowledgement + Table View Redesign Summary**

Yes — as you correctly pointed out, values like  
**Avg ROIC-WACC 1,542,384,497.50%** and **Avg Spread 4,035.62%** are completely meaningless due to **calculation errors / extreme outliers / data issues**.

The portfolio-level average approach breaks down entirely when individual metrics like **ROIC-WACC, DCF, and expected return spreads** contain extreme values.

**Therefore, we are changing direction completely.**

---

## Recommended Direction (Final)

### 1. Remove or Strongly Demote Portfolio-Level Averages

- In the Latest Snapshot Summary card:
  - **Remove Avg ROIC-WACC, Avg Spread, Avg DCF entirely**,  
  OR move them to a small optional section (e.g., bottom “Portfolio Summary”)

**Reason**
- These averages are currently meaningless and misleading
- They add confusion instead of insight

---

### 2. Add Per-Stock Key Metrics Columns in Table View (Core Change)

Redesign Table View (sector-based blocks) into a  
**“stock comparison dashboard at a glance”**

**New Columns (based on persisted snapshot data)**

| Order | Column Name                     | Format              | Color Rule                             | Notes |
|------|--------------------------------|---------------------|----------------------------------------|------|
| 1    | Ticker                         | Text                | -                                      | Existing |
| 2    | Sector                         | Tag                 | -                                      | Linked with sector blocks |
| 3    | Current Price                  | Number              | -                                      | Existing |
| 4    | ROIC - WACC                    | % (2 decimal)       | Positive=Green / Negative=Red / 0=Gray | **NEW** |
| 5    | DCF Value                      | % (2 decimal)       | Positive=Green / Negative=Red          | **NEW** (DCF Upside %) |
| 6    | Expected Return vs Market      | % (2 decimal)       | + = Green / - = Red                    | **NEW** |
| 7    | Volatility (1Y)                | %                   | Higher = Red                           | Existing |
| 8    | Allocation %                   | %                   | -                                      | Partial weights |

---

### 3. Table View UI Improvements (with Sector Blocks)

- Keep **sector-based vertical blocks** (max 6 sectors)
- Each block contains the table above

**UI Enhancements**
- Long tables → **scroll + sticky header**
- Auto column width adjustment
- Future: column show/hide toggle
- **Mobile / small screens**
  - Default: show only ROIC-WACC, DCF, Spread
  - Others collapsible

---

### 4. Integration with Stock Modal (Reuse Existing Chart)

- Clicking a row → opens existing modal

**Modal Enhancements**
- Already planned:
  - Moving averages (5 / 20 / 60 / 120)
  - Daily ↔ Monthly toggle
- **New addition**
  - Bottom section with 3 key metrics:
    - ROIC-WACC
    - DCF
    - Expected vs Market (large card format)

- Future:
  - “Snapshot History” button → historical ROIC-WACC trend chart

---

## Why This Approach Works

### Pros
- Completely eliminates meaningless averages
- Enables **direct per-stock comparison**
- Aligns 100% with Portfolio tab goal:
  → “Volatility + Expected Return comparison”
- Table becomes the **true core dashboard**
- Fully compatible with persisted snapshots
- Allocation % integrates naturally (partial weights + cash)

### Cons & Mitigation
- Table becomes wider  
  → Solve with responsive design + column toggles

- Data errors may still appear per stock  
  → Add validation rule:
    - If value exceeds ±500% → show **“N/A” or “Check Data” (red warning)**

---

## Implementation Priority

### This Sprint
- Add 3 new columns:
  - ROIC-WACC
  - DCF
  - Expected vs Market
- Remove portfolio-level averages
- Apply color rules

### Next
- Add metric cards inside modal
- Implement ±500% validation logic

### Later
- Add sparkline mini charts (ROIC-WACC trend)

---

With this change:

> The **“nonsense average value” problem is completely eliminated**  
> Table View becomes the **true core interface of the Portfolio tab**