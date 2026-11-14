---
description: "Task list for the Minimal Writer Shell (M1)"
---

# Tasks: Minimal Writer Shell

**Input**: Design documents from `specs/001-writer-shell/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/writer-ui.md, quickstart.md

**Tests**: Not requested in the spec. Verification is `npm run build` plus the manual scenarios in quickstart.md (research R5).

**Organization**: Tasks are grouped by user story. Paths are relative to the repo root (Tauri app: frontend in `src/`, backend in `src-tauri/`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story from spec.md (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Small standalone files and config that later phases import.

- [X] T001 [P] Add `"minWidth": 800, "minHeight": 600` to the single window object in `src-tauri/tauri.conf.json` (research R6; Tauri sizes are logical pixels).
- [X] T002 [P] Create `src/starter.ts` exporting `STARTER_DOCUMENT`: a minimal compilable LaTeX article (`\documentclass{article}`, `\begin{document}`, a `\section{Introduction}` and one short paragraph, `\end{document}`). No demo or marketing text.
- [X] T003 [P] Create `src/compile.ts` exporting `type CompileResult = { ok: boolean; summary: string; log: string; pdfPath: string | null }` and `compile(source: string): Promise<CompileResult>`. The M1 stub waits ~400 ms then resolves `{ ok: false, summary: "Compilation is not available yet", log: "Lexy cannot compile in this build. Compilation arrives in a later milestone.", pdfPath: null }`. Add a one-line comment saying M3 replaces the body with `invoke("compile_document", { source })` returning the same shape (contracts/writer-ui.md).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Turn `App` into the checking | setup | writer gate so every story has somewhere to render.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Move the setup UI out of `src/App.tsx` into `src/SetupScreen.tsx`, keeping its markup, classes, and behavior unchanged: the `ToolProbe`/`EnvironmentStatus`/`SetupProgress` types (export them), `setupSteps`, the `setup-progress` listener, `startSetup`, the Recheck button, and `ToolRow`. Props: `environment: EnvironmentStatus | null`, `checkError: string | null`, `onEnvironment(status: EnvironmentStatus): void`. Every place that previously called `setEnvironment` now calls `onEnvironment`.
- [X] T005 Create `src/Writer.tsx` exporting a placeholder `Writer` component that renders `<main className="writer" />` so the gate compiles; US1 fills it in.
- [X] T006 Rewrite `src/App.tsx` as the gate (data-model.md AppView): it owns `environment` and `checkError`, calls `check_environment` once on mount (keep the `mounted` guard), and renders: pending → a `<main className="app-shell">` with `<p role="status">Checking tools</p>`; `checkError` or `environment.ready === false` → `<SetupScreen …/>`; `environment.ready === true` → `<Writer />`.

**Checkpoint**: `npm run build` passes; with tools present the app shows an empty writer; with tools missing it shows the unchanged setup screen.

---

## Phase 3: User Story 1 - Open straight into a writing surface (Priority: P1) 🎯 MVP

**Goal**: With tools present, the app opens into the writer layout with the starter article ready to edit.

**Independent Test**: quickstart.md scenario 1 — launch with tools present; writer layout, starter article in a monospace editor, "No PDF yet" preview, no demo content.

- [X] T007 [US1] Build the layout in `src/Writer.tsx`: `<main className="writer">` containing a `<header className="command-strip">` (empty slot for US2/US3 controls), a `<textarea className="editor" aria-label="LaTeX source" spellCheck={false} wrap="off">` controlled by `source` state initialized from `STARTER_DOCUMENT`, a `<section className="preview" aria-label="PDF preview">` showing the blank state text "No PDF yet", and a `<footer className="status-bar">` slot for status and the drawer.
- [X] T008 [P] [US1] Add writer styles to `src/App.css` (research R6): `.writer` is a full-height CSS grid with rows `auto 1fr auto` and the editor/preview row split as `minmax(0, 1fr) minmax(0, 1fr)`; editor uses a monospace stack (`Cascadia Mono, Consolas, monospace`), no resize handle, scrolls internally; preview is a neutral blank panel with centered muted text; thin 1px separators, radius ≤ 8px, no viewport-scaled font sizes. Ensure the existing `body`/`.app-shell` rules don't force extra page scroll in the writer.

**Checkpoint**: US1 is demoable on its own (typing works; no compile yet).

---

## Phase 4: User Story 4 - Setup only when tools are missing (Priority: P1)

**Goal**: Setup appears only when a tool is missing, and finishing setup lands in the writer without a restart.

**Independent Test**: quickstart.md scenario 6 — launch with a tool missing (setup shows), then complete setup or restore the tool and click Recheck (writer shows).

- [X] T009 [US4] In `src/SetupScreen.tsx`, confirm both the successful `start_initial_setup` result and the Recheck result go through `onEnvironment`, so a `ready: true` status flips the gate in `src/App.tsx` to the writer.
- [X] T010 [US4] In `src/App.tsx`, when `check_environment` rejects, store the message in `checkError` and render `SetupScreen` with it (shown via the existing `.error-text` paragraph), so a failed check never leaves a blank window (spec edge case). A later successful Recheck clears `checkError`.

**Checkpoint**: US1 and US4 together are the MVP for M1.

---

## Phase 5: User Story 2 - See compile status at a glance (Priority: P2)

**Goal**: One text status indicator moves through Idle, Changed, Compiling, PDF ready, Compile failed.

**Independent Test**: quickstart.md scenarios 2 and 3 (status part) — edit → "Changed"; Compile → "Compiling" with the button disabled → "Compile failed".

- [X] T011 [US2] Add a `useReducer` in `src/Writer.tsx` over `{ status: "idle" | "dirty" | "compiling" | "ready" | "error", summary: string | null, log: string, pdfPath: string | null }`, starting `idle`, with events from data-model.md: `edit` (idle/ready/error/dirty → dirty; while compiling stay compiling), `compileStart` (ignored while compiling, else → compiling), `compileDone(result)` (`ok` → ready, else → error; store `summary`, `log`, `pdfPath`). Dispatch `edit` from the textarea `onChange`.
- [X] T012 [US2] Render the status indicator in the status bar of `src/Writer.tsx` as `<span role="status" aria-live="polite">` using the labels from contracts/writer-ui.md: idle "Idle", dirty "Changed", compiling "Compiling", ready "PDF ready", error "Compile failed" — text always present, color only as a supplement.
- [X] T013 [US2] Add the text button "Compile" to the command strip in `src/Writer.tsx` (`title="Compile"`, disabled while `compiling`): dispatch `compileStart`, `await compile(source)` from `src/compile.ts`, dispatch `compileDone`; on rejection dispatch `compileDone({ ok: false, summary: String(error), log: String(error), pdfPath: null })`.
- [X] T014 [US2] In the preview of `src/Writer.tsx`, when `status === "error"` show "Compile failed. Open log." with a button labelled "Open log" (wired in T017); otherwise keep "No PDF yet" (pdfPath is always null in M1).
- [X] T015 [P] [US2] Style the command strip, Compile button (primary accent) and status indicator in `src/App.css`; disabled state visibly distinct.

**Checkpoint**: All five states reachable (ready only once M3 lands; covered by the reducer).

---

## Phase 6: User Story 3 - Read logs only when needed (Priority: P3)

**Goal**: A collapsed log drawer that toggles by button and Ctrl+L, opens on a failed compile, and copies the log.

**Independent Test**: quickstart.md scenarios 3 (drawer part) and 4.

**Depends on**: US2 (needs compile results to show and the error event to auto-open).

- [X] T016 [US3] In `src/Writer.tsx` add `logsOpen` state (default `false`) and an icon-only toggle in the command strip: `aria-pressed={logsOpen}`, `aria-label` and `title` "Show logs" / "Hide logs", inline SVG icon with `aria-hidden="true"`.
- [X] T017 [US3] In `src/Writer.tsx` open the drawer when a compile ends with `ok: false` (set `logsOpen` true alongside dispatching `compileDone`), and wire the preview's "Open log" button (T014) to open it.
- [X] T018 [US3] In `src/Writer.tsx` add a `keydown` listener on `window` in a `useEffect` (removed on cleanup): `Ctrl+L` (no Shift/Alt) calls `preventDefault()` and toggles `logsOpen`.
- [X] T019 [US3] Render the drawer in `src/Writer.tsx` when `logsOpen`: `<section aria-label="Compile log">` with the `summary` line first, the raw `log` in a scrollable `<pre>` ("No log yet" when empty), and a "Copy log" button calling `navigator.clipboard.writeText(log)` (research R7; no clipboard plugin).
- [X] T020 [P] [US3] Style the drawer in `src/App.css`: height `min(40%, 220px)`, internal scroll for the `<pre>`, editor keeps a usable minimum height at 800x600 with the drawer open.

**Checkpoint**: All four stories work; quickstart scenarios 1–6 can run.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T021 Remove leftover template assets that are no longer referenced (FR-012): check `src/assets/react.svg` and files in `public/` with a grep for their names before deleting.
- [X] T022 Check focus order in `src/Writer.tsx` matches contracts/writer-ui.md (Compile → Logs → editor → preview action → drawer controls); fix DOM order rather than using `tabIndex`.
- [X] T023 Run `npm run build` and fix any type errors.
- [ ] T024 Run all scenarios in `specs/001-writer-shell/quickstart.md`, including 800x600 at 100/125/150% scaling.
- [X] T025 Update `docs/TRACKER.md`: F-004, F-005, F-008, F-009 status and evidence; add a Decision Log row for the M1 compile stub (research R2) and a Verification Log row for the quickstart run.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none; T001–T003 are independent.
- **Foundational (Phase 2)**: T004 → T005 → T006 (T006 imports both). Blocks all stories.
- **US1 (Phase 3)**: after Phase 2; T007 needs T002.
- **US4 (Phase 4)**: after Phase 2; independent of US1.
- **US2 (Phase 5)**: after US1 (adds to the Writer layout); T013 needs T003.
- **US3 (Phase 6)**: after US2 (uses compile results and the error event).
- **Polish (Phase 7)**: after all stories.

### Within stories

All Writer tasks edit `src/Writer.tsx` and run in order; only the `src/App.css` style tasks (T008, T015, T020) are parallel with their story's Writer work.

## Parallel Examples

```text
# Phase 1, all at once:
T001 tauri.conf.json min size
T002 src/starter.ts
T003 src/compile.ts

# After Phase 2, US1 and US4 can proceed side by side:
T007 + T008 (Writer.tsx / App.css)   |   T009 + T010 (SetupScreen.tsx / App.tsx)

# Inside US2 / US3:
T015 (App.css) alongside T011–T014 (Writer.tsx)
T020 (App.css) alongside T016–T019 (Writer.tsx)
```

## Implementation Strategy

### MVP first

1. Phase 1 + Phase 2.
2. US1 + US4 (both P1) → validate quickstart scenarios 1 and 6.
3. Stop and review.

### Incremental delivery

4. US2 → scenarios 2–3 (status part).
5. US3 → scenarios 3–4.
6. Polish → full quickstart run and tracker update.

## Notes

- No new npm or Cargo dependencies in this feature.
- Keep `SetupScreen` markup unchanged in T004; it's a move, not a redesign.
- Commit after each phase checkpoint.
