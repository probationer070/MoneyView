# Desktop Shortcuts: How They Are Built

How the **MoneyView** and **Stop MoneyView** entries on the Desktop and in the Start menu
(Start > MoneyView) are made, what they run, and how to change or remove them. For using
them, see [USER-GUIDE.md](USER-GUIDE.md); this file is for maintaining them.

They are not separate programs. Each is a Windows shortcut (`.lnk`) that runs a PowerShell
script in this repository, so they always run the code of this checkout.

---

## 1. The pieces

| File | Role |
|---|---|
| `Install MoneyView Shortcuts.cmd` (repo root) | Double-click entry for the installer. Runs `scripts\install_shortcuts.ps1` with `-ExecutionPolicy Bypass`, forwards any arguments, then `pause`s so the output stays readable. |
| `scripts/install_shortcuts.ps1` | Creates or removes the four `.lnk` files. |
| `scripts/launch_moneyview.ps1` | What **MoneyView** runs. |
| `scripts/stop_local.ps1` | What **Stop MoneyView** runs. |
| `scripts/start_local.ps1` | The existing launcher (`run MoneyView`); `launch_moneyview.ps1` calls it. |
| `apps/web/app/favicon.ico` | The shortcuts' icon. |

## 2. How the installer makes a shortcut

`install_shortcuts.ps1` uses the Windows Script Host COM object, which is built into every
Windows install, so no extra tool is needed:

```powershell
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut("<folder>\MoneyView.lnk")
$link.TargetPath       = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments        = '-NoProfile -ExecutionPolicy Bypass -File "<repo>\scripts\launch_moneyview.ps1"'
$link.WorkingDirectory = "<repo>"
$link.IconLocation     = "<repo>\apps\web\app\favicon.ico,0"
$link.Save()
```

It writes two shortcuts into two places:

| Shortcut | Script | Desktop | Start menu |
|---|---|---|---|
| MoneyView | `scripts\launch_moneyview.ps1` | `[Environment]::GetFolderPath("Desktop")` | `[Environment]::GetFolderPath("Programs")\MoneyView` |
| Stop MoneyView | `scripts\stop_local.ps1` | same | same |

Notes on the choices:

- **The target is Windows PowerShell 5.1 by full path**, not `pwsh` or a bare
  `powershell`. It ships with every Windows 10/11 and is what `start_local.ps1` is written
  for, and a full path cannot be redirected by `PATH`.
- **`-ExecutionPolicy Bypass` applies to that one process only.** It does not change the
  machine's policy. Without it, a default policy refuses to run the unsigned repo scripts.
- **`-NoProfile`** keeps a user's PowerShell profile out of the launch.
- **The Desktop path comes from Windows, not a guess.** A Desktop redirected into OneDrive
  (e.g. `OneDrive\바탕 화면`) is resolved correctly by `GetFolderPath("Desktop")`. One side
  effect: OneDrive then syncs the Desktop shortcuts to your other PCs, where they work only
  if the repo sits at the same path. The Start-menu copies are not synced.
- **The paths are absolute.** Moving the repo breaks the shortcuts; run the installer again.

Options: `-Uninstall` removes the shortcuts (and the Start-menu folder once it is empty;
the Desktop folder is never removed). `-NoDesktop` and `-NoStartMenu` skip one location.
`-TargetDir <dir>` writes the shortcuts into `<dir>` instead, which is how the installer
is tested without touching the real Desktop.

## 3. What happens when you double-click

```text
MoneyView.lnk
  -> powershell.exe -File scripts\launch_moneyview.ps1
       -> scripts\start_local.ps1 -OpenBrowser     (same as `run MoneyView`)
            -> window "MoneyView API Server :8000"       (uvicorn, FastAPI)
            -> window "MoneyView next-server v... :3000" (Next.js)
            -> opens http://localhost:3000
       success: prints a message, closes after 10 seconds
       failure: shows the error in red, waits for Enter (never fails silently)

Stop MoneyView.lnk
  -> powershell.exe -File scripts\stop_local.ps1
       -> finds this repo's two server windows, ends each with its child processes
       -> prints what it stopped, closes after 3 seconds
```

Extra arguments to `launch_moneyview.ps1` are passed through to `start_local.ps1`, so a
shortcut's `Arguments` can be edited by hand to add e.g. `-AutoPort` or
`-BuildWeb -ProductionWeb`. Running the installer again overwrites such edits.

## 4. How Stop finds what to stop

Stopping by port or by process name (`python.exe`, `node.exe`) could kill unrelated
programs, so `stop_local.ps1` matches only on things `start_local.ps1` itself sets:

1. **Server windows:** `powershell.exe` processes whose command line contains the window
   title `MoneyView API Server` or `MoneyView next-server` **and** this repo's path.
2. **Orphaned web servers:** `node.exe` processes whose command line contains `next`
   **and** this repo's `apps\web` path (left behind if a server window was closed oddly).
3. **Never itself:** its own process, its parent shell and anything whose command line
   mentions `stop_local.ps1` are excluded. Without this, the shell that started the stop
   matched rule 1 (its command line contains the same strings) and was killed mid-run.

Each match is ended with `taskkill /PID <id> /T /F`. `/T` takes the whole process tree:
uvicorn's reloader child and the Next.js workers. A second checkout of MoneyView in
another folder is not touched, because its path differs.

## 5. How it was tested

- The installer, run with `-TargetDir` into a scratch folder: both `.lnk` files had the
  expected target, arguments, working directory and icon. `-Uninstall` removed both.
- `stop_local.ps1`, against two decoy windows with the server title, one with this repo's
  path and one with another path: the first was stopped, the second survived, and the
  invoking shell was not hit.
- `launch_moneyview.ps1 -CheckOnly`: the launcher checks passed and it exited 0.

These are manual checks; there is no automated test for the scripts.

## 6. Changing or removing them

| To | Do |
|---|---|
| Reinstall (after moving the repo or editing the installer) | Double-click `Install MoneyView Shortcuts.cmd` again. Existing shortcuts are overwritten. |
| Remove all four | `powershell -ExecutionPolicy Bypass -File scripts\install_shortcuts.ps1 -Uninstall` |
| Change the icon | Replace `apps\web\app\favicon.ico`, or change `$icon` in the installer, then reinstall. |
| Change what a shortcut runs | Edit the `$shortcuts` table at the top of `install_shortcuts.ps1`, then reinstall. |
