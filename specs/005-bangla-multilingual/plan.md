# Implementation Plan: Seamless Bangla and Multilingual Documents

**Branch**: `005-bangla-multilingual` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-bangla-multilingual/spec.md`

## Summary

Make Bangla (via LaTeXbangla) and other scripts compile and edit without any setup.
1. Lexy picks XeLaTeX automatically when the preamble loads a Unicode-engine package. This fixes the reported failure.
2. Font files in the project are found through `TTFONTS`/`OPENTYPEFONTS`.
3. Non-Latin project and file names work: latexmk gets an ASCII snapshot name and, when needed, an ASCII junction to the project.
4. Missing packages install per run with MiKTeX's `-enable-installer`.
5. A missing font gets a readable summary.
6. The editor shows every script with a fallback font and lays out right-to-left lines correctly.

Every risky assumption was tested on the dev machine first ([research.md](research.md)).

## Technical Context

**Language/Version**: Rust 1.99 (edition 2021), TypeScript 5 / React 19

**Primary Dependencies**: Tauri 2, CodeMirror 6 (`@codemirror/view` `perLineTextDirection`), MiKTeX 26.5 + latexmk 4.88; LaTeXbangla 2.1 (MiKTeX package, not bundled). No new crates or npm packages.

**Storage**: None new. Build folders gain an optional `.lexy-root` junction.

**Testing**: `cargo test` (engine choice, font error summary, snapshot names, junction create/reuse/cleanup safety, e2e with LaTeXbangla when tools and a Bangla font exist), Vitest (editor extensions, status tooltip)

**Target Platform**: Windows 10/11

**Project Type**: Desktop app (Tauri)

**Performance Goals**: No extra compile time for pdfLaTeX documents; the engine scan reads only the preamble (< 1 ms for typical files); junction created once per build folder

**Constraints**: Never write into the user's project; no global MiKTeX config changes; no font downloads

**Scale/Scope**: One engine decision per compile; scripts covered in the editor: Bangla, Devanagari, Arabic/Hebrew, CJK, Latin

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template; gates are the engineering rules in `docs/PLAN.md` / `CLAUDE.md`.

| Rule | Status |
|------|--------|
| React presentation only; Rust owns files and processes | Pass. Engine choice, env vars, the junction and error parsing are all in Rust; React only shows the engine and configures CodeMirror. |
| Typed commands, structured errors | Pass. `compile_project` keeps its signature; `CompileResult.engine` already exists. |
| No `.unwrap()` on recoverable paths | Pass (design). Junction creation failure falls back to the plain path with a log note, not a panic. |
| Untrusted process output; validate paths | Pass. The junction target is the canonical project root from `ProjectState`; junction path is fixed inside the build folder. |
| Minimal capabilities | Pass. No new permissions. |
| No silent download/execute at startup | Pass. `-enable-installer` acts only during a compile the user started (F5 or live preview), which is the same moment MiKTeX would ask today. |
| Compiling never touches the user's files | Pass. Junction lives in the build folder; nothing is written through it. |

Post-design re-check: pass.

## Project Structure

### Documentation (this feature)

```text
specs/005-bangla-multilingual/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── compile.md
│   └── editor-ui.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
src-tauri/src/
├── lib.rs        # choose_engine (replaces engine_from_marker use), snapshot stem, search paths
│                 # (TEXINPUTS/BIBINPUTS/TTFONTS/OPENTYPEFONTS), -enable-installer, font error
│                 # summary, ASCII build-root fallback, junction for non-ASCII roots
└── project.rs    # (unchanged API) read helpers reused for scanning preamble \input files

src/
├── Editor.tsx    # perLineTextDirection
├── App.css       # --font-mono script fallbacks
└── Ribbon.tsx    # status tooltip shows the engine ("XeLaTeX · PDF ready")
```

**Structure Decision**: Changes stay in the existing compile path in `lib.rs` (where `engine_from_marker`, `compile_project_at` and `run_latexmk` live). No new module: the engine scan is ~40 lines plus tests. If `lib.rs` keeps growing, a later refactor can move compile code to `compile.rs`; not needed for this feature.

## Phasing (for /speckit-tasks)

1. **US1 engine choice**: `choose_engine` + tests; wire into `compile_project_at`; status tooltip shows engine.
2. **US2 fonts**: font search env vars; font-not-found summary; e2e with a project-local font (skipped without tools).
3. **US4 names**: ASCII snapshot stem; junction for non-ASCII roots; ASCII build-root fallback; tests incl. junction-safe cleanup.
4. **US5 packages**: `-enable-installer` for all three engines; summary pattern for failed installs.
5. **US3 editor**: `perLineTextDirection`, font fallbacks, Vitest for Bangla cluster delete and RTL line direction.
6. **Docs**: TRACKER (new F-ids, intake row), CLAUDE.md compile notes, DESIGN.md (scripts, Backspace behaviour), decision log entries.

## Complexity Tracking

No constitution violations.
