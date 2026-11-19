# Contract: Backend commands (spec 008)

All new commands are registered in `tauri::generate_handler!` in `src-tauri/src/lib.rs` and wrapped in TypeScript (`src/compile.ts`, `src/projects.ts`). Serde uses camelCase. Errors are `ProjectError { kind, message }` unless noted.

## `cancel_compile() -> ()`

- Increments the cancel epoch. Never fails, and is a no-op when nothing runs.
- Effect: every compile command (`compile_project`, `export_pdf_with_notes`) invoked before this call either ends within 2 s with `stopped: true`, or, if it was still waiting for `CompileLock`, returns `stopped: true` without starting latexmk.
- Compiles invoked after this call are unaffected.
- TS: `cancelCompile(): Promise<void>`.

## `compile_project(main, buffers) -> CompileResult` (changed)

New fields on `CompileResult`:

| Field | Type | Meaning |
| --- | --- | --- |
| `stopped` | bool (default false) | The run was ended by `cancel_compile`; `ok` is false, `summary` is `"Compile stopped"`, `pdfPath` is null, `problems` empty |
| `engineReason` | string | Why `engine` was used: `"marker"`, a package or class name, `"default"`, or the Bangla sentence |

On `stopped`: `<build>\<stem>.fdb_latexmk` and `<build>\<stem>.pdf` are deleted. `<build>\.lexy-shown\` and the SyncTeX state are left alone. The 180 s timeout still reports `ok: false, stopped: false, summary: "Compile stopped after 180 s"` as today.

`export_pdf_with_notes` returns `Err(ProjectError { kind: "io", message: "The PDF with notes was not made: the compile was stopped." })` when stopped.

## `recovery_save(path: string, text: string) -> ()`

- `path` is project-relative and validated by `resolve_in_project`.
- Refused with kind `readOnly` in a read-only window.
- Writes the copy atomically (temp + rename) with `savedAt = now` and `baseHash` = SHA-256 of the disk file, or `""` if missing.
- Fails with `io` on a write error; the previous copy stays.
- Rejects text over 10 MiB with kind `io` ("<path> is larger than 10 MiB"), the same as `read_file`.

## `recovery_list() -> RecoveryCopy[]`

- Prunes copies older than 30 days in all projects' recovery folders first.
- Returns the open project's copies whose text differs from the current disk text, sorted by `path`. Copies equal to disk are deleted.
- Each entry: `{ path, text, savedAt, baseHash, diskChanged, missing }`.
- Read-only windows get `[]` and nothing is deleted.

## `recovery_discard(paths: string[] | null) -> ()`

- Deletes the named copies, or all of the open project's copies when `null`. Missing copies are fine.
- Refused with `readOnly` in a read-only window.

## `run_with_timeout` (internal, changed signature)

`run_with_timeout(command, timeout, cancelled: &dyn Fn() -> bool) -> ProcessOutput`. `ProcessOutput` gains `stopped: bool`. The cancel check is polled every 50 ms; when it returns true the process tree is killed (`kill_tree`). Callers in `export.rs`, `git.rs` and `sync.rs` pass `&|| false`.
