---
description: "Task list for the Word-Style Writing Experience (feature 002)"
---

# Tasks: Word-Style Writing Experience

**Input**: Design documents from `specs/002-word-style-editor/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (backend-commands, settings-block, ribbon-ui), quickstart.md

**Tests**: Included. The plan's Testing section and the user's earlier request for extensive backend + frontend tests call for them. Pure LaTeX logic gets unit tests written first; UI pieces get Testing Library tests; Rust gets `cargo test`.

**Organization**: By user story (US1–US7 from spec.md). Paths are relative to the repo root.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: User story label (US1–US7)

---

## Phase 1: Setup

- [X] T001 Align Tauri crates with the npm minors: run `cargo update -p tauri -p tauri-plugin-dialog` in `src-tauri/` so `tauri` is 2.12.x and `tauri-plugin-dialog` 2.8.x in `src-tauri/Cargo.lock`. Confirm `npm run tauri dev` no longer prints "Found version mismatched Tauri packages" (research R11).
- [X] T002 [P] Add frontend deps in `package.json`: `katex`, `pdfjs-dist` (and `@types/katex` as a dev dep) via `npm install`.
- [X] T003 [P] Add `fontdb` to `[dependencies]` in `src-tauri/Cargo.toml`. Confirm its current API (`Database::new`, `load_system_fonts`, `faces()` → `families`) from docs.rs before use (research R3).

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: The new compile path, the editor edit API, the settings format, and the ribbon frame that every story plugs into.

### Backend: single compile path

- [X] T004 Add tests first in the `#[cfg(test)]` module of `src-tauri/src/lib.rs`. They should fail until T005–T006 exist:
  - `engine_from_marker`: `% !TEX program = xelatex` → xelatex; `TS-program`, mixed case, and a marker on line 5 work; a marker on line 6 is ignored; an unknown value or no marker → pdflatex.
  - `compile_source` writes the snapshot to the build folder and leaves `documentPath` untouched (the file content and mtime are unchanged).
  - A source over 10 MiB is refused.
  - An untitled source uses build key `untitled` and stem `Untitled`.
- [X] T005 Implement `compile_source(source: String, document_path: Option<String>)` in `src-tauri/src/lib.rs`, per `contracts/backend-commands.md`, replacing `compile_document`:
  - Validate `document_path` with `validate_tex_path`, without requiring the file to exist.
  - Build folder = `build_dir_for(path)`, or `build_root()/untitled`.
  - Write `<stem>.tex` with `write_atomic`.
  - Pass `engine_from_marker` → `-pdf | -xelatex | -lualatex` to latexmk.
  - Set `TEXINPUTS=<doc folder>;` when a path is given.
  - Add `engine` to `CompileResult`.
  - Keep the timeout, summary and log rules.
  - Update `generate_handler!`.
- [X] T006 Add a process-wide compile lock as Tauri managed state (`struct CompileLock(Mutex<()>)`, `.manage(...)` in `run()`), held for the whole latexmk run in `compile_source` in `src-tauri/src/lib.rs` (research R5).
- [X] T007 Extend the real-tools e2e test in `src-tauri/src/lib.rs` (skips when tools are missing) with three cases:
  - an XeLaTeX doc with `\setmainfont{Arial}` compiles;
  - a saved doc at `<tmp>/doc/main.tex` with `\input{chapter}` and `<tmp>/doc/chapter.tex` compiles via `compile_source` (proves `TEXINPUTS`);
  - the snapshot never creates aux files in `<tmp>/doc`.
- [X] T008 [P] Update `src/compile.ts`: `compileSource(source, documentPath | null)` → `invoke("compile_source", { source, documentPath })`, `CompileResult.engine`; `loadPdf` returns `Uint8Array` (for pdf.js) instead of a Blob. Update `src/compile.test.ts` for both.
- [X] T009 Update the explicit compile in `src/Writer.tsx`: save first, then `compileSource(savedText, savedPath)`; keep the drawer opening on failure. Update the compile tests in `src/Writer.test.tsx` to the new mock names.

### Editor edit API

- [X] T010 Add tests first in `src/Editor.test.tsx` for an `EditorHandle` passed via a `handle` ref prop:
  - `getSelection()` → `{ from, to, text }`;
  - `replaceRange(from, to, text, select?)`;
  - `wrapSelection(before, after)`, with the cursor between them when the selection is empty;
  - `transformLines(fn)` over the selected lines;
  - `replaceAll(text)`;
  - `getText()`, `focus()`.

  Each call must be exactly one undo step (one `undo()` restores the previous text).
- [X] T011 Implement `EditorHandle` in `src/Editor.tsx`, with each method as a single `view.dispatch` transaction plus `scrollIntoView`; expose it through a React 19 ref prop.

### Settings format (shared by US4 and US6)

- [X] T012 [P] Write `src/latex/settings.test.ts` first, covering:
  - the golden examples in `contracts/settings-block.md`;
  - `parseSettings` defaults on a document without a block;
  - class options: an existing `[twocolumn,12pt]` stays twocolumn;
  - marker add/remove;
  - an orphan marker;
  - a missing `\documentclass` → source unchanged;
  - idempotence (`apply(apply(s,x),x) == apply(s,x)`);
  - round-trip `parse(apply(s,x)) == x` for every built-in font × 4 margin presets × {a4, letter} × {portrait, landscape} (SC-005);
  - `conflicts()` finding user `geometry` / font package lines outside the block.
- [X] T013 [P] Write `src/latex/fonts.ts` (built-in table from research R3, `isValidFamily` regex `^[A-Za-z0-9 _.'&+-]{1,64}$`, `fontLines(font)`) with `src/latex/fonts.test.ts`: every built-in id produces its documented lines; `{`, `}`, `\`, `%`, `#` and empty or over-64-character names are rejected.
- [X] T014 Implement `src/latex/settings.ts` (`DocumentSettings`, `MARGIN_PRESETS`, `parseSettings`, `applySettings`, `conflicts`) per `data-model.md` and `contracts/settings-block.md` until T012 passes. `applySettings` throws on invalid margins or family; it never writes them.

### Ribbon frame

- [X] T015 Write `src/Ribbon.test.tsx` first, per `contracts/ribbon-ui.md`:
  - a tablist "Ribbon" with File, Home, Insert, Layout, View, defaulting to Home;
  - Left/Right/Home/End move between tabs;
  - the active tab is remembered in `localStorage["lexy.ribbonTab"]`, and a corrupt value falls back to Home;
  - each panel is a tabpanel labelled by its tab;
  - the File buttons call `onNew` / `onOpen` / `onSave` / `onSaveAs`;
  - the View tab's logs toggle reflects `logsOpen`;
  - Compile and the status pill are visible on every tab.
- [X] T016 Implement `src/Ribbon.tsx`: `Ribbon`, `RibbonGroup` (`role="group"` + caption) and `RibbonButton` (icon + label + tooltip with shortcut). Props carry the commands and state from `Writer`. Move the existing File commands, the logs toggle, the Compile button and the status pill into it.
- [X] T017 Replace the `command-strip` header in `src/Writer.tsx` with `<Ribbon …/>`. Keep the existing shortcuts, notices and unsaved dot (file name shown in the ribbon's title area). Update the structure-dependent tests in `src/Writer.test.tsx` (focus order now: tabs → panel controls → Compile → editor).
- [X] T018 [P] Ribbon styles in `src/App.css` using the existing tokens:
  - tab row with Compile + status at the right;
  - panel height ~84 px;
  - container query on `.ribbon`: labels under icons at ≥ 900 px, icon-only below, group captions hidden below 820 px;
  - no wrapping at 800 px;
  - light and dark.

**Checkpoint**: `npm test` and `cargo test` pass. The app looks like a ribbon with File/View working and compile unchanged.

---

## Phase 3: User Story 1 - Live preview while typing (P1) 🎯 MVP

**Goal**: The preview updates about 1 s after typing stops, without saving, flashing or losing your place.

**Independent Test**: quickstart scenarios 2 and 3.

- [X] T019 [P] [US1] Write `src/livePreview.test.ts` first, covering every row of the LivePreviewState transition table in `data-model.md`, using a fake clock: debounce restart; at most one running + one queued; the queued compile uses the newest text; disable cancels the timer; an error sets `lastError` and success clears it.
- [X] T020 [P] [US1] Implement `src/livePreview.ts`: `createLivePreview({ delayMs = 1000, compile, onResult, setTimer, clearTimer })` with `edit(text)`, `setEnabled(on)` and `dispose()`. No React inside, so it can be tested on its own.
- [X] T021 [P] [US1] Write `src/PdfView.test.tsx` first, with `pdfjs-dist` mocked:
  - new bytes render offscreen, and the old canvases stay until all new pages are drawn;
  - the scroll ratio is restored after the swap;
  - the previous document proxy is destroyed;
  - a render error keeps the old pages and calls `onError`;
  - empty state "No PDF yet", and "Compiling" while the first render is pending.
- [X] T022 [P] [US1] Implement `src/PdfView.tsx`:
  - `GlobalWorkerOptions.workerSrc` from `pdfjs-dist/build/pdf.worker.min.mjs?url`;
  - `getDocument({ data })`;
  - render every page into a hidden container at width-fit × `devicePixelRatio`, then swap and restore `scrollTop` ratio;
  - pages on white with a token-coloured gutter;
  - `role="document"` labelled "PDF preview".
- [X] T023 [US1] Wire live preview in `src/Writer.tsx`:
  - create the scheduler once, call `edit(source)` on each change, and run an initial compile on mount and after New/Open;
  - success → `loadPdf` → `PdfView` bytes, status "PDF ready";
  - failure → status pill "Preview failed" with the summary as tooltip and the last PDF kept, without opening the drawer;
  - replace the iframe with `PdfView`;
  - the View tab's "Live preview" toggle is persisted in `localStorage["lexy.livePreview"]` (default on), and "Compile now" = F5.
- [X] T024 [US1] Add live-preview tests to `src/Writer.test.tsx` (fake timers, mocked `compileSource`):
  - typing and waiting 1 s compiles the unsaved text with the current path or null;
  - `writeDocument` is not called;
  - a failure does not open the drawer, but F5 failure does;
  - toggle off stops compiles, and the toggle state persists;
  - New/Open trigger a fresh compile.

**Checkpoint**: US1 is demoable (quickstart 2–3).

---

## Phase 4: User Story 2 - Save to Documents\Lexy by default (P1)

**Goal**: The Save, Save As and Open dialogs start in `<Documents>\Lexy`, created on demand.

**Independent Test**: quickstart scenario 1.

- [X] T025 [US2] Add Rust tests first in `src-tauri/src/lib.rs` for a pure helper `lexy_folder(documents: Result<PathBuf, E>, home: Option<PathBuf>) -> DefaultFolder`:
  - it creates `<docs>/Lexy` in a temp dir;
  - an existing folder is fine;
  - a documents error → home with `fallback: true`;
  - no home → error.
- [X] T026 [US2] Implement the helper and the async command `default_document_folder(app)` (uses `app.path().document_dir()` and `home_dir()`) in `src-tauri/src/lib.rs`; register it in `generate_handler!`.
- [X] T027 [US2] In `src/documents.ts`, add `defaultFolder()` (cached per session).
  - `chooseSavePath(currentPath)` uses `<folder>\Untitled.tex` when `currentPath` is null.
  - `chooseOpenPath()` passes `defaultPath: folder`.
  - Return `fallback` so the Writer can show the notice.
  - Update `src/documents.test.ts`.
- [X] T028 [US2] In `src/Writer.tsx`, show the one-time dismissible notice "Saving to <path> because Documents isn't available." when `fallback` is true (FR-003). Add a test in `src/Writer.test.tsx`.

---

## Phase 5: User Story 3 - Word-style ribbon formatting (P2)

**Goal**: Home and Insert formatting commands work the way Word users expect, each as one undo step.

**Independent Test**: quickstart scenario 4.

- [X] T029 [P] [US3] Write `src/latex/format.test.ts` first, covering:
  - `wrap("textbf")` with a selection and when empty;
  - `setHeading(line, 0..3)`, including unwrapping an existing `\section{…}` and switching levels;
  - `toList(lines, "itemize" | "enumerate")`: blank lines skipped, existing `\item` not doubled;
  - `pageBreak()` on its own line mid-line;
  - `footnote()` placeholder selection.
- [X] T030 [P] [US3] Implement `src/latex/format.ts` as pure functions over `(text, selection)` → `{ from, to, insert, select }`.
- [X] T031 [US3] Add the Home tab Font group (B/I/U), Paragraph (Bullets, Numbering) and Styles (Normal, Heading 1–3 select), and the Insert tab Pages (Page break) and References (Footnote), in `src/Ribbon.tsx`. Each calls a `Writer` callback that applies `format.ts` through `EditorHandle.replaceRange`.
- [X] T032 [US3] Add Ctrl+B / Ctrl+I / Ctrl+U to the capture-phase shortcut handler in `src/Writer.tsx` (they override CodeMirror's Ctrl+I select-parent). Extend the shortcut tests in `src/Writer.test.tsx`.
- [X] T033 [US3] Add Ribbon tests for the Home and Insert actions in `src/Ribbon.test.tsx`: each button has an accessible name and a tooltip with its shortcut, and calls the right callback. Add one Writer-level test confirming Bold wraps the selection and that a single undo reverts it.

---

## Phase 6: User Story 4 - Change document font and size (P2)

**Goal**: Pick a built-in or installed Windows font and a base size; the preview follows.

**Independent Test**: quickstart scenario 5.

- [X] T034 [US4] Add Rust tests first for `filter_families(iter) -> Vec<String>`: sorted, de-duplicated, invalid names dropped (matching `isValidFamily`). Then implement `list_system_fonts()` using `fontdb` with a `OnceLock` / managed-state cache, async, registered. All in `src-tauri/src/lib.rs`.
- [X] T035 [P] [US4] Add `listSystemFonts()` (cached promise) to `src/latex/fonts.ts`, with a test in `src/latex/fonts.test.ts` (invoke mocked).
- [X] T036 [US4] Write `src/ribbon/FontPicker.test.tsx` first:
  - the combobox shows built-ins, then an "Installed fonts" section;
  - typing filters;
  - choosing calls `onChange({ kind, … })`;
  - the current value comes from `parseSettings`, and "Default" is shown when the block is absent;
  - the size select offers 10/11/12;
  - the installed list loads lazily on first open.
- [X] T037 [US4] Implement `src/ribbon/FontPicker.tsx` (ARIA combobox + listbox) and add it with the size select to the Home → Font group in `src/Ribbon.tsx`.
- [X] T038 [US4] In `src/Writer.tsx`, apply a font or size via `applySettings(source, next)` and then `EditorHandle.replaceAll` (one undo step). Show a one-time conflict notice when `conflicts(source)` is non-empty, and an error notice if there is no `\documentclass`. Add Writer tests for the built-in, system (adds the xelatex marker) and back-to-built-in (removes the marker) cases.

---

## Phase 7: User Story 5 - Insert equations (P2)

**Goal**: An equation dialog with a palette, instant preview, inline/display modes and editing of existing equations.

**Independent Test**: quickstart scenario 6.

- [X] T039 [P] [US5] Write `src/latex/equations.test.ts` first, covering:
  - every palette item has a name, a group and a snippet with `□` placeholders;
  - `wrapEquation(tex, "inline" | "display")`;
  - `findEquationAt(doc, pos)` for `\( \)`, `\[ \]`, `$ $` (not `\$`), and `equation`, `equation*`, `align`, `align*` environments; the cursor outside → null; nested braces;
  - `nextPlaceholder(text, from)`.
- [X] T040 [P] [US5] Implement `src/latex/equations.ts` (palette from research R7, `wrapEquation`, `findEquationAt`, `nextPlaceholder`).
- [X] T041 [US5] Write `src/ribbon/EquationDialog.test.tsx` first, with real KaTeX in jsdom:
  - focus starts in the field;
  - a palette click inserts and selects the first `□`;
  - Tab moves to the next `□`;
  - `\frac{a}{b}` renders `.katex`;
  - `\frac{` shows "Can't preview" and Insert stays enabled;
  - empty input disables Insert;
  - Ctrl+Enter inserts;
  - Esc/Cancel calls `onClose` without inserting;
  - the dialog opens prefilled when given an `editing` range;
  - focus is trapped.
- [X] T042 [US5] Implement `src/ribbon/EquationDialog.tsx` (`role="dialog"`, `aria-modal`, small CodeMirror field, KaTeX preview with `katex/dist/katex.min.css`, palette grouped as in research R7, Inline/Display radio). Lazy-load it with `React.lazy` so KaTeX isn't in the startup bundle.
- [X] T043 [US5] Wire Insert → Equation in `src/Ribbon.tsx` and `src/Writer.tsx`: open with `findEquationAt` at the cursor; insert or replace through `EditorHandle.replaceRange`. Add a Writer test for insert and for replace.

---

## Phase 8: User Story 6 - Page layout and margins (P2)

**Goal**: Margin presets and custom margins, paper size and orientation.

**Independent Test**: quickstart scenario 7.

- [X] T044 [US6] Write `src/ribbon/LayoutMenu.test.tsx` first:
  - the Margins menu lists Normal, Narrow, Moderate and Wide with values, plus Custom…;
  - the current preset is marked;
  - Paper offers A4/Letter and Orientation offers Portrait/Landscape;
  - the Custom dialog is prefilled, rejects 0.2 and 7 with inline errors and a disabled Apply, and applies 3;
  - the menus support keyboard (arrows, Esc).
- [X] T045 [US6] Implement `src/ribbon/LayoutMenu.tsx` (menu buttons + Custom margins dialog) and add it to the Layout → Page setup group in `src/Ribbon.tsx`.
- [X] T046 [US6] Apply layout changes in `src/Writer.tsx` via `applySettings` + `replaceAll`, reusing the conflict notice from T038. Add a Writer test where Narrow writes 1.27 cm into the block.

---

## Phase 9: User Story 7 - Insert tables (P3)

**Goal**: A Word-like hover grid and an "Insert table…" dialog.

**Independent Test**: quickstart scenario 8.

- [X] T047 [P] [US7] Write `src/latex/tables.test.ts` first, covering:
  - a 3×2 table with borders gives `|l|l|l|` and a `\hline` on every row;
  - borders off with a header gives one `\hline` after the header;
  - a caption wraps it in `table[h]` + `\centering` + `\caption`;
  - LaTeX specials in the caption are escaped;
  - alignment c/r;
  - bounds (rows 1–50, cols 1–20) throw outside the range.
- [X] T048 [P] [US7] Implement `src/latex/tables.ts` (`tableLatex(spec)`, `escapeLatex(text)`).
- [X] T049 [US7] Write `src/ribbon/TablePicker.test.tsx` first:
  - a 10×8 grid; hover or arrow keys update the "C x R Table" caption;
  - click or Enter inserts;
  - "Insert table…" opens a dialog with validation (inline errors, disabled Insert);
  - Esc closes.
- [X] T050 [US7] Implement `src/ribbon/TablePicker.tsx` and `src/ribbon/TableDialog.tsx`; add them to Insert → Tables in `src/Ribbon.tsx`; insert via `EditorHandle.replaceRange` in `src/Writer.tsx`, selecting the first `□`. Add a Writer test.

---

## Phase 10: Polish & cross-cutting

- [X] T051 [P] Update `docs/DESIGN.md`:
  - the ribbon replaces the compact strip, recorded with today's date;
  - the shortcut list: Ctrl+B/I/U, F5, Ctrl+L, with the Ctrl+I and Ctrl+L overrides of CodeMirror;
  - the live preview behaviour.
- [X] T052 [P] Update the `CLAUDE.md` architecture section: `compile_source` / snapshot / `TEXINPUTS`, the settings block, `src/latex/`, `src/ribbon/`, PdfView, the live preview scheduler, the new commands.
- [X] T053 Update `docs/TRACKER.md`: F-007, F-018 and F-033 status; new rows for the ribbon, fonts, equations, tables, margins and default folder; Decision Log rows for research R1–R6; Verification Log.
- [X] T054 Run `npm test`, `npm run build`, `cd src-tauri; cargo test` and `cargo clippy --all-targets`; fix failures and new warnings. Check that the KaTeX and pdf.js worker chunks are split out of the main bundle.
- [ ] T055 Run every scenario in `specs/002-word-style-editor/quickstart.md` in the native window (`npm run tauri dev`), including 800x600, dark mode and a OneDrive-redirected Documents folder if one is available; record the results in the tracker.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001–T003)**: none; T002 and T003 are parallel. Run T001 first if the dependency bumps overlap.
- **Foundational (T004–T018)**: blocks every story.
  - Backend: T004 → T005 → T006 → T007.
  - T008 is independent, and T009 needs T008.
  - Editor: T010 → T011.
  - Settings: T012 and T013 are parallel, then T014.
  - Ribbon: T015 → T016 → T017; T018 is parallel with T016.
- **US1 (T019–T024)**: needs T005/T008 (compile path) and T017 (View tab).
- **US2 (T025–T028)**: needs only Foundational; independent of US1.
- **US3 (T029–T033)**: needs T011 (EditorHandle) and T016.
- **US4 (T034–T038)**: needs T013, T014 and T016. T038 needs T011.
- **US5 (T039–T043)**: needs T011 and T016.
- **US6 (T044–T046)**: needs T014 and T016; T046 reuses T038's conflict notice, so do US4 first or move that notice into T046.
- **US7 (T047–T050)**: needs T011 and T016.
- **Polish (T051–T055)**: after the chosen stories.

### Shared-file contention

`src/Writer.tsx`, `src/Ribbon.tsx` and `src/Writer.test.tsx` are touched by most stories, so story tasks that edit them run one after another. Pure `src/latex/*` modules, `src/livePreview.ts`, `src/PdfView.tsx` and the `src/ribbon/*` components are separate files, and their [P] tasks can run alongside.

## Parallel Examples

```text
# Foundational, after T001:
T004–T007 (lib.rs)  |  T008 (compile.ts)  |  T010–T011 (Editor)  |  T012 + T013 → T014 (latex/)  |  T015–T018 (Ribbon)

# Pure logic for several stories at once:
T019/T020 livePreview  |  T021/T022 PdfView  |  T029/T030 format  |  T039/T040 equations  |  T047/T048 tables

# Then wire into Writer/Ribbon one story at a time: US1 → US2 → US3 → US4 → US5 → US6 → US7
```

## Implementation Strategy

### MVP

1. Setup + Foundational (ribbon frame, compile path, settings, editor API).
2. US1 live preview + US2 default folder (both P1). Validate quickstart 1–3. Stop and demo.

### Incremental

3. US3 formatting → US4 fonts → US5 equations → US6 margins → US7 tables, validating each story's quickstart scenario.
4. Polish: docs, tracker, full native-window run.

## Notes

- Every editor change from the ribbon goes through `EditorHandle`, so each is exactly one undo step (FR-025).
- Lexy never writes the user's file implicitly; live preview compiles a snapshot (PLAN P5).
- Commit at each checkpoint.

## Implementation notes (2026-11-13)

- T055 (native-window quickstart) is still open: the browser check could not show PDF pixels (the pane was hidden, and pdf.js draws via `requestAnimationFrame`), and native dialogs need the Tauri window.
- Departures from the contracts, all for smaller or safer code:
  - Tables and footnotes insert **empty cells / braces** instead of `□` placeholders. pdfLaTeX can't typeset `□`, so leftover placeholders would break live preview. `□` exists only inside the equation dialog and is stripped on insert.
  - The equation field is a plain `<textarea>`, not a nested CodeMirror.
  - Layout's paper menu is labelled "Size" (Word's wording); Home's Styles is a menu (Normal, Heading 1–3) rather than a select, because the current style isn't tracked.
  - `compile_document` was removed; explicit and live compiles both use `compile_source`.
