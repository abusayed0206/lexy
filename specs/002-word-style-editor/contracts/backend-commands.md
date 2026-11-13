# Contract: Backend commands (Rust ↔ frontend)

All are Tauri commands in `src-tauri/src/lib.rs`. Structs serialize camelCase; errors are `String`. No new plugins or capabilities.

## `default_document_folder() -> DefaultFolder` (new)

```ts
type DefaultFolder = { path: string; fallback: boolean };
```

- `path` = `<FOLDERID_Documents>\Lexy`, created if missing (`create_dir_all`).
- When the Documents folder can't be resolved or created: `path` = home folder, `fallback: true` (UI shows a one-line notice, FR-003).
- Async; never blocks the UI thread.

## `list_system_fonts() -> string[]` (new)

- Sorted, de-duplicated family names of installed fonts (system + per-user), via `fontdb`.
- Only names matching `^[A-Za-z0-9 _.'&+-]{1,64}$` are returned.
- Computed once per process, cached in managed state; async.

## `compile_source(source: string, documentPath: string | null) -> CompileResult` (new, replaces `compile_document`)

```ts
type CompileResult = { ok: boolean; summary: string; log: string; pdfPath: string | null; engine: "pdflatex" | "xelatex" | "lualatex" };
```

- `documentPath`, when given, must be an absolute `.tex` path (same validation as `read_document`); it need not exist yet.
- Build folder = `%LOCALAPPDATA%\Lexy\Build\<hash(documentPath) | "untitled">`.
- Writes `source` to `<build>\<stem>.tex` (stem from `documentPath`, else `Untitled`) — **never** writes `documentPath`.
- Engine from the line-1..5 marker `% !TEX program = …` (research R4); latexmk flag `-pdf` / `-xelatex` / `-lualatex`.
- Env: tool folders prepended to `PATH`; `TEXINPUTS=<document folder>;` when `documentPath` is given.
- Serialized by a process-wide compile lock (managed `Mutex<()>`); 180 s timeout with process-tree kill (existing).
- `summary`: `"PDF ready"`, first LaTeX error (`Line N: …`), `"<tools> missing"`, or timeout text (existing rules).
- `source` larger than 10 MiB → error (same limit as documents).

## Unchanged

`check_environment`, `start_initial_setup`, `read_document`, `write_document`, `read_pdf` (build-root check still applies to the new snapshot PDFs).
