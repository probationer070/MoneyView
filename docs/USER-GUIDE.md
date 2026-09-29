# MoneyView User Guide

How to start MoneyView, what each screen is for, how to read its numbers, and what to do
when something goes wrong. Developer setup is in the [README](../README.md).

---

## 1. Starting and stopping

### One-time setup: shortcuts

Double-click **`Install MoneyView Shortcuts.cmd`** in the MoneyView folder. It creates two
shortcuts on your Desktop and in the Start menu (Start > MoneyView):

| Shortcut | What it does |
|---|---|
| **MoneyView** | Starts the backend and the web app, then opens MoneyView in your browser. |
| **Stop MoneyView** | Stops both servers. |

Right-click either one and choose **Pin to taskbar** if you like. If you move the MoneyView
folder, double-click the installer again so the shortcuts point at the new place. To remove
them: `powershell -ExecutionPolicy Bypass -File scripts\install_shortcuts.ps1 -Uninstall`.

The very first run still needs the one-time setup in the README (Python environment and
`npm install`). If a dependency is missing, the launcher window says what to run.

### Daily use

1. Double-click **MoneyView**. A small launcher window appears and two server windows open
   (`MoneyView API Server` and `MoneyView next-server`). Leave those two open while you
   work; minimizing them is fine. The launcher window closes by itself.
2. Your browser opens **http://localhost:3000**. The first page can take a few seconds while
   the app compiles; "Starting Core Analytics..." is normal for up to about 30 seconds.
3. When you are done, double-click **Stop MoneyView**. It stops only MoneyView's own server
   windows of this folder, never other Python or Node programs.

The command line still works: `run MoneyView`, or `.\run.cmd MoneyView` in the MoneyView
folder.

---

## 2. The screens

The sidebar on the left switches between screens.

| Sidebar | Address | Use it to |
|---|---|---|
| **Market Overview** | `/` | See indices, commodities, FX and crypto at a glance, with event lines (Fed decisions, geopolitical dates, drawdowns, oil shocks) on the charts. |
| **Portfolio** | `/portfolio` | Keep holdings and the watchlist, set weights, press **Refresh Analysis** for attribution, open a holding's detail and its **Snapshot History**. |
| **News Feed** | `/news` | Read news for your tickers. |
| **Corporate Analysis** | `/corporate` | Value one company (**Refresh DCF**) and compare your watchlist (**Refresh comparison**). |
| **Monte Carlo** | `/monte-carlo` | The Simulation Lab: path simulations and risk analysis. |
| **Decision Log** | `/decisions` | Record a buy, sell, watch or pass with your reason. The figures are frozen at that moment so you can later see how the decision played out. |
| **Valuation** | `/valuation` | A ticker's verdict panel: drawdown, volume, PE and DCF signals against its sector peers. |
| **Cases** | `/cases` | Segment-built valuation cases. Fork a case with changed assumptions and see why the value moved and how uncertain it is. |
| **Events** | `/events` | Add your own dated events and choose which event categories are drawn on charts. |

A ticker's detail page (`/detail/<TICKER>`) shows its price chart and **Refresh DCF
Diagnostics**.

**Nothing heavy runs on its own.** Sections that fetch or calculate stay idle until you press
their refresh button. A section that says it "stays idle until refresh" is waiting for you,
not broken.

**History builds up by refreshing.** Each **Refresh comparison** on Corporate Analysis saves
that day's comparison as a snapshot. Snapshot History on Portfolio shows how the figures
changed, so refreshing on different days is what builds it.

---

## 3. Reading the numbers

**DCF value vs price (one-off gap)** is how far the price sits from the DCF value: +20% means
the model values the company 20% above today's price. It is a single gap, not a yearly
return, and says nothing about how fast the gap might close.

**Market-implied return (per year)** is the yearly return today's price implies, using the
same DCF cash flows. **Implied return vs WACC (pts per year)** subtracts the company's cost
of capital: above zero means that, at today's price, the business is expected to earn more
than its cost of capital on the model's cash flows.

**A dash (—) means MoneyView declined to show a number rather than show a misleading one.**
Hover over the dash to read why. Common reasons:

| Hover text | Meaning |
|---|---|
| Free cash flow is zero or negative over the forecast | The company burns cash; a DCF cannot value it. |
| Net debt or the share count is missing | The data needed to turn company value into a per-share value is missing. |
| No current price | There is no market price to compare against. |
| Not recorded before metric v3 | An older snapshot, saved before that figure existed. Not a refusal. |

On the single-company DCF the same refusal reads **"Not valued: ..."**.

**Metric versions.** When MoneyView changes how a figure is calculated, Snapshot History
marks where the definition changed, so values on either side are not compared as if they
meant the same thing.

---

## 4. Your data

- **Where it lives:** everything is local: the database `data/processed/moneyview.db` plus
  caches under `data/cache/`. Nothing is uploaded.
- **Backup:** stop MoneyView, then copy `data/processed/moneyview.db` somewhere safe.
- **Two PCs:** in `config/.env` on both PCs, set `MONEYVIEW_SYNC_DIR` to a folder that
  OneDrive, Google Drive or Dropbox keeps in sync. Your watchlist, cases, decisions, events
  and settings then sync through it. Keep both PCs on the same MoneyView version. Details:
  [local-run-resources.md](local-run-resources.md).

---

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| **"System Boot Failure"** after about 30 seconds | The backend did not answer. Look at the `MoneyView API Server` window for an error, or `data/cache/logs/api-server.log`. |
| **Boot fails and `data/cache/logs/next-server.log` shows `GET /api/runtime/backend-port 404`** | A stale web-app cache. Stop MoneyView, delete the folder `apps\web\.next\dev`, and start again. |
| **Launcher says a port is already in use** | Something else holds port 8000 or 3000. Close it, or start with `run MoneyView -AutoPort` to pick free ports. |
| **Launcher window says "MoneyView did not start"** | Read the red message in that window. For a missing dependency, run `run MoneyView -InstallDeps` once. |
| **It uses a lot of memory** | `next dev` is the heavy part. `run MoneyView -BuildWeb -ProductionWeb` is lighter day to day (it builds first, so it starts slower). |
| **"Stop MoneyView" says not running, but server windows are open** | Close those windows by hand. |

Logs are in `data/cache/logs/`: `api-server.log` for the backend, `next-server.log` for the
web app.
