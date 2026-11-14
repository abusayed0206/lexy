# Implementation Plan: Project Workspace

**Branch**: `004-project-workspace` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-project-workspace/spec.md`

## Summary

Replace Lexy's single-file model with folder projects: a Project Home screen over `Documents\Lexy`, "Open folder…", a lazy file sidebar with create/rename/delete (to the Recycle Bin) and drag-in import, one main document per project, and per-file editor state. The Rust backend owns the open project root and resolves every file path against it, so nothing outside the project can be touched. Compiles keep running in the build folder. Unsaved sub-files are written to an overlay folder that comes first on `TEXINPUTS`/`BIBINPUTS`, so saved files and images are read from the project and never copied ([research R1](research.md)).

## Technical Context

**Language/Version**: Rust 1.99 (edition 2021), TypeScript 5 / React 19

**Primary Dependencies**: Tauri 2, CodeMirror 6, pdf.js; new crates `notify-debouncer-full` (folder watching) and `trash` (Recycle Bin)

**Storage**: Plain files. User projects are untouched folders; Lexy state lives in `%LOCALAPPDATA%\Lexy\projects.json` and `Locks\`.

**Testing**: `cargo test` (path confinement, overlay compile, main detection, lock), Vitest + jsdom (Project Home, sidebar, multi-file Writer)

**Target Platform**: Windows 10/11 desktop

**Project Type**: Desktop app (Tauri: React frontend + Rust backend)

**Performance Goals**: Open a 200-file project in under 1 s (SC-003); switch files in under 100 ms (SC-004); reflect outside changes in under 2 s (FR-012)

**Constraints**: Usable at 800x600 with the sidebar open; no writes outside the project and Lexy's app data; capabilities stay minimal (no new frontend permissions)

**Scale/Scope**: Projects up to ~5,000 entries without a warning; ~20 open text files per session

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so the gates are the engineering rules in `docs/PLAN.md` and `CLAUDE.md`:

| Rule | Status |
|------|--------|
| React owns presentation only; Rust owns filesystem, processes, compile | Pass. All file IO, watching, locking and the trash go through Rust commands. |
| Typed serializable request/response structs; structured errors where UI branches | Pass. New commands return typed structs; `ProjectError { kind, message }` is used where the UI branches (`NoRecycleBin`, `NameTaken`, `OutsideProject`, `ReadOnly`). |
| No `.unwrap()` on recoverable paths | Pass (design). The lock and watcher errors surface as notices. |
| Shared services in managed state | Pass. `ProjectState` (root, lock, watcher) and the existing `CompileLock`. |
| Untrusted external output; validate paths | Pass. `resolve_in_project` is the single path gate (R2). |
| Capabilities explicit and minimal | Pass. No new permissions; drag-drop uses the core event permissions already in `core:default`; opening files uses opener from Rust (R6). |
| No silent download/execute at startup | Pass. Not affected. |

Post-design re-check: still passes; no violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/004-project-workspace/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── backend-commands.md
│   └── ui.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src-tauri/src/
├── lib.rs               # register new commands + managed ProjectState; compile_source gains overlay
└── project.rs           # NEW: resolve_in_project, list/count, CRUD, import, trash, main detection,
                         #      projects.json, lock, watcher (testable without Tauri, like setup.rs)

src/
├── App.tsx              # checking → setup → ProjectHome | Writer
├── ProjectHome.tsx      # NEW: project list, New project, Open folder…
├── Sidebar.tsx          # NEW: lazy tree, context menu, keyboard, drop target
├── projects.ts          # NEW: typed invoke wrappers (replaces most of documents.ts)
├── openFiles.ts         # NEW: pure reducer for open files (dirty set, current, main)
├── Writer.tsx           # project-aware: current file vs main document, Save all, close guard
├── Editor.tsx           # per-file EditorState map (switchTo / textOf / applyTo)
├── compile.ts           # compileProject(mainRel, dirty buffers)
└── documents.ts         # keep suggestFileName/fileName helpers; drop single-file pickers
```

**Structure Decision**: Same two-layer app. The new backend code goes in its own `project.rs` module, following `setup.rs`, so `lib.rs` doesn't grow further and the module is unit-testable without Tauri. Frontend gets two new components and one pure reducer, which is tested like `livePreview.ts`.

## Phasing (for /speckit-tasks)

1. **Backend core**: `project.rs` path gate, listing, CRUD, main detection, `projects.json`, with Rust tests.
2. **Compile overlay**: `compile_project` plus an extra e2e case (unsaved sub-file and an image).
3. **Project Home + open/create** (US1).
4. **Sidebar + multi-file editor** (US2), then watcher and drag-in import.
5. **Main document + compile from any file** (US3).
6. **Close/switch guard, PDF export, read-only lock** (US4).
7. **Docs**: TRACKER (new F-ids; F-014 superseded), CLAUDE.md architecture notes, DESIGN.md sidebar rules.

## Complexity Tracking

No constitution violations.
