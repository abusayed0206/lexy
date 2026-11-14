# Data Model: 003 PDF ↔ Source Sync and Actionable Errors

Rust serde structs (camelCase) mirrored in `src/compile.ts`; Rust tests assert the JSON shape.

## Problem (in `CompileResult.problems`)
| Field | Type | Notes |
|-------|------|-------|
| `severity` | `"error" \| "warning"` | |
| `file` | string? | project-relative, `/` separators; `null` when outside the project or unknown |
| `line` | number? | 1-based; `null` when the log gives none |
| `message` | string | one line, ≤ 300 chars; for external files it starts with the file name |

Rules: at most 200, de-duplicated by (file, line, message), errors first, then in log order. `CompileResult.summary` stays (first error) for the status chip.

## CompileResult (changed)
Adds `problems: Problem[]`. `pdfPath` now points into `<build>\.lexy-shown\` on success; `null` on failure (the UI keeps the previous PDF).

## Shown slot (`SyncState`, Rust managed state)
Per build key: `pdf` path, `synctex` path, and the path table `Vec<(recorded prefix, Mapping)>` where `Mapping` = `Main` (snapshot file → main document), `Overlay` (`<build>\.lexy-overlay\` → rel), `Project` (`<project>\` and `<build>\.lexy-root\` → rel). It is replaced only after a successful compile, and lookups read only this record.

## SyncTarget (`sync_to_source` result)
`{ kind: "project", file, line } | { kind: "external", name } | null`

## PdfSpot (`sync_to_pdf` result)
`{ page, x, y, width, height } | null` in PDF points from the page's top-left (`y` = top of box = `v - H`).

## Preview view state (frontend only)
`zoom: "fit" | number` (0.5–3), anchor `{ page, fraction }`; persisted zoom key `lexy.pdfZoom`.

## Validation
- Lookup `page ≥ 1`; `x, y` finite and ≥ 0; `line ≥ 1`; file through `resolve_in_project`.
- `synctex.exe` output paths are mapped by prefix only (case-insensitive, slashes normalized); anything unmatched is `external`.
