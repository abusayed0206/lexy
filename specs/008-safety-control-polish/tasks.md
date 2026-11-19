---
description: "Task list for 008: safety and control polish"
---

# Tasks: Safety and Control Polish

**Input**: `specs/008-safety-control-polish/`: plan.md, spec.md (US1–US4, FR-001…FR-031, SC-001…SC-008), research.md (R1–R6), data-model.md, contracts/commands.md, contracts/ui.md, quickstart.md

**Working rule (as in 003–007)**: Build each story as one batch. Write its tests inside the batch, then run the tests once at the batch's gate. Don't start the next batch while a gate is failing. Update `docs/TRACKER.md` (rows F-074…F-077) at every gate.

**Tests**: Included. Every earlier spec ships unit tests with its code, and the plan names the test files.

**Reuse, don't re-create**:
- `src-tauri/src/lib.rs`: `run_with_timeout`, `kill_tree`, `write_atomic`, `build_key`, `build_root`, `compile_project_at`, `choose_engine`.
- `src-tauri/src/project.rs`: `resolve_in_project`, `ProjectState::with`, `ProjectError`.
- `src-tauri/src/snapshots.rs`: the base-dir and prune pattern.
- `src/Writer.tsx`: `restoreSnapshot` / `replaceMainText`, `settleUnsaved`, `leave`, `exportPdfOnExit`, `saveAll`, `applyFiles`, `setInfo` / `setNotice`, the capture-phase shortcut listener.
- `src/Editor.tsx`: `EditorHandle.applyTo`.
- `src/ProjectDialogs.tsx`: `useChoice` (`ask`).
- `src/ribbon/Menu.tsx` (`MenuButton`), `src/Ribbon.tsx` (status area), `src/InfoBar.tsx`.
- `src/latex/settings.ts` (`applySettings`, `readSettings`, `XELATEX_MARKER`), `src/actions.ts` (`ribbonCommands`).
- `src/livePreview.ts`, `src/PdfView.tsx`, and the theme tokens in `src/App.css`.

**Copy rule**: Use the exact strings from `contracts/ui.md`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Create an empty module `src-tauri/src/recovery.rs` (module doc comment citing spec 008 research R3) and add `mod recovery;` in `src-tauri/src/lib.rs`; run `cd src-tauri; cargo check`

**Checkpoint**: `cargo check` passes.

---

## Phase 2: Foundational (blocks US2 and US3)

Both US2 (`stopped`) and US3 (`engineReason`) add fields to `CompileResult`, so the fields are added once here.

- [X] T002 In `src-tauri/src/lib.rs` add to `CompileResult` the fields `stopped: bool` (`#[serde(default)]`, false everywhere today) and `engine_reason: String` (serialized `engineReason`). Fill `engine_reason` from the `reason` that `compile_project_at` already computes: "`marker`, a package or class name, `default`, or the Bangla sentence". Update every `CompileResult { … }` literal and extend the existing JSON-shape test to assert both keys
- [X] T003 [P] In `src/compile.ts` add `stopped?: boolean` and `engineReason?: string` to `CompileResult` (doc comments as in contracts/commands.md); update the CompileResult fixtures in `src/Writer.test.tsx` only if the typecheck needs it
- [X] T004 **Gate 0**: run `cd src-tauri; cargo test` and `npx tsc --noEmit` once; fix failures

**Checkpoint**: Foundation ready. US1 does not depend on Phase 2 and may start after T001.

---

## Phase 3: US1 Crash recovery (P1) — Batch A 🎯 MVP

**Goal**: Unsaved text survives a crash or power loss and is offered on reopen, without ever being written into the project.

**Independent Test**: quickstart A. Edit without saving, kill `lexy.exe`, restart, Restore, and check that Ctrl+Z returns to the disk text and that the disk file never changed.

### Backend

- [X] T005 [US1] In `src-tauri/src/recovery.rs` implement the storage per data-model.md "RecoveryCopy":
  - `project_dir(base, root) = base.join("Recovery").join(build_key(root))` and file name `build_key(rel) + ".json"`.
  - Struct `Copy { path, text, saved_at, base_hash }` with serde camelCase.
  - `save(dir, root, rel, text, now)`: atomic via `write_atomic`; `base_hash` is the SHA-256 hex of the disk file, or `""` if missing; rejects text over 10 MiB with `ProjectError` kind `Io` "`<path> is larger than 10 MiB`".
  - `list(dir, root)`: returns `RecoveryEntry { path, text, savedAt, baseHash, diskChanged, missing }` sorted by path, and deletes copies whose text equals the disk text.
  - `discard(dir, paths: Option<&[String]>)`.
  - `prune(base, now)`: removes copies older than 30 days (`MAX_AGE_MS` shared with snapshots) in every project folder and drops empty folders.
- [X] T006 [US1] In `src-tauri/src/recovery.rs` add the commands `recovery_save(path, text)`, `recovery_list()` and `recovery_discard(paths: Option<Vec<String>>)` per contracts/commands.md:
  - Each resolves `path` with `resolve_in_project` against `ProjectState`.
  - `recovery_save` and `recovery_discard` return kind `ReadOnly` in read-only windows; `recovery_list` returns `[]` there and deletes nothing.
  - `recovery_list` calls `prune` first.
  - The base dir is the same `%LOCALAPPDATA%\Lexy` base that snapshots use.
  - Register all three in `tauri::generate_handler!` in `src-tauri/src/lib.rs`.
- [X] T007 [US1] Rust tests in `src-tauri/src/recovery.rs` `#[cfg(test)]`:
  - save/list round trip with exact text (incl. Bangla and CRLF);
  - text equal to disk is not listed and is deleted;
  - `diskChanged` after the disk file changes, and `missing` after it is deleted;
  - a failed write (folder made read-only or a path that is a directory) keeps the previous copy;
  - discard one and discard all;
  - prune drops 31-day-old copies and keeps fresh ones;
  - `..` and absolute paths are refused;
  - nothing is ever created inside the project folder.

### Frontend

- [X] T008 [P] [US1] In `src/projects.ts` add the type `RecoveryCopy` (`path`, `text`, `savedAt`, `baseHash`, `diskChanged`, `missing`) and the wrappers `recoverySave(path, text)`, `recoveryList()` and `recoveryDiscard(paths: string[] | null)`
- [X] T009 [P] [US1] Create the pure scheduler `src/recovery.ts`, modelled on `src/livePreview.ts`, with injectable `setTimer` / `clearTimer` / `now`:
  - API: `createRecoveryScheduler({ save(path, text), onError, delayMs = 2000, maxWaitMs = 10000 })` returning `{ changed(files: { path, text, dirty }[]), forget(path), dispose() }`.
  - It writes 2 s after the last change, and at most 10 s after the first unflushed change during continuous typing.
  - It sends only dirty files whose text differs from their last sent text.
  - It reports a failure to `onError` once per scheduler.
- [X] T010 [P] [US1] Tests in `src/recovery.test.ts`:
  - 2 s debounce;
  - the 10 s max wait under constant typing;
  - only changed dirty files are sent;
  - `forget` clears the last-sent text so the next change re-sends it;
  - `onError` fires once across repeated failures;
  - `dispose` cancels a pending write.
- [X] T011 [P] [US1] Create `src/RecoveryDialog.tsx` per contracts/ui.md "Review dialog":
  - Title "Unsaved text from your last session".
  - One row per `RecoveryCopy` showing the path, "saved <relative time>" (reuse `relativeDate` from `src/ProjectHome.tsx`), and the notes "changed on disk since" / "file no longer exists".
  - Row buttons **Restore** / **Discard**, and a **Done** button.
  - Keyboard order: rows, then Done.
  - Tests in `src/RecoveryDialog.test.tsx`.
- [X] T012 [US1] Wire recovery in `src/Writer.tsx`:
  - Create the scheduler on mount (not in read-only windows) and feed it from the `files` state on every change.
  - After a successful save of a file (incl. `saveAll` and auto-save), and on Don't save or Discard, call `scheduler.forget(path)` and `recoveryDiscard([path])`.
  - In `leave` and the window-close handler, after `settleUnsaved()` returns true, call `recoveryDiscard(null)`. Cancel keeps the copies.
  - Show the write-failure InfoBar once per session: "Lexy couldn't keep a recovery copy of your unsaved text. Save often."
- [X] T013 [US1] Wire restore in `src/Writer.tsx`:
  - After the project opens (not read-only), call `recoveryList()`. If it is non-empty, show the InfoBar "Lexy found unsaved text from your last session in N file(s)." with **Restore all**, **Discard all** and **Review…** (opens `RecoveryDialog`).
  - Restore reuses the `restoreSnapshot` flow (open the file if needed, then `replaceMainText`, so it is one undo step). For a `missing` file, open a new unsaved buffer at that path, as File → New file does.
  - After a restore, show the InfoBar "Restored unsaved text in <file>. Press Ctrl+Z to undo, Ctrl+S to keep it." and, when `diskChanged`, append " This file changed on disk since."
  - Delete the copy after each restore or discard.
  - **Discard all** asks "Discard unsaved text in N file(s)? This can't be undone." through `ask` with **Discard** / **Cancel**, destructive, so Cancel has focus.
- [X] T014 [US1] Writer tests in `src/Writer.test.tsx` (mock the new `projects.ts` wrappers):
  - unsaved typing calls `recoverySave` after the delay and never calls `write_file`;
  - Save discards the copy;
  - leaving with Don't save calls `recoveryDiscard(null)`, while Cancel does not;
  - opening with copies shows the InfoBar;
  - Restore all puts the text in as unsaved and one undo returns to the disk text;
  - a `diskChanged` copy adds the warning sentence;
  - a read-only window never calls any recovery command;
  - Discard all confirms first.
- [X] T015 [US1] (passed 2026-11-18: 169 Rust incl. 7 recovery tests, 59 Vitest files; the 500-file word-count timing test failed once under full-suite load, 2.4 s vs 2 s, and passed alone in 0.18 s. Browser and native walk of quickstart A deferred to the final run) **Gate A**: run `cd src-tauri; cargo test recovery` and `npm test` once; fix failures; walk quickstart A where possible (browser pane with a stub backend, plus a real kill-and-restart if the native app is available); update TRACKER F-074 and the Verification Log

**Checkpoint**: US1 is complete and shippable on its own.

---

## Phase 4: US2 Stop a running compile (P1) — Batch B

**Goal**: A stuck compile can be stopped in under 2 s, keeping the last good PDF; finishes F-017.

**Independent Test**: quickstart B. Compile an endless loop, Stop, then check the status, the processes and the next compile.

### Backend

- [X] T016 [US2] In `src-tauri/src/lib.rs` change `run_with_timeout(command, timeout)` to `run_with_timeout(command, timeout, cancelled: &dyn Fn() -> bool)` per contracts/commands.md:
  - Poll `cancelled()` in the existing 50 ms loop; when it returns true, call `kill_tree` and set the new `ProcessOutput.stopped`.
  - `success` stays false for stopped runs.
  - Update the callers in `src-tauri/src/export.rs`, `src-tauri/src/git.rs` (both call sites) and `src-tauri/src/sync.rs` to pass `&|| false`, and the three existing `run_with_timeout_*` tests.
- [X] T017 [US2] In `src-tauri/src/lib.rs` add managed state `CompileCancel(Arc<AtomicU64>)` (`.manage(...)` beside `CompileLock`) and the command `cancel_compile` (increments the epoch, never fails); register it. Then:
  - In `compile_project` and `export_pdf_with_notes`, read the epoch *before* taking `CompileLock`.
  - Thread a `cancelled` closure (epoch changed?) through `compile_project_at` → `run_latexmk` → `run_latexmk_inner` → `run_with_timeout`.
  - If the epoch already changed when the lock is acquired, return a stopped result without running latexmk.
- [X] T018 [US2] In `src-tauri/src/lib.rs` build the stopped result per contracts/commands.md:
  - `ok: false`, `stopped: true`, `summary: "Compile stopped"`, `pdf_path: None`, no problems; the log says "Compile stopped by the user."
  - Delete `<out_dir>\<stem>.fdb_latexmk` and `<out_dir>\<stem>.pdf`.
  - Never touch `.lexy-shown\` or `SyncState`, and keep the 180 s timeout message unchanged (FR-017).
  - `export_pdf_with_notes` maps stopped to `ProjectError` kind `Io` "The PDF with notes was not made: the compile was stopped."
- [X] T019 [US2] Rust tests in `src-tauri/src/lib.rs` `#[cfg(test)]`:
  - `run_with_timeout` stops a `ping -n 30` tree within 2 s when `cancelled` flips (measure elapsed);
  - a never-cancel check still times out as before;
  - a stale epoch at lock time returns stopped without spawning;
  - a cancel issued before a compile started does not affect that compile;
  - `compile_stop_kills_latexmk_tree`: a real compile of `\def\x{\x}\x` cancelled after 1 s ends within 2 s, leaves no `.fdb_latexmk` / PDF in the build folder but keeps the earlier `.lexy-shown` PDF, and the following normal compile succeeds. Skip it with "skipping" when the tools are missing, like the other e2e tests.

### Frontend

- [X] T020 [P] [US2] In `src/compile.ts` add `cancelCompile = () => invoke<void>("cancel_compile")`
- [X] T021 [P] [US2] In `src/livePreview.ts` add `cancel()` to `LivePreview`: clear the pause timer and the queued flag. The running compile's result still reaches `onResult`, and the next `edit` schedules normally. Add tests in `src/livePreview.test.ts`: cancel while waiting compiles nothing, and cancel while running drops the queued compile.
- [X] T022 [US2] In `src/Writer.tsx` extend `compileReducer` and `statusLabel`:
  - New `Status` value `"stopped"`, labelled "Compile stopped".
  - A `done` event with `result.stopped` keeps the previous `pdfPath`, `engine` and log, and clears `explicitBusy` for an explicit run.
  - `edit` from `stopped` goes to `dirty`.
  - A stopped result never opens the log drawer.
  - `statusDetail` shows "`<Engine> · Compile stopped`".
  - Add reducer tests in `src/Writer.test.tsx`.
- [X] T023 [US2] Stop control:
  - In `src/Ribbon.tsx`, render a **Stop** button next to the status text, only while the status is compiling: accessible name and tooltip "Stop compile (Shift+F5)", new `onStop` action (add an icon in `src/ribbon/icons.tsx` if needed).
  - In `src/Writer.tsx`, `onStop` calls `scheduler.cancel()` then `cancelCompile()`.
  - Add Shift+F5 to the capture-phase listener: ignored while a dialog is open or nothing compiles, and it must not trigger F5's compile.
  - Add a palette entry "Stop compile".
- [X] T024 [US2] In `src/Writer.tsx` `exportPdfOnExit`: when the recompile result is `stopped`, throw so that `leave` / close show the warning InfoBar "The PDF was not updated: the compile was stopped." (exact text, replacing the generic message for this case), keeping the existing keep-open-once behaviour
- [X] T025 [US2] Tests:
  - `src/Ribbon.test.tsx`: Stop is shown only while compiling and calls `onStop`.
  - `src/Writer.test.tsx`: Shift+F5 while compiling calls `cancel_compile` and the mocked stopped result shows "Compile stopped" with the previous PDF kept and the drawer closed; Shift+F5 when idle does nothing; leaving during a stopped export shows the exact warning.
- [X] T026 [US2] (passed 2026-11-18: 173 Rust incl. the real `compile_stop_kills_latexmk_tree` (loop stopped within 2 s, partial output removed, shown PDF untouched, next compile ok), 608 Vitest. Native quickstart B pending) **Gate B**: run `cd src-tauri; cargo test` (full, incl. the real stop e2e) and `npm test` once; fix failures; walk quickstart B; update TRACKER F-075 (and close F-017 as Done or superseded) and the Verification Log

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: US3 Choose the TeX engine (P2) — Batch C

**Goal**: Pick Automatic, pdfLaTeX, XeLaTeX or LuaLaTeX from the ribbon or palette as one undo step, and see why the last compile used its engine.

**Independent Test**: quickstart C. Choose LuaLaTeX, check line 1, undo once, compile, and check the engine shown.

- [X] T027 [P] [US3] Create `src/latex/engine.ts` per data-model.md "EngineChoice":
  - `type EngineChoice = "auto" | "pdflatex" | "xelatex" | "lualatex"`.
  - `readEngine(text) -> { choice, line: number | null, setByFont: boolean }`, using the recognised line "within the first 5 lines, the whole line matches `^\s*%\s*!\s*TEX\s+(TS-)?program\s*=\s*(pdflatex|xelatex|lualatex)\s*$`, any case". `setByFont` is true when the line is exactly `XELATEX_MARKER`.
  - `engineEdit(text, choice) -> TextEdit | null`: replace that line in place with `% !TEX TS-program = <engine>`, insert it as line 1 when absent, remove it (with its line break) for `auto`, and return null when nothing changes. Keep the file's EOL style.
- [X] T028 [P] [US3] Tests in `src/latex/engine.test.ts`:
  - all spellings from the Rust `marker_engine_reads_texworks_convention` test are recognised, and the non-markers from `marker_engine_is_none_without_a_known_marker` are not;
  - a line on line 5 is replaced in place and one on line 6 is ignored (so a new line 1 is added);
  - `auto` removes the line and returns null when there is none;
  - CRLF is preserved;
  - applying the same choice twice gives null;
  - `setByFont` is detected.
- [X] T029 [US3] In `src/latex/settings.ts` `applySettings`, per research R5:
  - Only remove the line when it is exactly `XELATEX_MARKER` (at any of lines 1–5, not just line 1).
  - Don't add `XELATEX_MARKER` when `readEngine` already finds `xelatex` or `lualatex`.
  - When it finds an explicit `pdflatex` line and the font needs a Unicode engine, replace that line with `XELATEX_MARKER` and expose this (for example via a returned flag or a separate helper `fontNeedsUnicodeEngine(settings)`) so the Writer can show an InfoBar.
  - Extend `src/latex/settings.test.ts`, and keep the existing 504-combination round trip green.
- [X] T030 [US3] Create `src/ribbon/EngineMenu.tsx`, a `MenuButton` labelled "Engine":
  - A radio group **Automatic** / **pdfLaTeX** / **XeLaTeX** / **LuaLaTeX** with the current choice checked.
  - A separator and a disabled line "Last compile: <Engine> (<reason>)". Reason text: `marker` → "engine line", a package or class name → "<name> package", `default` → "default", the Bangla sentence → "Bangla text".
  - Disabled in read-only windows.
  - Place it on the Layout tab in `src/Ribbon.tsx` next to `LayoutMenu`; it collapses to icon-only like the other ribbon buttons.
  - Tests in `src/ribbon/EngineMenu.test.tsx`.
- [X] T031 [US3] In `src/Writer.tsx` add `onEngine(choice)`:
  - Compute `engineEdit(mainText, choice)` and apply it with `EditorHandle.applyTo(main, …)` (one undo step on the main document even when another file is shown).
  - Before choosing `pdflatex` while `readSettings(main).font.kind` is `system` or `project`, ask "This font needs XeLaTeX or LuaLaTeX. Use pdfLaTeX anyway?" with **Use pdfLaTeX** / **Cancel**, destructive, so Cancel has focus.
  - Keep `engineReason` from the last result in `CompileState` for the menu.
  - Show the InfoBar from T029 when a font change replaced a pdfLaTeX line.
  - Add `engine.auto`, `engine.pdflatex`, `engine.xelatex` and `engine.lualatex` ("Engine: Automatic", etc.) to `ribbonCommands` in `src/actions.ts`, hidden when read-only.
- [X] T032 [US3] In `src-tauri/src/lib.rs` add a test that `choose_engine` returns `marker` for `% !TEX TS-program = lualatex` written by the menu, and that the automatic Bangla switch does not run when the main text has an explicit `% !TEX TS-program = pdflatex` line (FR-023; reason stays `marker`)
- [X] T033 [US3] Writer tests in `src/Writer.test.tsx`:
  - choosing LuaLaTeX from the Layout tab edits line 1 of the main document while a chapter is shown;
  - one undo reverts it;
  - choosing pdfLaTeX with a system font asks first and Cancel changes nothing;
  - the palette lists the four engine commands;
  - the menu shows "Last compile: XeLaTeX (fontspec package)" from a mocked result.
- [X] T034 [US3] (passed 2026-11-18: 175 Rust, 641 Vitest. Engine palette commands live in the Writer's own command list, next to Stop, rather than `ribbonCommands`. Load flakes: with `cargo test` and Vitest running together, the two stop-timing tests and several waitFor-based UI tests timed out; all pass alone, and the stop tests now time from the moment Stop fires with a 5 s bound (2 s stays a quickstart B check). Native quickstart C pending) **Gate C**: run `cd src-tauri; cargo test` and `npm test` once; fix failures; walk quickstart C; update TRACKER F-076 and the Verification Log

**Checkpoint**: US1–US3 work independently.

---

## Phase 6: US4 Find text in the PDF preview (P3) — Batch D

**Goal**: Ctrl+F on the PDF finds and highlights text, with "n of m" and next/previous.

**Independent Test**: quickstart D. Focus the PDF, Ctrl+F, type, step with Enter / Shift+Enter, Esc.

- [X] T035 [P] [US4] Create the pure module `src/pdfView/find.ts` per data-model.md "PdfSearch":
  - `pageText(items) -> { text, map }`: join item strings; `hasEOL` and runs of whitespace become one space; per-character case folding with `toLocaleLowerCase()`, keeping the original character when the folded length differs, so the map stays one-to-one.
  - `findMatches(pages, query) -> { page, start, end }[]`: normalise the query the same way; empty or whitespace-only query → `[]`.
  - `matchRects(match, items, map, pageHeight) -> Rect[]` in PDF points: one rect per item touched, x and width split proportionally by character offset, y from `transform[5]` and height from `item.height` (falling back to `Math.hypot(transform[2], transform[3])`), with y flipped to top-left.
  - `nearestMatch(matches, page, top) -> index`.
- [X] T036 [P] [US4] Tests in `src/pdfView/find.test.ts`:
  - matches across item boundaries and across a line break on one page;
  - case-insensitive matching;
  - whitespace collapsing;
  - no match → `[]`;
  - rect splitting for a match in the middle of an item;
  - `nearestMatch` picks the first match at or after a position and wraps to 0.
- [X] T037 [US4] In `src/PdfView.tsx`:
  - Cache `getTextContent()` per page for the loaded document, fetched lazily on the first search and dropped when `bytes` changes.
  - Ctrl+F in the scroller's `onKeyDown` opens the find bar (only when pages exist); Enter / Shift+Enter step to the next / previous match (wrapping); Esc closes the bar and focuses the scroller.
  - The bar follows contracts/ui.md: field "Find in PDF", **Previous** / **Next** / **Close** buttons with the names given there, and the count "n of m" / "No results" in `aria-live="polite"`.
  - Draw absolutely positioned highlight divs (`.pdf-find-match`, current `.pdf-find-current`) inside each `.pdf-page`, scaled by `wrapper.dataset.scale`.
  - Scroll the current match into view (centred when off-screen).
  - After a new PDF is swapped in, re-run the open search and keep the current match at `nearestMatch` of the old page and top.
- [X] T038 [P] [US4] In `src/App.css`:
  - `.pdf-page { position: relative }` and styles for the find bar.
  - Tokens `--find-match` and `--find-current` on `:root`, in the dark override and in the forced `:root[data-theme="dark"]` copy, with a `forced-colors` block using `Mark` / `Highlight`.
  - Add both tokens to `src/test/contrast.test.ts` (≥ 3:1 against the page white in light and dark).
- [X] T039 [US4] Tests in `src/PdfView.test.tsx` (mocked pdf.js document with `getTextContent`):
  - Ctrl+F opens the bar;
  - typing shows "1 of 3" and three highlight boxes;
  - Enter / Shift+Enter move the current match and wrap;
  - Esc closes the bar and removes the highlights;
  - Ctrl+F with no PDF does nothing;
  - a new `bytes` prop re-runs the search.
  - In `src/Writer.test.tsx`, check that Ctrl+F in the editor area does not open the PDF bar.
- [X] T040 [US4] (passed 2026-11-18: 658 Vitest incl. 8 find + 5 PdfView find tests and 4 contrast checks for the highlight outlines, tsc, build. The Writer test for Ctrl+F in the editor was not added: the handler lives on the PDF scroller only, and the Writer tests mock PdfView. Native quickstart D and the SC-007 50-page timing pending) **Gate D**: run `npm test` and `npm run build` once; fix failures; walk quickstart D (browser pane at 800x600, light and dark; a 50-page document for the SC-007 timing); update TRACKER F-077 and the Verification Log

**Checkpoint**: All four stories work independently.

---

## Phase 7: Polish

- [X] T041 [P] Update `CLAUDE.md`:
  - Add the commands `cancel_compile` and `recovery_save` / `recovery_list` / `recovery_discard` (`recovery.rs`) to the command list, and `CompileCancel` to the managed state list.
  - Add one line each on recovery (storage under `%LOCALAPPDATA%\Lexy\Recovery`, never in projects, cleared on clean close), stop (cancel epoch, partial output deleted, shown PDF kept), engine lines (menu writes the `TS-program` form, font settings own only the exact `XELATEX_MARKER` line) and PDF find (`src/pdfView/find.ts`, no text layer).
- [X] T042 [P] Update `docs/DESIGN.md` with the Shift+F5 Stop and PDF Ctrl+F shortcuts in its shortcut table, and `docs/PLAN.md` if it lists milestones affected
- [X] T043 (done 2026-11-19: 175 Rust, 658 Vitest, tsc, build; nothing writes project files except Save (recovery copies live under %LOCALAPPDATA%, compile output under the build folder, engine changes are unsaved edits). Native-window parts of quickstarts A–D still pending, listed in docs/ROADMAP.md) Final run: `cd src-tauri; cargo test`, `npm test`, `npx tsc --noEmit`, `npm run build`; data-safety check (a test or manual run showing that recovery, stop and the engine change never write a project file except through Save); record in the TRACKER Verification Log; note which quickstart parts still need the native window

---

## Dependencies

- Phase 1 (T001) → US1 can start at once. Phase 2 (T002–T004, Gate 0) → US2 and US3.
- The stories are independent of each other. Default order: US1 → US2 → US3 → US4 (priority order).
- Within a batch: the backend tasks run before the frontend wiring that calls them (T005–T007 before T012–T014; T016–T019 before T023–T025). Pure modules and their tests ([P]) can run alongside the backend.
- Shared files are edited one task at a time: `src-tauri/src/lib.rs` (T002, T006 registration, T016–T019, T032), `src/Writer.tsx` (T012–T013, T022–T024, T031), `src/Writer.test.tsx` (T014, T022, T025, T033, T039), `src/Ribbon.tsx` (T023, T030), `src/compile.ts` (T003, T020).

## Parallel examples

- **US1**: T008 (`projects.ts`), T009 + T010 (`recovery.ts`), and T011 (`RecoveryDialog.tsx`) together while T005–T007 build the Rust side.
- **US2**: T020 (`compile.ts`) and T021 (`livePreview.ts`) together while T016–T018 change `lib.rs`.
- **US3**: T027 + T028 (`engine.ts`) alongside T030 (`EngineMenu.tsx`), before T029 and T031.
- **US4**: T035 + T036 (`find.ts`) and T038 (`App.css` + contrast test) together, then T037 and T039.

## Implementation strategy

- **MVP**: Phase 1 + US1 (crash recovery). It is the only story that prevents data loss and needs neither Phase 2 nor any other story.
- **Next**: Gate 0 + US2. Together with US1 this finishes the two P1 stories, which removes the "frozen app" complaint and closes F-017.
- **Then**: US3 and US4, each shippable on its own after its gate.
- Each gate leaves the app releasable; stop at any gate if priorities change.
