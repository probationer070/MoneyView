# Git Worktrees In MoneyView

A worktree is a second (or third) checkout of the same repository in another
folder. Each worktree has its own branch and its own files on disk, but all of
them share one `.git`: the same commits, branches, remotes and stash. You can
keep `renewal` open in one folder and work on a feature branch in another,
without stashing or switching back and forth.

This note covers the commands and the MoneyView-specific traps: Python imports,
test ports, ignored data, Windows path length, and processes that outlive a
stopped run. Each one was hit or reproduced in this repo.

---

## 1. What is shared and what is not

| Shared by every worktree | Separate in each worktree |
| --- | --- |
| Commits, branches, tags, remotes (`git fetch` in one updates all) | The checked-out branch and the working files |
| The stash stack | `apps/web/node_modules` and `apps/web/.next` |
| Git config and hooks | The git-ignored parts of `data/` (`cache/`, `raw/`, `processed/`, `exports/`), including `data/processed/moneyview.db` |
| The conda `moneyview` env, whose editable install points at the **main checkout** | |
| | `config/.env` (git-ignored) |
| | Uncommitted and untracked changes |

Three consequences:

- **A new worktree has no database and no `node_modules`.** It is a fresh
  checkout of tracked files only. See §3.
- **One branch can be checked out in only one worktree at a time.** Git refuses a
  second checkout: `fatal: 'renewal' is already used by worktree at '...'`. See §5.
- **A Python script run by path imports the main checkout's code**, not the
  worktree's. See §4.

---

## 2. Quick reference

| Task | Command |
| --- | --- |
| List worktrees | `git worktree list` |
| New worktree on a new branch from `renewal` | `git worktree add .claude/worktrees/<name> -b <branch> origin/renewal` |
| New worktree on an existing branch | `git worktree add .claude/worktrees/<name> <branch>` |
| New worktree at a commit, no branch | `git worktree add --detach .claude/worktrees/<name> <commit>` |
| Remove a worktree (clean only) | `git worktree remove .claude/worktrees/<name>` |
| Forget worktrees whose folders were deleted | `git worktree prune` |
| Run git in another worktree without `cd` | `git -C .claude/worktrees/<name> status` |

Run `git fetch origin` first, so `origin/renewal` is current.

---

## 3. Starting work in a new worktree

```powershell
git fetch origin
git worktree add .claude/worktrees/my-feature -b my-feature origin/renewal
cd .claude\worktrees\my-feature

# Frontend dependencies are per worktree. The launcher (§4) installs them if
# missing; Playwright and tsc need them installed first.
cd apps\web
npm install
cd ..\..

# Make Python scripts import this worktree's code (§4).
$env:PYTHONPATH = (Get-Location).Path
```

**The database.** `apps/api/services/db.py` reads `DB_PATH`, which defaults to
`data/processed/moneyview.db` relative to the working folder. A new worktree has
no such file, so the app starts on an empty database. Pick one:

- **Point at the main checkout's database** by setting it in the shell you
  start the app from (the launcher's windows inherit it):
  `$env:DB_PATH = "C:\Learn\Economy\MoneyView\data\processed\moneyview.db"`.
  This is a live database, and anything the worktree's code writes lands there.
- **Copy it** into the worktree's `data\processed\` when the branch changes the
  schema or writes data you don't want in your real database.

pytest and Playwright do not need either option. Tests build their own
databases (§4).

**Where to put the folder.** Use `.claude/worktrees/<short-name>` inside the repo,
the location Claude Code also uses (§7). Keep the name short (§4, path length).
The main checkout lists `.claude/worktrees/` as untracked. That is expected;
never `git add` it.

---

## 4. Running the app and tests in a worktree

### The app

The global `run MoneyView` command is a shim fixed to the folder it was installed
from, which is normally the main checkout. From a worktree, call the launcher
directly. Use `-AutoPort` so it does not collide with an app already running on
3000/8000:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts\start_local.ps1 -AutoPort -OpenBrowser
```

### Python imports: set `PYTHONPATH` in every worktree shell

`pip install -e .` registered the `moneyview` package, and the conda
`moneyview` env points it at `C:\Learn\Economy\MoneyView`. How Python finds
`apps` depends on how it is started:

| Started as | Imports `apps` from |
| --- | --- |
| `python -m pytest`, `python -m uvicorn ...`, `python -c ...` | the worktree (the current folder comes first) |
| `python scripts\<file>.py` | **the main checkout** (the script's own folder comes first, then the editable install) |

The e2e API harness runs `python scripts/seed_e2e_market_cache.py`. Without the
fix, a worktree's Playwright run seeds its database with the main checkout's
`db.py`. If the branch changes the schema or the seed, the run tests a mix of
two branches. Set this once per shell, from the worktree root:

```powershell
$env:PYTHONPATH = (Get-Location).Path
```

Check it from another folder: `python -c "import apps; print(apps.__path__)"`.
The worktree's `apps` must be listed **first**. The main checkout may follow,
because `apps` is a namespace package, but `apps.api` is a regular package
and is taken whole from the first entry.

### pytest and tsc

These work from the worktree root (`python -m pytest -q`) and from `apps/web`
(`npx tsc --noEmit`).

### Playwright: one run per port pair

The e2e harness (`apps/web/playwright.config.ts`) starts its own API on **8110**
and web server on **3101** for every run, with `reuseExistingServer: false`. It
gives each port its own database, `data/processed/moneyview-e2e-<port>.db`.

- **Two runs on the same ports collide.** Usually the second run fails at once
  with `http://127.0.0.1:8110/api/v1/healthz is already used`. If the first run's
  server is still starting, the harness script instead kills whatever holds the
  port (`Stop-ListenerProcess`), which breaks the first run.
- **To run two worktrees at once**, give one of them other ports:

  ```powershell
  $env:MONEYVIEW_E2E_API_PORT = 8111
  $env:MONEYVIEW_E2E_WEB_PORT = 3102
  npx playwright test
  ```

### Never change a worktree's branch while something is running in it

A test run reads files from disk as it goes. A `git checkout`, `git merge` or
`git pull` mid-run puts different code under the test. The run then reports a
result for neither branch, and nothing in the output says so.

If you need another branch while a run is in progress, **use another worktree**
(§6). Don't switch this one.

### A stopped run can keep running

Stopping a background `npx playwright test` (closing its terminal, or stopping
it from a tool) can kill only the outer shell. The Playwright node process and
its servers on 8110/3101 keep going. The next run then fails with `is already
used`, and the orphan keeps testing whatever is on disk. Before rerunning:

```powershell
Get-NetTCPConnection -LocalPort 8110,3101 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'playwright test' } |
  Select-Object ProcessId, CreationDate, CommandLine
# then, for each process that belongs to the stopped run:
taskkill /PID <pid> /T /F
```

Match `CreationDate` against when you started the run before killing anything.
A live run might belong to another worktree or another session.

### Keep worktree paths short (Windows)

Windows limits paths to 260 characters unless long paths are enabled. Tests
create nested temp paths under `data\cache\pytest-runs\...`. From a worktree at
`C:\Users\<you>\AppData\Local\Temp\...\scratchpad\wt37`, three tests in
`tests/scripts/test_reset_snapshots.py` failed with `FileNotFoundError` on a
275-character path. The same commit passed from `.claude\worktrees\<name>`.
A `FileNotFoundError` on a very long path in a worktree is the location, not
the code.

---

## 5. Rules that come from sharing one repository

- **A branch in use elsewhere.** If `renewal` is checked out in the main
  checkout and you only need its code in a worktree, check out the commit rather
  than the branch: `git checkout --detach origin/renewal`. A detached HEAD is
  fine for running tests and reading code. Create a branch before committing.
- **The stash is shared.** A bare `git stash pop` in one worktree can pop another
  worktree's changes. Prefer a temporary commit. If you must stash, tag it
  (`git stash push -u -m "my-tag"`), then apply by SHA and drop it by tag.
- **Branch deletion affects every worktree.** Git refuses to delete a branch
  that is checked out in any worktree. Once a branch is gone, a worktree can still
  hold its files. Remove the folder separately (§8).

---

## 6. Common tasks

### Resolve a PR conflict while tests run in your main worktree

Open the PR branch in a temporary worktree, merge there, and push. The running
tests are never disturbed.

```powershell
git fetch origin
git worktree add .claude/worktrees/pr-fix <pr-branch>
cd .claude\worktrees\pr-fix
git merge origin/renewal          # resolve, then:
git add <files>
git commit
git push origin <pr-branch>
cd ..\..\..
git worktree remove .claude/worktrees/pr-fix
```

`ERROR-LOG.md` conflicts on almost every concurrent branch, because each branch
adds entries at the top. Keep **both** sides, newest first. Taking one side
silently deletes the other branch's records.

### Try a PR locally without touching your branch

```powershell
git fetch origin
git worktree add --detach .claude/worktrees/review origin/<pr-branch>
```

Run the app or tests there (set `PYTHONPATH` first, §4), then
`git worktree remove .claude/worktrees/review`.

---

## 7. Worktrees created by Claude Code

When Claude Code starts an isolated session, it creates the worktree at
`.claude/worktrees/<name>` on a branch named `worktree-<name>`. For example,
`portfolio-count-watchlist-drift` was created on branch
`worktree-portfolio-count-watchlist-drift`. Everything in this note applies to it.

---

## 8. Finishing

After the branch's PR is merged:

```powershell
git fetch --prune origin

# 1. Confirm the work is in renewal. $? prints True when it is merged.
git merge-base --is-ancestor <branch> origin/renewal; $?

# 2. Remove the worktree. This refuses if there are uncommitted or untracked files.
git worktree remove .claude/worktrees/<name>

# 3. Delete the branch locally and on GitHub.
git branch -d <branch>
git push origin --delete <branch>
```

If `git worktree remove` refuses with `contains modified or untracked files`,
those files exist nowhere else. Look first (`git -C <path> status --porcelain -uall`),
then commit or copy what you need. Use `--force` only for files you have decided to lose.

If a worktree folder was deleted by hand, `git worktree list` still shows it
until you run `git worktree prune`.

---

## 9. Troubleshooting

| Message | Cause | Fix |
| --- | --- | --- |
| `fatal: '<branch>' is already used by worktree at '<path>'` | The branch is checked out in another worktree | Use that worktree, or `git checkout --detach origin/<branch>` |
| `http://127.0.0.1:8110/api/v1/healthz is already used` | Another run, or an orphan from a stopped run, holds the e2e ports | §4: find and kill the orphan, or use other ports |
| `FileNotFoundError` on a path over 260 characters | The worktree folder path is too long | Move the worktree to `.claude/worktrees/<short-name>` |
| App shows no holdings or data in a new worktree | No `data/processed/moneyview.db` in that folder | §3: set `DB_PATH` or copy the database |
| A worktree run behaves like the main checkout's code | A script run by path imported `apps` through the editable install | §4: set `$env:PYTHONPATH` to the worktree root |
| `contains modified or untracked files, use --force to delete it` | Uncommitted work in the worktree | §8: inspect before forcing |
| Test results that make no sense after a branch switch | The branch changed while the run was reading files | Rerun without touching that worktree (§4) |
