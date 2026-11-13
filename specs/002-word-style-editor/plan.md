# Implementation Plan: Word-Style Writing Experience

**Branch**: `002-word-style-editor` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-word-style-editor/spec.md`

## Summary

Turn the writer into a Word-style LaTeX editor without hiding the source. A tabbed ribbon (File, Home, Insert, Layout, View) replaces the icon strip. Every ribbon action is a text edit on the `.tex` source made through one editor API, so each is one undo step and the file stays plain, portable LaTeX:

- Document-wide font, size, paper and margins live in one marked **Lexy settings block** in the preamble, plus the class size option.
- Choosing an installed Windows font switches the document to XeLaTeX with a standard `% !TEX program = xelatex` marker.
- The equation editor previews math with KaTeX as you type.
- Tables come from a hover grid or a dialog.

**Live preview** compiles a snapshot of the editor text (never the user's file) about 1 s after typing stops. Requests coalesce, so at most one compile runs plus one waits. The result renders through pdf.js onto canvases that are swapped in only when ready, so the preview neither flashes nor loses its scroll position.

**Save location**: new documents default to `<Documents>\Lexy`, resolved through Tauri's `document_dir()` (`FOLDERID_Documents`, which follows OneDrive redirection) and created on demand.

## Technical Context

**Language/Version**: TypeScript ~5.8 + React 19 (frontend); Rust 2021 (backend)

**Primary Dependencies**:
- Existing: Tauri 2, `tauri-plugin-dialog`, CodeMirror 6.
- New frontend: `katex` (equation preview), `pdfjs-dist` (flicker-free preview).
- New backend crate: `fontdb` (list installed font families).
- Align the `tauri` / `tauri-plugin-dialog` crates with the npm minors (2.12 / 2.8). This fixes the version-mismatch warning seen at launch.

**Storage**:
- `.tex` files, with settings embedded in the preamble.
- Live-preview snapshots and build output in `%LOCALAPPDATA%\Lexy\Build\<key>`.
- `localStorage` for UI preferences only (live preview on/off, active ribbon tab, split).

**Testing**: `cargo test` (Rust units, plus the real-latexmk e2e test extended to XeLaTeX and to live snapshots with `\input`); Vitest + Testing Library (pure generators/parsers, Ribbon, dialogs, Writer with mocked backend); manual quickstart in the native window.

**Target Platform**: Windows 10/11, WebView2, MiKTeX (pdfLaTeX + XeLaTeX), Strawberry Perl

**Project Type**: desktop-app (Tauri: React frontend + Rust backend)

**Performance Goals**: live preview visible ≤ 3 s after the user pauses, for a 2-page document (SC-001); equation preview < 50 ms per keystroke; ribbon actions instant (pure text edits)

**Constraints**: usable at 800x600 (ribbon collapses labels); never write the user's file without an explicit save; Lexy edits only its own preamble block and class options; font names validated (no LaTeX injection); one compile at a time per process

**Scale/Scope**: 1 window; ~10 new UI parts (ribbon, 5 tabs, font picker, layout menu, equation dialog, table picker/dialog, PDF view); 3 new/changed Rust commands

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the blank template. Interim gates come from `docs/PLAN.md` (principles and engineering rules) and `docs/DESIGN.md`.

| Gate (source) | Pre-design | Post-design |
| --- | --- | --- |
| P1 Minimal first screen, no landing (PLAN) | Pass — still opens straight into the writer | Pass |
| P2 One primary job: write LaTeX + see PDF (PLAN) | Pass — live preview strengthens it; source stays visible | Pass |
| P3 Install/run feels boring, no console windows (PLAN) | Pass — reuses hidden-console process runner | Pass |
| P4 Failures understandable (PLAN) | Pass — live errors as one line, explicit compile opens log; missing font package explained | Pass |
| P5 No hidden data loss / no hidden writes (PLAN) | Pass — live preview compiles a snapshot in the build folder, never writes the user's file | Pass |
| Rust owns FS + processes (PLAN Architecture) | Pass — Documents folder, fonts, snapshots, compile all in Rust | Pass |
| Typed command contracts (PLAN rules) | Pass — see [contracts/backend-commands.md](contracts/backend-commands.md) | Pass |
| Validate paths / treat process output as untrusted (PLAN rules) | Pass — font names validated, build-root PDF check kept, timeout kept | Pass |
| Managed state for shared services (PLAN rules) | Pass — compile lock + font cache in Tauri managed state | Pass |
| Minimal capabilities (PLAN rules) | Pass — no new plugins or permissions; everything is a Lexy command | Pass |
| **Compact command strip, sparse UI (DESIGN)** | **Deviation** — user asked for a Word-like ribbon | Justified below; DESIGN.md to be updated |
| Accessibility, 800x600, text-not-color (DESIGN) | Pass — tablist pattern, named controls, label collapse | Pass |
| Tracker updated in same change (README) | Required at implementation (F-007, F-018, F-033 + new rows) | — |

## Project Structure

### Documentation (this feature)

```text
specs/002-word-style-editor/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── backend-commands.md
│   ├── settings-block.md
│   └── ribbon-ui.md
└── tasks.md            # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/
├── App.tsx                 # unchanged gate
├── Writer.tsx              # layout: Ribbon + Editor + PdfView + log drawer; owns doc state
├── Ribbon.tsx              # new: tabs + groups (File/Home/Insert/Layout/View)
├── ribbon/                 # new: FontPicker, LayoutMenu, TablePicker, TableDialog, EquationDialog
├── Editor.tsx              # + imperative EditorHandle (wrap/replace/transform lines/find equation)
├── PdfView.tsx             # new: pdf.js canvases, double-buffered, keeps scroll
├── livePreview.ts          # new: debounce + coalescing scheduler (pure, timer-injected)
├── latex/
│   ├── settings.ts         # new: parse/serialize Lexy settings block, class size, engine marker
│   ├── fonts.ts            # new: built-in font table + system font validation
│   ├── format.ts           # new: bold/italic/heading/list/page break/footnote edits
│   ├── equations.ts        # new: palette, inline/display wrap, find equation at cursor
│   └── tables.ts           # new: table spec → LaTeX
├── compile.ts              # compileSource(), loadPdf()
├── documents.ts            # + defaultFolder() for dialogs
└── App.css                 # ribbon + dialogs + PdfView styles (tokens, light/dark)

src-tauri/src/lib.rs        # + default_document_folder, list_system_fonts, compile_source (replaces compile_document)
src-tauri/Cargo.toml        # + fontdb; tauri/dialog crate versions aligned
```

**Structure Decision**: The flat `src/` layout no longer scales, so pure LaTeX-text logic moves to `src/latex/` (no React, heavily unit-tested) and ribbon pop-ups to `src/ribbon/`. The backend stays one `lib.rs` file, organized into sections as it is today.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Ribbon instead of DESIGN.md's compact strip | Explicit user request ("slightly like MS Word UI"); hosts fonts, layout, equation, table commands | Icon strip can't hold ~20 grouped, labelled commands discoverably |
| `pdfjs-dist` (~1.3 MB incl. worker) | FR-008: no flash, keep scroll position on every live refresh | Built-in viewer in an iframe reloads to page 1 and flashes on each refresh; acceptable for manual compiles, not for ~1 s live updates |
| `katex` (~300 KB incl. fonts) | FR-022: instant rendered equation preview while typing | Compiling LaTeX per keystroke takes seconds; MathJax is larger |
| `fontdb` crate | FR-020: list installed Windows font families reliably (incl. per-user fonts) | Reading `C:\Windows\Fonts` filenames gives file names, not family names; PowerShell/`System.Drawing` adds a slow process per launch |
| Second engine (XeLaTeX) | FR-019: system fonts like Calibri need fontspec | pdfLaTeX cannot load arbitrary TTF/OTF system fonts |
