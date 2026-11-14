# Implementation Plan: Minimal Writer Shell

**Branch**: `001-writer-shell` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-writer-shell/spec.md`

## Summary

Turn the app from a setup-only screen into a writer. `App` becomes a three-way gate (checking → setup → writer) driven by the existing `check_environment` command. A new writer view adds a command strip, a monospace textarea preloaded with a starter article, a blank PDF preview, a status indicator, and a collapsible log drawer. Compilation is a frontend stub with the same result shape the real M3 Rust command will return, so M3 only swaps one function. No Rust changes beyond window minimum size.

## Technical Context

**Language/Version**: TypeScript ~5.8 (React 19); Rust 2021 (unchanged except config)

**Primary Dependencies**: React 19, `@tauri-apps/api` v2, Vite 7 — all already installed. No new dependencies.

**Storage**: N/A (starter document lives in memory; file IO is M2)

**Testing**: `npm run build` (tsc typecheck) + manual checklist in [quickstart.md](quickstart.md). No JS test runner exists; see research R5.

**Target Platform**: Windows 10/11, WebView2 via Tauri 2

**Project Type**: desktop-app (Tauri: React frontend + Rust backend)

**Performance Goals**: writer interactive within 3 s of launch (SC-001); typing has no perceptible lag for documents up to a few thousand lines (plain textarea)

**Constraints**: usable at 800x600 logical window at 100/125/150% scaling; text-only status states (not color alone); accessible names + tooltips on icon buttons

**Scale/Scope**: 1 window, 3 top-level views (checking, setup, writer), ~4 new UI parts

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so there are no ratified gates. As an interim gate this plan checks against the product principles and engineering rules in `docs/PLAN.md` and the UI rules in `docs/DESIGN.md`. Run `/speckit-constitution` to make these official.

| Gate (source) | Pre-design | Post-design |
| --- | --- | --- |
| Minimal first screen, no landing/tutorial (PLAN principle 1, DESIGN) | Pass — writer opens directly | Pass |
| One primary job: write + see PDF (PLAN 2) | Pass — strip limited to Compile + Logs | Pass |
| Failures understandable, distinct (PLAN 4) | Pass — compile stub says plainly it is not available yet | Pass |
| No hidden data loss (PLAN 5) | Pass with note — starter edits are in-memory only; no save exists yet, so nothing claims to be saved | Pass |
| React owns presentation; Rust owns FS/process (PLAN Architecture) | Pass — M1 does no FS or process work | Pass |
| Typed command contracts (PLAN Engineering Rules) | Pass — `CompileResult` contract defined now for M3 | Pass |
| Keep frontend state local (PLAN Engineering Rules) | Pass — state lives in `App` / `Writer` with `useState`/`useReducer`, no store | Pass |
| Minimal capabilities (PLAN Engineering Rules) | Pass — no new capabilities; clipboard via WebView `navigator.clipboard` | Pass |
| Tracker updated in same change (README/PLAN) | Required at implementation: F-004, F-005, F-008, F-009 | — |

No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-writer-shell/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── writer-ui.md
└── tasks.md          # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
src/
├── App.tsx           # becomes the gate: checking | setup | writer
├── SetupScreen.tsx   # current setup UI moved out of App.tsx unchanged
├── Writer.tsx        # new: command strip, editor, preview, status, log drawer
├── compile.ts        # new: CompileResult type + M1 stub compile()
├── starter.ts        # new: starter LaTeX article string
└── App.css           # extended with writer layout rules

src-tauri/
└── tauri.conf.json   # add minWidth/minHeight 800x600
```

**Structure Decision**: Keep the existing flat `src/` layout (no components/ folders for 4 files). Rust side is untouched apart from the window minimum size.

## Complexity Tracking

None.
