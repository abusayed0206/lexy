# Data Model: Git (006)

Rust serde structs (camelCase) mirrored by hand in `src/git.ts`. Rust tests assert the JSON shape.

## GitState (`git_status`)
| Field | Type | Notes |
|-------|------|-------|
| `installed` | bool | false → panel shows install link; everything else empty |
| `repo` | `"none" \| "own" \| "parent"` | `parent` = project inside a larger repo |
| `repoRoot` | string? | shown only for `parent` |
| `branch` | string? | `null` when detached or no commits |
| `remoteUrl` | string? | `origin` fetch URL; web link derived for github.com |
| `ahead` / `behind` | number | from `branch.ab`; 0 without upstream |
| `changes` | `Change[]` | project-relative paths |
| `merging` | bool | `MERGE_HEAD` exists |
| `readOnly` | bool | from `ProjectState` |

Derived UI state: none → `repo:"none"`; conflicts → any `status:"conflicted"`; clean → `changes` empty.

## Change
| Field | Type | Notes |
|-------|------|-------|
| `path` | string | project-relative, `/` separators |
| `oldPath` | string? | renames only |
| `status` | `"modified" \| "added" \| "deleted" \| "renamed" \| "conflicted"` | untracked → `added` |
| `size` | number? | bytes on disk; used for the 50 MB warning |

## CommitInfo (`git_log`)
`id` (40-hex), `message` (subject), `author`, `time` (unix s), `files` (count). Paged: `skip`, `limit` (50).

## CommitFiles (`git_log_files`)
`Change[]` for one commit (name-status vs first parent).

## FileDiff (`git_diff`)
| Field | Type | Notes |
|-------|------|-------|
| `binary` | bool | |
| `oldSize` / `newSize` | number? | binary only |
| `patch` | string | unified text, `""` for binary or no change |

`src/git/diff.ts` → `DiffRow { kind: "ctx" \| "add" \| "del" \| "hunk", oldLine?, newLine?, text }`.

## GitError
`{ kind, message }`, kinds: `notInstalled`, `ghNotInstalled`, `noRepo`, `needsIdentity`, `emptyMessage`, `nothingToCommit`, `largeFiles` (message lists paths), `dirty`, `rejected`, `conflict`, `network`, `auth`, `badUrl`, `readOnly`, `busy`, `failed` (message = last stderr lines).

## State transitions
`none` →init→ clean ⇄ (edits) changes →commit→ clean. With remote: ahead>0 →push→ ahead 0; behind>0 →pull→ clean or `merging` (conflicts) →resolve all + commit→ clean, or →abort→ pre-pull state.

## Validation
- Paths: `resolve_in_project`; commit ids `^[0-9a-f]{7,40}$`; message non-empty after trim; remote URL `https://…`, `ssh://…` or `user@host:path`, no whitespace, not starting with `-`; repo name `[A-Za-z0-9._-]{1,100}`.
