# Contract: Git Tauri commands (006)

All `async`, run in `spawn_blocking`, act on the open project (`ProjectState`). Errors are `GitError` ([data-model](../data-model.md)). Mutating commands (†) return `readOnly` in a read-only window and `busy` if another mutating git op runs (`GitLock`).

| Command | Args | Result | Batch |
|---------|------|--------|-------|
| `git_status` | `{ fetch?: bool }` | `GitState` (`fetch` runs `git fetch` first, 30 s timeout, network errors ignored) | A |
| `git_init` † | – | `GitState` (writes/merges `.gitignore`, first commit) | A |
| `git_set_identity` † | `{ name, email }` | `()` (global config, only if unset) | A |
| `git_commit` † | `{ message, allowLarge: bool }` | `{ id, message }`; `largeFiles` when files > 50 MB and `!allowLarge` | A |
| `git_ignore` † | `{ paths: string[] }` | `()` (appends `/path` lines) | A |
| `git_diff` | `{ path, commit?: string }` | `FileDiff` (worktree vs HEAD, or vs `commit`) | B |
| `git_log` | `{ skip, limit }` | `CommitInfo[]` | B |
| `git_log_files` | `{ commit }` | `Change[]` | B |
| `git_show_file` | `{ commit, path }` | `string` (text) or `failed` for binary | B |
| `git_restore` † | `{ commit, path?: string }` | `()` (no `path` = whole project) | B |
| `git_connect_remote` † | `{ url }` | `GitState` (`badUrl`, `network`, `auth`) | C |
| `git_publish_github` † | `{ name, private: bool }` | `{ url }` (`ghNotInstalled`, `auth`, `failed` e.g. name taken) | C |
| `git_push` † | – | `{ pushed: number }` (`rejected`, `network`, `auth`) | C |
| `git_pull` † | – | `{ pulled: number, conflicts: string[] }` (`dirty`, `network`, `auth`) | C |
| `git_resolve` † | `{ path, take: "mine" \| "theirs" \| "edited" }` | `GitState` | C |
| `git_abort_merge` † | – | `GitState` | C |

Events: none new. `git_publish_github` streams `gh auth login` output via the existing log/notice path only if a device code is printed (shown in the panel, not stored).

Sync is frontend composition: `git_pull` → if no conflicts → `git_push`.
