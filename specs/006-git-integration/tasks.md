---
description: "Task list for Git version control (006)"
---

# Tasks: Git Version Control for Projects

**Input**: `specs/006-git-integration/` — plan.md, spec.md, research.md (R1–R10), data-model.md, contracts/commands.md, contracts/git-ui.md, quickstart.md

**Working rule (user request)**: build similar features together and test once per batch. Each batch ends with a single test gate; do not run the suites after every task. Tests are written inside the batch, run at its gate.

**Reuse, don't re-create**: `hide_console` and `run_with_timeout` (`src-tauri/src/lib.rs`), `resolve_in_project` / `ProjectState::writable` / `ErrorKind` pattern (`src-tauri/src/project.rs`), `useChoice` / `useNamePrompt` (`src/ProjectDialogs.tsx`), `relativeDate`, `RIBBON_TABS` (`src/Ribbon.tsx`), Writer's save-all path and `project-changed` listener.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Create `src-tauri/src/git.rs` with `mod git;` in `src-tauri/src/lib.rs`; make `hide_console` and `run_with_timeout` `pub(crate)` in `src-tauri/src/lib.rs` so `git.rs` uses them
- [X] T002 [P] Create `src/git.ts` (empty typed module) and `src/git/diff.ts` (empty) as placeholders for the wrappers and diff parser

---

## Phase 2: Foundational (blocks all batches)

- [X] T003 In `src-tauri/src/git.rs` add `GitError { kind, message }` (serde camelCase, `kind` enum: `notInstalled, ghNotInstalled, noRepo, needsIdentity, emptyMessage, nothingToCommit, largeFiles, dirty, rejected, conflict, network, auth, badUrl, readOnly, busy, failed`) and `From<ProjectError>` mapping `ReadOnly`→`readOnly`
- [X] T004 In `src-tauri/src/git.rs` add `find_git()` / `find_gh()`: `PATH`, then `%ProgramFiles%\Git\cmd\git.exe`, then `%LOCALAPPDATA%\Programs\Git\cmd\git.exe` (gh: `%ProgramFiles%\GitHub CLI\gh.exe`) per research R1
- [X] T005 In `src-tauri/src/git.rs` add `run_git(root, args, timeout) -> Result<ProcessOutput, GitError>` using `Command::args` (never a shell), `-C <root> -c core.quotepath=false -c color.ui=false -c core.autocrlf=false`, env `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `hide_console`, `run_with_timeout` (10 s local, 120 s network); and `classify_stderr(&str) -> kind` (`rejected`/`fetch first`→`rejected`; `Could not resolve host`/`timed out`/`unable to access`→`network`; `Authentication failed`/`could not read Username`→`auth`; else `failed` with last 5 stderr lines)
- [X] T006 In `src-tauri/src/git.rs` add managed `GitLock(Mutex<()>)` (try_lock → `busy`) and a `mutating(state, lock, f)` helper that requires a writable project via `ProjectState::writable`; register `GitLock` in `src-tauri/src/lib.rs`
- [X] T007 In `src-tauri/src/git.rs` add input validators: commit id `^[0-9a-f]{7,40}$`; message non-empty after trim; remote URL `https://…`, `ssh://…` or `user@host:path`, no whitespace, not starting with `-`; repo name `[A-Za-z0-9._-]{1,100}`; every file path through `resolve_in_project`
- [X] T008 [P] In `src/git.ts` add `GitErrorKind` union and `GitError` type mirroring T003, plus `isGitError()` like `src/projects.ts`

**Checkpoint**: compiles (`cargo check`); no tests run yet.

---

## Phase 3: Batch A — Local history (US1 + sidebar marks) 🎯 MVP

**Goal**: start history, see state, commit with message; sidebar marks changed files.
**Independent test**: quickstart A.

### Backend

- [X] T009 [US1] In `src-tauri/src/git.rs` add `GitState` and `Change` structs exactly per data-model.md (`repo: "none" | "own" | "parent"`, `status: "modified" | "added" | "deleted" | "renamed" | "conflicted"`, untracked → `added`, paths project-relative with `/`)
- [X] T010 [US1] In `src-tauri/src/git.rs` add `parse_status_v2(bytes, prefix) -> (branch, ahead, behind, Vec<Change>)` for `status --porcelain=v2 --branch -z --untracked-files=all` (entries `1`, `2` with rename origPath, `u`, `?`; strip `prefix`, drop paths outside it); detect repo via `rev-parse --show-toplevel --show-prefix` (R3); `merging` = `MERGE_HEAD` exists; fill `size` from file metadata
- [X] T011 [US1] In `src-tauri/src/git.rs` add command `git_status { fetch?: bool }` (when `fetch`, run `git fetch` with 30 s timeout and ignore network errors); git missing → `installed:false`, not an error; `remoteUrl` from `remote get-url origin`
- [X] T012 [US1] In `src-tauri/src/git.rs` add `git_init` (only when `repo:"none"`): write `.gitignore` if absent or append missing lines from R7 (incl. `/<main stem>.pdf` from `ProjectState`), `init -b main`, `add -A -- .`, commit "Start Lexy project"; `needsIdentity` when `config user.name`/`user.email` is empty
- [X] T013 [US1] In `src-tauri/src/git.rs` add `git_set_identity { name, email }` writing `config --global` only for unset keys, and `git_ignore { paths }` appending `/path` lines to `.gitignore`
- [X] T014 [US1] In `src-tauri/src/git.rs` add `git_commit { message, allowLarge }`: validate message (`emptyMessage`), no changes → `nothingToCommit`, new/modified files > 50 MB and `!allowLarge` → `largeFiles` (message lists paths), identity check, `add -A -- .` then `commit -m`; return `{ id, message }`
- [X] T015 [US1] Register Batch A commands in the `invoke_handler` in `src-tauri/src/lib.rs`

### Frontend

- [X] T016 [P] [US1] In `src/git.ts` add `GitState`, `Change` types and wrappers `gitStatus`, `gitInit`, `gitSetIdentity`, `gitIgnore`, `gitCommit`
- [X] T017 [US1] Add `Git` to `RIBBON_TABS` in `src/Ribbon.tsx` with groups per contracts/git-ui.md (History: Start version history | Commit, History; Online buttons rendered but wired in Batch C); disabled per state and read-only
- [X] T018 [US1] Create `src/GitPanel.tsx`: header state line (all texts in git-ui.md, incl. "Git for Windows is needed for version history" + link via opener, "Part of the repository at <root>"), Changes list with M/A/D/R/C letters, message box, Commit (Ctrl+Enter), result line "Committed: <msg>"; styles in `src/App.css` using existing CSS variables
- [X] T019 [US1] In `src/Writer.tsx`: hold `GitState`, refresh on `project-changed`, after save and after each git action (FR-010); toggle panel with Ctrl+Shift+G and focus message with Ctrl+Shift+K in the capture-phase shortcut listener; before commit run the existing save-all path; handle `needsIdentity` (prompt name/email once via `ProjectDialogs`, then retry) and `largeFiles` (`useChoice`: Ignore them / Commit anyway / Cancel)
- [X] T020 [P] [US1] In `src/Sidebar.tsx` show an M/A/D/C badge at the row end for paths in `GitState.changes` (FR-012)

### Tests + gate A

- [X] T021 [P] [US1] Rust tests in `src-tauri/src/git.rs` `#[cfg(test)]` (print "skipping" when git missing): `parse_status_v2` on fixed bytes incl. rename, untracked, conflict and a Bangla path; init writes `.gitignore` and first commit in a temp folder (set local identity in the test repo); commit rejects empty message and returns `nothingToCommit`; project in a subfolder of a repo → `repo:"parent"` with stripped paths; `GitState` JSON shape is camelCase
- [X] T022 [P] [US1] Vitest `src/GitPanel.test.tsx` (mock `src/git.ts`): no-history state shows Start version history; Commit disabled when clean; Ctrl+Enter commits after save-all; `needsIdentity` prompt then retry
- [X] T023 **Gate A** (automated tests passed; manual quickstart walk still pending): run `cd src-tauri; cargo test git` and `npm test` once; fix failures; walk quickstart A; add F-row + Verification Log entry in `docs/TRACKER.md`

---

## Phase 4: Batch B — Viewing & restore (US2 + US3)

**Goal**: line diffs for changes, history browsing, view/compare/restore.
**Independent test**: quickstart B.

### Backend

- [X] T024 [US2] In `src-tauri/src/git.rs` add `git_diff { path, commit? }` → `FileDiff { binary, oldSize?, newSize?, patch }` per R4: tracked `diff HEAD -U3 --ignore-cr-at-eol --no-ext-diff -- <path>` (or `diff <commit> -- <path>`), untracked `diff --no-index -- NUL <path>` (exit code 1 is success), binary via `--numstat` `-\t-` with sizes from `cat-file -s <rev>:<path>` and file metadata
- [X] T025 [US3] In `src-tauri/src/git.rs` add `git_log { skip, limit }` → `CommitInfo { id, message, author, time, files }` using `log -z --format=%H%x1f%an%x1f%at%x1f%s --shortstat --skip --max-count -- .`, and `git_log_files { commit }` → `Change[]` via `show --name-status -z --format= <id> -- .`
- [X] T026 [US3] In `src-tauri/src/git.rs` add `git_show_file { commit, path }` (`show <id>:<prefix+path>`, binary/NUL bytes → `failed`) and `git_restore { commit, path? }` (`restore --source=<id> --worktree -- <path or .>`, mutating)
- [X] T027 [US2] Register Batch B commands in `src-tauri/src/lib.rs`

### Frontend

- [X] T028 [P] [US2] Implement `parseDiff(patch) -> DiffRow[]` in `src/git/diff.ts` (`kind: "ctx" | "add" | "del" | "hunk"`, old/new line numbers from `@@ -a,b +c,d @@`, ignore `\ No newline` lines) and wrappers `gitDiff`, `gitLog`, `gitLogFiles`, `gitShowFile`, `gitRestore` in `src/git.ts`
- [X] T029 [US2] In `src/GitPanel.tsx` render the selected change's diff inline (removed/added colors from CSS variables, line numbers; binary: "Binary file changed (12 KB → 15 KB)")
- [X] T030 [US3] In `src/GitPanel.tsx` add History view: commits newest first (message, author, `relativeDate`, "N files"), load 50 more on scroll end, selected commit → files → View (read-only text), Compare with current (`gitDiff` with `commit`), Restore this file, Restore whole project to this point (confirm via `useChoice`)
- [X] T031 [US3] In `src/Writer.tsx` before restoring a file that has unsaved edits ask via `useChoice`; after restore reload affected open files from disk through the existing reload path and refresh `GitState`

### Tests + gate B

- [X] T032 [P] [US2] Vitest `src/git/diff.test.ts`: multi-hunk patch, add-only file, delete-only, `\ No newline at end of file`
- [X] T033 [P] [US3] Rust tests in `src-tauri/src/git.rs`: 3 commits → `git_log` paging order; CRLF-only change gives empty patch; binary file reports `binary:true` with sizes; restore file then whole project leaves later commits in log and shows uncommitted changes; rejected commit id `"--all"`
- [X] T034 **Gate B** (automated tests passed; manual quickstart walk still pending): run `cd src-tauri; cargo test git` and `npm test` once; fix failures; walk quickstart B; update `docs/TRACKER.md`

---

## Phase 5: Batch C — Remote (US4 + US5)

**Goal**: connect/publish, push, pull, sync, resolve conflicts.
**Independent test**: quickstart C.

### Backend

- [X] T035 [US4] In `src-tauri/src/git.rs` add `git_connect_remote { url }` (validate → `badUrl`, `remote add origin` or `set-url`, `ls-remote --exit-code origin` with 30 s timeout; on failure remove the remote again and return the classified error)
- [X] T036 [US4] In `src-tauri/src/git.rs` add `git_publish_github { name, private }` per R8: `find_gh` else `ghNotInstalled`; `gh auth status`, if not signed in `gh auth login --web --git-protocol https --hostname github.com` (120 s); `gh repo create <name> --private|--public --source <root> --remote origin --push`; return `{ url }` from `remote get-url origin` converted to the https web link. Never read or log tokens
- [X] T037 [US4] In `src-tauri/src/git.rs` add `git_push` (`push -u origin HEAD`, 120 s; count = ahead before push) → `{ pushed }`
- [X] T038 [US5] In `src-tauri/src/git.rs` add `git_pull` (changes non-empty → `dirty`; `pull --no-rebase --no-edit` 120 s; return `{ pulled, conflicts }` where conflicts are `u` entries), `git_resolve { path, take: "mine" | "theirs" | "edited" }` (`checkout --ours|--theirs -- <path>` then `add`, or just `add`), `git_abort_merge` (`merge --abort`)
- [X] T039 [US4] Register Batch C commands in `src-tauri/src/lib.rs`

### Frontend

- [X] T040 [P] [US4] Wrappers `gitConnectRemote`, `gitPublishGithub`, `gitPush`, `gitPull`, `gitResolve`, `gitAbortMerge` in `src/git.ts`
- [X] T041 [US4] Wire Online group in `src/Ribbon.tsx` and panel actions in `src/GitPanel.tsx`: Publish dialog (name default = folder name, Private checked), Connect dialog (URL), "N to push · M to pull", repo link via opener, busy indicator per action (FR-011), messages: "Someone else pushed changes. Pull first." + Pull button, "Could not reach <host>. Your commits are safe here.", gh missing → install link + Connect option
- [X] T042 [US5] In `src/GitPanel.tsx` add Conflicts view when `merging`: per file Keep mine / Keep theirs / Mark resolved, "Cancel pull"; Sync = `gitPull` then `gitPush` if no conflicts; `dirty` → "Commit your changes first"
- [X] T043 [US5] In `src/Writer.tsx` reload open files after pull/resolve/abort; call `gitStatus({ fetch: true })` when the panel opens and before push/pull; Sidebar shows C badge for conflicts

### Tests + gate C

- [X] T044 [P] [US5] Rust tests in `src-tauri/src/git.rs` using a local bare repo as `origin` and a second clone: push then ahead 0; second clone pushes → push returns `rejected`; pull applies (`pulled:1`); conflicting edit → `conflicts:[path]`, resolve `theirs` + commit → clean; abort restores pre-pull state; pull with dirty tree → `dirty`; `badUrl` for `-oProxyCommand=x` and `file name with space`; `classify_stderr` table test
- [X] T045 [P] [US4] Vitest `src/GitPanel.test.tsx`: `rejected` shows Pull button; Sync stops on conflicts; read-only disables mutating buttons
- [X] T046 **Gate C** (automated tests passed; manual quickstart walk still pending): run `cd src-tauri; cargo test git` and `npm test` once; fix failures; walk quickstart C with a real private GitHub repo; update `docs/TRACKER.md`

---

## Phase 6: Polish

- [X] T047 [P] Update `CLAUDE.md` Architecture (git.rs commands, GitPanel, shortcuts Ctrl+Shift+G/K) and `docs/PLAN.md` milestone line
- [X] T048 Final full run: `cd src-tauri; cargo test`, `npm test`, `npm run build`; record in `docs/TRACKER.md` Verification Log

---

## Dependencies

- Phase 1 → Phase 2 → Batch A → Batch B → Batch C → Polish.
- B needs A's `GitState`/panel; C needs A's state/panel (not B). US2 and US3 share `git_diff`, so they ship together; US4 and US5 share push/pull error handling, so they ship together.
- Within a batch: backend tasks in order (same file `git.rs`), frontend after its wrappers; tests anytime in the batch, run only at the gate.

## Parallel examples

- Phase 2: T008 with T003–T007.
- Batch A: T016 and T020 alongside backend T009–T014; T021 and T022 together.
- Batch B: T028 and T032 while backend T024–T026 is written.
- Batch C: T040 alongside T035–T038; T044 and T045 together.

## Implementation strategy

MVP = Phases 1–3 (Batch A): local snapshots, which is the backup the user asked for first. Then B (see/restore), then C (online). Stop and validate at each gate; never start the next batch with a failing gate.
