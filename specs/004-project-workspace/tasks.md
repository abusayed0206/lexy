---
description: "Task list for Project Workspace"
---

# Tasks: Project Workspace

**Input**: Design documents from `specs/004-project-workspace/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included. The project rule (CLAUDE.md) is that new logic ships with unit tests, and [quickstart.md](quickstart.md) lists the required Rust and Vitest cases. Rust tests live in the `#[cfg(test)] mod tests` of the file they test; frontend tests sit beside the component as `*.test.ts(x)`.

**Organization**: Grouped by user story (US1–US4 from spec.md). US1–US3 are P1, US4 is P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US4 from spec.md

---

## Phase 1: Setup

- [X] T001 Add crates `notify-debouncer-full` and `trash` (latest stable, checked with Context7) to `[dependencies]` in src-tauri/Cargo.toml; run `cargo check` in src-tauri
- [X] T002 Create src-tauri/src/project.rs with module doc comment and an empty `#[cfg(test)] mod tests`; declare `mod project;` in src-tauri/src/lib.rs
- [X] T003 [P] Create src/projects.ts with TS types mirroring contracts/backend-commands.md: `ProjectError` (kinds `"outsideProject" | "notFound" | "nameTaken" | "invalidName" | "noRecycleBin" | "readOnly" | "noProject" | "io"`), `ProjectSummary`, `OpenedProject`, `Entry`, `ImportResult`; no functions yet

---

## Phase 2: Foundational (blocks every story)

- [X] T004 Implement `ProjectError { kind, message }` (serde camelCase, `kind` as lowerCamel string) plus `From<io::Error>` mapping to `io`/`notFound` in src-tauri/src/project.rs
- [X] T005 Implement `resolve_in_project(root: &Path, rel: &str) -> Result<PathBuf, ProjectError>` in src-tauri/src/project.rs (research R2): reject empty-after-trim only for writes, absolute paths, drive/UNC prefixes, any `..` component, reserved names (`CON PRN AUX NUL COM1-9 LPT1-9`, case-insensitive, with or without extension), names ending in `.` or space, and characters `<>:"/|?*` inside a component; accept `/` or `\` separators; canonicalize the nearest existing ancestor and require it `starts_with` the canonical root, else `outsideProject`
- [X] T006 Tests for T005 in src-tauri/src/project.rs: `..\x`, `C:\x`, `\\server\x`, `CON`, `a\CON.txt`, `name.` rejected; `chapters/intro.tex` and `chapters\intro.tex` accepted; a directory junction inside the root pointing outside (create with `std::os::windows::fs::symlink_dir` or `mklink /J`, skip with a printed note if creation fails) rejected
- [X] T007 Implement `Entry` struct and `classify(name) -> (editable, hidden)` in src-tauri/src/project.rs per data-model.md: editable extensions `tex, bib, cls, sty, txt, bst, md`; hidden when the name starts with `.` or the extension/name is one of `aux log fls fdb_latexmk synctex.gz out toc bbl blg bcf run.xml lof lot`; with tests
- [X] T008 Implement `ProjectState` managed state in src-tauri/src/project.rs (`Mutex<Option<OpenProject>>` holding canonical root, name, mainDocument, readOnly, lock file handle, watcher handle, `last_writes: HashMap<PathBuf, SystemTime>`) and a helper `with_project(&state, |p| …)` returning `noProject` when none is open; `.manage()` it in src-tauri/src/lib.rs
- [X] T009 Implement `projects.json` store in src-tauri/src/project.rs (research R8, data-model RecentProjects): path `%LOCALAPPDATA%\Lexy\projects.json`; `{ version: 1, lastOpen, projects: [{ path, mainDocument, lastOpened }] }`; "Max 20 entries, newest first, deduplicated by case-insensitive path"; unreadable JSON or unknown `version` → treat as empty and rename the bad file to `projects.json.bak`; write via the existing `write_atomic`; functions `load_store(dir)`, `save_store(dir, &store)`, `touch(&mut store, path, now)`; take the app-data dir as a parameter so tests use a temp dir; with tests
- [X] T010 Implement `detect_main(root) -> (Option<String>, Vec<String>)` in src-tauri/src/project.rs (research R10): candidates are top-level `*.tex` whose first 64 KiB, before `\begin{document}`, contain `\documentclass` on a line not starting with `%` (after leading whitespace); one candidate → main; tests for one, two, none and commented-out cases
- [X] T011 Implement `list_dir(rel) -> Vec<Entry>` and `count_entries(path, limit)` in src-tauri/src/project.rs: folders first, then case-insensitive name order; `count_entries` stops at `limit` and skips hidden names (research R11); tests with a temp tree
- [X] T012 Implement `read_file(rel)` / `write_file(rel, contents)` in src-tauri/src/project.rs reusing the `read_document` limits (UTF-8, ≤ 10 MiB, editable extensions only) and `write_atomic`; `write_file` fails `readOnly` when read-only and records the written mtime in `last_writes`; tests
- [X] T013 Implement typed invoke wrappers in src/projects.ts for every command in contracts/backend-commands.md (`listProjects`, `lastOpenProject`, `createProject`, `countEntries`, `forgetProject`, `openProject`, `closeProject`, `setMainDocument`, `listDir`, `readFile`, `writeFile`, `createFile`, `createFolder`, `renameEntry`, `deleteEntry`, `importFiles`, `openEntryExternal`, `compileProject`) and `isProjectError(e, kind)`
- [X] T014 Create pure reducer src/openFiles.ts per data-model.md OpenFile: state `{ files: Map<path, OpenFile>, current, main }`; events `opened, edited, saved, switched, diskChanged, reloaded, renamed(from,to), deleted(path), mainSet(path)`; rules "renaming a folder renames every open file under it; deleting the current file switches to the main document; the main document can't be closed"; plus selectors `dirtyFiles(state)`
- [X] T015 [P] Tests for T014 in src/openFiles.test.ts covering every event and the three rules

**Checkpoint**: backend can resolve paths, list folders, read/write files and remember projects; frontend has typed wrappers and the open-files reducer.

---

## Phase 3: User Story 1 - Project Home and opening projects (P1) 🎯 MVP

**Goal**: Launch shows Project Home (or reopens the last project); users create projects and open any folder.

**Independent Test**: With three folders in `Documents\Lexy`, launch, see all three newest first, click one, and land in the Writer with its main document open (quickstart US1 scenarios 1–2).

### Tests for User Story 1

- [X] T016 [P] [US1] Rust tests in src-tauri/src/project.rs for `list_projects` (default-folder scan + recent entries, dedupe, `missing` flag, sort by `lastOpened` desc then `modified`) and `create_project` (`<name> (2)` when taken, `invalidName` for `a:b`)
- [X] T017 [P] [US1] Rust test in src-tauri/src/project.rs: opening a root whose lock is already held by another handle returns `readOnly: true` (research R9)
- [X] T018 [P] [US1] Vitest src/ProjectHome.test.tsx: lists projects with relative dates, location only for outside projects, Missing rows with "Remove from list", New project inline field (Enter creates, Esc cancels, invalid-name message), Open folder… with >5000 entries shows "This folder is large. Open anyway?"
- [X] T019 [P] [US1] Update src/App.test.tsx: after setup, `lastOpenProject()` non-null → Writer; null → ProjectHome

### Implementation for User Story 1

- [X] T020 [US1] Implement commands `list_projects`, `last_open_project`, `create_project(name, starter)`, `count_entries`, `forget_project` in src-tauri/src/project.rs using `default_document_folder` logic from lib.rs (move the shared helper into project.rs or make it `pub(crate)`)
- [X] T021 [US1] Implement lock acquisition in src-tauri/src/project.rs: `%LOCALAPPDATA%\Lexy\Locks\<build_key(root)>.lock`, `File::try_lock()`; held → `readOnly: true`
- [X] T022 [US1] Implement `open_project(path)` / `close_project()` commands in src-tauri/src/project.rs per contract: close previous, canonicalize, lock, detect main (T010) or use remembered `mainDocument`, update store (`lastOpen`, `lastOpened`); `close_project` drops lock/watcher and sets `lastOpen` to null; register all US1 commands in `invoke_handler` in src-tauri/src/lib.rs
- [X] T023 [US1] Create src/ProjectHome.tsx per contracts/ui.md (header, New project Ctrl+N, Open folder… Ctrl+O via dialog `open({ directory: true })`, list with keyboard Up/Down/Enter, Missing rows, fallback notice, large-folder confirm); styles in src/App.css using existing theme variables
- [X] T024 [US1] Update src/App.tsx: checking → setup → (`lastOpenProject()` ? Writer(project) : ProjectHome); ProjectHome `onOpen(path)` calls `openProject` and switches to Writer; Writer gets `onHome()` to return
- [X] T025 [US1] Make src/Writer.tsx take an `OpenedProject` prop: load the main document via `readFile`, show project name and current file in the status bar, and if `mainDocument` is null show the "Which file is the main document?" chooser (contracts/ui.md) listing `candidates`, or the "No main document found…" message when empty; calls `setMainDocument`
- [X] T026 [US1] Ribbon File tab in src/Ribbon.tsx: replace New/Open with New project, Open folder…, Project Home, Recent projects submenu (max 10 from `listProjects`); update src/Ribbon.test.tsx
- [X] T027 [US1] Adapt existing tests in src/Writer.test.tsx to the project-based Writer (mock src/projects.ts instead of src/documents.ts for file IO)

**Checkpoint**: Project Home works end to end with single-file projects; existing behaviour is preserved for the main document.

---

## Phase 4: User Story 2 - File sidebar and multi-file editing (P1)

**Goal**: Sidebar lists project files; open/switch files keeping per-file state; create, rename, delete, drag-in import; outside changes reflected.

**Independent Test**: Create `chapters\intro.tex`, type in it, switch to main and back — text, cursor and undo intact, unsaved dot shown (quickstart US2 scenarios 3–5).

### Tests for User Story 2

- [X] T028 [P] [US2] Rust tests in src-tauri/src/project.rs for `create_file`/`create_folder` (`nameTaken`), `rename_entry` (moves across folders, refuses existing target, refuses outside), `delete_entry` (refuses root; temp-dir trash may be unavailable — assert `noRecycleBin` or success), `import_files` with `"ask"` returning conflicts and with `"keepBoth"` producing `fig (2).png`
- [X] T029 [P] [US2] Vitest src/Sidebar.test.tsx: lazy expand calls `listDir` per folder, hidden files toggle, unsaved dot and Main badge, keyboard (Up/Down, Right/Left, Enter, F2 inline rename, Delete with confirm, Shift+F10 menu), context menu items, drop on file row targets its folder
- [X] T030 [P] [US2] Vitest in src/Editor.test.tsx: `switchTo` restores text, selection and undo history per file; `applyTo` on a non-current file is one undo step there
- [X] T031 [P] [US2] Vitest in src/Writer.test.tsx: switching files keeps unsaved edits; non-text file calls `openEntryExternal`; watcher event reloads a clean file and shows "<name> changed on disk." with Reload / Keep mine for a dirty one

### Implementation for User Story 2

- [X] T032 [US2] Implement commands `list_dir`, `read_file`, `write_file`, `create_file`, `create_folder`, `rename_entry`, `delete_entry(rel, permanent)` (Recycle Bin via `trash::delete`, map "no recycle bin" failure to `noRecycleBin`), `open_entry_external` (resolve then `app.opener().open_path`) in src-tauri/src/project.rs; register in src-tauri/src/lib.rs
- [X] T033 [US2] Implement `import_files(sources, targetDir, onConflict)` in src-tauri/src/project.rs (research R5): sources must exist; target through `resolve_in_project`; folders copied recursively; `keepBoth` names `name (2).ext`; returns `ImportResult`
- [X] T034 [US2] Implement the watcher in src-tauri/src/project.rs (research R3): `notify_debouncer_full::new_debouncer(Duration::from_millis(500), None, …)` on root, recursive; drop events for hidden/build-clutter names and for paths whose mtime matches `last_writes`; emit `project-changed { paths }` (relative, deduplicated) and `project-missing` when root disappears or the watcher errors; started in `open_project`, dropped in `close_project`
- [X] T035 [US2] Extend src/Editor.tsx `EditorHandle` with `switchTo(path, text)`, `textOf(path)`, `applyTo(path, edit)` and `forget(path)` backed by `Map<path, EditorState>` (research R7); keep `apply`/`replaceAll` for the current file
- [X] T036 [US2] Create src/Sidebar.tsx per contracts/ui.md (header buttons, "…" menu with Show hidden files / Open in Explorer / Project Home, tree with roving tabindex and `role="tree"`, inline rename, context menu, drop highlight using `getCurrentWebview().onDragDropEvent` position → row) with styles in src/App.css
- [X] T037 [US2] Wire Sidebar into src/Writer.tsx with the openFiles reducer (T014): open/switch via `readFile` + `editor.switchTo`, unsaved dots, delete/rename update open files, import conflicts dialog "<n> files already exist." Replace / Keep both / Skip, delete dialogs "Move <name> to the Recycle Bin?" and the no-Recycle-Bin variant
- [X] T038 [US2] Handle `project-changed` in src/Writer.tsx: refresh affected folders in Sidebar; clean open file → reload text; dirty → `diskChanged` bar with Reload / Keep mine; handle `project-missing` with "Project folder is missing." bar
- [X] T039 [US2] Layout in src/Writer.tsx and src/App.css: three columns, sidebar 220 px default, resizable 160–400 px, Ctrl+Shift+E (Ctrl+B is Bold) and View tab "Files" toggle (src/Ribbon.tsx), starts collapsed under 900 px wide; verify nothing overlaps at 800x600
- [X] T040 [US2] Shortcuts in src/Writer.tsx capture listener: Ctrl+N new file in current folder, Ctrl+O open folder, Ctrl+Shift+E sidebar, Ctrl+S save all modified files, Ctrl+Shift+S save current file as (name inside project)

**Checkpoint**: multi-file projects are editable; compile still targets the main document but only with saved sub-files until US3.

---

## Phase 5: User Story 3 - Compile the main document from any file (P1)

**Goal**: F5 and live preview compile the main document using unsaved text from all open files, without writing user files.

**Independent Test**: Edit `chapters\intro.tex` without saving; live preview shows the change and the file on disk is unchanged (quickstart US3 scenario 6).

### Tests for User Story 3

- [X] T041 [P] [US3] Extend `compile_end_to_end_when_tools_are_installed` in src-tauri/src/lib.rs: project with `main.tex` (`\input{chapters/intro}`, `\includegraphics{fig.png}` with a tiny generated PNG, and an `\include{chapters/ch2}`), buffer for `chapters/intro.tex` differs from disk → PDF text contains the buffer text, disk file unchanged, `fig.png` absent from the build folder
- [X] T042 [P] [US3] Vitest in src/Writer.test.tsx: with a sub-file open, F5 saves all dirty files then calls `compileProject(main, buffers)`; live preview passes dirty buffers without saving; ribbon settings edit the main document via `applyTo` and show "Applied to <main>.tex"

### Implementation for User Story 3

- [X] T043 [US3] Implement `compile_project(main, buffers)` in src-tauri/src/lib.rs (research R1): validate `main` equals the project main, each buffer path through `resolve_in_project`, editable extension, ≤ 10 MiB; main snapshot text from buffers or disk to `<build>\<stem>.tex`; clear and rewrite `<build>\overlay\`; mirror project subfolders (folders only, skipping hidden) into `<build>`; set `TEXINPUTS` and `BIBINPUTS` to `<build>\overlay;<root>;`; reuse `CompileLock`, timeout, engine and log logic from `compile_snapshot` (extract the shared latexmk run into one function rather than copying it)
- [X] T044 [US3] Add `compileProject(main, buffers)` to src/compile.ts and switch src/Writer.tsx explicit compile and src/livePreview.ts callers to it, collecting dirty buffers with `editor.textOf`
- [X] T045 [US3] Route ribbon document-setting actions in src/Writer.tsx to the main document (`applyTo(main, edit)` when current ≠ main) and read settings from `textOf(main)`
- [X] T046 [US3] Main document missing at compile time in src/Writer.tsx: if `compileProject` fails with `notFound` for main, show the main-document chooser instead of a compile error; Sidebar context menu "Set as main document" for `.tex` files

**Checkpoint**: all P1 stories done — the MVP of the project system.

---

## Phase 6: User Story 4 - Close and switch projects safely (P2)

**Goal**: No unsaved edit is lost when closing, switching or going home; PDF is exported beside the main document.

**Independent Test**: Edit two files, close the window — one prompt lists both with Save all / Don't save / Cancel (quickstart US4 scenario 8).

### Tests for User Story 4

- [X] T047 [P] [US4] Vitest in src/Writer.test.tsx: close / Project Home / open other project with two dirty files shows one prompt listing both; Save all writes both then proceeds; Cancel aborts; on close the PDF is exported beside the main document (existing F-045 tests adapted); read-only project disables Save, Compile and file actions and shows "Open in another Lexy window. Read-only."

### Implementation for User Story 4

- [X] T048 [US4] Replace `confirmDiscard` in src/documents.ts with `confirmUnsaved(files: string[])` returning `"save" | "discard" | "cancel"` (dialog "Save changes to these files?") and use it in src/Writer.tsx for window close (`onCloseRequested`), Project Home and opening another project
- [X] T049 [US4] Update PDF export on close in src/Writer.tsx to use the absolute main document path, recompiling with `compileProject` when the last PDF came from other text (keep F-045 rules); window close leaves `lastOpen` set, Project Home calls `closeProject`
- [X] T050 [US4] Read-only mode in src/Writer.tsx and src/Sidebar.tsx: disable Save, Compile, live preview and file actions when `readOnly`; show the read-only bar; "Project folder is missing." bar offers Save as new project (create_project + write open buffers)

---

## Phase 7: Polish & cross-cutting

- [X] T051 Remove superseded single-file code: `read_document`, `write_document`, `prepare_save_path`, `compile_source` in src-tauri/src/lib.rs and `chooseOpenPath`, `chooseSavePath`, `prepareSavePath`, `readDocument`, `writeDocument` in src/documents.ts, with their tests; keep `default_document_folder`, `export_pdf`, `suggestFileName`, `fileName`
- [X] T052 [P] Update CLAUDE.md Architecture section: project model, `project.rs`, path gate rule, overlay compile, new commands/events, shortcuts
- [X] T053 [P] Update docs/DESIGN.md with sidebar rules (widths, collapse below 900 px, 800x600) and docs/TRACKER.md: new F-ids for Project Home, sidebar, main document, multi-file compile, watcher, read-only lock; mark F-014 superseded; move the intake row to the tracker
- [X] T054 [P] Ensure `specs/003-pdf-source-sync/spec.md` assumption about `\input` files notes it can now switch to the file (FR-005 follow-up)
- [X] T055 Run `npm run build`, `npm test`, `cargo test` in src-tauri; then walk quickstart.md manual scenarios 1–10 in `npm run tauri dev` and record results in docs/TRACKER.md Verification Log

---

## Dependencies & Execution Order

- **Setup (T001–T003)** → **Foundational (T004–T015)** → stories.
- **US1 (T016–T027)** first: every other story needs an open project in the Writer.
- **US2 (T028–T040)** depends on US1. **US3 (T041–T046)** depends on US1 and on T035 (`textOf`/`applyTo`) from US2. **US4 (T047–T050)** depends on US2 (multiple dirty files) and US3 (export recompiles via `compileProject`).
- **Polish (T051–T055)** last; T051 only after US4 so no caller of the removed code remains.

Within a phase: tests marked [P] first (expected to fail), then implementation in listed order. Backend tasks in project.rs are sequential (same file).

## Parallel Opportunities

- Setup: T003 alongside T001–T002.
- Foundational: T015 once T014 exists; frontend T013–T014 in parallel with backend T004–T012.
- US1: T016, T017, T018, T019 together; then backend T020–T022 in parallel with frontend T023.
- US2: T028–T031 together; backend T032–T034 in parallel with frontend T035–T036.
- US3: T041 and T042 together; T043 (Rust) in parallel with T045 (frontend).
- Polish: T052, T053, T054 together.

## Implementation Strategy

- **MVP = US1 + US2 + US3** (all P1): Project Home, sidebar and multi-file compile. US1 alone is a usable increment (projects with a single main file) and should be checked with quickstart scenarios 1–2 before moving on.
- Deliver story by story; run `npm test` and `cargo test` at every checkpoint.
- US4 hardens safety and can follow in the same release; T051 cleanup lands last.
