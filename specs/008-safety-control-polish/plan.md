# Implementation Plan: Safety and Control Polish

**Branch**: `008-safety-control-polish` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/008-safety-control-polish/spec.md`

## Summary

Four independent stories on top of the existing writer:

1. **Crash recovery (P1)**: Unsaved buffers are copied to `%LOCALAPPDATA%\Lexy\Recovery` by a new Rust module, on a debounced frontend schedule. On reopen they are offered for restore as unsaved edits through the existing snapshot-restore path.
2. **Stop compile (P1)**: A cancel epoch in managed state is checked inside the existing `run_with_timeout` poll loop and kills the tree with the existing `kill_tree`. The UI gets a Stop button, Shift+F5 and a "Compile stopped" status.
3. **Engine choice (P2)**: A pure `src/latex/engine.ts` edits the `% !TEX program` line as one undo step, using a Layout-tab menu and palette commands. The compile result reports why an engine was chosen.
4. **Find in PDF (P3)**: A pure `src/pdfView/find.ts` searches pdf.js text content. PdfView draws highlight boxes over its canvases.

Details and rejected alternatives: [research.md](research.md).

## Technical Context

**Language/Version**: Rust 2021 (stable, Tauri 2.12), TypeScript 5 / React 19

**Primary Dependencies**: Existing only: Tauri 2, `sha2`, `serde_json`, CodeMirror 6, pdf.js 5.7.284. No new crates or npm packages.

**Storage**: Recovery copies as JSON files under `%LOCALAPPDATA%\Lexy\Recovery\<hash(root)>\`. The engine choice lives only in the main `.tex` file.

**Testing**: `cargo test` (unit, plus a real latexmk stop test that skips without tools) and Vitest with jsdom (pure modules, scheduler, Writer flows with mocked backend).

**Target Platform**: Windows 10/11, WebView2

**Project Type**: Desktop app (Tauri: React frontend, Rust backend)

**Performance Goals**:
- Stop in under 2 s (SC-004).
- Recovery writes never on the keystroke path (SC-003).
- First PDF search result in under 1 s on 50 pages, next match in under 300 ms (SC-007).

**Constraints**:
- Nothing written into project folders (`.lexy\notes.json` stays the only exception).
- Read-only windows never write recovery copies or edit the engine.
- Every ribbon edit is one undo step.
- No network access.

**Scale/Scope**: Projects up to 500 files / 10 MiB per file (existing limits); PDFs up to a few hundred pages.

## Constitution Check

`.specify/memory/constitution.md` is still the blank template, so the gates are the engineering rules in `docs/PLAN.md` and `CLAUDE.md`.

| Gate | Pre-design | Post-design |
| --- | --- | --- |
| React owns presentation only; Rust owns filesystem and processes | Pass: recovery files and process kill are Rust commands | Pass: `recovery.rs`, `cancel_compile`; the frontend only schedules and renders |
| Typed commands, structured errors where the UI branches | Pass | Pass: recovery commands return `ProjectError`; `CompileResult.stopped` / `engineReason` mirrored in TS |
| Project paths only through `resolve_in_project`; no absolute paths from the UI | Pass | Pass: recovery commands take project-relative paths |
| Nothing written into project folders | Pass | Pass: recovery under `%LOCALAPPDATA%\Lexy\Recovery` |
| Shared services in managed state, no globals | Pass | Pass: `CompileCancel` managed; the recovery base dir is derived like `Snapshots` |
| No `.unwrap()` on recoverable paths | Pass | Pass: write failures are reported once, never panic (FR-010) |
| External process output untrusted; timeouts kept | Pass | Pass: the 180 s timeout stays (FR-017) |
| Capabilities explicit and minimal | Pass | Pass: no new capability (all through `invoke`) |
| Ribbon edits are pure functions in `src/latex/`, one undo step | Pass | Pass: `engine.ts` + `EditorHandle.applyTo` |
| Docs updated with the change (TRACKER, CLAUDE.md) | Pass | Pass: tracker rows F-074–F-077, CLAUDE.md lines for new commands |

No violations, so the Complexity Tracking section is omitted.

## Project Structure

### Documentation (this feature)

```text
specs/008-safety-control-polish/
├── plan.md              # This file
├── research.md          # R1–R6 decisions
├── data-model.md        # Recovery copy, compile run, engine choice, PDF search
├── quickstart.md        # Manual validation scenarios A–D
├── contracts/
│   ├── commands.md      # New/changed Tauri commands and result fields
│   └── ui.md            # Controls, shortcuts, copy, focus rules
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
src-tauri/src/
├── lib.rs               # CompileCancel state, cancel_compile, run_with_timeout(cancelled),
│                        # CompileResult.stopped / engineReason, stop cleanup, register commands
├── recovery.rs          # NEW: recovery_save / recovery_list / recovery_discard, prune, tests
├── export.rs, git.rs, sync.rs   # pass a never-cancel check to run_with_timeout
└── project.rs           # (unchanged API; recovery reuses resolve_in_project / ProjectState)

src/
├── compile.ts           # cancelCompile(); CompileResult.stopped / engineReason
├── projects.ts          # recoverySave / recoveryList / recoveryDiscard wrappers + types
├── livePreview.ts       # cancel()
├── recovery.ts          # NEW: pure debounce/max-wait scheduler for recovery writes
├── latex/engine.ts      # NEW: readEngine / engineEdit
├── latex/settings.ts    # respect explicit engine lines (research R5)
├── pdfView/find.ts      # NEW: normalise, match, rects
├── PdfView.tsx          # find bar, highlights, re-run after swap
├── Writer.tsx           # stopped status, Stop button, Shift+F5, recovery wiring + InfoBar,
│                        # engine actions, palette commands
├── RecoveryDialog.tsx   # NEW: per-file Restore / Discard list
├── Ribbon.tsx / ribbon/EngineMenu.tsx  # NEW menu on the Layout tab
├── actions.ts           # engine.* commands in ribbonCommands()
├── App.css              # find highlight tokens (light/dark/forced-colors), .pdf-page relative
└── test/contrast.test.ts # new tokens
```

**Structure Decision**: Keep the existing single Tauri app layout. New logic goes in pure modules (`recovery.ts`, `latex/engine.ts`, `pdfView/find.ts`, `recovery.rs`) with unit tests. Writer and PdfView only wire them up.

## Story order and independence

- US1 (recovery) and US2 (stop) are both P1 and touch different code (recovery: new module + Writer save paths; stop: compile path + status). They can be built in either order.
- US3 (engine) depends only on `CompileResult.engineReason`, a one-field Rust change that is independent of US2's `stopped`.
- US4 (find) touches only PdfView, `find.ts` and CSS.
- Shared files are `Writer.tsx` (US1–US3), `compile.ts` and `lib.rs` (`CompileResult`, US2 and US3). Tasks that touch the same file run one after another.

## Risks

- **Taskkill latency on a busy machine**: measured in the stop e2e test; the 2 s target allows 95 % (SC-004).
- **Proportional highlight boxes inside one text item** can be a few points off. Accepted (research R6).
- **Bangla PDF text extraction** may not round-trip shaped text. The spec accepts "No results".
- **Settings/engine interplay** (research R5) changes `applySettings`. Its 504-combination round-trip test must stay green, and new cases cover explicit engine lines.
