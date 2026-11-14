# Research: Git Version Control (006)

No NEEDS CLARIFICATION remained in Technical Context. Decisions below.

## R1. Git engine: shell out to `git.exe`
- **Decision**: Run Git for Windows via `std::process::Command` (hidden console, `CREATE_NO_WINDOW`), resolved like other tools: `PATH`, then `%ProgramFiles%\Git\cmd\git.exe`, then `%LOCALAPPDATA%\Programs\Git\cmd\git.exe`.
- **Rationale**: Push/pull get Git Credential Manager (browser/Windows sign-in) for free (FR-008); behavior matches what collaborators get on the command line; no new crate.
- **Alternatives**: `git2`/`gix` crates: add build weight and need our own credential flow, which violates "never handle tokens".

## R2. Every git call uses fixed safe options
- **Decision**: run from the project root with `-c core.quotepath=false -c color.ui=false` (the user's `core.autocrlf` is kept: overriding it would make every CRLF file look modified in repos cloned with autocrlf on), env `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` for status, `LC_ALL=C` for parseable messages. Machine-readable formats with `-z`: `status --porcelain=v2 --branch -z`, `log -z --format=%H%x1f%an%x1f%at%x1f%s --shortstat`.
- **Rationale**: Non-ASCII (Bangla) paths come back raw, not quoted (spec edge case); no hidden prompt hangs.

## R3. Project inside a larger repo
- **Decision**: `rev-parse --show-toplevel --show-prefix`; when prefix ≠ "" run status/diff/log with pathspec `-- .` from the project root and strip the prefix; state carries `repoRoot` so the UI shows "Part of the repository at …". Init is not offered in that case.

## R4. Diff
- **Decision**: Rust returns raw unified text: worktree vs HEAD `git diff HEAD -U3 --ignore-cr-at-eol --no-ext-diff -- <path>` (untracked: `diff --no-index /dev/null <path>`), commit vs current `git diff <id> -- <path>`. Binary detected by `--numstat` (`-\t-`); then sizes from `cat-file -s` and file metadata. TS `src/git/diff.ts` parses into rows (context/add/del with line numbers); inline view only.
- **Alternatives**: `@codemirror/merge` side-by-side: new dependency; inline satisfies "side-by-side or inline".

## R5. Restore
- **Decision**: file: `git restore --source=<id> --worktree -- <path>`; whole project: `git restore --source=<id> --worktree -- .` (no-overlay default deletes files tracked now but absent then; untracked files untouched). Index and history are untouched, so the result is uncommitted changes and later commits stay (SC-005).

## R6. Commit
- **Decision**: Frontend saves all first (existing save-all path), then `git add -A -- .` and `git commit -m <msg>`; empty message rejected in both UI and Rust. Before add, Rust lists new/modified files > 50 MB and returns them; UI offers "Ignore them" (`git_ignore` appends to `.gitignore`) or "Commit anyway".
- **Identity**: `config user.name`/`user.email` missing → `needsIdentity`; UI prompts once; `git_set_identity` writes `--global` (only reached when global is empty, so nothing is overwritten).

## R7. Ignore list on init
- **Decision**: write `.gitignore` only if absent, else append missing lines: `*.aux *.log *.out *.toc *.lof *.lot *.fls *.fdb_latexmk *.synctex.gz *.bbl *.blg *.bcf *.run.xml *.xdv *.nav *.snm *.vrb`, and `/<main stem>.pdf`. Then `init -b main`, `add -A`, commit "Start Lexy project". The `.lexy-*` build artifacts live outside the project (no entry needed).

## R8. Remotes, push, pull
- **Connect**: validate URL shape, `remote add origin <url>`, then `ls-remote --exit-code origin` (timeout) to check reach.
- **Publish**: requires `gh`; `gh auth status` → if not signed in, `gh auth login --web --git-protocol https` (opens browser, device code shown in panel from its output); then `gh repo create <name> --private|--public --source <root> --remote origin --push`. If `gh` missing: show link to install it, plus "Connect to existing repository" path.
- **Push**: `push -u origin HEAD`; stderr `rejected`/`fetch first` → `rejected` ("Someone else pushed changes. Pull first."); "Could not resolve host"/timeout → `network`; "Authentication failed" → `auth`.
- **Ahead/behind**: from `status --branch` (`# branch.ab +N -M`); `git fetch` runs on panel open and before pull/push only (not on a timer).
- **Pull**: refuse if dirty (`dirty`); `pull --no-rebase --no-edit`; on conflict return files (status `u` entries). Resolve: `checkout --ours|--theirs -- <path>` + `add`, or `add` for "mark resolved"; Cancel: `merge --abort`. Final commit uses the normal commit command.
- **Sync**: pull, then push if pull succeeded without conflicts.

## R9. Refresh
- **Decision**: status refetches on existing `project-changed` events (debounced already), after save, and after any git command. The watcher already ignores dot-folders, so `.git` churn doesn't loop.

## R10. Read-only window
- **Decision**: mutating commands check `ProjectState` read-only flag and return `readOnly`; UI disables them. One mutating git op at a time via `GitLock`.
