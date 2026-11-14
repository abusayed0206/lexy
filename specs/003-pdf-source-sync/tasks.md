---
description: "Task list for 003: live preview, PDF ↔ source sync, actionable errors"
---

# Tasks: Live Preview with PDF ↔ Source Sync and Actionable Errors

**Input**: `specs/003-pdf-source-sync/`: plan.md, spec.md (US1–US4, FR-001…FR-013), research.md (R1–R10), data-model.md, contracts/commands.md, contracts/ui.md, quickstart.md

**Working rule (user request)**: build similar features together and run the tests once per batch, at its gate. Tests are written inside the batch.

**Reuse, don't re-create**: `run_with_timeout`, `hide_console` (`src-tauri/src/lib.rs`); `compile_project_at`, `run_latexmk_inner`, `OVERLAY`, `tex_project_path`, `validate_pdf_path`, `first_latex_error` (lib.rs); `resolve_in_project` (project.rs); `EditorHandle`, `switchTo` (`src/Editor.tsx`); `onEntryOpen`, `showResult`, `lastPdf`, the log drawer, `setInfo` and the capture-phase shortcut listener (`src/Writer.tsx`); `RibbonButton` (`src/Ribbon.tsx`).

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Create `src-tauri/src/sync.rs` with `mod sync;` in `src-tauri/src/lib.rs`; add `"@codemirror/lint"` to `package.json` dependencies at the version already in `node_modules/@codemirror/lint/package.json` (run `npm install` to update the lockfile)
- [X] T002 [P] Create `src/pdfView/zoom.ts` (empty module) for pure zoom/anchor helpers

---

## Phase 2: Foundational (blocks every batch)

- [X] T003 In `src-tauri/src/sync.rs` add `PathTable { main_snapshot: PathBuf, main_rel: String, overlay: PathBuf, roots: Vec<PathBuf> }` (roots = project root display path and `<build>\.lexy-root` when used) with `fn to_project(&self, path: &str) -> Option<String>`: normalize slashes and `./`, compare case-insensitively by prefix; snapshot file → `main_rel`, `<overlay>\rel` and `<root>\rel` → `rel` with `/` separators; else `None`
- [X] T004 In `src-tauri/src/lib.rs` build the `PathTable` inside `compile_project_at` from values it already computes (snapshot path, overlay dir, `tex_project_path` result, project root), and return it alongside `CompileResult` to the command layer
- [X] T005 In `src-tauri/src/sync.rs` add managed `SyncState(Mutex<HashMap<PathBuf /*build dir*/, Shown>>)` with `Shown { pdf: PathBuf, synctex: PathBuf, table: PathTable }`; register it in `run()` in `src-tauri/src/lib.rs`
- [X] T006 [P] In `src/compile.ts` add the types `Problem { severity: "error" | "warning"; file: string | null; line: number | null; message: string }`, `SyncTarget = { kind: "project"; file: string; line: number } | { kind: "external"; name: string } | null`, `PdfSpot = { page; x; y; width; height } | null`, and `problems: Problem[]` on `CompileResult` (mirror Rust exactly per data-model.md)

**Checkpoint**: `cargo check` and `npx tsc --noEmit` pass (no test run yet).

---

## Phase 3: Batch A: Compile data (FR-001, FR-004, FR-009, FR-010, FR-013) 🎯

**Goal**: every compile yields SyncTeX data in a stable shown slot plus structured problems.

- [X] T007 [US3] In `run_latexmk_inner` (`src-tauri/src/lib.rs`) add `-synctex=1` to the latexmk args and `-max-print-line=1000` to each `-pdflatex=`/`-xelatex=`/`-lualatex=` command string (before `%O`)
- [X] T008 [US4] In `src-tauri/src/lib.rs` after a successful compile, copy `<stem>.pdf` and `<stem>.synctex.gz` to `<build>\.lexy-shown\<stem>.pdf`/`.synctex.gz` via temp names + rename (reuse `write_atomic` or `fs::copy` + `fs::rename`); set `CompileResult.pdf_path` to the slot PDF; then store `Shown` in `SyncState` in `compile_project`. A failed compile must not touch the slot or `SyncState`. Make sure the mirrored-folder cleanup skips `.lexy-shown` (dot prefix, like `OVERLAY`)
- [X] T009 [US3] In `src-tauri/src/sync.rs` add `parse_problems(log: &str, table: &PathTable) -> Vec<Problem>` per research R4: file stack from `(path` / `)`; errors from `path:line: msg` and `! msg` + `l.<n>`; warnings from `LaTeX Warning: … on input line N.`, `Package X Warning: …` (join `(X)` continuation lines) `on input line N`, `Overfull|Underfull \hbox … at lines A--B` → A; map paths with `to_project` (external → `file: None`, message prefixed with the file name); cap 200, dedupe on (file, line, message), errors first; `message` ≤ 300 chars, one line
- [X] T010 [US3] Add `problems: Vec<Problem>` (serde camelCase, `severity` lowercase) to `CompileResult` in `src-tauri/src/lib.rs`, filled from `parse_problems` on every compile (success or failure); keep `summary` from `first_latex_error`
- [X] T011 [P] [US3] Rust unit tests in `src-tauri/src/sync.rs`: `to_project` for snapshot, overlay, project root and `.lexy-root` paths with `/` and `\`, mixed case, and an external `article.cls`; `parse_problems` on fixed log excerpts (file-line-error error in `chapters/intro.tex`, `! Undefined control sequence` + `l.5`, undefined reference warning, multi-line package warning, overfull box, external file error, 250 duplicates capped)
- [X] T012 [US4] Extend the real e2e test in `src-tauri/src/lib.rs` (skips without MiKTeX): after a successful compile `.lexy-shown` holds the PDF and `.synctex.gz`; a following failed compile leaves both unchanged; the failed result lists an error with `file: Some("chapters/intro.tex")` and the right line; JSON of `CompileResult` has `problems` in camelCase
- [X] T013 **Gate A** (automated tests passed; manual quickstart walk still pending): run `cd src-tauri; cargo test` once; fix failures; walk quickstart A

---

## Phase 4: Batch B: Jumps (US1, US2; FR-002…FR-008)

**Goal**: double-click PDF → source line (opening sub-files); Ctrl+J → PDF spot.

### Backend

- [X] T014 [US1] (also fixed: latexmk skipped reruns when a file moved between project and overlay; Lexy now drops `<stem>.fdb_latexmk` when the overlay set changes) In `src-tauri/src/sync.rs` add `find_synctex()`: `synctex.exe` beside the resolved MiKTeX engine (`environment.miktex.path` parent, as `run_latexmk_inner` resolves it), else PATH; and `run_synctex(args) -> Result<String, String>` via `run_with_timeout` (5 s)
- [X] T015 [US1] In `src-tauri/src/sync.rs` add `parse_edit(stdout) -> Option<(String /*Input*/, u32 /*Line*/)>` and command `sync_to_source { main, page, x, y } -> Result<Option<SyncTarget>, String>`: look up `Shown` for `main`'s build folder (same hash key as compile; none → `Err("Compile first")`); validate `page ≥ 1`, finite `x, y ≥ 0`; run `synctex edit -o {page}:{x}:{y}:{pdf}`; map `Input` with `to_project` → `Project { file, line }` or `External { name: file_name }`
- [X] T016 [US2] In `src-tauri/src/sync.rs` add `parse_view(stdout) -> Option<PdfSpot>` (first `Page:`, `h:`, `v:`, `W:`, `H:`; `y = v - H`) and command `sync_to_pdf { main, file, line } -> Result<Option<PdfSpot>, String>`: validate `file` with `resolve_in_project` and `line ≥ 1`; try input candidates in order: main → snapshot path; else overlay path, project path, `.lexy-root` path; first non-empty result wins
- [X] T017 [US1] Register `sync::sync_to_source` and `sync::sync_to_pdf` in `invoke_handler` in `src-tauri/src/lib.rs`

### Frontend

- [X] T018 [P] [US1] Wrappers `syncToSource(main, page, x, y)` and `syncToPdf(main, file, line)` in `src/compile.ts`
- [X] T019 [US1] In `src/Editor.tsx` add to `EditorHandle`: `jumpToLine(line)` (clamp to doc length, cursor at line start, scroll into view centered, focus, 1 s line-flash decoration via a `StateEffect` + `StateField`; no text change, no undo step) and `cursorLine()`
- [X] T020 [US1] In `src/PdfView.tsx` add props `onDoubleClickPoint(page, xPt, yPt)` (convert the click to PDF points: offset in the canvas ÷ CSS scale, origin top-left) and an imperative `showSpot(spot)` (scroll the page so the box is centered; draw a 1 s translucent absolutely positioned box in theme colors over the page wrapper)
- [X] T021 [US1] In `src/Writer.tsx` wire PDF → source: on double-click call `syncToSource(main, …)`; `project` target → if not the current file, open it through `onEntryOpen` and then `editor.current.jumpToLine(line)`; `external` → `setInfo("Text is in <name>")`; `null` → nothing; error → `setInfo("Click-to-jump needs a fresh compile")`
- [X] T022 [US2] In `src/Writer.tsx` add the action `onShowInPdf`: no PDF → `setInfo("Compile first")`; else `syncToPdf(main, current, cursorLine())` → `showSpot`, or `setInfo("No PDF location for this line")`; bind Ctrl+J in the capture-phase shortcut listener; add `onShowInPdf` to `RibbonActions` and a "Show in PDF" `RibbonButton` (shortcut "Ctrl+J") in the View tab of `src/Ribbon.tsx`
- [X] T023 [P] [US1] Rust tests in `src-tauri/src/sync.rs`: `parse_edit` / `parse_view` on captured `synctex.exe` output samples; validation rejects `page 0`, negative/NaN coordinates, `../x.tex`
- [X] T024 [P] [US1] Real e2e in `src-tauri/src/lib.rs` (skips without MiKTeX): compile a 2-page main + `chapters/intro.tex` (pdfLaTeX, then XeLaTeX); `sync_to_pdf` for an intro line gives page 2; `sync_to_source` at that spot returns `chapters/intro.tex` within ±1 line; same for a main-file line; an unsaved intro buffer (overlay) also round-trips
- [X] T025 [P] [US1] Vitest in `src/Writer.test.tsx` (mock `syncToSource`/`syncToPdf`, PdfView and Editor already mocked): double-click target in another file opens it and calls `jumpToLine`; external target shows "Text is in article.cls"; Ctrl+J with no PDF shows "Compile first"; Ctrl+J calls `showSpot`; Ribbon test lists "Show in PDF" in the View tab
- [X] T026 **Gate B** (automated tests passed; manual quickstart walk still pending): run `cd src-tauri; cargo test sync` and `npm test` once; fix failures; walk quickstart B

---

## Phase 5: Batch C: Feedback UI (US3, US4; FR-011, FR-012, FR-013)

**Goal**: inline problems, a Problems list, zoom that survives updates, and the last-good note.

- [X] T027 [P] [US4] In `src/pdfView/zoom.ts` implement and export: `ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]`, `zoomIn/zoomOut(zoom: "fit" | number, fitScale)`, `cssScale(zoom, pageWidthPt, paneWidthPx)`, `captureAnchor(scroller, pages) -> { page, fraction }`, `restoreAnchor(scroller, pages, anchor)`
- [X] T028 [US4] (done except "render visible pages first": pages still render eagerly, noted as a shortcut in `PdfView.tsx`) In `src/PdfView.tsx` add `zoom` state (persisted in `localStorage` key `lexy.pdfZoom`, wrapped in try/catch like other keys); render with `cssScale`; on a new PDF capture the anchor before the swap and restore it after; on zoom change keep the anchor; Ctrl+wheel over the preview and Ctrl+= / Ctrl+- / Ctrl+0 while the preview is focused change the zoom; render visible pages first, then the rest (research R7); expose `zoomIn/zoomOut/fit` through a handle
- [X] T029 [US4] In `src/Ribbon.tsx` View tab add a "Zoom" group: Zoom out, Fit width, Zoom in (`RibbonButton`s, label shows "Fit" or "125 %"); in `src/Writer.tsx` wire them to the PdfView handle
- [X] T030 [US4] In `src/Writer.tsx` keep a `stalePdf` flag: true when the latest result failed and an older PDF is shown; render a thin bar above the preview "Preview is from the last successful compile" with a "Show problems" button (opens the drawer on Problems); cleared on the next success
- [X] T031 [US3] In `src/Editor.tsx` add `lintGutter()` and an `EditorHandle.setProblems(path, problems)` that dispatches `setDiagnostics` (whole-line ranges, severity mapped, message) into that file's kept `EditorState` (current or stored), clamping lines to the doc
- [X] T032 [US3] Create `src/Problems.tsx`: list rows (icon by severity, `file:line`, message); rows with a file and line are buttons (click/Enter → `onJump(file, line)`); rows without a line are plain text; empty state "No problems"
- [X] T033 [US3] In `src/Writer.tsx`: after every result, group `problems` by file and call `setProblems` for every open file (empty list clears it); turn the log drawer into tabs "Problems (N)" | "Log"; an explicit failure opens the drawer on Problems, a live failure never opens it (keep the existing rule); `onJump` reuses the jump path from T021; show the error/warning count in the status chip tooltip
- [X] T034 [P] [US3] Styles in `src/App.css` for the line flash, PDF spot box, stale bar, Problems tabs/rows and zoom label, using existing variables (`--danger-text`, `--warn-text`, `--accent-soft`…), working in dark mode and at 800x600
- [X] T035 [P] [US4] Vitest `src/pdfView/zoom.test.ts`: zoom steps clamp at 50 %/300 %, fit → first step above/below the fit scale, `captureAnchor`/`restoreAnchor` keep page and fraction when page heights double
- [X] T036 [P] [US3] Vitest `src/Problems.test.tsx` (rows, links, Enter key) and additions to `src/Writer.test.tsx`: a live failure updates problems without opening the drawer; F5 failure opens the drawer on "Problems"; clicking a problem in another file opens it and jumps; the stale bar appears on failure and clears on success
- [X] T037 **Gate C** (automated tests passed; manual quickstart walk at 800x600 still pending): run `npm test` and `npm run build` once; fix failures; walk quickstart C at 800x600 in light and dark

---

## Phase 6: Polish

- [X] T038 [P] Update `CLAUDE.md` (Architecture: SyncTeX, shown slot, `sync.rs` commands, problems, zoom, Ctrl+J) and `docs/TRACKER.md` (feature rows for sync, problems and zoom; Verification Log entry)
- [ ] T039 Final full run (suites run and green; the SyncTeX compile-time measurement for SC-004 is not done yet): `cd src-tauri; cargo test`, `npm test`, `npm run build`; measure compile time with and without `-synctex=1` on a 10-page document (SC-004 ≤ +10 %) and record it in the TRACKER Verification Log

---

## Dependencies

- Phase 1 → Phase 2 → Batch A → Batch B → Batch C → Polish.
- B needs A's shown slot and path table. C's Problems needs A's `problems`; C's zoom (T027–T029) only needs Phase 2 and could start right after A.
- US1 and US2 share `synctex.exe` handling, so they ship together (Batch B); US3 and US4 are both feedback UI (Batch C).
- Same-file tasks run in order (`sync.rs`: T003, T009, T014–T016; `lib.rs`: T004, T007, T008, T010; `Writer.tsx`: T021, T022, T030, T033).

## Parallel examples

- Phase 2: T006 alongside T003–T005.
- Batch A: T011 while T007–T010 are written.
- Batch B: T018 and T023 alongside T014–T016; T024 and T025 together.
- Batch C: T027 + T035, T032, T034 in parallel with T028–T031.

## Implementation strategy

MVP = Phases 1–4 (compile data + both jumps): the click-to-jump the spec started with. Then Batch C adds problems and zoom. Don't start the next batch with a failing gate.
