# Implementation Plan: Git Version Control for Projects

**Branch**: `006-git-integration` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-git-integration/spec.md`

## Summary

Add a Git ribbon tab and a Git panel that give single-user history (init, commit, diff, history, restore) and clone-based collaboration (connect remote, publish to GitHub, push, pull, sync, conflict resolution). Rust shells out to the user's Git for Windows (`git.exe`) and, for Publish only, GitHub CLI (`gh.exe`). Git's own credential manager and `gh`'s browser sign-in handle all secrets; Lexy never sees them. React shows state and diffs; a pure TS module parses unified diffs for display. No new crates or npm packages.

Per the user's request, work is grouped into **three batches of similar features, each tested once at the end** (see Delivery Batches).

## Technical Context

**Language/Version**: Rust 2021 (Tauri 2), TypeScript 5 + React 19

**Primary Dependencies**: existing only. External tools: Git for Windows ≥ 2.40 (required for Git features), GitHub CLI (optional, Publish only)

**Storage**: the project's own `.git` folder and `.gitignore`; Git identity in the user's global Git config (only written when absent); nothing new in `projects.json`

**Testing**: `cargo test` with real `git` in temp folders (skip with "skipping" when git is missing, like the compile e2e test); Vitest for the diff parser, `git.ts` wrappers and Writer/GitPanel behavior with mocked backend

**Target Platform**: Windows 10/11 desktop

**Project Type**: desktop app (Tauri: `src-tauri/` + `src/`)

**Performance Goals**: status ≤ 1 s for 200 files (SC-004); first 50 history entries ≤ 1 s at 1,000 commits (SC-003); status refresh ≤ 2 s after a change (FR-010)

**Constraints**: never block the editor (all git calls `async` + `spawn_blocking`); hidden console; no interactive terminal prompts (`GIT_TERMINAL_PROMPT=0`); network ops time out (120 s, tree-kill); paths stay inside the project; read-only window can't mutate

**Scale/Scope**: one repo per window, current branch only, no branch UI

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template; gates are the engineering rules in `docs/PLAN.md` / `CLAUDE.md`.

| Rule | Status |
|------|--------|
| React presentation only; Rust owns files and processes | Pass. All git/gh runs in `src-tauri/src/git.rs`; React calls typed commands via `src/git.ts`. Diff *parsing for display* is a pure TS function over text Rust returns. |
| Typed commands, structured errors | Pass. `GitError { kind, message }` like `ProjectError`; kinds the UI branches on (`notInstalled`, `noRepo`, `needsIdentity`, `dirty`, `rejected`, `conflict`, `network`, `auth`, `readOnly`). |
| No `.unwrap()` on recoverable paths | Pass (design). Every git output parse returns `Result`. |
| Untrusted process output; validate paths; time out | Pass. Args go through `Command::args` (no shell, no PowerShell escaping needed); file paths through `resolve_in_project`; commit ids validated as hex; remote URLs validated (`https://`, `ssh://`, `git@host:path`); network ops time out. |
| Shared services in managed state | Pass. Uses existing `ProjectState`; a `GitLock` (one mutating git op at a time) is managed state. |
| Minimal capabilities | Pass. No new Tauri permissions; GitHub link opens via existing opener plugin. |
| Never silently download/execute | Pass. Lexy does not install Git or gh; it links to the official download pages. |

Post-design re-check: still passes (no new deps, no new capabilities, no absolute-path commands).

## Project Structure

### Documentation (this feature)

```text
specs/006-git-integration/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── commands.md      # Tauri commands, args, results, errors
│   └── git-ui.md        # Ribbon tab, panel, shortcuts, copy
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src-tauri/src/
├── git.rs               # NEW: run_git/run_gh, status/log/diff parsers, commands, #[cfg(test)] with real git
├── project.rs           # reuse resolve_in_project, ProjectState, read-only flag
└── lib.rs               # register commands + GitLock
src/
├── git.ts               # NEW: typed invoke wrappers + GitError kinds (mirrors Rust)
├── git/diff.ts          # NEW: pure unified-diff → rows parser (+ test)
├── GitPanel.tsx         # NEW: changes list, diff view, history, remote/conflict actions
├── Ribbon.tsx           # add "Git" tab (RIBBON_TABS)
├── Sidebar.tsx          # per-file change badge (FR-012)
└── Writer.tsx           # panel toggle, Ctrl+Shift+K commit focus, save-all before commit, reload after restore/pull
```

**Structure Decision**: one new Rust module and one panel component, following the `project.rs` / `projects.ts` split. No new layers.

## Delivery Batches (similar features together, one test run each)

| Batch | Features (spec) | Backend commands | Test gate (run once at batch end) |
|-------|-----------------|------------------|-----------------------------------|
| A. Local history | US1, FR-001/002/003/012/013/014, identity, ignore list, big-file warning | `git_status`, `git_init`, `git_set_identity`, `git_commit`, `git_ignore` | `cargo test git` + `npm test`; manual: quickstart A |
| B. Viewing & restore | US2, US3, FR-004/005 | `git_diff`, `git_log`, `git_show_file`, `git_restore` | `cargo test git` + `npm test`; manual: quickstart B |
| C. Remote | US4, US5, FR-006/007/008/009/011 | `git_connect_remote`, `git_publish_github`, `git_push`, `git_pull`, `git_resolve`, `git_abort_merge` | `cargo test git` (local bare repo as remote) + `npm test`; manual: quickstart C (real GitHub) |

TRACKER.md gets one feature row per batch, updated in the same change.

## Complexity Tracking

None.
