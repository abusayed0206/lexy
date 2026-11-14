# Implementation Plan: Live Preview with PDF ↔ Source Sync and Actionable Errors

**Branch**: `003-pdf-source-sync` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-pdf-source-sync/spec.md` (extended 2026-11-14)

## Summary

Turn the existing live preview into a tight feedback loop: SyncTeX data on every compile, a double-click jump from PDF to source, Ctrl+J from source to PDF, structured errors and warnings shown inline and in a clickable list, and a preview that keeps zoom, scroll and the last good PDF.

Most of the loop already exists: the 1 s debounced live preview (`livePreview.ts`), the scroll-keeping page swap (`PdfView.tsx`), and failures keeping the old PDF. The new work:

- **Rust**: add `-synctex=1` and `-max-print-line=1000` to the engine commands; copy each successful PDF and its `.synctex.gz` into a "shown" slot; add two lookup commands that call MiKTeX's `synctex.exe`; add a log parser that returns problems as project-relative file and line.
- **Frontend**: inline markers through `@codemirror/lint` (already installed with `codemirror`), a Problems list in the log drawer, zoom controls in `PdfView`, and the jump wiring.

Per the user's request, the work comes in **three batches of similar features, each tested once**.

## Technical Context

**Language/Version**: Rust 2021 (Tauri 2), TypeScript 5 + React 19

**Primary Dependencies**: existing only. `@codemirror/lint` (already in `node_modules` through `codemirror`; it gets added to `package.json` explicitly), pdf.js, MiKTeX `synctex.exe` (installed with MiKTeX next to `pdflatex.exe`)

**Storage**: build folder only: `<build>\<stem>.synctex.gz` and a `<build>\.lexy-shown\` slot holding the last good PDF and SyncTeX copy

**Testing**: Rust unit tests for the log parser and path mapping (fixed logs), plus a real e2e test (pdfLaTeX and XeLaTeX → SyncTeX round trip, both directions) that skips without MiKTeX; Vitest for zoom/keep-position helpers, the diagnostics mapping, and Writer jump/problem wiring with mocks

**Target Platform**: Windows 10/11 desktop

**Project Type**: desktop app (`src-tauri/` + `src/`)

**Performance Goals**: each jump < 300 ms (one `synctex.exe` call ≈ 30–80 ms); compile time +≤ 10 % with SyncTeX (SC-004); the preview update never resets zoom

**Constraints**: lookups read only under the build root (FR-009); lookups use the data of the PDF on screen (FR-004); Lexy must not edit user files; the same ASCII-only rule for latexmk as before (SyncTeX paths can be non-ASCII; mapping goes through the same path table)

**Scale/Scope**: line-level mapping; 50-page documents

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template; gates are the engineering rules in `docs/PLAN.md` / `CLAUDE.md`.

| Rule | Status |
|------|--------|
| React presentation only; Rust owns files and processes | Pass. `synctex.exe`, log parsing and path mapping are in Rust; React converts click coordinates and renders markers. |
| Typed commands, structured errors | Pass. `SyncTarget`, `PdfSpot` and `Problem` are serde structs mirrored in `compile.ts`. A failed lookup is `Ok(None)`, not an error. |
| No `.unwrap()` on recoverable paths | Pass (design). |
| Untrusted process output; validate paths; time out | Pass. Every lookup is limited to the shown slot under the build root; `synctex.exe` runs through `run_with_timeout` (5 s); paths it outputs pass through the mapping table, and anything outside the project becomes `external` and is never opened. |
| Managed state | Pass. A `SyncState` (the shown slot's path table per build key) is managed state, next to `CompileLock`. |
| Minimal capabilities | Pass. No new permissions. |

Post-design re-check: passes (no new crates, no new capabilities, one npm package already present made explicit).

## Project Structure

### Documentation (this feature)

```text
specs/003-pdf-source-sync/
├── spec.md          # extended with US3, US4, FR-010..013
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── commands.md  # compile_project changes, sync_to_source, sync_to_pdf
│   └── ui.md        # double-click, Ctrl+J, zoom, Problems, notes
└── tasks.md         # /speckit-tasks
```

### Source Code

```text
src-tauri/src/
├── lib.rs           # engine args (-synctex=1, -max-print-line), shown slot, CompileResult.problems
└── sync.rs          # NEW: path table, log → problems parser, synctex.exe edit/view, 2 commands
src/
├── compile.ts       # Problem / SyncTarget / PdfSpot types + wrappers
├── PdfView.tsx      # zoom state + controls, keep zoom/scroll, double-click → point, flash marker
├── pdfView/zoom.ts  # NEW pure helpers: zoom steps, anchor keep (+ test)
├── Editor.tsx       # lint diagnostics, flashLine(line), cursorLine()
├── Problems.tsx     # NEW list in the log drawer
├── Writer.tsx       # wiring: problems per file, jumps (open file + line), Ctrl+J, "last successful" note
└── Ribbon.tsx       # View: Show in PDF (Ctrl+J), Zoom in/out/Fit
```

**Structure Decision**: one new Rust module (`sync.rs`) next to `lib.rs`'s compile code, one new list component, and one pure helper module. Everything else extends existing files.

## Delivery Batches (similar features together, one test run each)

| Batch | Features | Test gate |
|-------|----------|-----------|
| A. Compile data | SyncTeX flags, shown slot, path table, log → problems (FR-001, 004, 009, 010, 013) | `cargo test` (parser and mapping units + real e2e) |
| B. Jumps | `sync_to_source` / `sync_to_pdf`, double-click, Ctrl+J, open sub-file, line flash, PDF marker (US1, US2) | `cargo test sync` + `npm test`; quickstart B |
| C. Feedback UI | inline lint, Problems list, zoom controls + keep, "last successful" note (US3, US4) | `npm test` + `npm run build`; quickstart C at 800x600 |

## Complexity Tracking

None.
