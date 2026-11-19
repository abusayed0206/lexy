# Data Model: Safety and Control Polish

## RecoveryCopy (Rust `recovery::Copy`, TS `RecoveryCopy`)

One unsaved file of one project. Stored as JSON at `%LOCALAPPDATA%\Lexy\Recovery\<build_key(root)>\<build_key(rel)>.json`.

| Field | Type | Rules |
| --- | --- | --- |
| `path` | string | Project-relative, `/` separators; must pass `resolve_in_project` |
| `text` | string | The unsaved buffer; ≤ 10 MiB (same cap as `read_file`) |
| `savedAt` | u64 (unix ms) | Time of the copy; used for the 30-day prune |
| `baseHash` | string | SHA-256 hex of the file on disk when the copy was made; `""` if the file did not exist |

Returned by `recovery_list` with two derived fields, not stored:

| Field | Type | Meaning |
| --- | --- | --- |
| `diskChanged` | bool | Current disk hash ≠ `baseHash` |
| `missing` | bool | The file no longer exists on disk |

**Lifecycle**:

```text
(none) --edit, unsaved, 2 s pause or 10 s max wait--> written
written --more edits--> rewritten (atomic replace)
written --save / Don't save / Discard / clean close--> deleted
written --app dies--> survives --project opens--> offered
offered --Restore--> deleted after the buffer holds the text (the next unsaved edit writes a new copy)
offered --Discard--> deleted
written --older than 30 days--> pruned
```

Copies whose `text` equals the current disk text are deleted on list, not offered.

## CompileRun (frontend `CompileState`, backend epoch)

| Field | Where | Notes |
| --- | --- | --- |
| cancel epoch | Rust `CompileCancel(Arc<AtomicU64>)` | Read when a compile command is invoked; `cancel_compile` increments it |
| `status` | TS `Status` | adds `"stopped"`; label "Compile stopped" |
| `CompileResult.stopped` | Rust + TS | `true` only for runs ended by `cancel_compile` (not the timeout) |
| `CompileResult.engineReason` | Rust + TS | `"marker"`, package or class name, `"default"`, or the Bangla sentence |

**Status transitions (additions)**:

```text
compiling --stopped result--> stopped   (pdfPath, engine, log kept from before)
stopped   --edit--> dirty
stopped   --start--> compiling
```

## EngineChoice (TS `src/latex/engine.ts`)

| Value | Line in the main document |
| --- | --- |
| `auto` | No engine line in lines 1–5 |
| `pdflatex` / `xelatex` / `lualatex` | `% !TEX TS-program = <engine>` (written by the menu); any recognised spelling is read |

`readEngine(text)` returns `{ choice, line: number | null, setByFont: boolean }`. `setByFont` is true when the line is exactly `% !TEX program = xelatex`, the line written by the font settings.

Recognised line (same rule as Rust `marker_engine`): within the first 5 lines, the whole line matches `^\s*%\s*!\s*TEX\s+(TS-)?program\s*=\s*(pdflatex|xelatex|lualatex)\s*$`, any case.

## PdfSearch (TS, PdfView local state)

| Field | Type | Notes |
| --- | --- | --- |
| `query` | string | Raw text from the find field |
| `pages` | `PageText[]` cached per loaded document | `{ text: string; map: { item: number; offset: number }[] }`, normalised and case-folded |
| `matches` | `{ page: number; rects: Rect[]; top: number }[]` | `Rect` in CSS pixels relative to the page wrapper |
| `current` | number \| null | Index into `matches`; wraps |

Normalisation: each text item's string, with `hasEOL` and every run of whitespace collapsed to one space. Case folding is per character (`toLocaleLowerCase()`, falling back to the original character when the length changes) so offsets stay one-to-one.
