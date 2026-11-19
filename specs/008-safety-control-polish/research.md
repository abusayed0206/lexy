# Research: Safety and Control Polish

All decisions below come from reading the current code (2026-11-18). No new dependencies are needed: `sha2`, `serde_json`, pdf.js 5.7.284 and the existing process helpers already cover everything.

## R1. How to stop a running compile

**Decision**: A managed `CompileCancel(Arc<AtomicU64>)` holds a cancel *epoch*. `compile_project` (and `export_pdf_with_notes`) read the epoch when the command is invoked, before they wait for `CompileLock`. A new `cancel_compile` command increments the epoch. `run_with_timeout` gains a `cancelled: &dyn Fn() -> bool` check inside its existing 50 ms poll loop; when it returns true it calls the existing `kill_tree` (taskkill `/T /F`) and reports `stopped`. A compile whose epoch is already stale when it gets the lock returns a stopped result without starting latexmk, so one press also drops anything queued behind the running compile in the backend.

**Rationale**: The poll loop and tree-kill already exist and are tested (`run_with_timeout_kills_the_whole_process_tree`). An epoch rather than a boolean flag avoids a race: a flag reset by the next compile could wipe a cancel aimed at an older one, and a flag set while nothing runs could kill the *next* compile. With the epoch, only compiles that started before the press are affected (FR-012, FR-014). Taskkill normally takes well under a second, which fits the 2 s target with the 50 ms poll.

**Partial output (FR-015)**: After a stop, `compile_project_at` deletes `<stem>.fdb_latexmk` and `<stem>.pdf` from the build folder. The shown copy in `.lexy-shown\` is only replaced after a success, so the last good PDF and its SyncTeX data stay untouched (FR-013). Deleting the database makes latexmk re-run from scratch next time, the same fix already used when the overlay set changes.

**Other callers**: `run_with_timeout` is also used by `export.rs`, `git.rs` and `sync.rs`. They pass a check that never fires (`&|| false`), so their behaviour is unchanged.

**Alternatives considered**: Storing the `Child` handle in managed state and killing it from the cancel command needs a mutex around a handle that the blocking thread is also waiting on, and gives no clean way to cancel a queued compile. A Windows Job Object would kill the tree on its own, but `taskkill /T` already works and is tested.

## R2. Where the stopped state shows up in the UI

**Decision**: `CompileResult` gains `stopped: bool` (serde default `false`). The Writer's `compileReducer` handles a stopped result by keeping the previous `pdfPath`, `engine` and log, setting status `stopped` with the label "Compile stopped", and never opening the log drawer. The live-preview scheduler gains `cancel()`, which clears its pause timer and its queued flag; the in-flight compile resolves as stopped. Shift+F5 joins the capture-phase shortcut listener next to F5. A Stop button sits next to the status text and is rendered only while the status is `compiling`.

**Leaving a project (FR-016)**: the settle flow already treats a failed export compile as "keep the window open once with a notice"; a stopped result takes the same path with the text "The PDF was not updated: the compile was stopped."

**Alternatives considered**: Turning the Compile button itself into Stop would move a control while it is being clicked, which risks stopping by accident with a double click.

## R3. Crash recovery: storage, timing, cleanup

**Decision**: A new `src-tauri/src/recovery.rs` module stores one JSON file per unsaved file at `%LOCALAPPDATA%\Lexy\Recovery\<build_key(root)>\<build_key(rel)>.json`, holding `{ path, text, savedAt, baseHash }`. `baseHash` is the SHA-256 of the file on disk at the moment of the copy (empty for a file not on disk). Writes go through the existing `write_atomic` (temp file, fsync, rename), so a crash mid-write leaves the previous copy (FR-010). Commands: `recovery_save(path, text)`, `recovery_list()` and `recovery_discard(paths | null)`. All are project-relative through `resolve_in_project` and refused in read-only windows (FR-008). `recovery_list` also prunes copies older than 30 days for every project (FR-009) and leaves out copies whose text equals the current disk text.

**Timing (FR-001, SC-003)**: A pure scheduler, `src/recovery.ts` (same style as `livePreview.ts`, injectable timers), writes 2 s after the last change, with a 10 s maximum wait during continuous typing. It sends only files that are unsaved and whose text changed since their last copy. The IPC call is off the keystroke path. Text is capped by the existing 10 MiB file limit.

**Cleanup (FR-007)**: The Writer calls `recovery_discard([path])` after a successful save of that file and after Don't save or Discard. It calls `recovery_discard(null)` after the settle flow of a normal close, Project Home or project switch, once the user has picked Save all or Don't save. Cancel keeps everything.

**Detecting an unclean exit**: No session marker is needed. Copies only survive when the app did not get to clean them up, so "copies exist when the project opens" means an unclean exit (or a still-unsaved file left open in a session that crashed).

**Alternatives considered**: Reusing auto-save writes into the project, which breaks FR-005. Reusing snapshots mixes saved and unsaved history and has a 10-minute throttle. `localStorage` is the frontend's own storage, so Rust could not manage or prune it, and it is lost with WebView data.

## R4. Restoring recovered text

**Decision**: Restore uses the existing `restoreSnapshot` path: open the file if needed, then `replaceMainText`, which is one undo step back to the disk text and marks the file unsaved (FR-005). When `baseHash` differs from the current disk hash, the Writer adds the InfoBar text "This file changed on disk after Lexy saved your unsaved text. Ctrl+Z returns to the disk version." (FR-006). A deleted file is reopened as a new unsaved buffer at its old path, using the same path as File → New file; the next save creates it.

**UI**: When the project opens, if `recovery_list()` is non-empty, the Writer shows one InfoBar: "Lexy found unsaved text from your last session in N files" with Restore all / Discard all / Review…. Review… opens a dialog listing each file with Restore and Discard (primary-first order, `windowsOrder`).

## R5. Engine line editing and the font settings block

**Decision**: A new pure module, `src/latex/engine.ts`, provides `readEngine(text)`, which returns the choice and line index, and `engineEdit(text, choice)`, which returns the `TextEdit` or null. It follows the Rust `marker_engine` rules: first 5 lines, optional spaces, `%`, optional spaces, `!TEX`, optional `TS-`, `program`, `=`, a known engine, any case (FR-020). Choosing an engine replaces the existing line in place or inserts it as line 1. Automatic removes it. The edit is applied through `EditorHandle.applyTo(main)` so it is one undo step on the main document (FR-019).

**Interplay with font settings**: `applySettings` in `src/latex/settings.ts` adds or removes the exact line `% !TEX program = xelatex` when the font kind changes. To keep the two features from fighting:
- The engine menu writes the TeXworks `TS-` form (`% !TEX TS-program = lualatex`). The compiler already accepts it (`marker_engine_reads_texworks_convention`).
- `applySettings` only ever removes its own exact line. It does not add its line when any engine line already picks XeLaTeX or LuaLaTeX. When an explicit pdfLaTeX line is present and the new font needs a Unicode engine, it replaces that line with its own and the Writer says so in an InfoBar.
- The engine menu treats Lexy's own line as "XeLaTeX (set by the font)" and replaces it like any other line.

**Font warning (FR-022)**: Choosing pdfLaTeX when `readSettings(main).font.kind` is `system` or `project` asks through the existing `useChoice` dialog ("This font needs XeLaTeX or LuaLaTeX. Use pdfLaTeX anyway?", destructive style, so Cancel has focus).

**Reason display (FR-021)**: `CompileResult` gains `engineReason`, taken from the reason Rust already computes (`marker`, a package or class name such as `fontspec`, `default`, or the Bangla sentence). The engine menu shows "Last compile: XeLaTeX (engine line)".

**Placement**: An "Engine" menu button on the Layout ribbon tab, next to the other document settings, plus palette commands `engine.auto`, `engine.pdflatex`, `engine.xelatex` and `engine.lualatex`.

**Alternatives considered**: A per-project engine setting in `projects.json` would not travel with the file to Overleaf, other editors or Git, which is the reason the settings block exists.

## R6. Finding text in a canvas-rendered PDF

**Decision**: Use pdf.js `page.getTextContent()` per page, cached per loaded document and fetched lazily on the first search. A pure module, `src/pdfView/find.ts`, builds one normalised string per page (items joined, `hasEOL` and runs of whitespace become one space, case-folded per character so offsets stay aligned) together with a map from each character back to its item and offset. It returns matches as `{ page, rects }`. Each rect is computed from the item's `transform`, `width` and `height`, split proportionally by character offset, and converted with `page.getViewport({ scale: 1 })` then the page's CSS scale (`wrapper.dataset.scale`). PdfView draws absolutely positioned highlight `div`s inside each `.pdf-page`, which needs `position: relative`.

**Rationale**: PdfView renders its own canvases (no `PDFViewer` or text layer). pdf.js's `PDFFindController` needs `PDFViewer`, `EventBus` and a text layer, which would mean a second rendering stack. Proportional splitting inside an item is approximate for proportional fonts, but enough to show where a match is.

**Keys (FR-025)**: Ctrl+F is handled in PdfView's own `onKeyDown`, so it only fires while the PDF has focus. The Writer's capture listener does not bind plain Ctrl+F (checked: only Ctrl+Shift+F and Shift+Alt+F), and CodeMirror keeps Ctrl+F in the editor.

**After a recompile (FR-029)**: When `bytes` changes, the cache is dropped, the search re-runs on the new document after the pages are swapped in, and the current match becomes the first match at or after the old one's page and top position.

**Colours (FR-027)**: New tokens `--find-match` and `--find-current` on `:root`, with dark and forced-colors (`Mark` / `Highlight`) variants, are added to `src/test/contrast.test.ts`.

**Alternatives considered**: Drawing pdf.js's text layer (`TextLayer`) for every page and using the browser's find would also give selection, which the user declined (2026-11-14), and costs a DOM node per text run.
