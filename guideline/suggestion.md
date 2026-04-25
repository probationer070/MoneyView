```markdown
# ============================================================
# MoneyView Metrics Architecture Decision (Summary)
# ============================================================

1) Calculation Versioning (ROIC / Growth)
------------------------------------------------------------
✔ Use versioned metrics (DO NOT overwrite existing fields)

Example:
{
  "roic_legacy": 12.3,
  "roic_stable_v2": 8.7,

  "growth_avg_legacy": 28.4,
  "growth_cagr_v2": 15.2
}

Rule:
- Never overwrite historical metrics
- Always track "method" used for calculation
- Ensure reproducibility & auditability


2) UI Exposure (Growth)
------------------------------------------------------------
✔ Show ONLY CAGR in main UI

- Hide average YoY growth from main view
- Expose it only in audit / detail views

Example:
{
  "growth": {
    "value": 15.2,
    "method": "cagr_v2"
  },
  "audit": {
    "growth": {
      "cagr": 15.2,
      "avg_yoy": 28.4,
      "note": "Avg YoY is volatile; CAGR is primary metric"
    }
  }
}


3) Audit Structure
------------------------------------------------------------
✔ Use SINGLE unified audit payload (DO NOT split endpoints)

Example:
{
  "audit": {
    "roic": {...},
    "growth": {...},
    "dcf": {...},
    "wacc": {...}
  }
}

Rule:
- Keep all metrics in one payload
- Maintain consistency across calculations
- Avoid data fragmentation


4) Required Metadata (Critical)
------------------------------------------------------------
✔ Always include method + quality flags

Example:
{
  "value": 8.7,
  "method": "stable_v2",
  "quality": "valid",        # valid | invalid | outlier
  "confidence": 0.92
}

Purpose:
- Prevent data contamination
- Enable filtering / debugging
- Support RAG / AI analysis


# ============================================================
# Core Principle
# ============================================================

"Change calculations, NEVER overwrite history."

- Version everything
- Keep audit trails
- Separate display vs calculation logic

# ============================================================
```
